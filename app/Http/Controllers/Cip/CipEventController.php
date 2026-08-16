<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\Timeline;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The Activity tab: one application's own history.
 *
 * Read-only, and there is no writing half to come. cip_events is append-only
 * and every row is written by the code that made the change, inside the same
 * transaction — a route that let a client post its own history would be a way
 * to write the audit without doing the thing it describes.
 *
 * The application is resolved through {@see ApplicationScope} first, so a
 * reader who may not see it is told the history is not there rather than that
 * they are not allowed to read it: a 403 on a history is still confirmation
 * that the application exists. {@see Timeline} does the reading and the
 * English; this only decides who may ask.
 */
class CipEventController extends Controller
{
    /** Entries in one read when the caller does not say. */
    private const LIMIT = 100;

    public function index(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);

        // The ceiling is Timeline's own, read from it rather than repeated:
        // a validator that allowed more than the reader would be given back
        // would be promising a page nobody ever serves.
        $data = $request->validate([
            'limit' => ['nullable', 'integer', 'min:1', 'max:'.Timeline::MAX_LIMIT],
        ]);

        return response()->json([
            'events' => Timeline::for($application, $user, (int) ($data['limit'] ?? self::LIMIT)),
        ]);
    }
}
