<?php

namespace App\Observers;

use App\Jobs\PushFileToSharePoint;
use App\Models\FileItem;
use App\Support\SharePoint\Pusher;

/**
 * Mirrors portal file changes out to SharePoint.
 *
 * An observer rather than calls sprinkled through the controllers: files are
 * created and changed from six different places (direct upload, chunked upload,
 * copy, restore, new version, signature output), and any one of them forgotten
 * would be a file that silently never reaches SharePoint.
 *
 * Every hook is a no-op while inbound sync is running, which is what stops a
 * change arriving from SharePoint being pushed straight back to it.
 */
class FileSharePointObserver
{
    public function created(FileItem $file): void
    {
        if (Pusher::isSuspended()) {
            return;
        }

        PushFileToSharePoint::dispatch($file->id, 'content')->afterCommit();
    }

    public function updated(FileItem $file): void
    {
        if (Pusher::isSuspended()) {
            return;
        }

        // Only the changes SharePoint cares about, each mapped to the cheapest
        // Graph call that expresses it — renaming a 2 GB file must not
        // re-upload it.
        if ($file->wasChanged('storage_path')) {
            PushFileToSharePoint::dispatch($file->id, 'content')->afterCommit();

            return;
        }

        if ($file->wasChanged('name')) {
            PushFileToSharePoint::dispatch($file->id, 'rename')->afterCommit();
        }

        if ($file->wasChanged('folder_id')) {
            PushFileToSharePoint::dispatch($file->id, 'move')->afterCommit();
        }

    }

    /**
     * Soft deletes do NOT come through updated().
     *
     * SoftDeletes::runSoftDelete() writes deleted_at with the query builder
     * rather than saving the model, so `updated` never fires and a delete
     * silently failed to reach SharePoint. `deleted` is the hook that works.
     */
    public function deleted(FileItem $file): void
    {
        if (Pusher::isSuspended()) {
            return;
        }

        PushFileToSharePoint::dispatch($file->id, 'delete')->afterCommit();
    }

    /** Restoring from the recycle bin puts it back in SharePoint too. */
    public function restored(FileItem $file): void
    {
        if (Pusher::isSuspended()) {
            return;
        }

        PushFileToSharePoint::dispatch($file->id, 'content')->afterCommit();
    }
}
