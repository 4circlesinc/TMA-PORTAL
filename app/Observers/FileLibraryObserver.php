<?php

namespace App\Observers;

use App\Models\FileItem;
use App\Models\Folder;
use App\Support\Files\FileAccess;
use App\Support\Realtime\Live;
use Illuminate\Database\Eloquent\Model;

/**
 * Turns any change to a file or folder into a "refetch the library" signal.
 *
 * Hung off the models rather than the controllers on purpose. The library is
 * written from a lot of directions — upload, rename, move, copy, share, bulk
 * actions, the recycle bin, version restore, and the SharePoint synchroniser —
 * and wiring each one by hand guarantees the surface that gets missed is the
 * one nobody notices is stale. One observer covers every path, including the
 * ones added later.
 *
 * Cost is bounded by {@see Live}, which collects and sends once per request,
 * so a sync that lands ten thousand rows still emits a single event.
 *
 * Reach is staff plus the record's owner. Working out which *clients* can see
 * a given file means a shares lookup per row, which is exactly the per-row
 * cost the coalescing exists to avoid — so the write paths that change who can
 * see something (sharing, assignment) name those people explicitly instead.
 */
class FileLibraryObserver
{
    public function created(Model $model): void
    {
        $this->signal($model);
    }

    public function updated(Model $model): void
    {
        $this->signal($model);
    }

    public function deleted(Model $model): void
    {
        $this->signal($model);
    }

    public function restored(Model $model): void
    {
        $this->signal($model);
    }

    private function signal(Model $model): void
    {
        // A folder that just moved or vanished must not be evaluated from a
        // row fetched before it did. Runs in tests too, where a fixture built
        // mid-process would otherwise inherit the previous test's tree.
        if ($model instanceof Folder) {
            FileAccess::forgetFolders();
        }

        // Only tests are excluded. Deliberately *not* runningInConsole(): a
        // queue worker reports as console, and the SharePoint synchroniser and
        // mail import run there — those are precisely the changes a browser
        // cannot otherwise know about. Seeders and migrations do run through
        // here, but coalescing reduces a whole seed to one event.
        if (app()->runningUnitTests()) {
            return;
        }

        Live::staff(Live::FILES);

        if ($model instanceof FileItem || $model instanceof Folder) {
            Live::user(Live::FILES, $model->owner_id);
        }
    }
}
