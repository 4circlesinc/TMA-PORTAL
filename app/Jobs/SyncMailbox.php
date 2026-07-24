<?php

namespace App\Jobs;

use App\Models\ConnectedAccount;
use App\Models\MailSyncProgress;
use App\Support\Mail\MailAuthException;
use App\Support\Mail\MailSyncError;
use App\Support\Mail\MailSynchronizer;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Pulls one mailbox up to date on the queue.
 *
 * Dispatched when the email page opens and after actions that change the
 * server's view of the mailbox, so the UI never blocks on a provider round
 * trip it does not need.
 */
class SyncMailbox implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 120;

    /**
     * The email page polls a full sync roughly every minute and the
     * mail:sync-all scheduler dispatches one too — without this, each of those
     * would enqueue a fresh copy that only gets dropped at run time. Uniqueness
     * collapses them to one queued job per mailbox. Kept comfortably longer
     * than a normal sync so a queued job is never deduped against a stale lock.
     */
    public int $uniqueFor = 180;

    public function __construct(
        public ConnectedAccount $account,
    ) {}

    public function uniqueId(): string
    {
        return (string) $this->account->id;
    }

    /**
     * Two syncs of the same mailbox would race on the cursor and duplicate
     * work, so overlapping runs are dropped rather than queued behind.
     *
     * @return array<int, object>
     */
    public function middleware(): array
    {
        // expireAfter releases the lock even if the worker is killed mid-sync
        // (e.g. hits --max-time), so a dead run can't deadlock this mailbox's
        // future syncs. Comfortably longer than $timeout.
        return [(new WithoutOverlapping('mailbox:'.$this->account->id))->dontRelease()->expireAfter(180)];
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
