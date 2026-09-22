<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\MessageReceipt;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Who has seen a chat message, and the moment they first did.
 *
 * The participant cursor still decides unread counts. This table is only the
 * face under the bubble: one row per reader per message, stamped the first
 * time the cursor passes it. Someone with read receipts switched off is
 * never stamped and never listed.
 */
class ReadReceipts
{
    /**
     * Stamp every other person's message the cursor is about to cover.
     *
     * Call this before the cursor itself moves. Messages already stamped keep
     * their original time; anything newly covered is stamped now.
     */
    public static function note(ConversationParticipant $participant, int $through): void
    {
        if ($through < 1 || ! $participant->user_id) {
            return;
        }

        $user = $participant->relationLoaded('user')
            ? $participant->user
            : $participant->user()->first();

        if (! $user || ! MessagingSettings::get($user, 'readReceipts')) {
            return;
        }

        $previous = (int) ($participant->last_read_message_id ?? 0);
        $already = self::snapshotted((int) $participant->conversation_id, (int) $participant->user_id);
        $covered = min($previous, $through);

        if (! $already && $covered > 0) {
            $at = $participant->last_read_at ?? $participant->updated_at ?? now();
            self::stamp($participant, 0, $covered, $at);
        }

        $start = $already ? $previous : $covered;

        if ($through > $start) {
            self::stamp($participant, $start, $through, now());
        }
    }

    /**
     * Faces for these messages, keyed by message id.
     *
     * The author and the viewer are left off. A reader who has not been
     * stamped yet (they caught up before this table existed) still shows,
     * at the time on their cursor, until the next time they open the thread.
     *
     * @param  Collection<int, Message>  $messages
     * @return array<int, list<array{id: int, name: string, avatar: ?string, seenAt: string}>>
     */
    public static function forMessages(Collection $messages, Conversation $conversation, User $viewer): array
    {
        $out = [];

        foreach ($messages as $message) {
            $out[(int) $message->id] = [];
        }

        if ($messages->isEmpty()) {
            return $out;
        }

        $participants = $conversation->relationLoaded('activeParticipants')
            ? $conversation->activeParticipants
            : $conversation->activeParticipants()->with('user')->get();

        $participants->loadMissing('user');

        $readers = $participants->filter(function (ConversationParticipant $participant) use ($viewer) {
            return $participant->user
                && (int) $participant->user_id !== (int) $viewer->id
                && MessagingSettings::get($participant->user, 'readReceipts');
        })->values();

        if ($readers->isEmpty()) {
            return $out;
        }

        $ids = $messages->map(fn (Message $message) => (int) $message->id)->all();

        $rows = MessageReceipt::query()
            ->whereIn('message_id', $ids)
            ->get()
            ->groupBy(fn (MessageReceipt $row) => $row->message_id.'-'.$row->user_id);

        $snapshotted = MessageReceipt::query()
            ->where('conversation_id', $conversation->id)
            ->whereIn('user_id', $readers->pluck('user_id'))
            ->distinct()
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        foreach ($messages as $message) {
            if ($message->type === Message::TYPE_SYSTEM) {
                continue;
            }

            $faces = [];

            foreach ($readers as $participant) {
                if ((int) $participant->user_id === (int) $message->user_id) {
                    continue;
                }

                $row = $rows->get($message->id.'-'.$participant->user_id)?->first();
                $seenAt = $row?->seen_at;

                if ($seenAt === null && ! in_array((int) $participant->user_id, $snapshotted, true)) {
                    $cursor = (int) ($participant->last_read_message_id ?? 0);

                    if ($cursor >= (int) $message->id) {
                        $seenAt = $participant->last_read_at ?? $participant->updated_at;
                    }
                }

                if ($seenAt === null) {
                    continue;
                }

                $faces[] = [
                    'id' => (int) $participant->user_id,
                    'name' => $participant->user->name,
                    'avatar' => $participant->user->photoUrl(),
                    'seenAt' => $seenAt->toIso8601String(),
                ];
            }

            usort($faces, fn (array $a, array $b) => strcmp($a['seenAt'], $b['seenAt']));
            $out[(int) $message->id] = $faces;
        }

        return $out;
    }

    private static function snapshotted(int $conversationId, int $userId): bool
    {
        return MessageReceipt::query()
            ->where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->exists();
    }

    private static function stamp(ConversationParticipant $participant, int $after, int $through, mixed $seenAt): void
    {
        $ids = Message::query()
            ->where('conversation_id', $participant->conversation_id)
            ->where('id', '>', $after)
            ->where('id', '<=', $through)
            ->where('type', '!=', Message::TYPE_SYSTEM)
            ->where(function ($query) use ($participant) {
                $query->whereNull('user_id')
                    ->orWhere('user_id', '!=', $participant->user_id);
            })
            ->pluck('id');

        if ($ids->isEmpty()) {
            return;
        }

        $stamp = Carbon::parse($seenAt)->toDateTimeString();

        foreach ($ids->chunk(400) as $chunk) {
            MessageReceipt::query()->insertOrIgnore($chunk->map(fn ($id) => [
                'conversation_id' => $participant->conversation_id,
                'message_id' => $id,
                'user_id' => $participant->user_id,
                'seen_at' => $stamp,
            ])->all());
        }
    }
}
