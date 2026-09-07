<?php

namespace App\Support\Notifications;

use Firebase\JWT\JWT;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Firebase Cloud Messaging over the HTTP v1 API, authenticated with a service
 * account (FCM_CREDENTIALS_JSON: the JSON, or a path to it; FCM_PROJECT_ID).
 * Data-only messages: the app renders them with the same copy the websocket
 * carries, so nothing is said twice in two voices.
 */
class FcmClient implements PushTransport
{
    private const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';

    public function enabled(): bool
    {
        return (bool) config('services.fcm.project_id') && $this->credentials() !== null;
    }

    public function send(string $token, array $data, bool $urgent = true, ?int $ttlSeconds = null): string
    {
        $access = $this->accessToken();
        if ($access === null) {
            return self::FAILED;
        }

        $android = ['priority' => $urgent ? 'high' : 'normal'];
        if ($ttlSeconds !== null) {
            $android['ttl'] = $ttlSeconds.'s';
        }

        try {
            $response = Http::withToken($access)
                ->timeout(10)
                ->post(sprintf('https://fcm.googleapis.com/v1/projects/%s/messages:send', config('services.fcm.project_id')), [
                    'message' => [
                        'token' => $token,
                        'data' => array_map('strval', $data),
                        'android' => $android,
                    ],
                ]);
        } catch (\Throwable $e) {
            Log::warning('FCM send failed', ['error' => $e->getMessage()]);

            return self::FAILED;
        }

        if ($response->successful()) {
            return self::OK;
        }

        $status = (string) data_get($response->json(), 'error.status', '');
        $code = (string) data_get($response->json(), 'error.details.0.errorCode', '');
        if ($response->status() === 404 || $status === 'NOT_FOUND' || $code === 'UNREGISTERED'
            || ($response->status() === 400 && $code === 'INVALID_ARGUMENT')) {
            return self::UNREGISTERED;
        }

        Log::warning('FCM refused a message', ['status' => $response->status(), 'error' => $status]);

        return self::FAILED;
    }

    /** The service account, decoded; null when not configured or unreadable. */
    private function credentials(): ?array
    {
        $raw = (string) config('services.fcm.credentials');
        if ($raw === '') {
            return null;
        }
        if (! str_starts_with(ltrim($raw), '{') && is_file($raw)) {
            $raw = (string) file_get_contents($raw);
        }
        $json = json_decode($raw, true);

        return is_array($json) && isset($json['client_email'], $json['private_key']) ? $json : null;
    }

    /** An OAuth2 access token for the messaging scope, minted from the service account and cached under its hour. */
    private function accessToken(): ?string
    {
        $account = $this->credentials();
        if ($account === null) {
            return null;
        }

        $key = 'fcm:access-token:'.md5($account['client_email']);

        return Cache::remember($key, now()->addMinutes(50), function () use ($account) {
            $now = time();
            $assertion = JWT::encode([
                'iss' => $account['client_email'],
                'scope' => self::SCOPE,
                'aud' => self::TOKEN_URL,
                'iat' => $now,
                'exp' => $now + 3600,
            ], $account['private_key'], 'RS256');

            $response = Http::asForm()->timeout(10)->post(self::TOKEN_URL, [
                'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion' => $assertion,
            ]);
            $token = $response->json('access_token');
            if (! is_string($token) || $token === '') {
                Log::warning('FCM token exchange failed', ['status' => $response->status()]);
                throw new \RuntimeException('FCM token exchange failed');
            }

            return $token;
        });
    }
}
