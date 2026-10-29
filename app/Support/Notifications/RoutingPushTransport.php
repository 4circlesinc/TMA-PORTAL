<?php

namespace App\Support\Notifications;

use App\Models\DeviceToken;

/**
 * Android tokens go to FCM, iPhone tokens to APNs. Either side can be
 * unconfigured; that side is skipped and the other still sends.
 */
final class RoutingPushTransport implements PushTransport
{
    public function __construct(
        private FcmClient $fcm,
        private ApnsClient $apns,
    ) {}

    public function enabled(): bool
    {
        return $this->fcm->enabled() || $this->apns->enabled();
    }

    public function send(string $token, array $data, bool $urgent = true, ?int $ttlSeconds = null): string
    {
        $platform = (string) DeviceToken::query()->where('token', $token)->value('platform');

        if ($platform === DeviceToken::PLATFORM_IOS || $platform === DeviceToken::PLATFORM_IOS_SANDBOX) {
            if (! $this->apns->enabled()) {
                return self::FAILED;
            }

            return $this->apns->send($token, $data, $urgent, $ttlSeconds, $platform === DeviceToken::PLATFORM_IOS_SANDBOX);
        }

        if (! $this->fcm->enabled()) {
            return self::FAILED;
        }

        return $this->fcm->send($token, $data, $urgent, $ttlSeconds);
    }
}
