<?php

namespace App\Jobs;

use App\Models\ConnectedAccount;
use App\Support\Mail\MailAuthException;
use App\Support\Mail\MailSynchronizer;
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
class SyncMailbox implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 120;

    public function __construct(
        public ConnectedAccount $account,
    ) {}

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
    }

    /** Auth failures are terminal; everything else backs off and retries. */
    public function retryUntil(): \DateTimeInterface
    {
        return now()->addMinutes(10);
    }
}
