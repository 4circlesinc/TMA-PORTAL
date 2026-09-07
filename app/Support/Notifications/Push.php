<?php

namespace App\Support\Notifications;

use App\Jobs\SendPush;
use App\Models\User;

/**
 * What reaches a phone while the portal is not open (docs/android-app-prompt.md §13).
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

        self::queue($recipient->id, [
            'kind' => 'notification',
            'notification' => json_encode($notification, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'unread' => (string) $unread,
        ]);
    }

    /**
     * A call is ringing: every recipient's phone hears it, briefly. The
     * signal is the `call.signal` payload (signalId, conversationId,
     * fromUserId, type, payload{fromName, fromPhoto, media}).
     *
     * @param  int[]  $recipientIds
     */
    public static function callRing(array $recipientIds, array $signal): void
    {
        foreach ($recipientIds as $id) {
            self::queue((int) $id, [
                'kind' => 'call',
                'signal' => json_encode($signal, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
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

    private static function queue(int $userId, array $data, bool $urgent = true, ?int $ttlSeconds = null): void
    {
        if (! app(PushTransport::class)->enabled()) {
            return;
        }

        SendPush::dispatch($userId, $data, $urgent, $ttlSeconds);
    }
}
