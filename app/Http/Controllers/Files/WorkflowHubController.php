<?php

namespace App\Http\Controllers\Files;

use App\Models\FileComment;
use App\Support\Files\CommentReads;
use App\Support\Files\FileAccess;
use App\Support\Files\Workflow\Hub;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The Workflows section: every request and every conversation, across files.
 *
 * Read-only on purpose. Responding, cancelling, replying and resolving all
 * already have endpoints that authorize against the file they belong to, and
 * every row here carries its file's uuid so the client calls those. A second
 * set of write endpoints would be a second set of permission checks to keep in
 * step with the first, which is how the two drift apart.
 */
class WorkflowHubController extends BaseFilesController
{
    public function index(Request $request): JsonResponse
    {
        $user = $this->user($request);

        $data = $request->validate([
            'scope' => ['nullable', 'string', 'max:16'],
            'type' => ['nullable', 'string', 'max:32'],
            'state' => ['nullable', 'in:open,closed,all'],
            'q' => ['nullable', 'string', 'max:120'],
            'cursor' => ['nullable', 'integer', 'min:1'],
        ]);

        return response()->json(Hub::requests($user, $data));
    }

    public function comments(Request $request): JsonResponse
    {
        $user = $this->user($request);

        $data = $request->validate([
            'scope' => ['nullable', 'string', 'max:16'],
            'q' => ['nullable', 'string', 'max:120'],
            'cursor' => ['nullable', 'integer', 'min:1'],
        ]);

        return response()->json(Hub::comments($user, $data));
    }

    /** Just the tab numbers, for a cheap refresh after acting on something. */
    public function counts(Request $request): JsonResponse
    {
        return response()->json(['counts' => Hub::counts($this->user($request))]);
    }

    /**
     * Mark one thread read, because the reader opened it.
     *
     * The listing deliberately does not do this — see Hub::comments — so
     * opening a comment from the Workflows page has to say so. Addressed by
     * the comment's own uuid and authorized through its file, the same door
     * every other comment action uses.
     */
    public function read(Request $request, string $comment): JsonResponse
    {
        $user = $this->user($request);

        $row = FileComment::query()
            ->with('file')
            ->where('uuid', $comment)
            ->firstOrFail();

        abort_unless($row->file !== null, 404);
        FileAccess::authorize($user, 'view', $row->file);

        CommentReads::markThreadsRead($user, [$row->root_id ?? $row->id]);

        // Only this reader: nobody else's lists moved. Their other tabs did,
        // though — a thread read on the Workflows page must not still be bold
        // on the board open next to it.
        Live::user(Live::WORKFLOWS, $user->id);

        return response()->json(['counts' => Hub::counts($user)]);
    }
}
