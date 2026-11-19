<?php

namespace App\Support\Notifications;

use App\Jobs\SendPush;
use App\Models\User;
use App\Support\Messaging\LiveCalls;
use Illuminate\Support\Facades\URL;

/**
 * What reaches a phone while the portal is not open (docs/android-app-prompt.md section 13).
 *
 * Two kinds, both carrying exactly what the websocket carries:
 * `notification` (the presenter's record and the unread count) and `call`
 * (the ring signal). Preferences are honoured the way the desktop banner is:
 * only groups whose `desktop` channel is on are pushed, and the
 * non-silenceable groups always are. Nothing is sent when FCM is not
 * configured; the job is queued so a request never waits on Google.
 */
final class Push
{
    public static function notification(User $recipient, array $notification, int $unread): void
    {
        $type = (string) ($notification['type'] ?? '');
        if ($type === '' || ! self::wantsPush($recipient, $type)) {
            return;
        }

        // An email the portal itself sent (the notice about a CIP message, a
        // status change) is about something that already reached the phone
        // as its own notification: ringing it again for the email was two
        // banners for one thing. The email still lands in the inbox.
        if ($type === 'email.received' && self::isPortalsOwnEmail($notification)) {
            return;
        }

        $data = [
            'kind' => 'notification',
            'notification' => json_encode($notification, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'unread' => (string) $unread,
            // The person's iPhone sound: the bundled TM tone or "default"
            // (the Apple tone). Android ignores it.
            'iosSound' => NotificationSounds::apnsSound($recipient),
        ];
        // A message: the iPhone shows the sender's photo and a Reply box.
        $message = MessagePush::for($recipient, $notification);
        if ($message !== null) {
            $data['msg'] = json_encode($message, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        }

        self::queue($recipient->id, $data);
    }

    /**
     * A call is ringing: every recipient's phone hears it, briefly. The
     * signal is the `call.signal` payload (signalId, conversationId,
     * fromUserId, type, payload{fromName, fromPhoto, media}).
     *
     * An iPhone gets it as a VoIP push (SendPush), which rings the phone's
     * own call screen even with the app closed. `callUrl` is the phone's way
     * back without its web session: whether it should still be ringing, and
     * a decline from the lock screen (PushCallController).
     *
     * @param  int[]  $recipientIds
     */
    public static function callRing(array $recipientIds, array $signal): void
    {
        $signalId = (string) ($signal['signalId'] ?? '');
        foreach ($recipientIds as $id) {
            $data = [
                'kind' => 'call',
                'signal' => json_encode($signal, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            ];
            if ($signalId !== '') {
                $data['callUrl'] = URL::temporarySignedRoute('messaging.push-call', now()->addMinutes(10), [
                    'signal' => $signalId,
                    'user' => (int) $id,
                ]);
            }
            self::queue((int) $id, $data, urgent: true, ttlSeconds: 45); // delivery window, slightly above the 40s ring
        }
    }

    /**
     * A ringing call stopped ringing (LiveCalls::settle): answered, declined,
     * or the caller gave up. Every phone it rang is told, including the other
     * phones of whoever answered or declined, so nothing goes on ringing
     * after the call is over, the way a phone stops when it is picked up
     * elsewhere. Android hears this; an iPhone asks through its callUrl
     * instead (a VoIP push must always ring, so it cannot carry a stop).
     *
     * @param  array<string, mixed>  $record  the settled LiveCalls record
     */
    public static function callEnded(array $record): void
    {
        $signalId = (string) data_get($record, 'signal.signalId', '');
        if ($signalId === '') {
            return;
        }

        foreach ($record['recipients'] ?? [] as $id) {
            self::queue((int) $id, [
                'kind' => 'call-end',
                'signalId' => $signalId,
                'conversationId' => (string) ($record['conversation'] ?? ''),
                'outcome' => (string) ($record['outcome'] ?? LiveCalls::ENDED),
                'by' => (string) ($record['by'] ?? ''),
            ], urgent: true, ttlSeconds: 30);
        }
    }

    private static function wantsPush(User $user, string $type): bool
    {
        $group = NotificationType::preferenceGroup($type);
        if (in_array($group, NotificationType::NON_SILENCEABLE, true)) {
            return true;
        }

        return NotificationPreferences::channelEnabled($user, $type, 'desktop');
    }

    /** @param  array<string, mixed>  $notification */
    private static function isPortalsOwnEmail(array $notification): bool
    {
        $portal = mb_strtolower(trim((string) config('mail.from.address')));
        $meta = is_array($notification['meta'] ?? null) ? $notification['meta'] : [];
        $from = mb_strtolower(trim((string) ($meta['from_email'] ?? '')));

        return $portal !== '' && $from === $portal;
    }

    private static function queue(int $userId, array $data, bool $urgent = true, ?int $ttlSeconds = null): void
    {
        if (! app(PushTransport::class)->enabled()) {
            return;
        }

        SendPush::dispatch($userId, $data, $urgent, $ttlSeconds);
    }
}
