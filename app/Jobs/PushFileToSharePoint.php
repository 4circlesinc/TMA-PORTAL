<?php

namespace App\Jobs;

use App\Models\FileItem;
use App\Models\SharePointItem;
use App\Support\SharePoint\Pusher;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

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

    /**
     * A 2 GB upload goes up in 5 MB chunks and can outlast the worker's
     * 300-second default. Killed there, the push recorded nothing at all and
     * the file simply never appeared. The queue's retry_after (1830 s) is
     * already set above this.
     */
    public int $timeout = 1800;

    /** Re-dispatches this push gets when no mapping exists to count failures. */
    public const FIRST_PUSH_ATTEMPTS = 5;

    /** Minutes to wait before each of those re-dispatches. */
    private const FIRST_PUSH_DELAYS = [1, 5, 15, 60];

    /**
     * Which attempt at a first push this is. A plain property with a default,
     * not a promoted one, so jobs queued before it existed still unserialise.
     */
    public int $attempt = 1;

    public function __construct(public int $fileId, public string $action = 'content', int $attempt = 1)
    {
        $this->attempt = $attempt;
    }

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
            self::dispatch($this->fileId, $this->action, $this->attempt)
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
        if (in_array($result['status'] ?? null, ['failed', 'no-parent'], true)) {
            $failures = (int) SharePointItem::query()
                ->where('file_id', $this->fileId)->max('failure_count');
            if ($failures > 0 && $failures < 3) {
                self::dispatch($this->fileId, $this->action)
                    ->delay(now()->addSeconds(60 * $failures));

                return;
            }

            /*
             * A file's FIRST push has no mapping row, so markFailure() had
             * nothing to write and failure_count stayed 0: no retry here,
             * and RetrySharePointFailures (which only reads failed rows)
             * never saw it either. One Graph 504 on upload and the file was
             * in the portal and missing from SharePoint for good. The
             * attempt count rides on the job instead.
             */
            $mapped = SharePointItem::query()->where('file_id', $this->fileId)->exists();
            if (! $mapped && $this->attempt < self::FIRST_PUSH_ATTEMPTS) {
                $wait = self::FIRST_PUSH_DELAYS[$this->attempt - 1]
                    ?? self::FIRST_PUSH_DELAYS[array_key_last(self::FIRST_PUSH_DELAYS)];

                self::dispatch($this->fileId, $this->action, $this->attempt + 1)
                    ->delay(now()->addMinutes($wait));
            } elseif (! $mapped) {
                Log::error('SharePoint first push gave up', [
                    'file' => $this->fileId,
                    'attempts' => $this->attempt,
                    'reason' => $result['reason'] ?? $result['status'],
                ]);
            }
        }
    }
}
