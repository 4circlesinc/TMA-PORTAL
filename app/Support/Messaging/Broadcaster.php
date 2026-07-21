<?php

namespace App\Support\Messaging;

use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Fire-and-forget broadcasting for the messaging events.
 *
 * The events are ShouldBroadcastNow, which means they go out inside the
 * request. If the Reverb server is down or unreachable that would otherwise
 * throw *after* the message is already committed - the sender would see their
 * own send fail even though everyone will get it on their next load.
 *
 * Delivery of the message is the durable part and lives in the database; the
 * websocket is only how people find out sooner. So a broadcast failure is
 * logged and swallowed, never surfaced as a failed send.
 */
class Broadcaster
{
    public static function toOthers(object $event): void
    {
        try {
            broadcast($event)->toOthers();
        } catch (Throwable $e) {
            Log::warning('Messaging broadcast failed; message was still saved.', [
                'event' => $event::class,
                'reason' => $e->getMessage(),
            ]);
        }
    }
}
