<?php

namespace App\Support\Mail;

use App\Models\ConnectedAccount;
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

    public static function accessToken(ConnectedAccount $account): string
    {
        $key = 'mail.access.'.$account->id;

        $cached = Cache::get($key);
        if (is_string($cached) && $cached !== '') {
            return $cached;
        }

        $refresh = $account->token;
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
        Cache::forget('mail.access.'.$account->id);
    }

    /** @return array{0: string, 1: int} */
    private static function refreshGoogle(string $refresh): array
    {
        $response = Http::asForm()->post(self::GOOGLE_TOKEN_URL, [
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

        $response = Http::asForm()->post(
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
