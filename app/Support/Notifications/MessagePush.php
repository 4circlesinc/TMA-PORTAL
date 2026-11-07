<?php

namespace App\Support\Notifications;

use App\Models\CipApplication;
use App\Models\Conversation;
use App\Models\User;
use App\Support\Messaging\MessagingPresenter;
use Illuminate\Support\Facades\URL;

/**
 * How a message, or an email, is shown as a notification, the way Messages
 * shows one, on every device the portal notifies:
 *
 *   direct message   the sender's photo; their name, then the message
 *   group message    the group's photo; who wrote, the group, the message
 *   CIP file thread  the chat's photo; who wrote, the group chat, the message
 *   email            the sender's photo; their name, the subject, its start
 *
 * Tapping it opens the conversation (a CIP thread's group chat, the email);
 * replying sends a message there, or an email back (NotificationReply).
 *
 * Two shapes of the same description:
 *
 *  - for(): the phone push ("msg"). The iPhone's notification service
 *    extension and the Android app run outside the web session, so pictures
 *    and the reply go as signed, expiring links (avatar.push and the rest);
 *    a reply also wants one of the person's registered devices.
 *  - layout(): the page's own notification (notify-store.js, in a browser and
 *    in the Mac and Windows apps), which is signed in, so the pictures are the
 *    portal's own addresses and a reply goes to the signed-in endpoint.
 */
final class MessagePush
{
    /** How long a notification can still be replied to from a phone. */
    public const REPLY_DAYS = 3;

    /** How long the photo link in a phone notification lasts. */
    public const PHOTO_DAYS = 3;

    /**
     * The phone push's fields.
     *
     * @param  array<string, mixed>  $notification  NotificationPresenter::notification()
     * @return array<string, string>|null null for anything that is not a message or an email
     */
    public static function for(User $recipient, array $notification): ?array
    {
        $d = self::describe($notification);
        if ($d === null) {
            return null;
        }

        return self::filled([
            'kind' => $d['kind'] === 'email' ? 'email' : null,
            'conversation' => $d['thread'],
            'message' => $d['kind'] === 'email' ? $d['reply']['message'] : null,
            'sender' => $d['sender'],
            'name' => $d['name'],
            'photo' => self::signedPhoto($d['photo']),
            'group' => $d['group'],
            'groupPhoto' => self::signedGroupPhoto($d),
            'title' => $d['title'],
            'subtitle' => $d['subtitle'],
            'body' => $d['body'],
            'url' => $d['url'],
            'reply' => self::signedReply($recipient, $d['reply']),
        ]);
    }

    /**
     * The page's notification: the same lines, the picture as the portal's
     * own address, and what a reply goes to.
     *
     * @param  array<string, mixed>  $notification
     * @return array<string, mixed>|null
     */
    public static function layout(array $notification): ?array
    {
        $d = self::describe($notification);
        if ($d === null) {
            return null;
        }

        return array_filter([
            'kind' => $d['kind'],
            'title' => $d['title'],
            'subtitle' => $d['subtitle'],
            'body' => $d['body'],
            'image' => self::pagePicture($d),
            'url' => $d['url'],
            'tag' => $d['thread'],
            'replyTo' => $d['reply'],
        ], fn ($value) => $value !== null && $value !== '');
    }

    /**
     * What a message-like notification says, before it is shaped for a
     * device.
     *
     * @param  array<string, mixed>  $notification
     * @return array<string, mixed>|null
     */
    private static function describe(array $notification): ?array
    {
        $type = (string) ($notification['type'] ?? '');
        $meta = is_array($notification['meta'] ?? null) ? $notification['meta'] : [];
        $actor = is_array($notification['actor'] ?? null) ? $notification['actor'] : [];
        $actionUrl = is_string($notification['actionUrl'] ?? null) ? $notification['actionUrl'] : null;

        if ($type === 'email.received') {
            return self::describeEmail($notification, $meta, $actionUrl);
        }

        if ($type === 'cip.message') {
            return self::describeCipThread($notification, $meta, $actor, $actionUrl);
        }

        $conversation = $meta['conversationId'] ?? null;
        if (! str_starts_with($type, 'message') || ! is_string($conversation) || $conversation === '') {
            return null;
        }

        $title = (string) ($notification['title'] ?? '');
        $isGroup = (bool) ($meta['group'] ?? false);
        $name = (string) ($actor['name'] ?? $title);

        return [
            'kind' => $isGroup ? 'group' : 'message',
            'thread' => $conversation,
            'sender' => isset($actor['id']) ? (string) $actor['id'] : null,
            'name' => $name,
            // A group: the person who wrote is the first line, the group the second.
            'title' => $isGroup ? $name : $title,
            'subtitle' => $isGroup ? $title : null,
            'group' => $isGroup ? $title : null,
            'body' => (string) ($meta['pushBody'] ?? $notification['message'] ?? ''),
            'url' => $actionUrl,
            'photo' => self::string($actor['avatar'] ?? null),
            'groupConversation' => $isGroup ? $conversation : null,
            'clientPhoto' => null,
            'reply' => ['kind' => 'message', 'conversation' => $conversation],
        ];
    }

    /**
     * One email from one sender. "5 new emails" (no subject recorded) stays a
     * plain notification: it is not from anyone in particular.
     *
     * @param  array<string, mixed>  $notification
     * @param  array<string, mixed>  $meta
     * @return array<string, mixed>|null
     */
    private static function describeEmail(array $notification, array $meta, ?string $actionUrl): ?array
    {
        $message = $meta['message_uuid'] ?? null;
        $from = mb_strtolower(trim((string) ($meta['from_email'] ?? '')));
        if (! is_string($message) || $message === '' || ! array_key_exists('subject', $meta) || $from === '') {
            return null;
        }

        $name = trim((string) ($meta['from_name'] ?? '')) ?: $from;

        return [
            'kind' => 'email',
            // One stack per sender, as Mail stacks them.
            'thread' => 'email:'.$from,
            'sender' => 'email:'.$from,
            'name' => $name,
            // The sender, the subject, then the start of the email.
            'title' => $name,
            'subtitle' => self::oneLine($meta['subject']) ?: '(no subject)',
            'group' => null,
            // One run of text: an email's own line breaks left gaps in it.
            'body' => self::oneLine($meta['snippet'] ?? ''),
            'url' => $actionUrl,
            'photo' => self::string($notification['image'] ?? null),
            'groupConversation' => null,
            'clientPhoto' => null,
            'reply' => ['kind' => 'email', 'message' => $message],
        ];
    }

    /**
     * A message on a CIP file's thread, as the group chat it is copied into:
     * who wrote it, the chat's name (the client, the application's name), the
     * message, under the chat's photo or else the client's. Tapping it opens
     * that chat. A reply goes back into the same lane (internal, or the
     * service provider's), so a reply to an internal note never reaches the
     * service provider.
     *
     * @param  array<string, mixed>  $notification
     * @param  array<string, mixed>  $meta
     * @param  array<string, mixed>  $actor
     * @return array<string, mixed>|null
     */
    private static function describeCipThread(array $notification, array $meta, array $actor, ?string $actionUrl): ?array
    {
        $application = $meta['applicationId'] ?? null;
        $lane = $meta['lane'] ?? null;
        if (! is_string($application) || $application === '' || ! is_string($lane) || $lane === '') {
            return null;
        }

        $chat = is_string($meta['conversationId'] ?? null) && $meta['conversationId'] !== '' ? $meta['conversationId'] : null;
        $group = trim((string) ($meta['chatName'] ?? '')) ?: (trim((string) ($meta['number'] ?? '')) ?: 'CIP file');
        $name = trim((string) ($actor['name'] ?? '')) ?: $group;

        return [
            'kind' => 'group',
            // Stacked with the chat's own messages.
            'thread' => $chat ?? 'cip:'.$application,
            'sender' => isset($actor['id']) ? (string) $actor['id'] : null,
            'name' => $name,
            'title' => $name,
            'subtitle' => $group,
            'group' => $group,
            'body' => (string) ($meta['pushBody'] ?? $notification['message'] ?? ''),
            'url' => $chat ? '/social/messages?conversation='.$chat : $actionUrl,
            'photo' => self::string($actor['avatar'] ?? null),
            'groupConversation' => $chat,
            'clientPhoto' => self::clientPhoto($application),
            'reply' => ['kind' => 'cip', 'application' => $application, 'lane' => $lane],
        ];
    }

    /**
     * The picture the page shows: the group's (or client's) photo, else the sender's.
     *
     * @param  array<string, mixed>  $d
     */
    private static function pagePicture(array $d): ?string
    {
        $group = self::groupWithPhoto($d['groupConversation']);
        if ($group) {
            return MessagingPresenter::groupPhotoUrl($group);
        }

        return $d['clientPhoto'] ?? $d['photo'];
    }

    /** @param  array<string, mixed>  $d */
    private static function signedGroupPhoto(array $d): ?string
    {
        $group = self::groupWithPhoto($d['groupConversation']);
        if ($group) {
            return URL::temporarySignedRoute('messaging.group-photo.push', now()->addDays(self::PHOTO_DAYS), ['uuid' => $group->uuid]);
        }

        return self::signedPhoto($d['clientPhoto']);
    }

    private static function groupWithPhoto(?string $uuid): ?Conversation
    {
        if ($uuid === null) {
            return null;
        }

        $row = Conversation::query()->where('uuid', $uuid)->first(['id', 'uuid', 'photo_path']);

        return $row?->photo_path ? $row : null;
    }

    /** @param  array<string, string>  $reply */
    private static function signedReply(User $recipient, array $reply): string
    {
        $until = now()->addDays(self::REPLY_DAYS);

        return match ($reply['kind']) {
            'email' => URL::temporarySignedRoute('mail.push-reply', $until, ['message' => $reply['message'], 'user' => $recipient->id]),
            'cip' => URL::temporarySignedRoute('cip.push-reply', $until, ['application' => $reply['application'], 'user' => $recipient->id, 'lane' => $reply['lane']]),
            default => URL::temporarySignedRoute('messaging.push-reply', $until, ['conversation' => $reply['conversation'], 'user' => $recipient->id]),
        };
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

        return self::string($client->photo_url ?: ($client->hasLiveLogin() ? $client->user?->photoUrl() : null));
    }

    /** A link a phone can fetch without signing in, or null to draw initials. */
    private static function signedPhoto(?string $url): ?string
    {
        if ($url === null || $url === '') {
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

    private static function oneLine(mixed $text): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', (string) $text));
    }

    private static function string(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * @param  array<string, string|null>  $fields
     * @return array<string, string>
     */
    private static function filled(array $fields): array
    {
        return array_filter($fields, fn ($value) => $value !== null && $value !== '');
    }
}
