<?php

namespace App\Http\Controllers\Files;

use App\Models\FileComment;
use App\Models\FileItem;
use App\Support\Files\CommentPresenter;
use App\Support\Files\Comments;
use App\Support\Files\FileAccess;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Comment threads on a file.
 *
 * Every action re-derives what the caller may do from FileAccess and the
 * comment's own authorship. The client hides buttons it shouldn't offer, but
 * that is presentation — this is the control.
 */
class FileCommentController extends BaseFilesController
{
    public function index(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'view', $file);

        $data = $request->validate(['before' => ['nullable', 'integer', 'min:1']]);

        return response()->json(
            CommentPresenter::page($file, $user, isset($data['before']) ? (int) $data['before'] : null)
        );
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
        ]);

        abort_if(trim($data['body']) === '', 422, 'A comment can’t be empty.');

        $parent = null;
        if (! empty($data['parent'])) {
            $parent = $this->findComment($file, $data['parent']);
        }

        $comment = Comments::create($file, $user, $data['body'], $parent, $data['mentions'] ?? []);

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
