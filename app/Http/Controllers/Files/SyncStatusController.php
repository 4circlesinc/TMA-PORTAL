<?php

namespace App\Http\Controllers\Files;

use App\Models\FileItem;
use App\Models\SharePointConnection;
use App\Models\SharePointItem;
use App\Support\Access\Role;
use App\Support\Imports\ImportPause;
use App\Support\SharePoint\RemoteContent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * "Is the library up to date?", answered the way the mailbox answers it.
 *
 * A sync that is quietly running, quietly stalled, or quietly failing all look
 * identical from a file list. Surfacing the state is what stops "I can't see my
 * files" being a mystery: the answer is usually "it is still importing" or
 * "it stopped with an error", and the user should be able to see which.
 */
class SyncStatusController extends BaseFilesController
{
    public function __invoke(Request $request): JsonResponse
    {
        $user = $this->user($request);

        // Staff-only: a client has no business seeing the firm's sync plumbing.
        if (! Role::isStaff($user)) {
            return response()->json(['connections' => [], 'syncing' => false]);
        }

        // Personal OneDrives are private plumbing: their progress shows as
        // the owner's own bottom-right sync toast (sync-toasts.js), never as
        // a firm-wide pill, one presentation, and nobody else's drive name
        // paraded across the Files page.
        $connections = SharePointConnection::with('folder:id,uuid,name')
            ->where('drive_kind', '!=', 'onedrive')
            ->get();

        $rows = $connections->map(function (SharePointConnection $c) {
            // A dead worker leaves `status = syncing`, settle it on read so
            // the toast does not pin itself at "155,259 of 155,259" for ever.
            if ($c->status === SharePointConnection::STATUS_SYNCING
                && $c->effectiveStatus() === SharePointConnection::STATUS_IDLE) {
                $c->update(['status' => SharePointConnection::STATUS_IDLE]);
            }

            $failed = SharePointItem::where('connection_id', $c->id)
                ->where('sync_status', SharePointItem::FAILED)->count();
            $conflicts = SharePointItem::where('connection_id', $c->id)
                ->where('sync_status', SharePointItem::CONFLICT)->count();

            return [
                'id' => $c->uuid,
                // Every site's default library is called "Documents", so the
                // drive name alone gives four identical rows. The portal
                // folder is what the reader actually recognises.
                'name' => $c->folder?->name ?: ($c->site_name ?: $c->drive_name),
                'folder' => $c->folder ? ['id' => $c->folder->uuid, 'name' => $c->folder->name] : null,
                'status' => $c->effectiveStatus(),
                'enabled' => (bool) $c->sync_enabled,
                'importsPaused' => ImportPause::connection($c),
                'items' => SharePointItem::where('connection_id', $c->id)->count(),
                /*
                 * How many items the library holds in total.
                 *
                 * Summed from the childCount Graph reports on every folder, so
                 * it is exact once every folder has been discovered and a
                 * rising lower bound before that. Null while no folder has been
                 * seen yet, which the panel reads as "total still unknown"
                 * rather than printing "780 of 0".
                 */
                'itemsTotal' => (SharePointItem::where('connection_id', $c->id)
                    ->where('item_type', 'folder')
                    ->sum('child_count') + (int) $c->root_child_count) ?: null,
                'failedItems' => $failed,
                'conflicts' => $conflicts,
                'lastSuccessAt' => optional($c->last_success_at)->toIso8601String(),
                'lastError' => $c->last_error,
                // A connection that has never finished is "importing", which
                // reads very differently from "syncing" on an established one.
                'initialImport' => $c->last_success_at === null,
                /*
                 * Files whose structure is imported but whose bytes have not
                 * been fetched yet. Structure-complete + content_pending > 0
                 * means the library is browsable but files will download on
                 * first open. Exposed so the toast can say "140,926 files still
                 * downloading" rather than "155,629 of 155,629 items" (done).
                 */
                'contentPending' => FileItem::whereIn(
                    'id',
                    SharePointItem::where('connection_id', $c->id)
                        ->whereNotNull('file_id')
                        ->select('file_id')
                )->where('content_state', RemoteContent::PENDING)->count(),
            ];
        });

        $anySyncing = $rows->contains(fn ($r) => $r['status'] === 'syncing' && empty($r['importsPaused']));

        return response()->json([
            'connections' => $rows->values(),
            'syncing' => $anySyncing,
            'importsPaused' => $rows->contains(fn ($r) => ! empty($r['importsPaused'])),
            'hasError' => $rows->contains(fn ($r) => $r['status'] === 'error' || $r['failedItems'] > 0),
            'conflicts' => (int) $rows->sum('conflicts'),
        ]);
    }

    /** Kick a sync by hand, for the Retry button. */
    public function retry(Request $request): JsonResponse
    {
        $user = $this->user($request);
        abort_unless(Role::isAdmin($user), 403, 'Only administrators can start a sync.');

        $data = $request->validate(['connection' => ['nullable', 'string', 'max:64']]);

        $targets = SharePointConnection::query()
            ->where('sync_enabled', true)
            ->when($data['connection'] ?? null, fn ($q, $uuid) => $q->where('uuid', $uuid))
            ->get();

        $runnable = $targets->reject(fn (SharePointConnection $c) => ImportPause::connection($c));

        abort_unless($runnable->isNotEmpty(), 422, 'That import is paused. Resume it in Settings → Background Operations.');

        $runnable->each(fn (SharePointConnection $c) => \App\Jobs\SyncSharePointLibrary::dispatch($c->id));

        return response()->json(['status' => 'queued']);
    }
}
