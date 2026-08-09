<?php

namespace App\Observers;

use App\Models\FileComment;
use App\Models\FileItem;
use App\Models\FileWorkflow;
use App\Support\Files\ReviewAuto;
use App\Support\Files\ReviewStatus;
use App\Support\Files\Workflow\Status;
use Illuminate\Database\Eloquent\Model;

/**
 * Comments and approval requests move a document's review along.
 *
 * On the models rather than the controllers, for the reason every observer in
 * this app is: a comment is created from the viewer, from a mention reply and
 * from the API, and an approval changes state from a send, a response, a
 * cancellation and an expiry. A status that only kept up with some of those
 * would be worse than one that never moved, because it would look maintained.
 *
 * @see ReviewAuto for what it refuses to overwrite.
 */
class ReviewActivityObserver
{
    public function created(Model $model): void
    {
        if ($model instanceof FileComment) {
            ReviewAuto::commented(FileItem::find($model->file_id));

            return;
        }

        if ($model instanceof FileWorkflow) {
            $this->fromWorkflow($model);
        }
    }

    public function updated(Model $model): void
    {
        // Only when the outcome changed — a workflow row is touched for
        // reminders and due dates too, and neither says anything new about
        // where the document stands.
        if ($model instanceof FileWorkflow && $model->wasChanged('status')) {
            $this->fromWorkflow($model);
        }
    }

    /** Translate an approval workflow's state into the document's own. */
    private function fromWorkflow(FileWorkflow $workflow): void
    {
        $file = FileItem::find($workflow->file_id);

        if (! $file) {
            return;
        }

        $to = match ($workflow->status) {
            Status::APPROVED, Status::SIGNED, Status::ACKNOWLEDGED, Status::COMPLETED => ReviewStatus::APPROVED,
            Status::DECLINED => ReviewStatus::REJECTED,
            Status::CHANGES_REQUESTED => ReviewStatus::CHANGES_REQUESTED,
            // Cancelled or expired leaves the document where any request left
            // it rather than inventing an outcome nobody reached.
            Status::CANCELLED, Status::EXPIRED => null,
            // Everything else is a request in flight.
            default => ReviewStatus::AWAITING_APPROVAL,
        };

        if ($to !== null) {
            ReviewAuto::move($file, $to);
        }
    }
}
