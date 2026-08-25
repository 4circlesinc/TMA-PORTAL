<?php

namespace App\Http\Controllers\Files;

use App\Models\FileComment;
use App\Models\FileItem;
use App\Support\Files\CommentPresenter;
use App\Support\Files\CommentReads;
use App\Support\Files\Comments;
use App\Support\Files\FileAccess;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Comment threads on a file.
 *
 * Every action re-derives what the caller may do from FileAccess and the
 * comment's own authorship. The client hides buttons it shouldn't offer, but
 * that is presentation, this is the control.
 */
class FileCommentController extends BaseFilesController
{
    public function index(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'view', $file);

        $data = $request->validate([
            'before' => ['nullable', 'integer', 'min:1'],
            'peek' => ['nullable', 'boolean'],
        ]);

        $page = CommentPresenter::page($file, $user, isset($data['before']) ? (int) $data['before'] : null);

        /*
         * The bodies are now on the reader's screen, so this is the moment
         * they were read. Recorded here rather than on any listing that merely
         * names the file: a row in a folder is not a conversation you have had.
         *
         * Unless the caller says it is only counting. The viewer refreshes
         * this endpoint to keep its tab badge honest when a comment lands
         * while the conversation column is CLOSED, and that fetch was clearing
         * every thread on the file: a colleague writing to you marked their
         * own message read, on your behalf, because you happened to have the
         * document open on another tab. Peeking asks the same question and
         * claims nothing.
         */
        $marked = ($data['peek'] ?? false)
            ? false
            : CommentReads::markFileRead($user, $file);

        // So the tab holding this response can redraw its own indicators, and
        // stay quiet when there was nothing to clear.
        return response()->json($page + ['readCleared' => $marked]);
    }

    /** People the author may @-mention on this file. */
    public function mentionable(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'view', $file);

        $data = $request->validate(['q' => ['nullable', 'string', 'max:80']]);

        return response()->json([
            'people' => CommentPresenter::mentionable($file, $user, trim($data['q'] ?? '')),
        ]);
    }

    public function store(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);
        abort_unless(Comments::canComment($user, $file), 403, 'You can’t comment on this file.');

        $data = $request->validate([
            'body' => ['required', 'string', 'max:'.Comments::MAX_LENGTH],
            'parent' => ['nullable', 'string', 'max:64'],
            'mentions' => ['nullable', 'array', 'max:50'],
            'mentions.*' => ['integer', 'min:1'],
            /*
             * The highlighted area this comment is about, as fractions of the
             * rendered page, resolution-independent, so the same anchor
             * lands on the same words on any screen. Bounded to the page so a
             * hand-built request cannot park a marker off the document.
             */
            'anchor' => ['nullable', 'array:page,x,y,w,h'],
            'anchor.page' => ['required_with:anchor', 'integer', 'min:1', 'max:10000'],
            'anchor.x' => ['required_with:anchor', 'numeric', 'min:0', 'max:1'],
            'anchor.y' => ['required_with:anchor', 'numeric', 'min:0', 'max:1'],
            'anchor.w' => ['required_with:anchor', 'numeric', 'min:0', 'max:1'],
            'anchor.h' => ['required_with:anchor', 'numeric', 'min:0', 'max:1'],
        ]);

        abort_if(trim($data['body']) === '', 422, 'A comment can’t be empty.');

        $parent = null;
        if (! empty($data['parent'])) {
            $parent = $this->findComment($file, $data['parent']);
        }

        $comment = Comments::create($file, $user, $data['body'], $parent, $data['mentions'] ?? [], $data['anchor'] ?? null);

        return response()->json(
            CommentPresenter::comment($comment->fresh()->load('author'), $user, $file) + ['replies' => []],
            201,
        );
    }

    public function update(Request $request, string $uuid, string $commentUuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);
        $comment = $this->findComment($file, $commentUuid);

        abort_unless(Comments::canEdit($user, $comment), 403, 'Only the author can edit a comment.');

        $data = $request->validate([
            'body' => ['required', 'string', 'max:'.Comments::MAX_LENGTH],
            'mentions' => ['nullable', 'array', 'max:50'],
            'mentions.*' => ['integer', 'min:1'],
        ]);

        abort_if(trim($data['body']) === '', 422, 'A comment can’t be empty.');

        $comment = Comments::update($comment, $user, $data['body'], $data['mentions'] ?? []);

        return response()->json(CommentPresenter::comment($comment->load('author'), $user, $file));
    }

    public function destroy(Request $request, string $uuid, string $commentUuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);
        $comment = $this->findComment($file, $commentUuid);

        abort_unless(Comments::canDelete($user, $comment, $file), 403, 'You can’t delete this comment.');

        Comments::delete($comment, $user);

        return response()->json(['status' => 'ok']);
    }

    public function resolve(Request $request, string $uuid, string $commentUuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);
        $comment = $this->findComment($file, $commentUuid);

        abort_unless(Comments::canResolve($user, $comment, $file), 403, 'You can’t resolve this comment.');
        abort_if($comment->isReply(), 422, 'Only a thread can be resolved.');

        $data = $request->validate(['resolved' => ['required', 'boolean']]);
        $comment = Comments::resolve($comment, $user, (bool) $data['resolved']);

        return response()->json(CommentPresenter::comment($comment->load(['author', 'resolver']), $user, $file));
    }

    /**
     * A comment is always addressed within its file, so a uuid from one file
     * can never be used to reach another's thread.
     */
    private function findComment(FileItem $file, string $commentUuid): FileComment
    {
        $comment = FileComment::where('file_id', $file->id)->where('uuid', $commentUuid)->first();

        abort_unless($comment, 404, 'Comment no longer exists.');

        return $comment;
    }
}
