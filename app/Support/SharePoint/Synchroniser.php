<?php

namespace App\Support\SharePoint;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\SharePointItem;
use App\Support\Files\Activity;
use App\Support\Files\Naming;
use App\Support\Files\Vault;
use App\Support\Files\Versions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Pulls a SharePoint document library into the portal.
 *
 * Driven by Graph's delta feed, never by re-listing the library. The first run
 * walks everything; every run after that asks only "what changed since the
 * cursor I gave you". §1 is explicit that this must not repeatedly download and
 * compare the whole library, and on a real library it would be unusable.
 *
 * Four properties this is built to hold:
 *
 *  - **No duplicates.** Every Graph item is matched to its existing mapping row
 *    by `graph_item_id` before anything is created. The unique index on
 *    (connection, graph_item_id) makes that a database guarantee, not a hope.
 *  - **One bad item never stops the sync.** Each item is processed in its own
 *    try/catch; a failure marks that row and the walk continues (§26).
 *  - **Renames are not new versions.** eTag changes on any edit, cTag only on
 *    content. Comparing cTag is what stops a rename creating a version.
 *  - **Nothing is destroyed.** A delete in SharePoint soft-deletes in the
 *    portal (recycle bin), so a mistake on either side is recoverable.
 */
class Synchroniser
{
    /** Safety valve: pages per run, so one job cannot walk forever. */
    private const MAX_PAGES = 50;

    public static function sync(SharePointConnection $connection): array
    {
        if (! $connection->sync_enabled) {
            return ['skipped' => true];
        }

        $connection->update(['status' => SharePointConnection::STATUS_SYNCING, 'last_synced_at' => now()]);

        $stats = ['created' => 0, 'updated' => 0, 'deleted' => 0, 'failed' => 0, 'pages' => 0];
        $link = $connection->delta_link;
        $changedFolders = [];

        try {
            // Inbound writes must never bounce back out as outbound pushes.
            Pusher::suspend(function () use ($connection, &$link, &$changedFolders, &$stats) {
            for ($page = 0; $page < self::MAX_PAGES; $page++) {
                $batch = Drive::delta($connection->drive_id, $link, $connection->root_item_id);
                $stats['pages']++;

                foreach ($batch['items'] as $item) {
                    // A deletion always changes its parent folder, so the
                    // folders delta reports are exactly the places worth
                    // re-checking for items that have gone.
                    if (isset($item['folder']) && ! empty($item['id'])) {
                        $changedFolders[] = $item['id'];
                    }

                    try {
                        self::apply($connection, $item, $stats);
                    } catch (\Throwable $e) {
                        // §26: record the failure against the item and keep
                        // going. One unreadable file must not stall a library.
                        $stats['failed']++;
                        self::markFailed($connection, $item, $e->getMessage());
                        self::log($connection, 'item-failed', 'error', $item['id'] ?? null, $e->getMessage());
                    }
                }

                if ($batch['delta']) {
                    // Caught up. Store the cursor for next time.
                    $connection->update(['delta_link' => $batch['delta']]);
                    break;
                }

                if (! $batch['next']) {
                    break;
                }
                $link = $batch['next'];
            }

            self::reconcileDeletions($connection, $changedFolders, $stats);
            });

            $connection->update([
                'status' => SharePointConnection::STATUS_IDLE,
                'last_success_at' => now(),
                'last_error' => null,
                'error_count' => 0,
            ]);

            self::log($connection, 'sync-complete', 'info', null, json_encode($stats));
        } catch (GraphThrottledException $e) {
            // Not an error: Graph asked us to wait. Leave the cursor alone so
            // the next run resumes exactly where this one stopped.
            $connection->update(['status' => SharePointConnection::STATUS_IDLE]);
            self::log($connection, 'throttled', 'warning', null, 'Retry after '.$e->retryAfter.'s');

            return $stats + ['throttled' => true, 'retryAfter' => $e->retryAfter];
        } catch (\Throwable $e) {
            $connection->update([
                'status' => SharePointConnection::STATUS_ERROR,
                'last_error' => $e->getMessage(),
                'error_count' => $connection->error_count + 1,
            ]);
            self::log($connection, 'sync-failed', 'error', null, $e->getMessage());
            Log::error('SharePoint sync failed', ['connection' => $connection->uuid, 'error' => $e->getMessage()]);

            return $stats + ['error' => $e->getMessage()];
        }

        return $stats;
    }

    /**
     * Find items that have been deleted in SharePoint.
     *
     * **This exists because delta does not reliably emit tombstones.** Verified
     * against a real library on 2026-08-01: deleting a file produced no
     * `deleted` facet even after twenty seconds — the item simply stopped
     * appearing. Trusting tombstones would have meant deletions silently never
     * propagating, which is the worst kind of sync bug because nothing looks
     * wrong until someone notices a file that should be gone.
     *
     * So deletions are detected by difference, but only for the folders delta
     * actually reported as changed — a deletion always modifies its parent. The
     * library is never re-walked wholesale, which §1 forbids.
     */
    private static function reconcileDeletions(SharePointConnection $connection, array $folderGraphIds, array &$stats): void
    {
        foreach (array_unique($folderGraphIds) as $graphFolderId) {
            try {
                $children = GraphClient::get("/drives/{$connection->drive_id}/items/{$graphFolderId}/children")['value'] ?? [];
                $present = array_values(array_filter(array_column($children, 'id')));

                $gone = SharePointItem::where('connection_id', $connection->id)
                    ->where('graph_parent_id', $graphFolderId)
                    // An empty folder means everything mapped under it is gone;
                    // whereNotIn([]) would match nothing, so guard it.
                    ->when($present !== [], fn ($q) => $q->whereNotIn('graph_item_id', $present))
                    ->get();

                foreach ($gone as $mapping) {
                    self::applyDelete($connection, $mapping);
                    $stats['deleted']++;
                }
            } catch (\Throwable $e) {
                // A folder we cannot list is not a reason to fail the sync.
                self::log($connection, 'reconcile-failed', 'warning', $graphFolderId, $e->getMessage());
            }
        }
    }

    /** Apply one delta entry. */
    private static function apply(SharePointConnection $connection, array $item, array &$stats): void
    {
        $graphId = $item['id'] ?? null;
        if (! $graphId) {
            return;
        }

        // The drive root arrives in delta but is not content — it is the
        // library itself, already represented by the connection's folder. The
        // same is true of the folder a scoped connection starts from.
        if (isset($item['root']) || $graphId === $connection->root_item_id) {
            return;
        }

        $mapping = SharePointItem::where('connection_id', $connection->id)
            ->where('graph_item_id', $graphId)->first();

        if (isset($item['deleted'])) {
            if ($mapping) {
                self::applyDelete($connection, $mapping);
                $stats['deleted']++;
            }

            return;
        }

        $isFolder = isset($item['folder']);

        if ($mapping) {
            self::applyUpdate($connection, $mapping, $item, $isFolder, $stats);

            return;
        }

        self::applyCreate($connection, $item, $isFolder, $stats);
    }

    private static function applyCreate(SharePointConnection $connection, array $item, bool $isFolder, array &$stats): void
    {
        $parentFolder = self::resolveParentFolder($connection, $item);
        $name = Naming::clean($item['name'] ?? 'Untitled');

        if ($isFolder) {
            $folder = Folder::create([
                'uuid' => (string) Str::uuid(),
                'name' => $name,
                'parent_id' => $parentFolder?->id,
                'owner_id' => $connection->created_by,
                'created_by' => $connection->created_by,
                'origin' => 'sharepoint',
            ]);

            self::mapFolder($connection, $item, $folder);
            $stats['created']++;

            return;
        }

        $file = self::downloadIntoLibrary($connection, $item, $parentFolder, $name);
        self::mapFile($connection, $item, $file);
        $stats['created']++;
    }

    private static function applyUpdate(SharePointConnection $connection, SharePointItem $mapping, array $item, bool $isFolder, array &$stats): void
    {
        $name = Naming::clean($item['name'] ?? 'Untitled');

        if ($isFolder && $mapping->folder) {
            $mapping->folder->update([
                'name' => $name,
                'parent_id' => self::resolveParentFolder($connection, $item)?->id,
            ]);
            self::touchMapping($mapping, $item);
            $stats['updated']++;

            return;
        }

        $file = $mapping->file;
        if (! $file) {
            return;
        }

        // cTag, not eTag: eTag changes on a rename too, and treating that as
        // new content would file a version for every renamed document.
        $contentChanged = ($item['cTag'] ?? null) !== $mapping->ctag;

        $file->update([
            'name' => $name,
            'folder_id' => self::resolveParentFolder($connection, $item)?->id,
        ]);

        if ($contentChanged) {
            self::pullNewVersion($connection, $mapping, $item, $file);
        }

        self::touchMapping($mapping, $item);
        $stats['updated']++;
    }

    /**
     * A deletion in SharePoint recycles in the portal — it never purges.
     * Retention and "somebody deleted the wrong thing" are the same problem,
     * and only a recoverable delete solves both.
     */
    private static function applyDelete(SharePointConnection $connection, SharePointItem $mapping): void
    {
        DB::transaction(function () use ($mapping, $connection) {
            if ($mapping->file) {
                $mapping->file->update(['deleted_by' => $connection->created_by]);
                $mapping->file->delete();
                Activity::forFile($connection->created_by, $mapping->file, 'delete', ['via' => 'sharepoint']);
            }
            if ($mapping->folder) {
                $mapping->folder->update(['deleted_by' => $connection->created_by]);
                $mapping->folder->delete();
            }
            $mapping->delete();
        });

        self::log($connection, 'deleted', 'info', $mapping->graph_item_id, $mapping->name);
    }

    /** Fetch the bytes and file them as a brand-new portal file. */
    private static function downloadIntoLibrary(SharePointConnection $connection, array $item, ?Folder $parent, string $name): FileItem
    {
        $temp = tempnam(sys_get_temp_dir(), 'sp-');
        Drive::download($connection->drive_id, $item['id'], $temp);

        $ext = pathinfo($name, PATHINFO_EXTENSION) ?: '';
        $stored = Vault::store($temp, strtolower($ext));

        $file = FileItem::create([
            'uuid' => $stored['uuid'],
            'folder_id' => $parent?->id,
            'name' => $name,
            'extension' => strtolower($ext),
            'mime_type' => $item['file']['mimeType'] ?? null,
            'size' => $stored['size'],
            'disk' => $stored['disk'],
            'storage_path' => $stored['path'],
            'checksum' => $stored['checksum'],
            'owner_id' => $connection->created_by,
            'uploaded_by' => $connection->created_by,
            'source_modified_at' => isset($item['lastModifiedDateTime'])
                ? \Illuminate\Support\Carbon::parse($item['lastModifiedDateTime']) : null,
            // Origin drives conflict resolution: the firm chose that
            // SharePoint stays authoritative for the files it authored.
            'origin' => 'sharepoint',
        ]);

        Versions::recordInitial($file, $connection->created_by, 'Imported from SharePoint');
        Activity::forFile($connection->created_by, $file, 'upload', ['via' => 'sharepoint']);

        return $file;
    }

    /** Content changed in SharePoint → a new portal version, never an overwrite. */
    private static function pullNewVersion(SharePointConnection $connection, SharePointItem $mapping, array $item, FileItem $file): void
    {
        $temp = tempnam(sys_get_temp_dir(), 'sp-');
        Drive::download($connection->drive_id, $item['id'], $temp);

        $stored = Vault::store($temp, strtolower((string) $file->extension));
        $author = \App\Models\User::find($connection->created_by);

        if (! $author) {
            return;
        }

        Versions::addStored(
            $file,
            $author,
            $stored,
            ['mime' => $item['file']['mimeType'] ?? $file->mime_type, 'extension' => $file->extension],
            'Updated in SharePoint by '.($item['lastModifiedBy']['user']['displayName'] ?? 'someone'),
        );
    }

    /**
     * The portal folder a Graph item belongs under.
     *
     * An item whose parent has not been seen yet lands in the connection's root
     * rather than being dropped: delta does not guarantee parents arrive first,
     * and a later page will correct the placement.
     */
    private static function resolveParentFolder(SharePointConnection $connection, array $item): ?Folder
    {
        $parentId = $item['parentReference']['id'] ?? null;
        if (! $parentId || $parentId === $connection->root_item_id) {
            return $connection->folder;
        }

        $mapping = SharePointItem::where('connection_id', $connection->id)
            ->where('graph_item_id', $parentId)
            ->whereNotNull('folder_id')
            ->first();

        return $mapping?->folder ?? $connection->folder;
    }

    private static function mapFile(SharePointConnection $connection, array $item, FileItem $file): SharePointItem
    {
        return SharePointItem::create(self::mappingAttributes($connection, $item) + [
            'item_type' => 'file',
            'file_id' => $file->id,
        ]);
    }

    private static function mapFolder(SharePointConnection $connection, array $item, Folder $folder): SharePointItem
    {
        return SharePointItem::create(self::mappingAttributes($connection, $item) + [
            'item_type' => 'folder',
            'folder_id' => $folder->id,
        ]);
    }

    private static function mappingAttributes(SharePointConnection $connection, array $item): array
    {
        return [
            'connection_id' => $connection->id,
            'graph_item_id' => $item['id'],
            'graph_parent_id' => $item['parentReference']['id'] ?? null,
            'etag' => $item['eTag'] ?? null,
            'ctag' => $item['cTag'] ?? null,
            'web_url' => $item['webUrl'] ?? null,
            'name' => $item['name'] ?? null,
            'size' => $item['size'] ?? null,
            'mime_type' => $item['file']['mimeType'] ?? null,
            'graph_created_at' => isset($item['createdDateTime']) ? \Illuminate\Support\Carbon::parse($item['createdDateTime']) : null,
            'graph_modified_at' => isset($item['lastModifiedDateTime']) ? \Illuminate\Support\Carbon::parse($item['lastModifiedDateTime']) : null,
            'graph_modified_by' => $item['lastModifiedBy']['user']['displayName'] ?? null,
            'sync_status' => SharePointItem::SYNCED,
            'last_synced_at' => now(),
            'last_error' => null,
            'failure_count' => 0,
        ];
    }

    private static function touchMapping(SharePointItem $mapping, array $item): void
    {
        $mapping->update([
            'graph_parent_id' => $item['parentReference']['id'] ?? null,
            'etag' => $item['eTag'] ?? null,
            'ctag' => $item['cTag'] ?? null,
            'web_url' => $item['webUrl'] ?? null,
            'name' => $item['name'] ?? null,
            'size' => $item['size'] ?? null,
            'graph_modified_at' => isset($item['lastModifiedDateTime']) ? \Illuminate\Support\Carbon::parse($item['lastModifiedDateTime']) : null,
            'graph_modified_by' => $item['lastModifiedBy']['user']['displayName'] ?? null,
            // A successful pass clears an earlier failure — §26 says stale
            // failed statuses must not linger after things recover.
            'sync_status' => SharePointItem::SYNCED,
            'last_error' => null,
            'failure_count' => 0,
            'last_synced_at' => now(),
        ]);
    }

    private static function markFailed(SharePointConnection $connection, array $item, string $error): void
    {
        $graphId = $item['id'] ?? null;
        if (! $graphId) {
            return;
        }

        $mapping = SharePointItem::where('connection_id', $connection->id)
            ->where('graph_item_id', $graphId)->first();

        if ($mapping) {
            $mapping->update([
                'sync_status' => SharePointItem::FAILED,
                'last_error' => Str::limit($error, 500),
                'failure_count' => $mapping->failure_count + 1,
            ]);
        }
    }

    public static function log(SharePointConnection $connection, string $action, string $level, ?string $graphItemId, ?string $detail, array $meta = []): void
    {
        \App\Models\SharePointSyncLog::create([
            'connection_id' => $connection->id,
            'action' => $action,
            'level' => $level,
            'graph_item_id' => $graphItemId,
            'detail' => $detail ? Str::limit($detail, 1000) : null,
            'meta' => $meta ?: null,
            'created_at' => now(),
        ]);
    }
}
