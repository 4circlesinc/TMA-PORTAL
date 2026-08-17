<?php

namespace App\Observers;

use App\Models\FileItem;
use App\Support\Files\ClientDocuments;
use App\Support\Files\ReviewStatus;

/**
 * A client document starts its life waiting to be reviewed.
 *
 * On the model rather than in the upload controller because files are created
 * from seven different places — the chunked uploader, plain upload, copy, bulk
 * copy, the folder-tree importer, the SharePoint synchroniser and the
 * signature completer. The brief asks for this to hold "regardless of whether
 * the upload occurs from the Client Details page, the Documents tab, the File
 * Library, a client-specific folder, or another UI component", and the only
 * way to promise that is to hang it below all of them.
 *
 * `creating`, not `created`: setting it before the insert means the row is
 * never briefly on disk without a status, which a listing loaded mid-upload
 * would otherwise catch.
 */
class ClientDocumentObserver
{
    public function creating(FileItem $file): void
    {
        // Something explicit wins — a copy carries its source's status, and a
        // caller that has already decided is not second-guessed here.
        if ($file->review_status !== null) {
            return;
        }

        if (ClientDocuments::isClientFolder($file->folder_id)) {
            $file->review_status = ReviewStatus::APPLICATION_REVIEW;
        }
    }

    /**
     * Moving a file into or out of a client folder changes what it is.
     *
     * A document dragged into a client's folder has just become a client
     * document and has not been reviewed there; one dragged out is no longer
     * part of that client's queue and should stop being counted in it.
     */
    public function updating(FileItem $file): void
    {
        if (! $file->isDirty('folder_id')) {
            return;
        }

        $nowClient = ClientDocuments::isClientFolder($file->folder_id);

        if ($nowClient && $file->review_status === null) {
            $file->review_status = ReviewStatus::APPLICATION_REVIEW;

            return;
        }

        // Leaving: clear the review rather than leave "Application review"
        // hanging on a file that is no longer in anybody's queue.
        if (! $nowClient && ! $file->isDirty('review_status')) {
            $file->review_status = null;
            $file->review_note = null;
            $file->reviewed_by = null;
            $file->reviewed_at = null;
        }
    }
}
