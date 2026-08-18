<?php

namespace App\Observers;

use App\Models\FileItem;
use App\Models\User;
use App\Support\Cip\DocumentEngine;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Realtime\Live;

/**
 * Keeps CIP checklist slots in sync with the file library.
 *
 * - On upload: links a new file to a matching empty slot (adoptOrphan).
 * - On delete: if the file was the slot's answer, the slot is reset to
 *   Pending upload so it can be answered again.
 */
class CipFileObserver
{
    public function created(FileItem $file): void
    {
        if (app()->runningUnitTests()) {
            return;
        }

        $actor = $file->uploaded_by ? User::find($file->uploaded_by) : null;

        if (DocumentSlots::adoptOrphan($file, $actor)) {
            Live::staff(Live::CIP);
        }
    }

    /**
     * Soft-delete (recycle bin) and force-delete both land here.
     *
     * When the deleted file was a checklist slot's answer, the slot is reset
     * to Pending upload. A document accepted by a reviewer (READY_FOR_SUBMISSION)
     * is left in its accepted state — the history should reflect what the
     * reviewer decided, not just that someone later removed the file.
     */
    public function deleted(FileItem $file): void
    {
        if (app()->runningUnitTests()) {
            return;
        }

        $slot = $file->cipDocument()->first();

        if ($slot === null) {
            return;
        }

        if (($slot->status ?? DocumentStatus::PENDING_UPLOAD) === DocumentStatus::READY_FOR_SUBMISSION) {
            return;
        }

        $actor = $file->uploaded_by ? User::find($file->uploaded_by) : null;

        DocumentEngine::resetAfterFileDeletion($slot, $actor);
    }
}
