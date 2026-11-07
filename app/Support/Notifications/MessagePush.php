<?php

namespace App\Support\Notifications;

use App\Models\User;
use Illuminate\Support\Facades\URL;

/**
 * What an iPhone needs to show a message the way Messages does: the sender's
 * photo with the app's icon in its corner, the person's (or group's) name as
 * the title, the message alone under it, and a Reply box in Notification
 * Center.
 *
 * The app's notification service extension (ios/TMAPortalNotifications)
 * turns this into a communication notification. It runs outside the app's
 * web session, so the photo comes as a signed link (avatar.push), and a
 * reply goes to a signed link scoped to this person and this conversation
 * (messaging.push-reply), which also wants one of their registered devices.
 */
final class MessagePush
{
    /** How long a notification can still be replied to from Notification Center. */
    public const REPLY_DAYS = 3;

    /** How long the photo link in a notification lasts. */
    public const PHOTO_DAYS = 3;

    /**
     * @param  array<string, mixed>  $notification  NotificationPresenter::notification()
     * @return array<string, string>|null null for anything that is not a message
     */
    public static function for(User $recipient, array $notification): ?array
    {
        $type = (string) ($notification['type'] ?? '');
        $meta = is_array($notification['meta'] ?? null) ? $notification['meta'] : [];
        $conversation = $meta['conversationId'] ?? null;

        if (! str_starts_with($type, 'message') || ! is_string($conversation) || $conversation === '') {
            return null;
        }

        $actor = is_array($notification['actor'] ?? null) ? $notification['actor'] : [];
        $title = (string) ($notification['title'] ?? '');
        $group = (bool) ($meta['group'] ?? false);

        return array_filter([
            'conversation' => $conversation,
            'sender' => isset($actor['id']) ? (string) $actor['id'] : null,
            'name' => (string) ($actor['name'] ?? $title),
            'photo' => self::photo($actor['avatar'] ?? null),
            // A group's name; the photo is still the person who wrote.
            'group' => $group ? $title : null,
            'title' => $title,
            'body' => (string) ($meta['pushBody'] ?? $notification['message'] ?? ''),
            'url' => is_string($notification['actionUrl'] ?? null) ? $notification['actionUrl'] : null,
            'reply' => URL::temporarySignedRoute(
                'messaging.push-reply',
                now()->addDays(self::REPLY_DAYS),
                ['conversation' => $conversation, 'user' => $recipient->id],
            ),
        ], fn ($value) => $value !== null && $value !== '');
    }

    /** A link the extension can fetch without signing in, or null to draw initials. */
    private static function photo(mixed $url): ?string
    {
        if (! is_string($url) || $url === '') {
            return null;
        }

        if (preg_match('#^/media/avatars/([a-f0-9-]{36}\.jpg)$#', $url, $match)) {
            return URL::temporarySignedRoute('avatar.push', now()->addDays(self::PHOTO_DAYS), ['name' => $match[1]]);
        }

        if (str_starts_with($url, '/storage/')) {
            return url($url);
        }

        return preg_match('#^https://#i', $url) ? $url : null;
    }
}
