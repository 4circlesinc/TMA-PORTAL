<?php

namespace App\Support\Notifications;

use App\Models\User;
use Illuminate\Support\Facades\URL;

/**
 * What an iPhone needs to show a message, or an email, the way Messages does:
 * the sender's photo with the app's icon in its corner, one line saying who
 * (the person, or the group for a group), the message under it, and a Reply
 * box in Notification Center. An email is laid out the same: the sender, then
 * its subject and the start of it; a reply goes back as an email.
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
        $subject = trim((string) $meta['subject']);
        $snippet = trim((string) ($meta['snippet'] ?? ''));
        // The subject, then the start of the email on the line under it.
        $body = implode("\n", array_filter([$subject, $snippet], fn ($line) => $line !== ''));

        return array_filter([
            'kind' => 'email',
            // One thread per sender, as Mail stacks them.
            'conversation' => 'email:'.$from,
            'sender' => 'email:'.$from,
            'name' => $name,
            'photo' => self::photo($notification['image'] ?? null),
            'title' => $name,
            'body' => $body !== '' ? $body : '(no subject)',
            'url' => is_string($notification['actionUrl'] ?? null) ? $notification['actionUrl'] : null,
            'reply' => URL::temporarySignedRoute(
                'mail.push-reply',
                now()->addDays(self::REPLY_DAYS),
                ['message' => $message, 'user' => $recipient->id],
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
