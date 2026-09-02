<?php

namespace App\Jobs;

use App\Models\FileItem;
use App\Models\SharePointItem;
use App\Support\Imports\ImportPause;
use App\Support\SharePoint\Synchroniser;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * The sweep that makes item failures transient.
 *
 * A reset connection or a Graph 504 marks one item FAILED, and nothing in the
 * normal flow ever returns to it: delta only re-emits changed items, and a
 * failed push has no second trigger. Left alone, one network blip showed
 * "could not sync" until an administrator noticed. This walks the failed
 * rows on a timer and retries each with growing spacing — a push failure is
 * re-pushed through the same queued job uploads use; a pull failure is
 * re-fetched and re-applied. failure_count both spaces the retries and caps
 * them: what still fails after MAX_ATTEMPTS is a real problem, and the strip
 * showing it is then the truth.
 */
class RetrySharePointFailures implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 300;

    public int $uniqueFor = 300;

    /** Retries stop here; the failure is persistent and worth a human. */
    public const MAX_ATTEMPTS = 6;

    /** Minutes between attempts, multiplied by how often it has failed. */
    private const BACKOFF_MINUTES = 10;

    /** Per pass, so one sweep stays comfortably inside its timeout. */
    private const BATCH = 25;

    public function handle(): void
    {
        $candidates = SharePointItem::query()
            ->where('sync_status', SharePointItem::FAILED)
            ->where('failure_count', '<', self::MAX_ATTEMPTS)
            ->with('connection')
            ->orderBy('updated_at')
            ->limit(self::BATCH)
            ->get();

        foreach ($candidates as $mapping) {
            $connection = $mapping->connection;

            if (! $connection || ! $connection->sync_enabled || ImportPause::connection($connection)) {
                continue;
            }

            // Growing spacing: the first retry waits ten minutes, the second
            // twenty since the second failure, and so on — quick enough to
            // heal a blip, spaced enough not to hammer a struggling tenant.
            $wait = self::BACKOFF_MINUTES * max(1, (int) $mapping->failure_count);
            if ($mapping->updated_at && $mapping->updated_at->gt(now()->subMinutes($wait))) {
                continue;
            }

            if ($this->retryPush($mapping)) {
                continue;
            }

            rescue(fn () => Synchroniser::retryItem($connection, $mapping), report: false);
        }
    }

    /**
     * A failed PUSH (portal file → SharePoint) is retried by re-running the
     * same queued push every upload uses. True when that path applies.
     */
    private function retryPush(SharePointItem $mapping): bool
    {
        if (! $mapping->file_id || ! $mapping->connection->pushesBack()) {
            return false;
        }

        $file = FileItem::find($mapping->file_id);
        if (! $file) {
            return false;
        }

        /*
         * The push outcome lands on the mapping (Pusher::markFailure /
         * recordMapping), so a failed retry raises failure_count and a
         * successful one settles the row to SYNCED — the same bookkeeping
         * this sweep reads next pass. Stamp the attempt so the backoff
         * window is measured from now, not from the original failure.
         */
        $mapping->touch();
        PushFileToSharePoint::dispatch($file->id);

        return true;
    }
}
