<?php

namespace App\Jobs;

use App\Models\Calendar;
use App\Models\Notification;
use App\Support\Calendar\Sync\CalendarSyncException;
use App\Support\Calendar\Sync\CalendarSynchronizer;
use App\Support\Microsoft\MailboxBusyException;
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
 *
 * Microsoft Graph allows only four concurrent requests per mailbox. Connecting
 * Birthdays + Calendar + Upcoming Events at once 429s all of them, so Outlook
 * calendars on the same account run one at a time and wait their turn.
 */
class SyncProviderCalendar implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public int $timeout = 180;

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
     * Two syncs of the same calendar would race on the cursor, so a second
     * run waits rather than overlapping. Microsoft calendars on one mailbox
     * also share a lock, because Graph 429s a stampede.
     *
     * releaseAfter, not dontRelease: a throttled run re-queues itself after
     * Retry-After, and dropping that follow-up left the calendar failed.
     *
     * @return array<int, object>
     */
    public function middleware(): array
    {
        $locks = [
            (new WithoutOverlapping('calendar-sync:'.$this->calendarId))->releaseAfter(10)->expireAfter(210),
        ];

        $calendar = Calendar::query()
            ->select(['id', 'source', 'connected_account_id'])
            ->find($this->calendarId);

        if ($calendar?->source === Calendar::SOURCE_MICROSOFT && $calendar->connected_account_id) {
            $locks[] = (new WithoutOverlapping('calendar-mailbox:'.$calendar->connected_account_id))
                ->releaseAfter(15)
                ->expireAfter(210);
        }

        return $locks;
    }

    public function handle(): void
    {
        $calendar = Calendar::find($this->calendarId);

        if (! $calendar || ! $calendar->isProviderSynced()) {
            return;
        }

        try {
            (new CalendarSynchronizer($calendar))->run();
        } catch (MailboxBusyException $e) {
            $this->rescheduleThrottle($calendar, $e->retryAfter);

            return;
        } catch (CalendarSyncException $e) {
            if ($e->throttled || CalendarSyncException::looksThrottled($e->getMessage())) {
                $this->rescheduleThrottle($calendar, max(30, $e->retryAfter));

                return;
            }
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

        if (! $calendar || $calendar->subscription_status !== 'syncing') {
            return;
        }

        if ($e instanceof MailboxBusyException
            || ($e instanceof CalendarSyncException && ($e->throttled || CalendarSyncException::looksThrottled($e->getMessage())))
            || ($e && CalendarSyncException::looksThrottled($e->getMessage()))) {
            $this->rescheduleThrottle($calendar, 30);

            return;
        }

        $this->recordInterruption($calendar, $e);
    }

    private function rescheduleThrottle(Calendar $calendar, int $retryAfter): void
    {
        $calendar->forceFill([
            'subscription_error' => null,
            'subscription_failures' => 0,
        ])->save();

        Notification::query()
            ->where('type', 'calendar.sync_error')
            ->where('dedupe_key', 'calendar.sync_error:'.$calendar->id)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        static::dispatch($this->calendarId)
            ->delay(now()->addSeconds(max(30, $retryAfter)));
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
