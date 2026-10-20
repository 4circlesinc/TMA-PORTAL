<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\User;
use App\Support\Cip\Threads;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Writing a message into a conversation.
 *
 * Everything that has to be true the moment a message exists, in one
 * transaction, so a message sent from the composer and one posted when its
 * scheduled time arrives are the same thing by the time anybody reads them.
 * Telling people (the broadcast, the notifications) is the caller's, after
 * the write has committed.
 */
final class Posting
{
    /** What a presented message reads; load these before handing one out. */
    public const RELATIONS = [
        'sender', 'attachments', 'reactions.user', 'stars', 'mentions',
        'replyTo.sender', 'replyTo.attachments',
    ];

    /**
     * @param  array<string, mixed>  $attributes  type, body, reply_to_id, client_nonce, is_announcement
     * @param  Collection<int, MessageAttachment>|null  $staged  Uploaded files this message claims.
     * @return array{0: Message, 1: array{users: list<int>, all: bool}} The message, and who it newly addresses.
     */
    public static function write(Conversation $conversation, User $author, array $attributes, ?Collection $staged = null): array
    {
        $staged ??= collect();
        $mentioned = ['users' => [], 'all' => false];

        $message = DB::transaction(function () use ($conversation, $author, $attributes, $staged, &$mentioned) {
            $message = $conversation->messages()->create(['user_id' => $author->id] + $attributes);

            if ($staged->isNotEmpty()) {
                MessageAttachment::whereIn('id', $staged->pluck('id'))->update([
                    'message_id' => $message->id,
                    'status' => MessageAttachment::STATUS_READY,
                ]);
            }

            $conversation->forceFill(['last_message_at' => $message->created_at])->save();

            // @Name and @all, read out of the text itself.
            $mentioned = Mentions::sync($message, $conversation);

            // Sending is also reading: the sender's own message must not come
            // back to them as unread, and their draft is now spent. Stamp
            // everyone else's messages first, while the old cursor is still
            // the time they were actually seen.
            $participant = ConversationParticipant::query()
                ->where('conversation_id', $conversation->id)
                ->where('user_id', $author->id)
                ->first();

            if ($participant) {
                ReadReceipts::note($participant, $message->id);
                $participant->forceFill([
                    'last_read_message_id' => $message->id,
                    'last_read_at' => now(),
                    'marked_unread_at' => null,
                    'draft' => null,
                ])->save();
            }

            return $message;
        });

        // Sending reads everything up to this line, including a copy of an
        // application message. That copy being seen is the application
        // message being seen.
        Threads::noteSeenInMessages($author, (int) $conversation->id, (int) $message->id);

        return [$message, $mentioned];
    }
}
