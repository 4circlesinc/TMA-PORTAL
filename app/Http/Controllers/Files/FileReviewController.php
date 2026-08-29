<?php

namespace App\Http\Controllers\Files;

use App\Models\CipDocument;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\DocumentEngine;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Review as CipReview;
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
 * Reviewing is a staff act on somebody else's document, so it takes the same
 * bar as uploading a version rather than merely being able to open the file —
 * a client with view access to their own folder must not be able to mark their
 * own passport approved.
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

        FileAccess::authorize($user, 'upload', $file);

        $data = $request->validate([
            'status' => ['required', Rule::in(ReviewStatus::ALL)],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        $to = ReviewStatus::normalize($data['status']) ?? $data['status'];
        $note = trim((string) ($data['note'] ?? ''));

        $this->applyTo($user, $file, $to, $note);

        $presented = (new Presenter($user))->file($file->fresh());

        return response()->json([
            'status' => $presented['status'] ?? ReviewStatus::badge($to),
            'file' => $presented,
        ]);
    }

    /**
     * Judge one file, the same path the single-file endpoint and bulk review use.
     */
    public function applyTo(User $user, FileItem $file, string $to, string $note): void
    {
        FileAccess::authorize($user, 'upload', $file);

        abort_if($to === ReviewStatus::UPDATE_REQUIRED && $note === '', 422, 'Say what needs changing.');

        $slot = CipDocument::query()->where('file_id', $file->id)->first();

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
     * A CIP slot: the engine's edges, the officer's two verbs.
     *
     * Application review is reached by uploading, not by picking it here —
     * a picker that could skip the new version would short the revision loop.
     */
    private function judgeCip(CipDocument $slot, User $user, string $to, string $note): void
    {
        try {
            if ($to === DocumentStatus::READY_FOR_SUBMISSION) {
                CipReview::approve($slot, $user);
            } elseif ($to === DocumentStatus::UPDATE_REQUIRED) {
                CipReview::requestChanges($slot, $user, $note);
            } elseif (CipAccess::canOverrideStatus($user)) {
                DocumentEngine::set($slot, $to, $user, array_filter(['note' => $note !== '' ? $note : null]));
            } else {
                abort(422, 'Re-upload the document to put it back into application review.');
            }
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

        ActivityLogger::log([
            'actor' => $user,
            'type' => 'file.review',
            'description' => $user->name.' marked '.$file->name.' '.strtolower((string) ReviewStatus::label($to)),
            'subject' => $file,
        ]);
    }
}
