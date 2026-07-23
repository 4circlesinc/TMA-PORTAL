<?php

namespace App\Support\Calendar;

use App\Models\CalendarEvent;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Sabre\VObject\Recur\RRuleIterator;

/**
 * Turns a recurring event into the concrete occurrences that fall inside a
 * date window.
 *
 * How a series is stored
 * ---------------------
 * - The **master** carries `recurrence_rule` and has `series_id = null`.
 * - A **detached occurrence** — one instance that was moved or edited on its
 *   own — is a real row with `series_id` pointing at the master and
 *   `recurrence_starts_at` recording which instance it replaces.
 * - `recurrence_exdates` lists instances deleted from the series.
 *
 * Expansion therefore yields, for a window: every rule-generated instant that
 * is neither excluded nor already replaced, as a *virtual* occurrence; the
 * detached rows are returned by the ordinary query alongside them.
 *
 * Virtual occurrences are not rows. They carry a composite id
 * (`<master-uuid>@<occurrence-start>`) so the client can address one, and
 * materialise into a real row only when someone edits that single instance.
 */
class RecurrenceExpander
{
    /** Hard ceiling per series per window, so a runaway rule can't hang a request. */
    private const MAX_OCCURRENCES = 750;

    public const ID_SEPARATOR = '@';

    /**
     * Expand every recurring master in `$masters` across the window.
     *
     * @param  Collection<int, CalendarEvent>  $masters
     * @param  Collection<int, CalendarEvent>  $detached  rows with series_id set
     * @return array<int, array<string, mixed>> virtual occurrence descriptors
     */
    public static function expandAll(
        Collection $masters,
        Collection $detached,
        CarbonImmutable $from,
        CarbonImmutable $to,
    ): array {
        // Which instants already have a row of their own, per master.
        $replaced = [];
        foreach ($detached as $row) {
            if ($row->series_id && $row->recurrence_starts_at) {
                $replaced[$row->series_id][$row->recurrence_starts_at->utc()->format('Y-m-d\TH:i:s')] = true;
            }
        }

        $out = [];

        foreach ($masters as $master) {
            if (! $master->recurrence_rule) {
                continue;
            }

            foreach (self::expand($master, $from, $to, $replaced[$master->id] ?? []) as $occurrence) {
                $out[] = $occurrence;
            }
        }

        return $out;
    }

    /**
     * One master's occurrences inside the window.
     *
     * @param  array<string, bool>  $replaced  keyed by UTC instant
     * @return array<int, array<string, mixed>>
     */
    public static function expand(
        CalendarEvent $master,
        CarbonImmutable $from,
        CarbonImmutable $to,
        array $replaced = [],
    ): array {
        if (! $master->recurrence_rule) {
            return [];
        }

        $tz = $master->timezone ?: 'UTC';

        /*
         * The rule is evaluated in the event's own zone, not UTC. "Every
         * Monday at 09:00" must stay 09:00 local across a DST change, which it
         * only does if the iterator walks in that zone.
         */
        $start = $master->starts_at->setTimezone($tz);
        $duration = $master->starts_at->diffInSeconds($master->ends_at);

        $excluded = [];
        foreach ((array) ($master->recurrence_exdates ?? []) as $exdate) {
            try {
                $excluded[CarbonImmutable::parse($exdate)->utc()->format('Y-m-d\TH:i:s')] = true;
            } catch (\Throwable) {
                // A malformed exdate must not take the whole series down.
                continue;
            }
        }

        try {
            $iterator = new RRuleIterator($master->recurrence_rule, $start->toDateTime());
        } catch (\Throwable) {
            // An unparseable rule yields nothing rather than throwing: one bad
            // event should never blank a whole month's grid.
            return [];
        }

        $out = [];
        $seen = 0;

        while ($iterator->valid()) {
            if (++$seen > self::MAX_OCCURRENCES) {
                break;
            }

            $current = CarbonImmutable::instance($iterator->current())->setTimezone($tz);

            // Past the window: nothing later can qualify either.
            if ($current >= $to) {
                break;
            }

            $occurrenceEnd = $current->addSeconds($duration);

            // Overlap, matching how single events are queried.
            if ($occurrenceEnd > $from) {
                $key = $current->utc()->format('Y-m-d\TH:i:s');

                if (! isset($excluded[$key]) && ! isset($replaced[$key])) {
                    $out[] = [
                        'master' => $master,
                        'startsAt' => $current,
                        'endsAt' => $occurrenceEnd,
                        'occurrenceId' => self::occurrenceId($master->uuid, $current),
                    ];
                }
            }

            $iterator->next();
        }

        return $out;
    }

    /** Composite id for a virtual occurrence. */
    public static function occurrenceId(string $masterUuid, CarbonImmutable $start): string
    {
        return $masterUuid.self::ID_SEPARATOR.$start->utc()->format('Y-m-d\TH:i:s\Z');
    }

    /**
     * Split a composite id back into the master uuid and the instant, or null
     * if it isn't one.
     *
     * @return array{0: string, 1: CarbonImmutable}|null
     */
    public static function parseOccurrenceId(string $id): ?array
    {
        if (! str_contains($id, self::ID_SEPARATOR)) {
            return null;
        }

        [$uuid, $stamp] = explode(self::ID_SEPARATOR, $id, 2);

        try {
            return [$uuid, CarbonImmutable::parse($stamp)->utc()];
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Render a virtual occurrence in the same shape as a stored event, so the
     * views never need to know which kind they are drawing.
     *
     * @param  array<string, mixed>  $occurrence
     * @return array<string, mixed>
     */
    public static function toRecord(
        array $occurrence,
        string $role,
        ?int $viewerId,
        ?string $calendarColour,
    ): array {
        /** @var CalendarEvent $master */
        $master = $occurrence['master'];

        $record = $master->toRecord($role, $viewerId, $calendarColour);

        return array_merge($record, [
            'id' => $occurrence['occurrenceId'],
            'startsAt' => $occurrence['startsAt']->toIso8601String(),
            'endsAt' => $occurrence['endsAt']->toIso8601String(),
            'recurring' => true,
            'isOccurrence' => true,
            'seriesId' => $master->uuid,
            // An occurrence is never independently "completed"; that lives on
            // the master or on a detached row.
            'completed' => false,
        ]);
    }
}
