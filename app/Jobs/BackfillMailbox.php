<?php

namespace App\Jobs;

use App\Models\ConnectedAccount;
use App\Models\MailSyncProgress;
use App\Support\Mail\MailAuthException;
use App\Support\Mail\MailSyncError;
use App\Support\Mail\MailSynchronizer;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Pulls a mailbox's older history in slices.
 *
 * The seed only takes the newest messages per folder so the page is usable at
 * once; this walks back through the rest. Each run does a bounded number of
 * pages and then re-dispatches itself, so a 30,000-message mailbox drains
 * steadily without a single job running for hours or holding a worker.
 */
class BackfillMailbox implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 600;

    /** Pages per run — roughly PAGES × 100 messages before handing the worker back. */
    private const PAGES_PER_RUN = 10;

    public function __construct(
        public ConnectedAccount $account,
    ) {}

    /** @return array<int, object> */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('mailbox-backfill:'.$this->account->id))->dontRelease()];
    }

    public function handle(): void
    {
        $result = new MailSynchronizer($this->account)->backfillStep(self::PAGES_PER_RUN);

        if (! $result['done']) {
            // Fresh job rather than a loop: keeps memory flat and lets other
            // queued work (sends, syncs) interleave.
            self::dispatch($this->account->fresh());

            return;
        }

        // Every folder drained: walk the closing stages and seal the record
        // with the real counts. Conversations are grouped by the thread ids
        // the import stored, so "building conversations" is a recount, not a
        // second pass over the mailbox.
        $tracker = MailSyncProgress::for($this->account);

        $tracker->enterStage('threads');
        $stats = MailSyncProgress::statsFor($this->account);

        $tracker->enterStage('finalizing', $stats);

        $tracker->finish(array_merge($stats, [
            'totals_estimated' => false,
            'total_messages' => $stats['processed_messages'],
            'total_attachments' => $stats['processed_attachments'],
            'current_folder' => null,
            'next_link' => null,
        ]));
    }

    public function failed(\Throwable $e): void
    {
        // The page tokens are already persisted per folder, so the retry (or
        // the stall watchdog's re-dispatch) resumes from the failed batch —
        // never from message zero.
        $tracker = MailSyncProgress::for($this->account);

        if ($tracker->isRunning()) {
            $failure = MailSyncError::describe($e);
            $tracker->fail($failure['code'], $failure['message']);
        }

        if ($e instanceof MailAuthException) {
            $this->account->forceFill([
                'mail_status' => 'error',
                'mail_error' => $e->getMessage(),
            ])->save();
        }
    }
}
