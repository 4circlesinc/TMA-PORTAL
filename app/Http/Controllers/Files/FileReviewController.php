<?php

namespace App\Http\Controllers\Files;

use App\Models\CipDocument;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\DocumentComments;
use App\Support\Cip\DocumentEngine;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\Review as CipReview;
use App\Support\Cip\Status;
use App\Support\Files\Comments;
use App\Support\Files\FileAccess;
use App\Support\Files\Presenter;
use App\Support\Files\ReviewStatus;
use App\Support\Realtime\Live;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Moving a client document through its review.
 *
 * Reviewing is a staff act on somebody else's document. Opening the file is
 * enough to set its working label; rewriting the bytes is not. A client with
 * view access to their own folder must not be able to mark their own passport
 * approved.
 *
 * CIP slots travel {@see DocumentEngine} rather than this
 * column: the checklist and the File Library are two doors onto the same
 * document, and writing files.review_status here while leaving cip_documents
 * behind would show two statuses for one file.
 */
class FileReviewController extends BaseFilesController
{
    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);
        $slot = CipDocument::query()->where('file_id', $file->id)->first();

        $this->authorizeReview($user, $file, $slot);

        $data = $request->validate([
            'status' => ['required', Rule::in(ReviewStatus::ALL)],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        $to = ReviewStatus::normalize($data['status']) ?? $data['status'];
        $note = trim((string) ($data['note'] ?? ''));

        $this->applyTo($user, $file, $to, $note, $slot);

        $presented = (new Presenter($user))->file($file->fresh());
        $payload = [
            'status' => $presented['status'] ?? ReviewStatus::badge($to),
            'file' => $presented,
        ];

        if ($slot) {
            $slot->refresh()->loadMissing(['application.client']);
            $application = $slot->application;
            if ($application) {
                $payload['application'] = [
                    'id' => $application->uuid,
                    'clientUid' => $application->client?->uid,
                    'status' => $application->status,
                    'statusLabel' => Status::label($application->status),
                    'statusTone' => Status::tone($application->status),
                ];
            }
            if ($to === DocumentStatus::UPDATE_REQUIRED && $note !== '') {
                $payload['updateReason'] = $note;
            }
        }

        return response()->json($payload);
    }

    /**
     * Judge one file, the same path the single-file endpoint and bulk review use.
     */
    public function applyTo(User $user, FileItem $file, string $to, string $note, ?CipDocument $slot = null): void
    {
        $slot ??= CipDocument::query()->where('file_id', $file->id)->first();
        $this->authorizeReview($user, $file, $slot);

        abort_if($to === ReviewStatus::UPDATE_REQUIRED && $note === '', 422, 'Say what needs changing.');

        if ($slot) {
            $this->judgeCip($slot, $user, $to, $note);
            Live::staff(Live::CIP);
        } else {
            $this->judgeFile($file, $user, $to, $note);
        }

        Live::staff(Live::FILES);
        Live::user(Live::FILES, $file->owner_id);
    }

    /**
     * Judging a document is not the same as rewriting the file.
     *
     * Preview is the bar: a viewer must not mark somebody's passport ready
     * unless they are staff who can open it, and Confirm submission must not
     * take the chip away. A CIP slot in Review Applications is the officer's
     * job even when assignment only grants view on the folder.
     */
    private function authorizeReview(User $user, FileItem $file, ?CipDocument $slot): void
    {
        abort_unless(Role::isStaff($user), 403, 'Permission denied.');

        // Preview, not upload: a confirmed original package is view-only for
        // the bytes, and judging the file is not rewriting it. Upload would
        // refuse the chip after Confirm submission.
        if (FileAccess::can($user, 'preview', $file) || FileAccess::can($user, 'upload', $file)) {
            return;
        }

        abort_unless(
            $slot !== null
            && ApplicationScope::query($user)->whereKey($slot->application_id)->exists(),
            403,
            'Permission denied.',
        );
    }

    /**
     * A CIP slot: any file-review status, both directions, for staff.
     *
     * Officers still settle the application checklist after a verdict.
     * Any file marked Update required still puts the application in
     * Updates Required — the checklist moved, even when the actor cannot
     * type application status themselves.
     */
    private function judgeCip(CipDocument $slot, User $user, string $to, string $note): void
    {
        try {
            $meta = array_filter(['note' => $note !== '' ? $note : null]);
            DocumentEngine::set($slot, $to, $user, $meta);

            if ($to === DocumentStatus::UPDATE_REQUIRED && $note !== '') {
                DocumentComments::create($slot, $user, $note);
            }

            CipReview::settle($slot->loadMissing('application')->application, $user);
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        } catch (AuthorizationException $e) {
            abort(403, $e->getMessage());
        } catch (ValidationException $e) {
            throw $e;
        }

        $file = $slot->file;
        if ($file) {
            $file->forceFill([
                'review_note' => $note === '' ? null : $note,
                'reviewed_by' => $user->id,
                'reviewed_at' => now(),
            ])->save();

            // Workflows → Feedback and Comments lists file threads, not the
            // slot conversation. Mirror the reason there so it is not only
            // on the checklist.
            if ($to === DocumentStatus::UPDATE_REQUIRED && $note !== '') {
                try {
                    Comments::create($file, $user, $note);
                } catch (\Throwable $e) {
                    report($e);
                }
            }
        }
    }

    /** An ordinary client document: any file-level status from any other. */
    private function judgeFile(FileItem $file, User $user, string $to, string $note): void
    {
        $from = ReviewStatus::normalize($file->review_status);

        abort_if(
            ! ReviewStatus::canMove($from, $to),
            422,
            'A document that is '.strtolower((string) ReviewStatus::label($from)).' cannot move straight to '.strtolower((string) ReviewStatus::label($to)).'.'
        );

        $file->forceFill([
            'review_status' => $to,
            'review_note' => $note === '' ? null : $note,
            'reviewed_by' => $user->id,
            'reviewed_at' => now(),
        ])->save();

        if ($to === ReviewStatus::UPDATE_REQUIRED && $note !== '') {
            try {
                Comments::create($file, $user, $note);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        ActivityLogger::log([
            'actor' => $user,
            'type' => 'file.review',
            'description' => $user->name.' marked '.$file->name.' '.strtolower((string) ReviewStatus::label($to)),
            'subject' => $file,
        ]);
    }
}
