<?php

namespace App\Support\Mail;

use App\Models\ConnectedAccount;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Exchanges a stored refresh token for a short-lived access token.
 *
 * `connected_accounts.token` holds the refresh token (encrypted at rest). The
 * access tokens it buys live ~1 hour, so they are cached rather than stored —
 * a cache miss just costs one more round trip, and nothing long-lived ends up
 * in a second place.
 */
class MailTokens
{
    private const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

    /**
     * Where this account's access token is cached.
     *
     * Keyed on who the account *is* — provider plus provider id — not on its
     * row id. A row id is only unique inside one database, and the cache is
     * not: a filesystem or Redis store shared between environments hands
     * `mail.access.1` to whatever happens to be account 1 in each of them.
     * That is not hypothetical — a throwaway test database whose first
     * account got id 1 picked up the real mailbox's cached token and synced a
     * live account into itself.
     */
    private static function cacheKey(ConnectedAccount $account): string
    {
        return 'mail.access.'.sha1(
            $account->provider.'|'.$account->provider_id.'|'.$account->email
        );
    }

    public static function accessToken(ConnectedAccount $account): string
    {
        $key = self::cacheKey($account);

        $cached = Cache::get($key);
        if (is_string($cached) && $cached !== '') {
            return $cached;
        }

        // A token that will not decrypt is as dead as one that was revoked, and
        // it has to say so. Left as a raw DecryptException it surfaced as
        // "The MAC is invalid." parked on the account — every mailbox call
        // failing (new mail, attachment downloads, sending) with nothing on
        // screen explaining why or suggesting what to do about it.
        //
        // It means this environment's APP_KEY is not the one the token was
        // encrypted with: a key rotation, or two environments sharing a
        // database while the provider rotates the refresh token between them.
        // Reconnecting mints a token under the current key, which is the only
        // thing that fixes it.
        try {
            $refresh = $account->token;
        } catch (DecryptException $e) {
            throw new MailAuthException(
                'This mailbox’s saved credentials cannot be read by this environment '
                .'(the encryption key does not match). Reconnect the account to continue.'
            );
        }

        if (! $refresh) {
            throw new MailAuthException(
                'This mailbox is not connected. Reconnect the account to continue.'
            );
        }

        [$token, $expiresIn] = $account->provider === 'google'
            ? self::refreshGoogle($refresh)
            : self::refreshMicrosoft($refresh, $account);

        // Expire a minute early so a token never dies mid-request.
        Cache::put($key, $token, max(60, $expiresIn - 60));

        return $token;
    }

    /** Drop the cached access token, e.g. after the provider returns 401. */
    public static function forget(ConnectedAccount $account): void
    {
        Cache::forget(self::cacheKey($account));
    }

    /** @return array{0: string, 1: int} */
    private static function refreshGoogle(string $refresh): array
    {
        $response = Http::asForm()->timeout(12)->post(self::GOOGLE_TOKEN_URL, [
            'client_id' => config('services.google.client_id'),
            'client_secret' => config('services.google.client_secret'),
            'refresh_token' => $refresh,
            'grant_type' => 'refresh_token',
        ]);

        return self::readTokenResponse($response->json(), $response->successful(), 'Google');
    }

    /** @return array{0: string, 1: int} */
    private static function refreshMicrosoft(string $refresh, ConnectedAccount $account): array
    {
        $tenant = config('services.microsoft.tenant', 'common');

        $response = Http::asForm()->timeout(12)->post(
            "https://login.microsoftonline.com/{$tenant}/oauth2/v2.0/token",
            [
                'client_id' => config('services.microsoft.client_id'),
                'client_secret' => config('services.microsoft.client_secret'),
                'refresh_token' => $refresh,
                'grant_type' => 'refresh_token',
            ]
        );

        $data = $response->json();

        // Entra rotates refresh tokens: the response carries a replacement and
        // the old one stops working. Persisting it is what keeps a mailbox
        // connected past the first refresh.
        if ($response->successful() && ! empty($data['refresh_token'])) {
            $account->forceFill(['token' => $data['refresh_token']])->save();
        }

        return self::readTokenResponse($data, $response->successful(), 'Microsoft');
    }

    /**
     * @param  array<string, mixed>|null  $data
     * @return array{0: string, 1: int}
     */
    private static function readTokenResponse(?array $data, bool $ok, string $label): array
    {
        if (! $ok || empty($data['access_token'])) {
            // invalid_grant means the user revoked access or changed their
            // password — a reconnect, not something a retry can fix.
            $error = $data['error'] ?? 'unknown_error';

            if ($error === 'invalid_grant') {
                throw new MailAuthException(
                    "Your {$label} account needs to be reconnected before mail can sync."
                );
            }

            throw new RuntimeException("{$label} token refresh failed: {$error}");
        }

        return [(string) $data['access_token'], (int) ($data['expires_in'] ?? 3600)];
    }
}
