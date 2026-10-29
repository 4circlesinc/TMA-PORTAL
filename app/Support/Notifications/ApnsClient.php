<?php

namespace App\Support\Notifications;

use Firebase\JWT\JWT;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Apple Push Notification service, authenticated with a .p8 key
 * (APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY). Alert plus the same data
 * the websocket carries, so a locked phone can show it and a tap still has
 * the record. Nothing is sent while the key is unset.
 */
class ApnsClient
{
    public function enabled(): bool
    {
        return (bool) config('services.apns.key_id')
            && (bool) config('services.apns.team_id')
            && (bool) config('services.apns.bundle_id')
            && $this->privateKey() !== null;
    }

    /**
     * @param  array<string, string>  $data
     * @return PushTransport::OK|PushTransport::UNREGISTERED|PushTransport::FAILED
     */
    public function send(string $token, array $data, bool $urgent = true, ?int $ttlSeconds = null, bool $sandbox = false): string
    {
        $jwt = $this->token();
        if ($jwt === null) {
            return PushTransport::FAILED;
        }

        $host = $sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
        $headers = [
            'authorization' => 'bearer '.$jwt,
            'apns-topic' => (string) config('services.apns.bundle_id'),
            'apns-push-type' => 'alert',
            'apns-priority' => $urgent ? '10' : '5',
        ];
        if ($ttlSeconds !== null) {
            $headers['apns-expiration'] = (string) (time() + $ttlSeconds);
        }

        try {
            $response = Http::withHeaders($headers)
                ->withBody(json_encode($this->payload($data), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), 'application/json')
                ->withOptions(['version' => 2.0])
                ->timeout(10)
                ->post($host.'/3/device/'.$token);
        } catch (\Throwable $e) {
            Log::warning('APNs send failed', ['error' => $e->getMessage()]);

            return PushTransport::FAILED;
        }

        if ($response->successful()) {
            return PushTransport::OK;
        }

        $reason = (string) data_get($response->json(), 'reason', '');
        if (in_array($reason, ['Unregistered', 'BadDeviceToken', 'DeviceTokenNotForTopic'], true)) {
            return PushTransport::UNREGISTERED;
        }

        Log::warning('APNs refused a message', ['status' => $response->status(), 'reason' => $reason]);

        return PushTransport::FAILED;
    }

    /**
     * @param  array<string, string>  $data
     * @return array<string, mixed>
     */
    private function payload(array $data): array
    {
        $kind = $data['kind'] ?? 'notification';
        $title = 'TM ANTOINE Portal';
        $body = 'New notification';
        $badge = null;

        if ($kind === 'notification') {
            $record = json_decode($data['notification'] ?? '', true);
            if (is_array($record)) {
                $title = (string) ($record['title'] ?? $title);
                $body = (string) ($record['message'] ?? $body);
            }
            if (isset($data['unread']) && is_numeric($data['unread'])) {
                $badge = (int) $data['unread'];
            }
        } elseif ($kind === 'call') {
            $signal = json_decode($data['signal'] ?? '', true);
            $payload = is_array($signal) ? ($signal['payload'] ?? []) : [];
            $name = is_array($payload) ? (string) ($payload['fromName'] ?? '') : '';
            $title = $name !== '' ? $name : 'Incoming call';
            $body = (is_array($payload) && ($payload['media'] ?? '') === 'video') ? 'Incoming video call' : 'Incoming call';
        }

        $aps = [
            'alert' => ['title' => $title, 'body' => $body],
            'sound' => 'default',
        ];
        if ($badge !== null) {
            $aps['badge'] = $badge;
        }
        if ($kind === 'call') {
            $aps['category'] = 'CALL';
            $aps['interruption-level'] = 'time-sensitive';
        }

        return ['aps' => $aps] + $data;
    }

    private function privateKey(): ?string
    {
        $raw = (string) config('services.apns.private_key');
        if ($raw === '') {
            return null;
        }
        if (! str_contains($raw, 'PRIVATE KEY') && is_file($raw)) {
            $raw = (string) file_get_contents($raw);
        }

        return str_contains($raw, 'PRIVATE KEY') ? $raw : null;
    }

    private function token(): ?string
    {
        $key = $this->privateKey();
        $keyId = (string) config('services.apns.key_id');
        $teamId = (string) config('services.apns.team_id');
        if ($key === null || $keyId === '' || $teamId === '') {
            return null;
        }

        return Cache::remember('apns:jwt:'.md5($keyId.$teamId), now()->addMinutes(50), function () use ($key, $keyId, $teamId) {
            return JWT::encode(['iss' => $teamId, 'iat' => time()], $key, 'ES256', $keyId);
        });
    }
}
