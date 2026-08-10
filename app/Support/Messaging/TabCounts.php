<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;

/**
 * The badge on the Messages nav bar's Calls tab.
 *
 * It answers "what has happened here that I have not looked at?", and needs a
 * *seen* marker to answer it, because a missed call has no per-item read state
 * of its own — it is not unread mail.
 *
 * Two rules shape this:
 *
 * - **The markers are written from server truth, never from a number the
 *   client sends.** Opening a tab means "I have seen everything up to now",
 *   and now is something only the server should decide.
 * - **Chats is deliberately absent.** The chat badge is summed from the
 *   visible rows client-side, which excludes archived threads; a server total
 *   would count them and the two would disagree. One question, one answer.
 */
final class TabCounts
{
    /** Where the markers live inside users.preferences. */
    private const KEY = 'messagingSeen';

    /** A badge only has to be right up to "99+", so counting stops there. */
    private const CAP = 200;

    /**
     * @param  ?array<int, int>  $conversationIds  the caller's conversations,
     *   when they have already been loaded — the chat list has them in hand,
     *   and this runs on every one of its loads.
     * @return array{calls:int}
     */
    public static function for(User $user, ?array $conversationIds = null): array
    {
        return [
            'calls' => self::missedCalls($user, $conversationIds),
        ];
    }

    /**
     * Mark one tab seen and return the counts as they now stand.
     *
     * @return array{calls:int}
     */
    public static function markSeen(User $user, string $tab): array
    {
        if ($tab !== 'calls') {
            return self::for($user);
        }

        $seen = self::markers($user);
        $seen['callId'] = (int) Message::query()
            ->whereIn('conversation_id', self::conversationIds($user))
            ->where('type', Message::TYPE_SYSTEM)
            ->max('id');

        $preferences = $user->preferences ?? [];
        $preferences[self::KEY] = $seen;
        $user->preferences = $preferences;
        $user->save();

        return self::for($user);
    }

    /**
     * Calls that rang for this user and were never answered, since they last
     * opened the Calls tab.
     *
     * A call *they* placed that nobody picked up is "No answer" in the log —
     * they already know how it went, so it is not a badge.
     */
    private static function missedCalls(User $user, ?array $conversationIds = null): int
    {
        $ids = $conversationIds ?? self::conversationIds($user);
        if (empty($ids)) {
            return 0;
        }

        $since = (int) (self::markers($user)['callId'] ?? 0);

        // The initiator is filtered in PHP: it lives inside the JSON blob as a
        // number, and comparing it in SQL means trusting two database engines
        // to agree about JSON types. The row set is a call log, not a feed.
        return Message::query()
            ->whereIn('conversation_id', $ids)
            ->where('type', Message::TYPE_SYSTEM)
            ->where('system_event->event', 'call_missed')
            ->where('id', '>', $since)
            ->orderByDesc('id')
            ->limit(self::CAP)
            ->get(['id', 'system_event'])
            ->filter(function (Message $m) use ($user) {
                $initiator = data_get($m->system_event, 'initiatorId');

                return $initiator === null || (int) $initiator !== $user->id;
            })
            ->count();
    }

    /** @return array<string, mixed> */
    private static function markers(User $user): array
    {
        $stored = data_get($user->preferences, self::KEY, []);

        return is_array($stored) ? $stored : [];
    }

    /** @return array<int, int> */
    private static function conversationIds(User $user): array
    {
        return Conversation::query()->forUser($user)->pluck('id')->all();
    }
}
