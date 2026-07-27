<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use App\Models\UserBlock;
use App\Models\UserWorkStatus;

/**
 * The badges on the Messages nav bar: Calls and Updates.
 *
 * Both answer the same question — "what has happened here that I have not
 * looked at?" — and both need a *seen* marker to answer it, because neither
 * has a per-item read state of its own. A missed call is not unread, and a
 * colleague's status is not addressed to anyone.
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
     * @return array{calls:int, updates:int}
     */
    public static function for(User $user): array
    {
        return [
            'calls' => self::missedCalls($user),
            'updates' => self::newUpdates($user),
        ];
    }

    /**
     * Mark one tab seen and return the counts as they now stand.
     *
     * @return array{calls:int, updates:int}
     */
    public static function markSeen(User $user, string $tab): array
    {
        $seen = self::markers($user);

        if ($tab === 'calls') {
            $seen['callId'] = (int) Message::query()
                ->whereIn('conversation_id', self::conversationIds($user))
                ->where('type', Message::TYPE_SYSTEM)
                ->max('id');
        } elseif ($tab === 'updates') {
            $seen['updatesAt'] = now()->toIso8601String();
        } else {
            return self::for($user);
        }

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
    private static function missedCalls(User $user): int
    {
        $ids = self::conversationIds($user);
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

    /** Colleagues who have posted or changed a status since the last look. */
    private static function newUpdates(User $user): int
    {
        $blocked = UserBlock::query()
            ->where('user_id', $user->id)->pluck('blocked_user_id')
            ->merge(UserBlock::where('blocked_user_id', $user->id)->pluck('user_id'));

        $query = UserWorkStatus::query()
            ->current()
            ->whereHas('user', fn ($q) => $q
                ->where('id', '!=', $user->id)
                ->whereNotIn('id', $blocked)
                ->where('status', User::STATUS_APPROVED));

        if ($since = self::markers($user)['updatesAt'] ?? null) {
            $query->where('updated_at', '>', $since);
        }

        return min($query->count(), self::CAP);
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
