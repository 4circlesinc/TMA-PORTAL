<?php

namespace App\Providers;

use App\Mail\Postcard;
use App\Models\EmailDelivery;
use Illuminate\Mail\Events\MessageSent;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\ServiceProvider;
use Throwable;

/**
 * Promotes an EmailDelivery row from `queued` to `sent` when the transport has
 * actually accepted the message.
 *
 * The row is found through the X-TMA-Delivery header that
 * App\Support\Mail\Deliveries stamps on the outgoing postcard, so this works
 * the same whether the mail went out inline or through a queue worker. Mail we
 * do not track carries no header and is ignored.
 */
class MailTrackingServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Event::listen(function (MessageSent $event) {
            $uuid = self::deliveryUuid($event);

            if ($uuid === null) {
                return;
            }

            try {
                EmailDelivery::where('uuid', $uuid)
                    ->where('status', EmailDelivery::STATUS_QUEUED)
                    ->first()?->forceFill([
                        'status' => EmailDelivery::STATUS_SENT,
                        'sent_at' => now(),
                        // The transport's id, so a later bounce webhook can
                        // find this row without guessing from the address.
                        'message_id' => $event->sent?->getMessageId(),
                        'error' => null,
                    ])->save();
            } catch (Throwable $e) {
                Log::warning('Could not mark an email as sent: '.$e->getMessage());
            }
        });
    }

    /** The delivery id carried on the message, if this is one of ours. */
    private static function deliveryUuid(MessageSent $event): ?string
    {
        $header = $event->message->getHeaders()->get(Postcard::DELIVERY_HEADER);

        $value = $header?->getBodyAsString();

        return $value !== null && $value !== '' ? trim($value) : null;
    }
}
