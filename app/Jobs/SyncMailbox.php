<?php

namespace App\Jobs;

use App\Models\ConnectedAccount;
use App\Models\MailSyncProgress;
use App\Support\Mail\MailAuthException;
use App\Support\Mail\MailSyncError;
use App\Support\Mail\MailSynchronizer;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Pulls one mailbox up to date on the queue.
 *
 * Dispatched when the email page opens, when Graph pushes a change, and
 * after actions that change the server's view of the mailbox, so the UI
 * never blocks on a provider round trip it does not need.
 *
 * UntilProcessing, not plain ShouldBeUnique: a lock held for the job's
 * whole life dropped the next webhook/scheduler tick, so mail that arrived
 * during a pass sat until the three-minute overlap cooldown also expired.
 * Releasing at processing keeps queue-level dedupe; WithoutOverlapping
 * still stops two workers racing the cursor, and releaseAfter parks the
 * follow-up instead of throwing it away.
 */
class SyncMailbox implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    /**
     * Room to wait out an in-flight pass (releaseAfter × tries) rather than
     * fail a webhook that arrived while the previous sync was still walking.
     * maxExceptions keeps a real Graph failure from retrying 30 times.
     */
    public int $tries = 30;

    public int $maxExceptions = 3;

    public int $timeout = 120;

    /**
     * Queued-dedupe only — UntilProcessing releases this when the worker
     * starts. Comfortably longer than a typical wait for a worker, never 0.
     */
    public int $uniqueFor = 90;

    public function __construct(
        public ConnectedAccount $account,
    ) {}

    public function uniqueId(): string
    {
        return (string) $this->account->id;
    }

    /**
     * Two syncs of the same mailbox would race on the cursor, so a second
     * run waits rather than overlapping. The lock is released when the job
     * finishes (no dontRelease): a cooldown after a successful 10-second
     * pass was what made the mailbox look stuck for minutes at a time.
     *
     * @return array<int, object>
     */
    public function middleware(): array
    {
        // expireAfter is the dead-worker safety net, above $timeout so a
        // killed run cannot deadlock this mailbox. releaseAfter parks a
        // webhook that arrived mid-pass until this one is done.
        return [(new WithoutOverlapping('mailbox:'.$this->account->id))->releaseAfter(5)->expireAfter(150)];
    }

    public function handle(): void
    {
        new MailSynchronizer($this->account)->sync();
    }

    public function failed(\Throwable $e): void
    {
        // A revoked grant is not transient — stop retrying and leave the
        // reason where the settings panel can show it.
        if ($e instanceof MailAuthException) {
            $this->account->forceFill([
                'mail_status' => 'error',
                'mail_error' => $e->getMessage(),
            ])->save();
        }

        // If the first-run pipeline is what dispatched this, its progress
        // panel needs the reason too — not a spinner that never resolves.
        $tracker = MailSyncProgress::for($this->account);

        if ($tracker->isRunning()) {
            $failure = MailSyncError::describe($e);
            $tracker->fail($failure['code'], $failure['message']);
        }
    }

    /** Auth failures are terminal; everything else backs off and retries. */
    public function retryUntil(): \DateTimeInterface
    {
        return now()->addMinutes(10);
    }
}
