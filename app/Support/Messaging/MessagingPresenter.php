<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\MessageReaction;
use App\Models\User;
use App\Models\UserBlock;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Turns messaging models into the JSON the Messages page renders.
 *
 * Everything is shaped from one viewer's perspective: 'in' vs 'out', unread
 * counts, read receipts, and presence all depend on who is asking. The client
 * never has to work out whose message it is looking at.
 */
class MessagingPresenter
{
    /** One row in the chat list. */
    /**
     * What this conversation is called, from one viewer's point of view.
     *
     * A group has its own name; a direct thread is named after the other
     * person, so the same row reads differently for each side. Extracted so
     * the cross-conversation media view can label where a file came from
     * without restating the rule.
     */
    public static function title(Conversation $conversation, User $viewer): string
    {
        if ($conversation->isGroup()) {
            return $conversation->name ?: 'Group';
        }

        return $conversation->activeParticipants
            ->where('user_id', '!=', $viewer->id)
            ->map(fn (ConversationParticipant $p) => $p->user)
            ->filter()
            ->first()?->name ?? 'Unknown';
    }

    /**
     * @param  ?\Illuminate\Support\Collection  $latestReactions  Newest reaction
     *   per conversation id, when the caller has already batched them. Passing
     *   null keeps the single-conversation behaviour of looking one up.
     */
    public static function conversation(
        Conversation $conversation,
        User $viewer,
        ?ConversationParticipant $participant = null,
        ?int $unread = null,
        ?\Illuminate\Support\Collection $latestReactions = null,
    ): array {
        $participant ??= $conversation->participantFor($viewer);
        $others = $conversation->activeParticipants
            ->where('user_id', '!=', $viewer->id)
            ->map(fn (ConversationParticipant $p) => $p->user)
            ->filter()
            ->values();

        $last = $conversation->messages->last();
        $counterpart = $conversation->isGroup() ? null : $others->first();

        return [
            'id' => $conversation->uuid,
            'type' => $conversation->type,
            'name' => self::title($conversation, $viewer),
            'photo' => $conversation->isGroup()
                ? self::groupPhotoUrl($conversation)
                : $counterpart?->avatar_url,
            // Group rows stack the members' avatars, as the list already does.
            'members' => $conversation->isGroup()
                ? $others->take(3)->map(fn (User $u) => [
                    'id' => $u->id,
                    'name' => $u->name,
                    'photo' => $u->avatar_url,
                ])->values()
                : [],
            'memberCount' => $conversation->activeParticipants->count(),
            'preview' => self::preview($last, $viewer, $conversation),
            // Surfaced in the list the way an unsent draft is, without letting
            // a reaction masquerade as a message.
            'reactionNote' => self::reactionNote($conversation, $viewer, $last, $latestReactions),
            'time' => self::listTime($conversation->last_message_at),
            'timestamp' => $conversation->last_message_at?->toIso8601String(),
            'unread' => $participant ? self::unreadFor($participant, $conversation, $unread) : 0,
            'pinned' => $participant?->pinned_at !== null,
            'archived' => $participant?->archived_at !== null,
            'muted' => (bool) $participant?->isMuted(),
            'markedUnread' => $participant?->marked_unread_at !== null,
            'draft' => $participant?->draft,
            'role' => $participant?->role,
            'presence' => $counterpart
                ? PresenceService::forViewer($counterpart, $viewer)
                : ['label' => 'Group chat'],
            'counterpartId' => $counterpart?->id,
            'description' => $conversation->description,
            // The firm's own chat: managed by administrators, and nobody
            // leaves it.
            'isDefault' => (bool) $conversation->is_default,
            'canManage' => $conversation->isManageableBy($viewer),
            'canLeave' => $conversation->isLeavableBy($viewer),
            // Drives Block vs Unblock in the conversation menu.
            'blocked' => $counterpart !== null
                && in_array($counterpart->id, self::blockedIds($viewer), true),
        ];
    }

    /** One message bubble. */
    public static function message(Message $message, User $viewer, ?Conversation $conversation = null): array
    {
        $conversation ??= $message->conversation;
        $deleted = $message->trashed();

        return [
            'id' => $message->uuid,
            // Monotonic ordering key. The client pages and de-duplicates on
            // this rather than on timestamps, which can collide.
            'seq' => $message->id,
            'type' => $message->type,
            // The list already styles bubbles by side; keep that vocabulary.
            'direction' => $message->user_id === $viewer->id ? 'out' : 'in',
            'body' => $deleted ? null : $message->body,
            'deleted' => $deleted,
            'edited' => $message->edited_at !== null,
            'sender' => $message->sender ? [
                'id' => $message->sender->id,
                'name' => $message->sender->name,
                'photo' => $message->sender->avatar_url,
            ] : null,
            'sentAt' => $message->created_at->toIso8601String(),
            'time' => $message->created_at->format('g:i A'),
            'replyTo' => $message->replyTo ? self::replyStub($message->replyTo) : null,
            'attachments' => $deleted ? [] : $message->attachments->map(
                fn (MessageAttachment $a) => self::attachment($a)
            )->values(),
            'reactions' => self::reactions($message, $viewer),
            'starred' => $message->stars->contains('user_id', $viewer->id),
            'systemEvent' => $message->system_event,
            // Only the sender needs a delivery tick, and only when the people
            // who could read it have read receipts switched on.
            'status' => $message->user_id === $viewer->id
                ? self::deliveryStatus($message, $conversation)
                : null,
            'can' => [
                'edit' => ! $deleted && $message->isEditableBy($viewer),
                'delete' => ! $deleted && $message->isDeletableBy($viewer, $conversation->participantFor($viewer)),
            ],
        ];
    }

    /**
     * Everyone this viewer has blocked, or been blocked by, memoised for the
     * life of the request. The chat list presents many conversations at once,
     * so checking each pair individually would be one query per row.
     */
    private static array $blockCache = [];

    private static function blockedIds(User $viewer): array
    {
        if (! isset(self::$blockCache[$viewer->id])) {
            self::$blockCache[$viewer->id] = UserBlock::query()
                ->where('user_id', $viewer->id)
                ->pluck('blocked_user_id')
                ->merge(
                    UserBlock::query()
                        ->where('blocked_user_id', $viewer->id)
                        ->pluck('user_id')
                )
                ->unique()
                ->values()
                ->all();
        }

        return self::$blockCache[$viewer->id];
    }

    /**
     * The compact quote shown above a reply.
     *
     * Carries enough about an attachment for the quote to show a thumbnail or
     * a file-type icon — replying to a photo should look like replying to a
     * photo, not read as a line of text.
     */
    public static function replyStub(Message $message): array
    {
        $attachment = $message->trashed() ? null : $message->attachments->first();

        return [
            'id' => $message->uuid,
            'seq' => $message->id,
            'senderName' => $message->sender?->name ?? 'System',
            'preview' => $message->trashed()
                ? 'Message deleted'
                : self::snippet($message),
            'type' => $message->type,
            'attachmentName' => $attachment?->name,
            'thumbUrl' => $attachment && $attachment->isImage()
                ? route('messaging.attachments.show', $attachment->uuid)
                : null,
        ];
    }

    public static function attachment(MessageAttachment $attachment): array
    {
        return [
            'id' => $attachment->uuid,
            'name' => $attachment->name,
            'mime' => $attachment->mime,
            'size' => $attachment->size,
            'width' => $attachment->width,
            'height' => $attachment->height,
            'durationMs' => $attachment->duration_ms,
            'waveform' => $attachment->waveform,
            'shelf' => $attachment->shelf(),
            'kind' => match (true) {
                // Checked first: a recording is packaged as WebM, which would
                // otherwise classify as video.
                $attachment->isVoice() => 'voice',
                $attachment->isImage() => 'image',
                $attachment->isVideo() => 'video',
                $attachment->isAudio() => 'audio',
                default => 'file',
            },
            // Both go through the membership-checked download route; there is
            // no public URL to an attachment anywhere in the payload.
            'url' => route('messaging.attachments.show', $attachment->uuid),
            'thumbUrl' => $attachment->thumb_path
                ? route('messaging.attachments.thumb', $attachment->uuid)
                : null,
        ];
    }

    /**
     * Grouped reaction summary: one entry per emoji with who used it, so the
     * bubble can show counts and the "who reacted" sheet needs no extra call.
     */
    private static function reactions(Message $message, User $viewer): array
    {
        return $message->reactions
            ->groupBy('emoji')
            ->map(fn ($group, $emoji) => [
                'emoji' => $emoji,
                'count' => $group->count(),
                'mine' => $group->contains('user_id', $viewer->id),
                'users' => $group->map(fn ($r) => [
                    'id' => $r->user_id,
                    'name' => $r->user?->name ?? 'Someone',
                ])->values(),
            ])
            ->values()
            ->all();
    }

    /**
     * The sender's tick state: 'sent' → 'delivered' → 'read'.
     *
     * Each step requires *every* other participant to have reached it, so in a
     * group the tick only turns blue once the whole room has read it — which is
     * the behaviour people already expect from other messengers.
     *
     * Read receipts are a privacy setting, delivery is not. Someone with
     * receipts off still advances the message to 'delivered' (their device did
     * receive it) but never to 'read'; that is the whole point of the setting.
     */
    private static function deliveryStatus(Message $message, Conversation $conversation): string
    {
        $others = $conversation->activeParticipants->where('user_id', '!=', $message->user_id);

        if ($others->isEmpty()) {
            return 'sent';
        }

        $allRead = $others->every(function (ConversationParticipant $p) use ($message) {
            if (! $p->user || ! MessagingSettings::get($p->user, 'readReceipts')) {
                return false;
            }

            return ($p->last_read_message_id ?? 0) >= $message->id;
        });

        if ($allRead) {
            return 'read';
        }

        // Reading implies receiving, so a participant whose read mark is past
        // this message counts as delivered even if the delivery mark lagged.
        $allDelivered = $others->every(function (ConversationParticipant $p) use ($message) {
            $reached = max(
                $p->last_delivered_message_id ?? 0,
                $p->last_read_message_id ?? 0,
            );

            return $reached >= $message->id;
        });

        return $allDelivered ? 'delivered' : 'sent';
    }

    /**
     * A participant's unread badge. An explicit "mark as unread" wins over the
     * computed count so the row still reads as unread with nothing new in it.
     */
    /**
     * A participant's unread badge.
     *
     * `$known` is the count already worked out in bulk by the caller. When it
     * is absent this counts in the database rather than over
     * `$conversation->messages` — that relation is usually loaded with only the
     * newest message (for the list preview), so counting across it silently
     * capped every conversation at 1 unread and made the sidebar badge read
     * "number of conversations with something new" instead of a message count.
     */
    private static function unreadFor(
        ConversationParticipant $participant,
        Conversation $conversation,
        ?int $known = null,
    ): int {
        $count = $known ?? $participant->unreadCount();

        // An explicit "mark as unread" keeps the row bold with nothing new in it.
        if ($count === 0 && $participant->marked_unread_at !== null) {
            return 1;
        }

        return $count;
    }

    /**
     * The most recent reaction in a conversation, phrased for the chat list.
     *
     * Reactions are not messages, so they never move a conversation or change
     * its preview on their own — but a reaction arriving is the kind of thing
     * you want to see from the list, the same way an unsent draft is surfaced
     * there. Only shown when it is newer than the last message.
     */
    private static function reactionNote(
        Conversation $conversation,
        User $viewer,
        ?Message $last,
        ?\Illuminate\Support\Collection $latestReactions = null,
    ): ?string {
        /*
         * Presenting a list means asking this for every row. Left to itself
         * that is one query per conversation, so the list endpoint batches the
         * lookup (see MessagingController::latestReactionsFor) and hands the
         * result in. A caller presenting a single conversation passes nothing
         * and takes the direct query, which is cheaper than batching one row.
         */
        if ($latestReactions !== null) {
            $reaction = $latestReactions->get($conversation->id);
        } else {
            $reaction = MessageReaction::query()
                ->whereHas('message', fn ($q) => $q->where('conversation_id', $conversation->id))
                ->with(['user', 'message'])
                ->latest('id')
                ->first();
        }

        if (! $reaction) {
            return null;
        }

        // Stale next to a newer message: the message is the more useful line.
        if ($last && $reaction->created_at < $last->created_at) {
            return null;
        }

        $who = $reaction->user_id === $viewer->id
            ? 'You'
            : ($reaction->user?->name ?? 'Someone');

        $target = $reaction->message?->user_id === $viewer->id
            ? 'your message'
            : 'a message';

        return $who.' reacted '.$reaction->emoji.' to '.$target;
    }

    /** The one-line summary under a conversation name in the list. */
    private static function preview(?Message $message, User $viewer, Conversation $conversation): string
    {
        if (! $message) {
            return 'No messages yet';
        }

        if ($message->trashed()) {
            return 'Message deleted';
        }

        $snippet = self::snippet($message);

        // Group rows name the speaker; direct rows only mark your own sends.
        if ($message->isSystem()) {
            return $snippet;
        }

        if ($message->user_id === $viewer->id) {
            return 'You: '.$snippet;
        }

        return $conversation->isGroup() && $message->sender
            ? $message->sender->name.': '.$snippet
            : $snippet;
    }

    /** Text stand-in for any message type, used in previews and reply quotes. */
    private static function snippet(Message $message): string
    {
        if ($message->body) {
            return Str::limit($message->body, 80);
        }

        $attachment = $message->attachments->first();

        return match (true) {
            $message->type === Message::TYPE_VOICE => 'Voice note',
            $attachment?->isImage() => 'Photo',
            $attachment?->isVideo() => 'Video',
            $attachment !== null => $attachment->name,
            default => '',
        };
    }

    /** Chat-list timestamps compress with age, like every messenger's list. */
    private static function listTime(?Carbon $at): string
    {
        if (! $at) {
            return '';
        }

        return match (true) {
            $at->isToday() => $at->format('H:i'),
            $at->isYesterday() => 'Yesterday',
            $at->isCurrentYear() => $at->format('M j'),
            default => $at->format('M j, Y'),
        };
    }

    private static function groupPhotoUrl(Conversation $conversation): ?string
    {
        return $conversation->photo_path
            ? route('messaging.conversations.photo', $conversation->uuid)
            : null;
    }
}
