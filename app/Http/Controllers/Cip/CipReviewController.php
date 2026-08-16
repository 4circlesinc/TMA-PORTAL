<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipDocument;
use App\Models\User;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\DocumentComments;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\Review;
use App\Support\Cip\Status;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The Reviewing Officer's two verdicts (§14), addressed by document.
 *
 * By document, and never by file. Review happens on the application's own page,
 * on the checklist row the officer is reading — §14 is explicit that nobody
 * should have to go and find the upload in the File Library to say what is
 * wrong with it. The slot is the thing being judged; the file is only what
 * happens to be in it today, which is why a document sent back and re-uploaded
 * comes home to the same row, the same verdict and the same conversation.
 *
 * 404 rather than 403 for a document the reader may not see, the portal's
 * convention. 403 is kept for the reader who may see it and may not judge it —
 * the provider contact who uploaded the document knows perfectly well that it
 * is there, and is better told plainly that the verdict is not theirs.
 */
class CipReviewController extends Controller
{
    /** Accept a document for the submission package. */
    public function approve(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $document = $this->reviewable($request, $uuid);

        return $this->state($this->judge(fn () => Review::approve($document, $user)), $user);
    }

    /** Send a document back, with the reason the provider side will read. */
    public function requestChanges(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $document = $this->reviewable($request, $uuid);

        $data = $request->validate([
            'comment' => ['required', 'string', 'max:'.DocumentComments::MAX_LENGTH],
        ]);

        return $this->state(
            $this->judge(fn () => Review::requestChanges($document, $user, $data['comment'])),
            $user,
        );
    }

    /* ── internals ─────────────────────────────────── */

    /**
     * The document, if this reader may see it AND may judge it.
     *
     * Two different answers on purpose; see the note at the top of the class.
     */
    private function reviewable(Request $request, string $uuid): CipDocument
    {
        $user = $request->user();
        $document = CipDocument::query()->where('uuid', $uuid)->firstOrFail();

        abort_unless(
            ApplicationScope::query($user)->whereKey($document->application_id)->exists(),
            404,
        );

        abort_unless(
            CipAccess::can($user, 'cip.review'),
            403,
            'Only a reviewing officer can assess a document.',
        );

        return $document;
    }

    /**
     * A verdict the review cycle has no edge for is the officer's mistake, not
     * the server's: approving a slot nothing has been uploaded into answers
     * 422 with the engine's own sentence rather than a 500 with none.
     */
    private function judge(callable $verdict): CipDocument
    {
        try {
            return $verdict();
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        }
    }

    /** What the checklist row and the page header both need after a verdict. */
    private function state(CipDocument $document, User $user): JsonResponse
    {
        $application = $document->loadMissing('application')->application;

        Live::staff(Live::CIP);

        return response()->json([
            'document' => [
                'id' => $document->uuid,
                'status' => $document->status,
                'statusLabel' => DocumentStatus::label($document->status),
                'statusTone' => DocumentStatus::tone($document->status),
                // The row's "needs attention" mark. A document just sent back
                // carries at least the reason it was sent back for.
                'openComments' => DocumentComments::openCounts([$document->id])[$document->id] ?? 0,
            ],
            // The verdict was on one document and the answer is about the
            // whole file, which is the point of the roll-up: the officer needs
            // to see the header follow the row they just cleared.
            'application' => [
                'id' => $application->uuid,
                'status' => $application->status,
                'statusLabel' => Status::label($application->status),
                'statusTone' => Status::tone($application->status),
            ],
            // Counted on the server rather than in the browser: the checklist
            // in front of the officer is one person's, and an application's
            // progress is every person's.
            'progress' => Review::progress($application),
        ]);
    }
}
