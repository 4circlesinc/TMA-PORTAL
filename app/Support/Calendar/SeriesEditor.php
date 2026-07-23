<?php

namespace App\Support\Calendar;

use App\Models\CalendarEvent;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * The three ways to change a recurring event — this occurrence, this and
 * everything after it, or the whole series — expressed once so the controller
 * doesn't grow three near-identical branches.
 *
 * The awkward case is "this and following". Rather than track split points,
 * the master's rule is truncated with UNTIL at the split and a *new* master is
 * created from that instant. That is how ICS clients do it, so an exported or
 * synced series stays comprehensible to Google and Outlook.
 */
class SeriesEditor
{
    public const SCOPE_THIS = 'this';

    public const SCOPE_FOLLOWING = 'following';

    public const SCOPE_ALL = 'all';

    public const SCOPES = [self::SCOPE_THIS, self::SCOPE_FOLLOWING, self::SCOPE_ALL];

    /**
     * Turn one virtual occurrence into a real row that overrides it, so a
     * single instance can be edited without touching the rest of the series.
     *
     * Idempotent: if the occurrence was already detached, that row is returned.
     */
    public static function materialise(
        CalendarEvent $master,
        CarbonImmutable $occurrenceStart,
        User $actor,
    ): CalendarEvent {
        $existing = CalendarEvent::where('series_id', $master->id)
            ->where('recurrence_starts_at', $occurrenceStart)
            ->first();

        if ($existing) {
            return $existing;
        }

        $duration = $master->starts_at->diffInSeconds($master->ends_at);

        return CalendarEvent::create([
            'uuid' => (string) Str::uuid(),
            'calendar_id' => $master->calendar_id,
            'title' => $master->title,
            'description' => $master->description,
            'location' => $master->location,
            'starts_at' => $occurrenceStart,
            'ends_at' => $occurrenceStart->addSeconds($duration),
            'all_day' => $master->all_day,
            'timezone' => $master->timezone,
            'status' => $master->status,
            'visibility' => $master->visibility,
            'colour' => $master->colour,
            'organizer_id' => $master->organizer_id,
            'client_id' => $master->client_id,
            'meeting_url' => $master->meeting_url,
            // The link back to the series, and which instance this replaces.
            'series_id' => $master->id,
            'recurrence_starts_at' => $occurrenceStart,
            'created_by' => $master->created_by,
            'updated_by' => $actor->id,
        ]);
    }

    /**
     * Remove a single occurrence: recorded as an EXDATE on the master, and any
     * detached row for that instant deleted with it.
     */
    public static function excludeOccurrence(CalendarEvent $master, CarbonImmutable $occurrenceStart): void
    {
        $exdates = (array) ($master->recurrence_exdates ?? []);
        $stamp = $occurrenceStart->utc()->toIso8601String();

        if (! in_array($stamp, $exdates, true)) {
            $exdates[] = $stamp;
            $master->recurrence_exdates = array_values($exdates);
            $master->save();
        }

        CalendarEvent::where('series_id', $master->id)
            ->where('recurrence_starts_at', $occurrenceStart)
            ->delete();
    }

    /**
     * End the series immediately before `$splitAt`, so everything from that
     * instant onwards stops being generated.
     *
     * UNTIL is inclusive in RFC 5545, hence the one-second step back — without
     * it the occurrence at the split point survives on both sides of the
     * split, which shows up as a duplicate on the day of the change.
     */
    public static function truncateAt(CalendarEvent $master, CarbonImmutable $splitAt): void
    {
        $spec = RecurrenceRule::parse($master->recurrence_rule);

        // COUNT and UNTIL cannot coexist; the split replaces the count.
        $spec['count'] = null;
        $spec['until'] = $splitAt->utc()->subSecond()->toIso8601String();

        $master->recurrence_rule = RecurrenceRule::build($spec);
        $master->save();
    }

    /**
     * Split a series at `$splitAt`: the existing master stops there, and a new
     * master carries the same rule forward from that instant.
     *
     * Returns the new master, which is what "this and following" edits are
     * then applied to.
     */
    public static function split(CalendarEvent $master, CarbonImmutable $splitAt, User $actor): CalendarEvent
    {
        $rule = $master->recurrence_rule;
        $duration = $master->starts_at->diffInSeconds($master->ends_at);

        /*
         * A COUNT-limited series can't simply be copied forward — the tail
         * would restart the count from scratch and generate more occurrences
         * than the original ever had. Convert the remaining count instead.
         */
        $spec = RecurrenceRule::parse($rule);
        if (! empty($spec['count'])) {
            $before = count(RecurrenceExpander::expand(
                $master,
                $master->starts_at->toImmutable(),
                $splitAt,
            ));
            $spec['count'] = max(1, $spec['count'] - $before);
            $rule = RecurrenceRule::build($spec);
        }

        // Carry forward the exclusions that fall after the split.
        $exdates = array_values(array_filter(
            (array) ($master->recurrence_exdates ?? []),
            fn ($d) => CarbonImmutable::parse($d) >= $splitAt,
        ));

        $tail = CalendarEvent::create([
            'uuid' => (string) Str::uuid(),
            'calendar_id' => $master->calendar_id,
            'title' => $master->title,
            'description' => $master->description,
            'location' => $master->location,
            'starts_at' => $splitAt,
            'ends_at' => $splitAt->addSeconds($duration),
            'all_day' => $master->all_day,
            'timezone' => $master->timezone,
            'status' => $master->status,
            'visibility' => $master->visibility,
            'colour' => $master->colour,
            'organizer_id' => $master->organizer_id,
            'client_id' => $master->client_id,
            'meeting_url' => $master->meeting_url,
            'recurrence_rule' => $rule,
            'recurrence_exdates' => $exdates ?: null,
            'created_by' => $master->created_by,
            'updated_by' => $actor->id,
        ]);

        // Detached occurrences after the split belong to the new series.
        CalendarEvent::where('series_id', $master->id)
            ->where('recurrence_starts_at', '>=', $splitAt)
            ->update(['series_id' => $tail->id]);

        self::truncateAt($master, $splitAt);

        return $tail;
    }

    /**
     * Delete part or all of a series.
     *
     * Returns the number of stored rows removed; excluding a single occurrence
     * removes none, because a virtual occurrence has no row to delete.
     */
    public static function delete(CalendarEvent $master, string $scope, ?CarbonImmutable $occurrenceStart): int
    {
        if ($scope === self::SCOPE_THIS && $occurrenceStart) {
            self::excludeOccurrence($master, $occurrenceStart);

            return 0;
        }

        if ($scope === self::SCOPE_FOLLOWING && $occurrenceStart) {
            $removed = CalendarEvent::where('series_id', $master->id)
                ->where('recurrence_starts_at', '>=', $occurrenceStart)
                ->delete();

            /*
             * Truncating to before the very first occurrence would leave a
             * master that generates nothing — a ghost row. Delete it instead.
             */
            if ($occurrenceStart <= $master->starts_at) {
                $master->occurrences()->delete();
                $master->delete();

                return $removed + 1;
            }

            self::truncateAt($master, $occurrenceStart);

            return $removed;
        }

        $removed = $master->occurrences()->delete();
        $master->delete();

        return $removed + 1;
    }
}
