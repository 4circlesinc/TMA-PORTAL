<?php

namespace App\Support\Apple;

use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Laravel\Socialite\Two\User as OAuthUser;
use Throwable;

/**
 * Sign in with Apple, the parts the web flow and the iOS app share.
 *
 * Apple has no client secret to copy from a console: the secret is a JWT this
 * server signs with the .p8 key from Certificates, Identifiers & Profiles >
 * Keys. The person comes back as an ID token, also a JWT, signed by one of
 * Apple's published keys; there is no userinfo endpoint behind it.
 *
 * Two client IDs, one key. The web signs in as the Services ID
 * (APPLE_CLIENT_ID), the iOS app as its bundle ID (APPLE_BUNDLE_ID), and a
 * token can only be redeemed or revoked by the client it was issued to.
 */
class AppleSignIn
{
    public const ISSUER = 'https://appleid.apple.com';

    private const KEYS_URL = 'https://appleid.apple.com/auth/keys';

    private const TOKEN_URL = 'https://appleid.apple.com/auth/token';

    private const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

    /** The web button: a Services ID, plus the key that signs for it. */
    public static function configured(): bool
    {
        return (bool) config('services.apple.client_id') && self::canSign();
    }

    /** The iOS app's own sheet: the bundle ID, plus the same key. */
    public static function nativeConfigured(): bool
    {
        return (bool) config('services.apple.bundle_id') && self::canSign();
    }

    public static function webClientId(): string
    {
        return (string) config('services.apple.client_id');
    }

    public static function bundleId(): string
    {
        return (string) config('services.apple.bundle_id');
    }

    /**
     * The client secret for one client ID. Apple accepts up to six months;
     * an hour, cached for fifty minutes, keeps a leaked one short-lived.
     */
    public static function clientSecret(string $clientId): ?string
    {
        $key = self::privateKey();
        $keyId = (string) config('services.apple.key_id');
        $teamId = (string) config('services.apple.team_id');
        if ($key === null || $keyId === '' || $teamId === '' || $clientId === '') {
            return null;
        }

        return Cache::remember('apple:client-secret:'.md5($clientId.$keyId.$teamId), now()->addMinutes(50), function () use ($key, $keyId, $teamId, $clientId) {
            $now = time();

            return JWT::encode([
                'iss' => $teamId,
                'iat' => $now,
                'exp' => $now + 3600,
                'aud' => self::ISSUER,
                'sub' => $clientId,
            ], $key, 'ES256', $keyId);
        });
    }

    /**
     * Check an ID token and return its claims: Apple's signature, issuer,
     * audience and expiry, and the nonce when the client sent one.
     *
     * @return array<string, mixed>
     *
     * @throws AppleSignInException
     */
    public static function verifyIdToken(string $idToken, string $audience, ?string $rawNonce = null): array
    {
        if ($idToken === '' || $audience === '') {
            throw new AppleSignInException('No ID token to check.');
        }

        $claims = self::decode($idToken, refresh: false);

        if (($claims['iss'] ?? null) !== self::ISSUER) {
            throw new AppleSignInException('The ID token was not issued by Apple.');
        }

        if (($claims['aud'] ?? null) !== $audience) {
            throw new AppleSignInException('The ID token was issued to another app.');
        }

        if (! is_string($claims['sub'] ?? null) || $claims['sub'] === '') {
            throw new AppleSignInException('The ID token names nobody.');
        }

        // The app sends Apple the SHA-256 of a nonce it keeps, and Apple signs
        // that hash into the token. A token lifted from another sign-in cannot
        // carry the hash of a nonce this request knows.
        if ($rawNonce !== null) {
            $expected = hash('sha256', $rawNonce);
            if (! is_string($claims['nonce'] ?? null) || ! hash_equals($expected, $claims['nonce'])) {
                throw new AppleSignInException('The ID token belongs to a different sign-in.');
            }
        }

        return $claims;
    }

    /**
     * Redeem an authorization code. The response carries the ID token and,
     * the one thing worth keeping, a refresh token: Apple requires it to be
     * revoked when the account is deleted.
     *
     * @return array<string, mixed>
     *
     * @throws AppleSignInException
     */
    public static function exchangeCode(string $code, string $clientId, ?string $redirectUri = null): array
    {
        $secret = self::clientSecret($clientId);
        if ($secret === null || $code === '') {
            throw new AppleSignInException('Sign in with Apple is not configured.');
        }

        $response = Http::asForm()->acceptJson()->timeout(15)->post(self::TOKEN_URL, array_filter([
            'grant_type' => 'authorization_code',
            'client_id' => $clientId,
            'client_secret' => $secret,
            'code' => $code,
            'redirect_uri' => $redirectUri,
        ], fn ($value) => $value !== null && $value !== ''));

        if (! $response->successful()) {
            throw new AppleSignInException('Apple refused the authorization code: '.(string) data_get($response->json(), 'error', $response->status()));
        }

        return (array) $response->json();
    }

    /**
     * Revoke a refresh token. It was issued to either the website or the app
     * and only that client may revoke it, so both are tried; Apple answers
     * 200 for a token that is already gone.
     */
    public static function revoke(string $refreshToken): bool
    {
        foreach (array_unique(array_filter([self::webClientId(), self::bundleId()])) as $clientId) {
            $secret = self::clientSecret($clientId);
            if ($secret === null) {
                continue;
            }

            try {
                $response = Http::asForm()->timeout(15)->post(self::REVOKE_URL, [
                    'client_id' => $clientId,
                    'client_secret' => $secret,
                    'token' => $refreshToken,
                    'token_type_hint' => 'refresh_token',
                ]);
            } catch (Throwable $e) {
                Log::warning('Sign in with Apple: revoke failed', ['error' => $e->getMessage()]);

                continue;
            }

            if ($response->successful()) {
                return true;
            }
        }

        Log::warning('Sign in with Apple: no client could revoke the token');

        return false;
    }

    /**
     * Apple sends the name once, on the first authorization only: as JSON in
     * the web form post's `user` field, or from the app's credential.
     */
    public static function nameFromUserField(mixed $user): ?string
    {
        if (! is_string($user) || $user === '') {
            return null;
        }

        $decoded = json_decode($user, true);
        if (! is_array($decoded)) {
            return null;
        }

        return self::joinName(data_get($decoded, 'name.firstName'), data_get($decoded, 'name.lastName'));
    }

    public static function joinName(mixed $first, mixed $last): ?string
    {
        $name = trim(implode(' ', array_filter([
            is_string($first) ? trim($first) : '',
            is_string($last) ? trim($last) : '',
        ])));

        return $name !== '' ? $name : null;
    }

    /** Apple writes its booleans as "true" / "false" strings in some tokens. */
    public static function emailVerified(array $claims): bool
    {
        $value = $claims['email_verified'] ?? false;

        return $value === true || $value === 'true';
    }

    /**
     * The person as the rest of SocialAuthController expects them: a
     * Socialite user, so Apple takes the same path as Google and Microsoft.
     *
     * @param  array<string, mixed>  $claims
     * @param  array<string, mixed>  $tokens
     */
    public static function oauthUser(array $claims, ?string $name, array $tokens = []): OAuthUser
    {
        $user = (new OAuthUser)->setRaw($claims)->map([
            'id' => (string) $claims['sub'],
            'name' => $name,
            'email' => is_string($claims['email'] ?? null) ? $claims['email'] : null,
            'avatar' => null,
        ]);

        $user->token = isset($tokens['access_token']) ? (string) $tokens['access_token'] : null;
        $user->refreshToken = isset($tokens['refresh_token']) ? (string) $tokens['refresh_token'] : null;
        $user->expiresIn = $tokens['expires_in'] ?? null;
        $user->accessTokenResponseBody = $tokens;

        return $user;
    }

    /**
     * @return array<string, mixed>
     *
     * @throws AppleSignInException
     */
    private static function decode(string $idToken, bool $refresh): array
    {
        $keys = self::keys($refresh);
        $leeway = JWT::$leeway;

        try {
            // A minute either way for clock drift between Apple and here.
            JWT::$leeway = 60;

            return (array) json_decode(json_encode(JWT::decode($idToken, JWK::parseKeySet($keys, 'RS256'))), true);
        } catch (\UnexpectedValueException $e) {
            // Apple rotates its keys. A kid we have not seen means the cached
            // set is stale; fetch it once more before refusing.
            if (! $refresh && str_contains($e->getMessage(), '"kid"')) {
                return self::decode($idToken, refresh: true);
            }

            throw new AppleSignInException('The ID token did not verify: '.$e->getMessage(), previous: $e);
        } catch (Throwable $e) {
            throw new AppleSignInException('The ID token did not verify: '.$e->getMessage(), previous: $e);
        } finally {
            JWT::$leeway = $leeway;
        }
    }

    /**
     * Apple's public keys, cached for an hour.
     *
     * @return array<string, mixed>
     *
     * @throws AppleSignInException
     */
    private static function keys(bool $refresh): array
    {
        if ($refresh) {
            Cache::forget('apple:jwks');
        }

        $keys = Cache::remember('apple:jwks', now()->addHour(), function () {
            $response = Http::acceptJson()->timeout(10)->get(self::KEYS_URL);

            return $response->successful() ? (array) $response->json() : null;
        });

        if (! is_array($keys) || empty($keys['keys'])) {
            Cache::forget('apple:jwks');

            throw new AppleSignInException("Apple's signing keys could not be fetched.");
        }

        return $keys;
    }

    /** The .p8 contents, or a path to the file, as APNS_PRIVATE_KEY accepts. */
    private static function privateKey(): ?string
    {
        $raw = str_replace('\n', "\n", (string) config('services.apple.private_key'));
        if ($raw === '') {
            return null;
        }
        if (! str_contains($raw, 'PRIVATE KEY') && is_file($raw)) {
            $raw = (string) file_get_contents($raw);
        }

        return str_contains($raw, 'PRIVATE KEY') ? $raw : null;
    }

    private static function canSign(): bool
    {
        return (bool) config('services.apple.team_id')
            && (bool) config('services.apple.key_id')
            && self::privateKey() !== null;
    }
}
