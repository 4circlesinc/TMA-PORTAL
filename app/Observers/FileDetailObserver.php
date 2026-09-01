<?php

namespace App\Observers;

use App\Events\FileDetailChanged;
use App\Models\CipDocument;
use App\Models\FileActivity;
use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\FileWorkflow;
use App\Models\FileWorkflowEvent;
use App\Models\FileWorkflowStep;
use Illuminate\Database\Eloquent\Model;
use Throwable;

/**
 * Version, approval and activity changes, pushed to whoever has that file open.
 *
 * These ride the per-file channel rather than {@see \App\Support\Realtime\Live}
 * because they are about one document, not a list — the reach is "whoever has
 * this file open", which the existing `file.{uuid}` channel already authorises
 * against FileAccess.
 *
 * Sent immediately rather than collected per request: unlike the list
 * surfaces, these fire once or twice per action (a version upload, an approval
 * step) rather than once per row, so there is no burst to coalesce.
 */
class FileDetailObserver
{
    public function created(Model $model): void
    {
        // A file's own creation has no viewer open on it yet — and the
        // synchroniser creates them by the thousand.
        if ($model instanceof FileItem) {
            return;
        }

        $this->signal($model);
    }

    public function updated(Model $model): void
    {
        /*
         * The file row itself only signals for a review change. Every other
         * column the library writes (names, sizes, moves, sync bookkeeping)
         * already reaches open viewers through the listing refresh, and a
         * SharePoint pass re-saves rows far too often to broadcast each one.
         * `reviewed_at` is in the set because judging a CIP slot stamps the
         * file without necessarily moving its own review_status column.
         */
        if ($model instanceof FileItem && ! $model->wasChanged(['review_status', 'review_note', 'reviewed_at'])) {
            return;
        }

        /*
         * A CIP slot's status IS the file's review pill when the file answers
         * a checklist slot — and judging from the application page moves only
         * the slot, never a file column. Same channel, same 'details' section.
         */
        if ($model instanceof CipDocument && ! $model->wasChanged(['status', 'file_id'])) {
            return;
        }

        $this->signal($model);
    }

    public function deleted(Model $model): void
    {
        if ($model instanceof FileItem) {
            return;
        }

        $this->signal($model);
    }

    private function signal(Model $model): void
    {
        if (app()->runningUnitTests()) {
            return;
        }

        $uuid = $this->fileUuid($model);

        if ($uuid === null) {
            return;
        }

        try {
            broadcast(new FileDetailChanged($uuid, $this->section($model)))->toOthers();
        } catch (Throwable) {
            // A portal that can't reach Reverb still has to accept writes.
        }
    }

    private function section(Model $model): string
    {
        return match (true) {
            $model instanceof FileItem,
            $model instanceof CipDocument => FileDetailChanged::DETAILS,
            $model instanceof FileVersion => FileDetailChanged::VERSIONS,
            $model instanceof FileActivity => FileDetailChanged::ACTIVITY,
            default => FileDetailChanged::APPROVALS,
        };
    }

    /** Resolve the file a record belongs to, however indirectly. */
    private function fileUuid(Model $model): ?string
    {
        if ($model instanceof FileItem) {
            return $model->uuid;
        }

        if ($model instanceof CipDocument) {
            // An emptied slot leaves nothing to repaint; a filled one names
            // its file. withTrashed because the slot may point at a binned row.
            return $model->file_id === null
                ? null
                : FileItem::withTrashed()->whereKey($model->file_id)->value('uuid');
        }

        if ($model instanceof FileActivity) {
            // Activity is polymorphic over files and folders; only the file
            // rows have a viewer panel to update.
            return $model->item_type === 'file'
                ? FileItem::withTrashed()->whereKey($model->item_id)->value('uuid')
                : null;
        }

        if ($model instanceof FileWorkflowStep || $model instanceof FileWorkflowEvent) {
            // Steps and events hang off the workflow, which hangs off the file.
            $fileId = FileWorkflow::whereKey($model->workflow_id)->value('file_id');

            return $fileId === null
                ? null
                : FileItem::withTrashed()->whereKey($fileId)->value('uuid');
        }

        if ($model instanceof FileVersion || $model instanceof FileWorkflow) {
            return FileItem::withTrashed()->whereKey($model->file_id)->value('uuid');
        }

        return null;
    }
}
