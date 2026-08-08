<?php

namespace App\Observers;

use App\Events\FileDetailChanged;
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
            $model instanceof FileVersion => FileDetailChanged::VERSIONS,
            $model instanceof FileActivity => FileDetailChanged::ACTIVITY,
            default => FileDetailChanged::APPROVALS,
        };
    }

    /** Resolve the file a record belongs to, however indirectly. */
    private function fileUuid(Model $model): ?string
    {
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
