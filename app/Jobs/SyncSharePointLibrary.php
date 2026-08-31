<?php

namespace App\Jobs;

use App\Models\SharePointConnection;
use App\Support\Imports\ImportPause;
use App\Support\SharePoint\Synchroniser;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Str;

/**
 * Pull one linked library.
 *
 * UntilProcessing, not plain ShouldBeUnique: an incomplete or throttled run
 * re-dispatches itself from handle(), and a lock held for the job's whole
 * life swallowed that follow-up. The next chunk then waited on the scheduler
 * (or, with uniqueFor defaulting to never-expire, never ran at all). The
 * connection's status column is still the run lock, so two workers cannot
 * walk the same delta cursor.
 */
class SyncSharePointLibrary implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public array $backoff = [30, 120, 300];

    /** Large libraries (150k+ items) need room for delta + reconciliation. */
    public int $timeout = 1800;

    /**
     * Seconds the queued-dedupe lock may live. UntilProcessing releases it
     * when the worker starts; this is only the safety net if a job sits
     * unclaimed. Must never be 0 — a uniqueFor of 0 never expires, and a
     * killed worker then blocks this library until the cache is flushed.
     */
    public int $uniqueFor = 120;

    /** Seconds before a chained follow-up run starts. */
    private const CHAIN_DELAY = 1;

    public function __construct(public int $connectionId) {}

    /** One queued job per connection. */
    public function uniqueId(): string
    {
        return 'sharepoint-sync-'.$this->connectionId;
    }

    public function handle(): void
    {
        $connection = SharePointConnection::find($this->connectionId);

        if (! $connection || ! $connection->sync_enabled) {
            return;
        }

        if (ImportPause::connection($connection)) {
            return;
        }

        $result = Synchroniser::sync($connection);

        // Graph asked us to back off: reschedule rather than burning a retry.
        if (! empty($result['throttled'])) {
            self::dispatch($this->connectionId)->delay(now()->addSeconds($result['retryAfter'] ?? 30));

            return;
        }

        /*
         * The page cap stops one job from walking forever, but an initial
         * OneDrive import can be tens of thousands of items — waiting for the
         * five-minute scheduler between each chunk made first connect feel
         * stuck for hours. Chain immediately until the delta cursor is held.
         */
        if (isset($result['complete']) && $result['complete'] === false) {
            self::dispatch($this->connectionId)->delay(now()->addSeconds(self::CHAIN_DELAY));
        }
    }

    /**
     * Worker timeout / SIGKILL never reaches Synchroniser's catch — release the
     * lock here or the library reads as "syncing" until the heartbeat window
     * expires and the next run takes over.
     */
    public function failed(\Throwable $e): void
    {
        $connection = SharePointConnection::find($this->connectionId);

        if (! $connection || $connection->status !== SharePointConnection::STATUS_SYNCING) {
            return;
        }

        $connection->update([
            'status' => SharePointConnection::STATUS_IDLE,
            'last_error' => Str::limit($e->getMessage(), 500),
            'error_count' => $connection->error_count + 1,
        ]);

        Synchroniser::log($connection, 'sync-failed', 'error', null, $e->getMessage());
    }
}
