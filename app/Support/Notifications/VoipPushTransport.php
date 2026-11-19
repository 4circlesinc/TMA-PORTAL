<?php

namespace App\Support\Notifications;

/**
 * An iPhone's VoIP push (PushKit): what rings a call on the phone's own
 * incoming-call screen with the app closed. Implemented by
 * RoutingPushTransport over ApnsClient; SendPush uses it for calls when a
 * device has registered a VoIP token, and the ordinary push otherwise.
 */
interface VoipPushTransport
{
    /**
     * @param  array<string, string>  $data
     * @return PushTransport::OK|PushTransport::UNREGISTERED|PushTransport::FAILED
     */
    public function sendVoip(string $voipToken, array $data, ?int $ttlSeconds = null, bool $sandbox = false): string;
}
