<?php

namespace App\Http\Controllers\Files;

use App\Support\Activity\ActivityLogger;
use App\Support\Files\FileAccess;
use App\Support\Files\Presenter;
use App\Support\Files\ReviewStatus;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Moving a client document through its review.
 *
 * Reviewing is a staff act on somebody else's document, so it takes the same
 * bar as uploading a version rather than merely being able to open the file —
 * a client with view access to their own folder must not be able to mark their
 * own passport approved.
 */
class FileReviewController extends BaseFilesController
{
    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);

        FileAccess::authorize($user, 'upload', $file);

        $data = $request->validate([
            'status' => ['required', Rule::in(ReviewStatus::ALL)],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        $from = $file->review_status;
        $to = $data['status'];

        abort_if(
            ! ReviewStatus::canMove($from, $to),
            422,
            'A document that is '.strtolower((string) ReviewStatus::label($from)).' cannot move straight to '.strtolower((string) ReviewStatus::label($to)).'.'
        );

        $note = trim((string) ($data['note'] ?? ''));

        // A rejection without a reason leaves whoever uploaded it with nothing
        // to act on, which is the one outcome that always needs an explanation.
        abort_if($to === ReviewStatus::REJECTED && $note === '', 422, 'Say why the document is being rejected.');

        $file->forceFill([
            'review_status' => $to,
            // Cleared rather than kept: a note explaining a rejection would
            // otherwise sit under the word "Approved" after a re-review.
            'review_note' => $note === '' ? null : $note,
            'reviewed_by' => $user->id,
            'reviewed_at' => now(),
        ])->save();

        ActivityLogger::log([
            'actor' => $user,
            'type' => 'file.review',
            'description' => $user->name.' marked '.$file->name.' '.strtolower((string) ReviewStatus::label($to)),
            'subject' => $file,
        ]);

        // The library, the client's Documents tab and any open viewer all show
        // this, and none of them know the others exist.
        Live::staff(Live::FILES);
        Live::user(Live::FILES, $file->owner_id);

        return response()->json([
            'status' => ReviewStatus::badge($to),
            'file' => (new Presenter($user))->file($file->fresh()),
        ]);
    }
}
