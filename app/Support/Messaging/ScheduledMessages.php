<?php

namespace App\Support\Messaging;

use App\Events\MessageSent;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\ScheduledMessage;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Messages written now and posted later.
 *
 * A scheduled message is posted by its author, as its author, when its time
 * comes: the same write a send from the composer makes, so nothing that reads
 * a thread can tell the two apart. What may have changed while it waited is
 * asked again at that moment, not trusted from when it was written.
 */
final class ScheduledMessages
{
    /** How far ahead something may be scheduled. */
    public const MAX_DAYS_AHEAD = 366;

    /** How many one conversation may have waiting at once. */
    public const MAX_WAITING = 50;

    /** How long one that could not be posted stays listed, so its author sees it. */
    public const FAILED_SHOWN_DAYS = 7;

    /** @return array<string, mixed> */
    public static function present(ScheduledMessage $scheduled): array
    {
        return [
            'id' => $scheduled->uuid,
            'body' => $scheduled->body,
            'announcement' => (bool) $scheduled->is_announcement,
            'sendAt' => $scheduled->send_at->toIso8601String(),
            'author' => $scheduled->author
                ? ['id' => $scheduled->author->id, 'name' => $scheduled->author->name]
                : null,
            'failed' => $scheduled->failed_at !== null,
            'failedReason' => $scheduled->failed_reason,
        ];
    }

    /**
     * Post everything whose time has come.
     *
     * One at a time and each in its own transaction, so one that cannot be
     * posted does not hold up the rest.
     */
    public static function deliverDue(int $limit = 200): int
    {
        $sent = 0;

        foreach (ScheduledMessage::query()->due()->orderBy('send_at')->limit($limit)->pluck('id') as $id) {
            try {
                if (self::deliver((int) $id)) {
                    $sent++;
                }
            } catch (Throwable $e) {
                // Left waiting: the next minute tries it again.
                Log::warning('Scheduled message could not be posted.', ['id' => $id, 'reason' => $e->getMessage()]);
            }
        }

        return $sent;
    }

    /** Post one, if it is still waiting. Null when there was nothing to post. */
    public static function deliver(int $id): ?Message
    {
        $posted = DB::transaction(function () use ($id) {
            // Held for the write, so two runs that both saw it due cannot
            // both post it: the second waits here and finds it sent.
            $scheduled = ScheduledMessage::query()->whereKey($id)->lockForUpdate()->first();

            if (! $scheduled || $scheduled->sent_at !== null || $scheduled->failed_at !== null) {
                return null;
            }

            $conversation = Conversation::query()->with('activeParticipants.user')->find($scheduled->conversation_id);
            $author = $scheduled->author;

            $refusal = self::refusal($scheduled, $conversation, $author);

            if ($refusal !== null) {
                $scheduled->forceFill(['failed_at' => now(), 'failed_reason' => $refusal])->save();

                return null;
            }

            [$message, $mentioned] = Posting::write($conversation, $author, [
                'type' => Message::TYPE_TEXT,
                'body' => $scheduled->body,
                'is_announcement' => $scheduled->is_announcement,
            ]);

            $scheduled->forceFill(['sent_at' => now(), 'message_id' => $message->id])->save();

            return [$conversation, $author, $message, $mentioned];
        });

        if ($posted === null) {
            return null;
        }

        [$conversation, $author, $message, $mentioned] = $posted;

        $message->load(Posting::RELATIONS);

        // Nobody's browser sent this one, so there is no sender to leave out:
        // the author's own open tabs have to hear it like everyone else's.
        Broadcaster::to(new MessageSent($message));
        MessageNotifier::announceMessage($conversation, $message, $author, $mentioned);

        return $message;
    }

    /** Why this can no longer be posted, or null when it still can. */
    private static function refusal(ScheduledMessage $scheduled, ?Conversation $conversation, ?User $author): ?string
    {
        if (! $conversation || ! $author) {
            return 'The conversation no longer exists.';
        }

        if ($conversation->isDisabled()) {
            return 'The conversation is closed.';
        }

        if (! $author->isApproved() || ! $conversation->participantFor($author)) {
            return 'Its author is no longer in the conversation.';
        }

        if ($scheduled->is_announcement && ! $conversation->isManageableBy($author)) {
            return 'Its author can no longer post announcements here.';
        }

        return null;
    }
}
