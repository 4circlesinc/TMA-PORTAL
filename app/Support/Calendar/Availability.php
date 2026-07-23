<?php

namespace App\Support\Calendar;

use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * Free/busy for people and groups — what the event form shows when picking a
 * time, and the only thing an availability-only viewer is ever told.
 *
 * The rule this class exists to enforce: a busy block carries **no detail**.
 * Not a title, not a location, not which calendar it came from. Someone who
 * can see that a colleague is busy at 10am learns exactly that and nothing
 * more, however many calendars they can otherwise read.
 */
class Availability
{
    public const FREE = 'free';

    public const BUSY = 'busy';

    public const TENTATIVE = 'tentative';

    public const OUT_OF_OFFICE = 'out_of_office';

    public const WORKING_ELSEWHERE = 'working_elsewhere';

    /** Nobody's availability is readable without at least this much access. */
    private const MIN_ROLE = CalendarAccess::ROLE_AVAILABILITY;

    /**
     * Busy blocks for each of `$users` between `$from` and `$to`.
     *
     * @param  Collection<int, User>  $users
     * @return array<int, array<string, mixed>> keyed by user id
     */
    public static function forUsers(
        User $viewer,
        Collection $users,
        CarbonImmutable $from,
        CarbonImmutable $to,
    ): array {
        $out = [];

        foreach ($users as $subject) {
            $out[$subject->id] = [
                'userId' => $subject->id,
                'name' => $subject->name,
                'avatarUrl' => $subject->avatar_url,
            ] + self::forUser($viewer, $subject, $from, $to);
        }

        return $out;
    }

    /**
     * One person's busy blocks.
     *
     * Reads every calendar they own, then keeps only those the viewer holds at
     * least availability permission on. A calendar the viewer cannot see at
     * all contributes nothing — not even a block — which is why the result can
     * legitimately be "unknown" rather than "free".
     *
     * @return array<string, mixed>
     */
    public static function forUser(
        User $viewer,
        User $subject,
        CarbonImmutable $from,
        CarbonImmutable $to,
    ): array {
        $calendars = Calendar::where('owner_id', $subject->id)
            ->where('is_archived', false)
            ->get();

        $roles = CalendarAccess::rolesFor($viewer, $calendars);

        $readable = $calendars->filter(
            fn (Calendar $c) => CalendarAccess::atLeast($roles[$c->id] ?? null, self::MIN_ROLE)
        );

        /*
         * No readable calendar is *not* the same as a free diary. Saying
         * "free" here would let anyone schedule over a colleague they simply
         * have no visibility of, so the caller is told the truth instead.
         */
        if ($readable->isEmpty()) {
            return ['status' => 'unknown', 'blocks' => []];
        }

        $events = CalendarEvent::whereIn('calendar_id', $readable->pluck('id'))
            ->where('status', '!=', CalendarEvent::STATUS_CANCELLED)
            ->where('starts_at', '<', $to)
            ->where('ends_at', '>', $from)
            ->orderBy('starts_at')
            ->limit(500)
            ->get(['id', 'starts_at', 'ends_at', 'all_day', 'status']);

        $blocks = $events->map(fn (CalendarEvent $e) => [
            // Deliberately only times and a coarse state — never a title.
            'startsAt' => $e->starts_at->toIso8601String(),
            'endsAt' => $e->ends_at->toIso8601String(),
            'status' => $e->status === CalendarEvent::STATUS_TENTATIVE ? self::TENTATIVE : self::BUSY,
            'allDay' => (bool) $e->all_day,
        ])->values()->all();

        return [
            'status' => $blocks ? self::BUSY : self::FREE,
            'blocks' => self::merge($blocks),
        ];
    }

    /**
     * Collapse overlapping blocks so the UI draws one bar per busy stretch
     * rather than stacking every calendar's copy of the same meeting.
     *
     * A tentative block absorbed into a confirmed one becomes busy — the
     * stronger claim on the time wins.
     *
     * @param  array<int, array<string, mixed>>  $blocks
     * @return array<int, array<string, mixed>>
     */
    private static function merge(array $blocks): array
    {
        if (count($blocks) < 2) {
            return $blocks;
        }

        usort($blocks, fn ($a, $b) => strcmp($a['startsAt'], $b['startsAt']));

        $merged = [array_shift($blocks)];

        foreach ($blocks as $block) {
            $last = &$merged[count($merged) - 1];

            if ($block['startsAt'] <= $last['endsAt']) {
                if ($block['endsAt'] > $last['endsAt']) {
                    $last['endsAt'] = $block['endsAt'];
                }
                if ($block['status'] === self::BUSY) {
                    $last['status'] = self::BUSY;
                }
                $last['allDay'] = $last['allDay'] || $block['allDay'];

                continue;
            }

            $merged[] = $block;
        }

        return $merged;
    }

    /**
     * The earliest slot of `$minutes` in which everyone is free — the "find a
     * time" answer. Returns null when the window holds no such slot.
     *
     * @param  array<int, array<string, mixed>>  $availability  as returned by forUsers()
     */
    public static function firstFreeSlot(
        array $availability,
        CarbonImmutable $from,
        CarbonImmutable $to,
        int $minutes,
    ): ?array {
        // Every busy block from everyone, merged into one timeline.
        $all = [];
        foreach ($availability as $person) {
            foreach ($person['blocks'] as $block) {
                $all[] = $block;
            }
        }

        $busy = self::merge($all);

        $cursor = $from;
        foreach ($busy as $block) {
            $start = CarbonImmutable::parse($block['startsAt']);

            if ($cursor->diffInMinutes($start) >= $minutes) {
                return ['startsAt' => $cursor->toIso8601String(),
                    'endsAt' => $cursor->addMinutes($minutes)->toIso8601String()];
            }

            $end = CarbonImmutable::parse($block['endsAt']);
            if ($end > $cursor) {
                $cursor = $end;
            }
        }

        if ($cursor->diffInMinutes($to) >= $minutes) {
            return ['startsAt' => $cursor->toIso8601String(),
                'endsAt' => $cursor->addMinutes($minutes)->toIso8601String()];
        }

        return null;
    }
}
