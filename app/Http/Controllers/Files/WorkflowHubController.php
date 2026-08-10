<?php

namespace App\Http\Controllers\Files;

use App\Support\Files\Workflow\Hub;
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
}
