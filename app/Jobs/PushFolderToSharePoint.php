<?php

namespace App\Jobs;

use App\Models\Folder;
use App\Support\SharePoint\Pusher;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Create one portal folder in its linked SharePoint library.
 *
 * Queued for the same reason pushes of files are, and unique per folder so a
 * burst of provisioning cannot ask Graph for the same folder twice at once.
 */
class PushFolderToSharePoint implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public array $backoff = [30, 120, 300];

    /**
     * The unique lock must expire. Without this it lives until the job
     * finishes, and a worker killed mid-push left it held for good: every
     * later rename or move of that folder was silently dropped as a
     * duplicate. The sync's divergence pass repairs anything missed.
     */
    public int $uniqueFor = 600;

    public function __construct(public int $folderId) {}

    public function uniqueId(): string
    {
        return (string) $this->folderId;
    }

    public function handle(): void
    {
        $folder = Folder::find($this->folderId);
        if (! $folder) {
            return;
        }

        $result = Pusher::pushFolder($folder);

        // Graph asked us to wait: come back then, rather than dropping the
        // rename or move on the floor.
        if (($result['status'] ?? null) === 'throttled') {
            $this->release((int) ($result['retryAfter'] ?? 30));
        }
    }
}
