<?php

namespace App\Http\Controllers\Files;

use App\Support\Files\FileAccess;
use App\Support\Files\Presence;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Active viewers on a file.
 *
 * Reading the roster and joining it both need `view`, you cannot appear on, or
 * see, the roster of a file you cannot open.
 */
class FilePresenceController extends BaseFilesController
{
    public function index(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'view', $file);

        return response()->json(Presence::roster($file, $user));
    }

    /** Heartbeat: "I still have this open, and this is what I'm doing." */
    public function store(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'view', $file);

        $data = $request->validate([
            'session' => ['required', 'string', 'max:64'],
            'action' => ['nullable', 'string', 'max:16'],
            'device' => ['nullable', 'string', 'max:40'],
        ]);

        Presence::heartbeat($file, $user, $data['session'], $data['action'] ?? 'viewing', $data['device'] ?? null);

        return response()->json(Presence::roster($file, $user));
    }

    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'view', $file);

        $data = $request->validate(['session' => ['required', 'string', 'max:64']]);
        Presence::leave($file, $data['session']);

        return response()->json(['status' => 'ok']);
    }
}
