<?php

namespace App\Support\Notifications;

use App\Models\CipApplication;
use App\Models\Conversation;
use App\Models\User;
use Illuminate\Support\Facades\URL;

/**
 * What an iPhone needs to show a message, or an email, the way Messages does,
 * with the app's icon in the picture's corner and a Reply box:
 *
 *   direct message   the sender's photo; their name, then the message
 *   group message    the group's photo; who wrote, the group, the message
 *   CIP file thread  the chat's photo; who wrote, the group chat, the message
 *   email            the sender's photo; their name, the subject, its start
 *
 * A reply to an email goes back as an email.
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
     * @return array<string, string>|null null for anything that is not a message or an email
     */
    public static function for(User $recipient, array $notification): ?array
    {
        $type = (string) ($notification['type'] ?? '');
        $meta = is_array($notification['meta'] ?? null) ? $notification['meta'] : [];

        if ($type === 'email.received') {
            return self::email($recipient, $notification, $meta);
        }

        if ($type === 'cip.message') {
            return self::cipThread($recipient, $notification, $meta);
        }

        $conversation = $meta['conversationId'] ?? null;

        if (! str_starts_with($type, 'message') || ! is_string($conversation) || $conversation === '') {
            return null;
        }

        $actor = is_array($notification['actor'] ?? null) ? $notification['actor'] : [];
        $title = (string) ($notification['title'] ?? '');
        $group = (bool) ($meta['group'] ?? false);
        $name = (string) ($actor['name'] ?? $title);

        return array_filter([
            'conversation' => $conversation,
            'sender' => isset($actor['id']) ? (string) $actor['id'] : null,
            'name' => $name,
            'photo' => self::photo($actor['avatar'] ?? null),
            // A group: the group's photo is the picture, the person who wrote
            // is the first line and the group's name the second.
            'group' => $group ? $title : null,
            'groupPhoto' => $group ? self::groupPhoto($conversation) : null,
            'title' => $group ? $name : $title,
            'subtitle' => $group ? $title : null,
            'body' => (string) ($meta['pushBody'] ?? $notification['message'] ?? ''),
            'url' => is_string($notification['actionUrl'] ?? null) ? $notification['actionUrl'] : null,
            'reply' => URL::temporarySignedRoute(
                'messaging.push-reply',
                now()->addDays(self::REPLY_DAYS),
                ['conversation' => $conversation, 'user' => $recipient->id],
            ),
        ], fn ($value) => $value !== null && $value !== '');
    }

    /**
     * One email from one sender. "5 new emails" (no subject recorded) stays a
     * plain notification: it is not from anyone in particular.
     *
     * @param  array<string, mixed>  $notification
     * @param  array<string, mixed>  $meta
     * @return array<string, string>|null
     */
    private static function email(User $recipient, array $notification, array $meta): ?array
    {
        $message = $meta['message_uuid'] ?? null;
        $from = mb_strtolower(trim((string) ($meta['from_email'] ?? '')));
        if (! is_string($message) || $message === '' || ! array_key_exists('subject', $meta) || $from === '') {
            return null;
        }

        $name = trim((string) ($meta['from_name'] ?? '')) ?: $from;
        $subject = self::oneLine($meta['subject']) ?: '(no subject)';

        return array_filter([
            'kind' => 'email',
            // One thread per sender, as Mail stacks them.
            'conversation' => 'email:'.$from,
            'message' => $message,
            'sender' => 'email:'.$from,
            'name' => $name,
            'photo' => self::photo($notification['image'] ?? null),
            // The sender, the subject, then the start of the email.
            'title' => $name,
            'subtitle' => $subject,
            // One run of text: an email's own line breaks left gaps in it.
            'body' => self::oneLine($meta['snippet'] ?? ''),
            'url' => is_string($notification['actionUrl'] ?? null) ? $notification['actionUrl'] : null,
            'reply' => URL::temporarySignedRoute(
                'mail.push-reply',
                now()->addDays(self::REPLY_DAYS),
                ['message' => $message, 'user' => $recipient->id],
            ),
        ], fn ($value) => $value !== null && $value !== '');
    }

    /**
     * A message on a CIP file's thread, laid out as the group chat it is
     * copied into: who wrote it, the chat's name (the client, the
     * application's name), the message, under the chat's photo or else the
     * client's. Tapping it opens that chat. A reply goes back into the same
     * lane (internal, or the service provider's), so a reply to an internal
     * note never reaches the service provider.
     *
     * @param  array<string, mixed>  $notification
     * @param  array<string, mixed>  $meta
     * @return array<string, string>|null
     */
    private static function cipThread(User $recipient, array $notification, array $meta): ?array
    {
        $application = $meta['applicationId'] ?? null;
        $lane = $meta['lane'] ?? null;
        if (! is_string($application) || $application === '' || ! is_string($lane) || $lane === '') {
            return null;
        }

        $actor = is_array($notification['actor'] ?? null) ? $notification['actor'] : [];
        $chat = is_string($meta['conversationId'] ?? null) && $meta['conversationId'] !== '' ? $meta['conversationId'] : null;
        $group = trim((string) ($meta['chatName'] ?? '')) ?: (trim((string) ($meta['number'] ?? '')) ?: 'CIP file');
        $name = trim((string) ($actor['name'] ?? '')) ?: $group;

        return array_filter([
            // Stacked with the chat's own messages.
            'conversation' => $chat ?? 'cip:'.$application,
            'sender' => isset($actor['id']) ? (string) $actor['id'] : null,
            'name' => $name,
            'photo' => self::photo($actor['avatar'] ?? null),
            'group' => $group,
            'groupPhoto' => ($chat ? self::groupPhoto($chat) : null) ?? self::clientPhoto($application),
            'title' => $name,
            'subtitle' => $group,
            'body' => (string) ($meta['pushBody'] ?? $notification['message'] ?? ''),
            'url' => $chat
                ? '/social/messages?conversation='.$chat
                : (is_string($notification['actionUrl'] ?? null) ? $notification['actionUrl'] : null),
            'reply' => URL::temporarySignedRoute(
                'cip.push-reply',
                now()->addDays(self::REPLY_DAYS),
                ['application' => $application, 'user' => $recipient->id, 'lane' => $lane],
            ),
        ], fn ($value) => $value !== null && $value !== '');
    }

    /**
     * The client's own photo for a file's thread. Never the passport portrait:
     * a lock screen is no place for it.
     */
    private static function clientPhoto(string $application): ?string
    {
        $client = CipApplication::query()->where('uuid', $application)->with('client.user')->first()?->client;
        if (! $client) {
            return null;
        }

        return self::photo($client->photo_url ?: ($client->hasLiveLogin() ? $client->user?->photoUrl() : null));
    }

    private static function oneLine(mixed $text): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', (string) $text));
    }

    /** The group's own photo, signed for the extension, or null when it has none. */
    private static function groupPhoto(string $conversation): ?string
    {
        $row = Conversation::query()->where('uuid', $conversation)->first(['id', 'uuid', 'photo_path']);

        return $row?->photo_path
            ? URL::temporarySignedRoute('messaging.group-photo.push', now()->addDays(self::PHOTO_DAYS), ['uuid' => $row->uuid])
            : null;
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

        // An email sender's photo from the mailbox's cache.
        if (preg_match('#^/portal/mail/sender-photo/([a-f0-9]{64})$#', $url, $match)) {
            return URL::temporarySignedRoute('mail.sender-photo.push', now()->addDays(self::PHOTO_DAYS), ['hash' => $match[1]]);
        }

        if (str_starts_with($url, '/storage/')) {
            return url($url);
        }

        return preg_match('#^https://#i', $url) ? $url : null;
    }
}
