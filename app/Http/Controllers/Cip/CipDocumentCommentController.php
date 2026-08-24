<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipDocument;
use App\Models\CipDocumentComment;
use App\Support\Cip\DocumentComments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The conversation on a checklist document (§13).
 *
 * Sibling to {@see \App\Http\Controllers\Files\FileCommentController}, and
 * deliberately the same shape, the difference is the subject, not the idea.
 *
 * 404 rather than 403 for a document the reader may not see, the portal's
 * convention: a stranger should not learn that an application exists by being
 * told they may not comment on it.
 */
class CipDocumentCommentController extends Controller
{
    /** A document's whole thread. */
    public function index(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $document = $this->reachable($request, $uuid);

        return response()->json(['comments' => DocumentComments::thread($document, $user)]);
    }

    public function store(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $document = $this->reachable($request, $uuid);

        $data = $request->validate([
            'body' => ['required', 'string', 'max:'.DocumentComments::MAX_LENGTH],
            'parent' => ['nullable', 'string', 'max:64'],
        ]);

        abort_if(trim($data['body']) === '', 422, 'A comment can’t be empty.');

        $parent = empty($data['parent']) ? null : $this->comment($document, $data['parent']);

        $comment = DocumentComments::create($document, $user, $data['body'], $parent);

        return response()->json(
            DocumentComments::present($comment->fresh()->load('author'), $user) + ['replies' => []],
            201,
        );
    }

    public function update(Request $request, string $uuid, string $commentUuid): JsonResponse
    {
        $user = $request->user();
        $document = $this->reachable($request, $uuid);
        $comment = $this->comment($document, $commentUuid);

        abort_unless(DocumentComments::canEdit($user, $comment), 403, 'Only the author can edit a comment.');

        $data = $request->validate([
            'body' => ['required', 'string', 'max:'.DocumentComments::MAX_LENGTH],
        ]);
        abort_if(trim($data['body']) === '', 422, 'A comment can’t be empty.');

        // Stamped rather than silently rewritten: a document's thread is part
        // of the record of why it was sent back, and an edit that left no mark
        // would let it be rewritten after the fact.
        $comment->forceFill(['body' => trim($data['body']), 'edited_at' => now()])->save();

        return response()->json(DocumentComments::present($comment->load('author'), $user));
    }

    /**
     * Take a comment out of the thread.
     *
     * Soft, always. §13 says these are retained, and a reviewer's reason for
     * rejecting a document is exactly the thing somebody would want gone.
     */
    public function destroy(Request $request, string $uuid, string $commentUuid): JsonResponse
    {
        $user = $request->user();
        $document = $this->reachable($request, $uuid);
        $comment = $this->comment($document, $commentUuid);

        abort_unless(DocumentComments::canEdit($user, $comment), 403, 'Only the author can delete a comment.');

        $comment->forceFill(['deleted_by' => $user->id])->save();
        $comment->delete();

        return response()->json(['deleted' => true]);
    }

    /** Settle a question, or reopen it. */
    public function resolve(Request $request, string $uuid, string $commentUuid): JsonResponse
    {
        $user = $request->user();
        $document = $this->reachable($request, $uuid);
        $comment = $this->comment($document, $commentUuid);

        $resolved = $request->boolean('resolved', true);

        $comment->forceFill([
            'resolved_at' => $resolved ? now() : null,
            'resolved_by' => $resolved ? $user->id : null,
        ])->save();

        return response()->json(DocumentComments::present($comment->load(['author', 'resolver']), $user));
    }

    /**
     * The document, if this reader may join its conversation at all.
     *
     * The gate is reach of the APPLICATION, not of the file in the slot: an
     * empty requirement is exactly the one most worth talking about, and it
     * has no file to be judged against.
     */
    private function reachable(Request $request, string $uuid): CipDocument
    {
        $document = CipDocument::query()->where('uuid', $uuid)->firstOrFail();

        abort_unless(DocumentComments::canJoin($request->user(), $document), 404);

        return $document;
    }

    /** A comment on THIS document, a uuid from another thread is a 404. */
    private function comment(CipDocument $document, string $uuid): CipDocumentComment
    {
        return $document->comments()->where('uuid', $uuid)->firstOrFail();
    }
}
