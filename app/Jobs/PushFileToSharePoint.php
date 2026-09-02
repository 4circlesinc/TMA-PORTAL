<?php

namespace App\Jobs;

use App\Models\FileItem;
use App\Support\SharePoint\Pusher;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Push one portal file to its linked SharePoint library.
 *
 * Queued, because uploading to Graph can take as long as the file is big and
 * the person who pressed Upload should not wait for it. Retries with backoff:
 * most push failures are transient.
 */
class PushFileToSharePoint implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public array $backoff = [30, 120, 300];

    public function __construct(public int $fileId, public string $action = 'content') {}

    public function handle(): void
    {
        $file = FileItem::withTrashed()->find($this->fileId);
        if (! $file) {
            return;
        }

        $result = match ($this->action) {
            'rename' => Pusher::pushRename($file),
            'move' => Pusher::pushMove($file),
            'delete' => Pusher::pushDelete($file),
            default => Pusher::pushFile($file),
        };

        // Graph asked us to slow down — reschedule rather than burn a retry.
        if (($result['status'] ?? null) === 'throttled') {
            self::dispatch($this->fileId, $this->action)
                ->delay(now()->addSeconds($result['retryAfter'] ?? 30));
        }

        /*
         * "Retries with backoff" in the docblock was aspirational: Pusher
         * catches its own exceptions (an OAuth callback or observer must not
         * die on a push), so a failure comes back as a STATUS and the
         * queue's tries never fire — one reset connection was permanent.
         * Re-dispatch with a delay instead, bounded by the mapping's own
         * failure_count; past three, RetrySharePointFailures owns it with
         * longer spacing and a final cap.
         */
        if (($result['status'] ?? null) === 'failed') {
            $failures = (int) \App\Models\SharePointItem::query()
                ->where('file_id', $this->fileId)->max('failure_count');
            if ($failures > 0 && $failures < 3) {
                self::dispatch($this->fileId, $this->action)
                    ->delay(now()->addSeconds(60 * $failures));
            }
        }
    }
}
