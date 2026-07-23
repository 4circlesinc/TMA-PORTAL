<?php

namespace App\Jobs;

use App\Models\Calendar;
use App\Support\Calendar\Sync\CalendarSyncException;
use App\Support\Calendar\Sync\CalendarSynchronizer;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Syncs one provider-backed calendar on the queue.
 *
 * Backgrounded so the Calendar page never blocks on a Google or Graph round
 * trip. A failure is recorded on the calendar row by the synchronizer and
 * surfaced against that one entry in the sidebar; it never takes down the
 * page or the other calendars, which is section 24 of the brief.
 */
class SyncProviderCalendar implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public int $timeout = 120;

    public function __construct(public int $calendarId) {}

    /**
     * Two syncs of the same calendar would race on the cursor, so overlapping
     * runs are dropped. Mirrors SyncMailbox.
     *
     * @return array<int, object>
     */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('calendar-sync:'.$this->calendarId))->dontRelease()->expireAfter(180)];
    }

    public function handle(): void
    {
        $calendar = Calendar::find($this->calendarId);

        if (! $calendar || ! $calendar->isProviderSynced()) {
            return;
        }

        try {
            (new CalendarSynchronizer($calendar))->run();
        } catch (CalendarSyncException) {
            // Already recorded on the calendar by the synchronizer. Swallowed
            // so a provider outage doesn't spill into failed_jobs on every
            // scheduler tick; the row's error state is the record.
        }
    }
}
