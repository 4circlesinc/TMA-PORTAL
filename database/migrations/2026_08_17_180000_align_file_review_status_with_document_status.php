<?php

use App\Support\Files\ReviewStatus;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Client documents now share §12's status vocabulary.
 *
 * The File Library, the Documents tab and the CIP checklist were drawing
 * different words for the same fact — "Pending review" next to "Application
 * review" on one passport. The stored values move with the labels so a
 * listing that has not yet been re-presented still reads the new chip.
 */
return new class extends Migration
{
    public function up(): void
    {
        $map = [
            'pending_review' => ReviewStatus::APPLICATION_REVIEW,
            'under_review' => ReviewStatus::APPLICATION_REVIEW,
            'awaiting_approval' => ReviewStatus::APPLICATION_REVIEW,
            'changes_requested' => ReviewStatus::UPDATE_REQUIRED,
            'rejected' => ReviewStatus::UPDATE_REQUIRED,
            'approved' => ReviewStatus::READY_FOR_SUBMISSION,
        ];

        foreach ($map as $from => $to) {
            DB::table('files')->where('review_status', $from)->update(['review_status' => $to]);
        }
    }

    public function down(): void
    {
        $map = [
            ReviewStatus::APPLICATION_REVIEW => 'pending_review',
            ReviewStatus::UPDATE_REQUIRED => 'changes_requested',
            ReviewStatus::READY_FOR_SUBMISSION => 'approved',
        ];

        foreach ($map as $from => $to) {
            DB::table('files')->where('review_status', $from)->update(['review_status' => $to]);
        }
    }
};
