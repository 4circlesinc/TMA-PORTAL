<?php

namespace App\Jobs;

use App\Models\SharePointConnection;
use App\Support\Imports\ImportPause;
use App\Support\SharePoint\Synchroniser;
use Illuminate\Bus\Queueable;
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
class SyncSharePointLibrary implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public array $backoff = [30, 120, 300];

    public function __construct(public int $connectionId) {}

    /** One run per connection at a time. */
    public function uniqueId(): string
    {
        return 'sharepoint-sync-'.$this->connectionId;
    }

    public function handle(): void
    {
        if (ImportPause::active()) {
            return;
        }

        $connection = SharePointConnection::find($this->connectionId);

        if (! $connection || ! $connection->sync_enabled) {
            return;
        }

        $result = Synchroniser::sync($connection);

        // Graph asked us to back off: reschedule rather than burning a retry.
        if (! empty($result['throttled'])) {
            self::dispatch($this->connectionId)->delay(now()->addSeconds($result['retryAfter'] ?? 30));
        }
    }
}
