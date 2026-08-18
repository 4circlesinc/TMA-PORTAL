<?php

namespace App\Observers;

use App\Models\FileItem;
use App\Models\User;
use App\Support\Cip\DocumentSlots;
use App\Support\Realtime\Live;

/**
 * Links a library upload to the CIP checklist when it lands in a person's
 * folder with the name {@see DocumentSlots::documentName()} would have used.
 *
 * Without this, the Documents tab and the File Library show Application
 * review on a loose file while the checklist row still reads Pending upload —
 * two answers for one requirement.
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
}
