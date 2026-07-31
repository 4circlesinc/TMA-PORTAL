<?php

namespace App\Support\Mail;

use App\Mail\Postcard;
use App\Models\EmailDelivery;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Throwable;

/**
 * Send a postcard and keep a record of what happened to it.
 *
 * Every transactional email that someone might later ask about — "did the
 * client ever get their invitation?" — goes through here instead of calling
 * Mail::to()->queue() directly. The row is created first, in `queued`, and the
 * mail events promote it to `sent` only once a transport has accepted it.
 *
 * Nothing in here is allowed to break the action that triggered the email: a
 * tracking failure is logged and swallowed, and the mail still goes out.
 */
final class Deliveries
{
    /**
     * Queue a postcard and return its delivery row.
     *
     * @param  Model|null  $related  what the mail is about (an Invitation, a Client…)
     * @param  string|null  $template  the Postcards helper that built it
     */
    public static function send(
        Postcard $postcard,
        string $recipient,
        ?Model $related = null,
        ?string $template = null,
    ): ?EmailDelivery {
        $delivery = self::record($recipient, $postcard->subjectLine, $related, $template);

        $postcard->deliveryUuid = $delivery?->uuid;

        try {
            Mail::to($recipient)->queue($postcard);
        } catch (Throwable $e) {
            // Failing to even reach the queue is itself a delivery failure.
            $delivery?->forceFill([
                'status' => EmailDelivery::STATUS_FAILED,
                'error' => mb_substr($e->getMessage(), 0, 2000),
                'failed_at' => now(),
            ])->save();

            throw $e;
        }

        return $delivery;
    }

    /**
     * Re-send a delivery that failed, against the same recipient and subject.
     * The caller rebuilds the postcard, because only it knows the copy.
     */
    public static function retry(EmailDelivery $delivery, Postcard $postcard): ?EmailDelivery
    {
        $fresh = self::record(
            $delivery->recipient,
            $postcard->subjectLine,
            $delivery->related,
            $delivery->template,
        );

        $fresh?->forceFill([
            'retry_count' => $delivery->retry_count + 1,
            'last_retry_at' => now(),
        ])->save();

        $postcard->deliveryUuid = $fresh?->uuid;
        Mail::to($delivery->recipient)->queue($postcard);

        return $fresh;
    }

    private static function record(
        string $recipient,
        string $subject,
        ?Model $related,
        ?string $template,
    ): ?EmailDelivery {
        try {
            return EmailDelivery::create([
                'uuid' => (string) Str::uuid(),
                'recipient' => $recipient,
                'subject' => $subject,
                'template' => $template,
                'mailable' => Postcard::class,
                'related_type' => $related ? $related::class : null,
                'related_id' => $related?->getKey(),
                'status' => EmailDelivery::STATUS_QUEUED,
                'queued_at' => now(),
            ]);
        } catch (Throwable $e) {
            Log::warning('Could not record an email delivery: '.$e->getMessage());

            return null;
        }
    }
}
