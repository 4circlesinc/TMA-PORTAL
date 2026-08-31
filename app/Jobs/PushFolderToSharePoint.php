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

        Pusher::pushFolder($folder);
    }
}
