<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\User;
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
    public static function conversation(
        Conversation $conversation,
        User $viewer,
        ?ConversationParticipant $participant = null,
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
            'name' => $conversation->isGroup()
                ? ($conversation->name ?: 'Group')
                : ($counterpart?->name ?? 'Unknown'),
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
            'time' => self::listTime($conversation->last_message_at),
            'timestamp' => $conversation->last_message_at?->toIso8601String(),
            'unread' => $participant ? self::unreadFor($participant, $conversation) : 0,
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

    /** The compact quote shown above a reply. */
    public static function replyStub(Message $message): array
    {
        return [
            'id' => $message->uuid,
            'seq' => $message->id,
            'senderName' => $message->sender?->name ?? 'System',
            'preview' => $message->trashed()
                ? 'Message deleted'
                : self::snippet($message),
            'type' => $message->type,
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
     * 'sent' until everyone else has read it, then 'read'.
     *
     * A participant who has turned read receipts off never advances this, so
     * their reading stays invisible to the sender.
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

        return $allRead ? 'read' : 'sent';
    }

    /**
     * A participant's unread badge. An explicit "mark as unread" wins over the
     * computed count so the row still reads as unread with nothing new in it.
     */
    private static function unreadFor(ConversationParticipant $participant, Conversation $conversation): int
    {
        $count = $conversation->messages
            ->where('id', '>', $participant->last_read_message_id ?? 0)
            ->where('user_id', '!=', $participant->user_id)
            ->count();

        if ($count === 0 && $participant->marked_unread_at !== null) {
            return 1;
        }

        return $count;
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
