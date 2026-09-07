<?php

namespace App\Support\Notifications;

/**
 * One device, one message. Implemented by FcmClient; tests bind a fake so the
 * gating and the payload can be asserted without a Firebase project.
 */
interface PushTransport
{
    public const OK = 'ok';

    public const UNREGISTERED = 'unregistered';

    public const FAILED = 'failed';

    public function enabled(): bool;

    /**
     * @param  array<string, string>  $data  the data message, every value a string
     * @return self::OK|self::UNREGISTERED|self::FAILED
     */
    public function send(string $token, array $data, bool $urgent = true, ?int $ttlSeconds = null): string;
}
