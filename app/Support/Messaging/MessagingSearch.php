<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\User;
use App\Models\UserBlock;
use Illuminate\Support\Str;

/**
 * Search across everything the Messages page can reach.
 *
 * Results are grouped rather than ranked into one list: "a person called Ana",
 * "a message mentioning invoices" and "a file called invoice.pdf" are different
 * kinds of answer, and flattening them makes the useful one harder to find.
 *
 * Every query is scoped to conversations the caller is a member of *before* it
 * matches anything, so search can never surface a message from a thread they
 * cannot open.
 */
class MessagingSearch
{
    private const PER_GROUP = 12;

    public static function run(User $user, string $term): array
    {
        $term = trim($term);

        if (mb_strlen($term) < 2) {
            return self::empty();
        }

        // The ids the caller may see anything from. Everything below joins
        // against this rather than trusting a later filter to catch strays.
        $conversationIds = Conversation::query()
            ->forUser($user)
            ->pluck('id');

        if ($conversationIds->isEmpty()) {
            return array_merge(self::empty(), ['people' => self::people($user, $term)]);
        }

        return [
            'people' => self::people($user, $term),
            'conversations' => self::conversations($user, $term, $conversationIds),
            'messages' => self::messages($user, $term, $conversationIds),
            'files' => self::files($user, $term, $conversationIds),
            'links' => self::links($user, $term, $conversationIds),
        ];
    }

    private static function empty(): array
    {
        return [
            'people' => [],
            'conversations' => [],
            'messages' => [],
            'files' => [],
            'links' => [],
        ];
    }

    /** lower(col) LIKE ? — the same on Postgres and the SQLite tests use. */
    private static function like($query, string $column, string $term)
    {
        return $query->whereRaw('lower('.$column.') like ?', ['%'.mb_strtolower($term).'%']);
    }

    /**
     * Staff and clients this user could start a conversation with.
     *
     * Blocked people are excluded in both directions: offering to start a chat
     * that cannot be sent to is worse than not offering it.
     */
    private static function people(User $user, string $term): array
    {
        $blocked = UserBlock::query()
            ->where('user_id', $user->id)->pluck('blocked_user_id')
            ->merge(UserBlock::where('blocked_user_id', $user->id)->pluck('user_id'));

        return User::query()
            ->where('id', '!=', $user->id)
            ->whereNotIn('id', $blocked)
            ->where('status', User::STATUS_APPROVED)
            ->where(function ($q) use ($term) {
                self::like($q, 'name', $term);
                $q->orWhereRaw('lower(email) like ?', ['%'.mb_strtolower($term).'%']);
            })
            ->orderBy('name')
            ->limit(self::PER_GROUP)
            ->get(['id', 'name', 'email', 'avatar_url', 'account_type'])
            ->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'photo' => $u->avatar_url,
                'accountType' => $u->account_type,
            ])
            ->all();
    }

    /**
     * Conversations by name.
     *
     * A direct thread has no name of its own, so it matches on the other
     * person's — which is what someone searching "Ana" is looking for.
     */
    private static function conversations(User $user, string $term, $ids): array
    {
        $matches = Conversation::query()
            ->whereIn('id', $ids)
            ->with(['activeParticipants.user', 'messages' => fn ($q) => $q->latest('id')->limit(1)])
            ->where(function ($q) use ($term, $user) {
                self::like($q, 'name', $term);
                $q->orWhereHas('activeParticipants.user', function ($u) use ($term, $user) {
                    $u->where('users.id', '!=', $user->id);
                    self::like($u, 'users.name', $term);
                });
            })
            ->orderByDesc('last_message_at')
            ->limit(self::PER_GROUP)
            ->get();

        return $matches
            ->map(fn (Conversation $c) => MessagingPresenter::conversation($c, $user))
            ->all();
    }

    /** Message text, newest first, with the conversation it belongs to. */
    private static function messages(User $user, string $term, $ids): array
    {
        return Message::query()
            ->whereIn('conversation_id', $ids)
            ->whereNotNull('body')
            ->where(fn ($q) => self::like($q, 'body', $term))
            ->with(['sender', 'conversation.activeParticipants.user'])
            ->latest('id')
            ->limit(self::PER_GROUP)
            ->get()
            ->map(fn (Message $m) => [
                'id' => $m->uuid,
                'seq' => $m->id,
                'conversationId' => $m->conversation->uuid,
                'conversationName' => self::conversationLabel($m->conversation, $user),
                'senderName' => $m->user_id === $user->id ? 'You' : ($m->sender?->name ?? 'Unknown'),
                // Enough context to recognise the message without opening it.
                'excerpt' => self::excerpt($m->body, $term),
                'sentAt' => $m->created_at->toIso8601String(),
                'date' => $m->created_at->format('j M Y'),
            ])
            ->all();
    }

    /** Attachments by filename. */
    private static function files(User $user, string $term, $ids): array
    {
        return MessageAttachment::query()
            ->whereIn('conversation_id', $ids)
            ->whereNotNull('message_id')
            ->where(fn ($q) => self::like($q, 'name', $term))
            ->with(['message.conversation.activeParticipants.user', 'message.sender'])
            ->latest('id')
            ->limit(self::PER_GROUP)
            ->get()
            ->filter(fn (MessageAttachment $a) => $a->message !== null)
            ->map(fn (MessageAttachment $a) => array_merge(
                MessagingPresenter::attachment($a),
                [
                    'messageId' => $a->message->uuid,
                    'seq' => $a->message->id,
                    'conversationId' => $a->message->conversation->uuid,
                    'conversationName' => self::conversationLabel($a->message->conversation, $user),
                    'senderName' => $a->message->user_id === $user->id
                        ? 'You'
                        : ($a->message->sender?->name ?? 'Unknown'),
                    'date' => $a->created_at->format('j M Y'),
                ]
            ))
            ->values()
            ->all();
    }

    /**
     * Messages containing a URL that matches the term.
     *
     * Matched on the message body rather than the link_previews cache: a link
     * with no metadata never reaches that table, and it is still a link the
     * user shared and may be looking for.
     */
    private static function links(User $user, string $term, $ids): array
    {
        return Message::query()
            ->whereIn('conversation_id', $ids)
            ->where(fn ($q) => self::like($q, 'body', 'http'))
            ->where(fn ($q) => self::like($q, 'body', $term))
            ->with(['sender', 'conversation.activeParticipants.user'])
            ->latest('id')
            ->limit(self::PER_GROUP)
            ->get()
            ->flatMap(function (Message $m) use ($user, $term) {
                return collect(LinkPreviewService::extract($m->body))
                    ->filter(fn (string $url) => Str::contains(
                        Str::lower($url), Str::lower($term)
                    ))
                    ->map(fn (string $url) => [
                        'url' => $url,
                        'domain' => parse_url($url, PHP_URL_HOST),
                        'messageId' => $m->uuid,
                        'seq' => $m->id,
                        'conversationId' => $m->conversation->uuid,
                        'conversationName' => self::conversationLabel($m->conversation, $user),
                        'senderName' => $m->user_id === $user->id ? 'You' : ($m->sender?->name ?? 'Unknown'),
                        'date' => $m->created_at->format('j M Y'),
                    ]);
            })
            ->take(self::PER_GROUP)
            ->values()
            ->all();
    }

    private static function conversationLabel(Conversation $conversation, User $user): string
    {
        if ($conversation->isGroup()) {
            return $conversation->name ?: 'Group';
        }

        return $conversation->counterpartFor($user)?->name ?? 'Unknown';
    }

    /**
     * A window of the body around the match, so a hit deep in a long message
     * is still recognisable in the results list.
     */
    private static function excerpt(string $body, string $term): string
    {
        $position = mb_stripos($body, $term);

        if ($position === false || mb_strlen($body) <= 120) {
            return Str::limit($body, 120);
        }

        $start = max(0, $position - 40);
        $slice = mb_substr($body, $start, 120);

        return ($start > 0 ? '…' : '').trim($slice).'…';
    }
}
