<?php

namespace App\Observers;

use App\Jobs\PushFolderToSharePoint;
use App\Models\Folder;
use App\Support\SharePoint\Pusher;

/**
 * Mirrors new portal folders out to SharePoint the moment they exist.
 *
 * Folders used to materialise remotely only when their first file pushed,
 * which left every freshly provisioned client folder invisible to staff
 * working from SharePoint or OneDrive. The job is a cheap no-op for folders
 * outside any linked library, and creations arriving FROM inbound sync are
 * skipped the same way file echoes are.
 */
class FolderSharePointObserver
{
    public function created(Folder $folder): void
    {
        if (Pusher::isSuspended()) {
            return;
        }

        PushFolderToSharePoint::dispatch($folder->id)->afterCommit();
    }
}
