<?php

namespace App\Http\Controllers\Files;

use App\Support\Files\AccessSources;
use App\Support\Files\ActivityFeed;
use App\Support\Files\FileAccess;
use App\Support\Files\FileDetails;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The collaboration viewer's right-hand panel: activity, access and the full
 * metadata block.
 *
 * Deliberately three endpoints rather than one fat payload. Opening a file must
 * not wait on a firm-wide access roll-up or a long history, the preview shows
 * immediately and each panel section loads when it is actually looked at.
 *
 * Every action re-checks `view` through FileAccess. The client hides what it
 * cannot do, but hiding is never the control.
 */
class FileViewerController extends BaseFilesController
{
    /** Paginated, filterable activity for one file. */
    public function activity(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'view', $file);

        $data = $request->validate([
            'filter' => ['nullable', 'string', 'max:32'],
            'before' => ['nullable', 'integer', 'min:1'],
        ]);

        $page = ActivityFeed::page(
            $file,
            $user,
            $data['filter'] ?? 'all',
            isset($data['before']) ? (int) $data['before'] : null,
        );

        return response()->json($page + ['filters' => ActivityFeed::options()]);
    }

    /** Who can reach this file, grouped by why. */
    public function access(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'view', $file);

        return response()->json(AccessSources::forFile($file, $user));
    }

    /** The "More details" metadata block. */
    public function details(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'view', $file);

        $file->loadMissing(['folder.parent', 'owner', 'uploader', 'uploadedByMember']);

        return response()->json(FileDetails::for($file, $user));
    }
}
