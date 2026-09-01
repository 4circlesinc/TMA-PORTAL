<?php

namespace App\Http\Controllers;

use App\Jobs\SyncSharePointLibrary;
use App\Models\SharePointConnection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The owner's controls over their own OneDrive sync.
 *
 * Pausing is per-drive and per-person: it stops the scheduled and chained
 * sync passes for this one connection (ImportPause::connection reads
 * paused_at fresh on every run, so a long-lived worker still honours it).
 * The admin's global OneDrive switch in Background Operations is separate
 * and wins while it is on.
 */
class MeOneDriveController extends Controller
{
    public function pause(Request $request): JsonResponse
    {
        $connection = $this->drive($request);

        $connection->forceFill(['paused_at' => now()])->save();

        return response()->json(['paused' => true]);
    }

    public function resume(Request $request): JsonResponse
    {
        $connection = $this->drive($request);

        $connection->forceFill(['paused_at' => null])->save();

        // Catch up now rather than on the next scheduled pass; the job is
        // queue-unique and lock-guarded, so an already-running sync absorbs it.
        SyncSharePointLibrary::dispatch($connection->id);

        return response()->json(['paused' => false]);
    }

    private function drive(Request $request): SharePointConnection
    {
        $connection = SharePointConnection::personalDriveFor($request->user());

        abort_unless($connection, 404, 'No OneDrive is connected.');

        return $connection;
    }
}
