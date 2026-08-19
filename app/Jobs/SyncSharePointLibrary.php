<?php

namespace App\Jobs;

use App\Models\SharePointConnection;
use App\Support\Imports\ImportPause;
use App\Support\SharePoint\Synchroniser;
use Illuminate\Bus\Queueable;
use Illuminate\Support\Str;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Pull one linked library.
 *
 * Queued and non-overlapping: two runs against the same delta cursor would
 * process the same page twice. Failures are retried with backoff rather than
 * abandoned, because most sync failures are transient (throttling, a token
 * expiring mid-run, a blip).
 */
class SyncSharePointLibrary implements ShouldQueue, ShouldBeUnique
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public array $backoff = [30, 120, 300];

    /** Large libraries (150k+ items) need room for delta + reconciliation. */
    public int $timeout = 1800;

    /** Seconds before a chained follow-up run starts. */
    private const CHAIN_DELAY = 2;

    public function __construct(public int $connectionId) {}

    /** One run per connection at a time. */
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
     * lock here or the library reads as "syncing" until the 30-minute window
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
