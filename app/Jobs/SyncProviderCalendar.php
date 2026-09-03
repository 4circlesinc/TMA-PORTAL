<?php

namespace App\Jobs;

use App\Models\Calendar;
use App\Support\Calendar\Sync\CalendarSyncException;
use App\Support\Calendar\Sync\CalendarSynchronizer;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
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
class SyncProviderCalendar implements ShouldQueue, ShouldBeUniqueUntilProcessing
{
    use Queueable;

    public int $tries = 2;

    public int $timeout = 120;

    /**
     * Identical syncs stop piling into the jobs table while one is queued:
     * the every-ten-minutes sweep, a manual "Sync now" and a connect all
     * dispatch the same calendar, and only one row needs to exist. Released
     * at processing, so a sync that is merely running never blocks the next
     * request from queueing behind it.
     */
    public int $uniqueFor = 600;

    public function __construct(public int $calendarId) {}

    public function uniqueId(): string
    {
        return (string) $this->calendarId;
    }

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
        } catch (\Throwable $e) {
            /*
             * Anything else - a TypeError, a lost database connection, an
             * auth layer throwing something unexpected - used to escape with
             * the row still stamped 'syncing', and the sweep then skipped
             * the calendar for ever. Record the failure on the row, then
             * rethrow so the queue retries and failed_jobs keeps the trace:
             * this is a bug worth seeing, unlike a provider outage.
             */
            $this->recordInterruption($calendar, $e);

            throw $e;
        }
    }

    /**
     * Last line of defence: retries exhausted, or the job was killed by its
     * timeout. Without this, a hard death left 'syncing' on the row for ever.
     */
    public function failed(?\Throwable $e): void
    {
        $calendar = Calendar::find($this->calendarId);

        if ($calendar && $calendar->subscription_status === 'syncing') {
            $this->recordInterruption($calendar, $e);
        }
    }

    private function recordInterruption(Calendar $calendar, ?\Throwable $e): void
    {
        $calendar->forceFill([
            'subscription_status' => 'error',
            'subscription_error' => mb_substr($e?->getMessage() ?: 'The sync was interrupted.', 0, 500),
            'subscription_failures' => (int) $calendar->subscription_failures + 1,
        ])->save();
    }
}
