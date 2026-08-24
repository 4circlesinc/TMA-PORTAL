<?php

namespace App\Support\SharePoint;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\SharePointItem;
use App\Support\Files\Vault;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Pushes portal changes back into SharePoint.
 *
 * The conflict rule is the firm's own decision, and it is applied here:
 * **portal wins for portal-originated files.** A file the portal authored is
 * pushed even if SharePoint has moved on; a file SharePoint authored is never
 * overwritten behind its back, it is flagged as a conflict for a person to
 * resolve. §25 forbids silently discarding either side's changes, and this is
 * where that promise is kept or broken.
 *
 * Recursion guard: inbound sync creates and updates portal rows, and those
 * writes must not bounce straight back out. {@see suspend()} is wrapped around
 * the whole inbound pass.
 */
class Pusher
{
    /** True while inbound sync is applying changes, so pushes are ignored. */
    private static bool $suspended = false;

    /** Run a block with outbound pushes disabled. */
    public static function suspend(callable $work): mixed
    {
        $previous = self::$suspended;
        self::$suspended = true;

        try {
            return $work();
        } finally {
            self::$suspended = $previous;
        }
    }

    public static function isSuspended(): bool
    {
        return self::$suspended;
    }

    /**
     * The connection covering a folder, if any, found by walking up to a
     * mapped ancestor. A file outside every linked library simply isn't synced.
     */
    public static function connectionFor(?Folder $folder): ?SharePointConnection
    {
        $seen = [];
        $node = $folder;

        while ($node !== null && ! isset($seen[$node->id])) {
            $seen[$node->id] = true;

            $connection = SharePointConnection::where('folder_id', $node->id)->first();
            if ($connection) {
                return $connection->pushesBack() ? $connection : null;
            }

            $node = $node->parent;
        }

        return null;
    }

    /**
     * The connection for a file: a folder-linked library when any ancestor is
     * connected, otherwise the personal root drive, the null-folder OneDrive
     * connection that mirrors the top level of a person's own library.
     */
    public static function connectionForFile(FileItem $file): ?SharePointConnection
    {
        return self::connectionFor($file->folder) ?? self::personalRootConnection($file);
    }

    /**
     * The owner's whole-drive OneDrive link, but only when the file really
     * lives in a personal tree: every ancestor must be an ordinary user
     * folder with one consistent owner. A client, organisation or staff
     * folder must never leak into somebody's personal drive.
     */
    private static function personalRootConnection(FileItem $file): ?SharePointConnection
    {
        $driveOwner = $file->owner_id;

        $seen = [];
        for ($node = $file->folder; $node !== null && ! isset($seen[$node->id]); $node = $node->parent) {
            $seen[$node->id] = true;

            if ($node->folder_type !== Folder::TYPE_USER || ! $node->owner_id) {
                return null;
            }

            // The tree's owner decides whose drive this is, a file someone
            // else drops into my shared folder still mirrors to MY OneDrive.
            $driveOwner = $node->owner_id;
        }

        if (! $driveOwner) {
            return null;
        }

        $connection = SharePointConnection::whereNull('folder_id')
            ->where('drive_kind', 'onedrive')
            ->where('created_by', $driveOwner)
            ->first();

        return ($connection && $connection->pushesBack()) ? $connection : null;
    }

    /** The Graph folder id a portal folder corresponds to. */
    private static function graphParentFor(SharePointConnection $connection, ?Folder $folder): ?string
    {
        if (! $folder || $folder->id === $connection->folder_id) {
            // A scoped connection starts at root_item_id, not the drive root —
            // pushing to the drive root would scatter a connected subfolder's
            // files across the whole drive.
            return $connection->root_item_id
                ?: (Drive::root($connection->drive_id)['id'] ?? null);
        }

        $mapping = SharePointItem::where('connection_id', $connection->id)
            ->where('folder_id', $folder->id)->first();

        if ($mapping) {
            return $mapping->graph_item_id;
        }

        // Not mapped yet: create it in SharePoint so the portal's structure is
        // reproduced rather than flattened into the root.
        $parentGraphId = self::graphParentFor($connection, $folder->parent);
        if (! $parentGraphId) {
            return null;
        }

        $created = Drive::createFolder($connection->drive_id, $parentGraphId, $folder->name);

        SharePointItem::create([
            'connection_id' => $connection->id,
            'graph_item_id' => $created['id'],
            'graph_parent_id' => $parentGraphId,
            'item_type' => 'folder',
            'folder_id' => $folder->id,
            'etag' => $created['eTag'] ?? null,
            'name' => $created['name'] ?? $folder->name,
            'web_url' => $created['webUrl'] ?? null,
            'sync_status' => SharePointItem::SYNCED,
            'last_synced_at' => now(),
        ]);

        return $created['id'];
    }

    /**
     * Upload a portal file, or push a new version of one already there.
     *
     * @return array{status:string, reason?:string}
     */
    public static function pushFile(FileItem $file): array
    {
        if (self::$suspended) {
            return ['status' => 'skipped'];
        }

        $connection = self::connectionForFile($file);
        if (! $connection) {
            return ['status' => 'not-linked'];
        }

        $mapping = SharePointItem::where('connection_id', $connection->id)
            ->where('file_id', $file->id)->first();

        try {
            if ($mapping) {
                $conflict = self::detectConflict($connection, $mapping, $file);
                if ($conflict) {
                    return $conflict;
                }
            }

            $parentGraphId = self::graphParentFor($connection, $file->folder);
            if (! $parentGraphId) {
                return ['status' => 'no-parent'];
            }

            /*
             * A file imported by reference has no local bytes, and does not
             * need any. SharePoint already holds the content; that is where we
             * got the file from. Pushing it back would mean downloading the
             * bytes purely to upload the identical bytes to where they came
             * from, and before this check that download failed and marked a
             * perfectly healthy file as a push failure.
             */
            if (RemoteContent::isPending($file)) {
                return ['status' => 'content-remote'];
            }

            // Vault::localCopy handles the case where durable bytes live on
            // object storage rather than the local disk.
            $local = Vault::localCopy($file);
            if (! $local) {
                throw new GraphException('The file could not be read for upload.');
            }

            try {
                $result = Drive::upload($connection->drive_id, $parentGraphId, $file->name, $local);
            } finally {
                Vault::cleanupLocalCopy($local);
            }

            self::recordMapping($connection, $mapping, $file, $result, $parentGraphId);
            Synchroniser::log($connection, 'pushed', 'info', $result['id'] ?? null, $file->name);

            return ['status' => 'pushed'];
        } catch (GraphThrottledException $e) {
            return ['status' => 'throttled', 'retryAfter' => $e->retryAfter];
        } catch (\Throwable $e) {
            self::markFailure($mapping, $e->getMessage());
            Synchroniser::log($connection, 'push-failed', 'error', $mapping?->graph_item_id, $e->getMessage());
            Log::error('SharePoint push failed', ['file' => $file->uuid, 'error' => $e->getMessage()]);

            return ['status' => 'failed', 'reason' => $e->getMessage()];
        }
    }

    /**
     * Has SharePoint changed this item since we last saw it?
     *
     * cTag tracks content. If it has moved and the file did NOT originate in
     * the portal, overwriting would destroy somebody's edit, so the item is
     * flagged and left alone. For a portal-originated file the firm's rule says
     * the portal wins, so the push proceeds.
     */
    private static function detectConflict(SharePointConnection $connection, SharePointItem $mapping, FileItem $file): ?array
    {
        try {
            $remote = Drive::item($connection->drive_id, $mapping->graph_item_id);
        } catch (GraphException $e) {
            // Gone from SharePoint: re-uploading recreates it, which is the
            // kinder outcome than treating it as a conflict.
            return null;
        }

        $remoteCtag = $remote['cTag'] ?? null;

        if ($remoteCtag === null || $remoteCtag === $mapping->ctag) {
            return null;   // unchanged since our last sync
        }

        if ($file->origin === 'portal') {
            // Portal wins for what the portal authored, the firm's decision.
            Synchroniser::log($connection, 'conflict-overridden', 'warning', $mapping->graph_item_id,
                'SharePoint had newer content; portal-originated file took precedence.');

            return null;
        }

        $mapping->update([
            'sync_status' => SharePointItem::CONFLICT,
            'conflict_reason' => 'Changed in SharePoint and in the portal since the last sync. '.
                'This file originated in SharePoint, so the portal did not overwrite it.',
        ]);

        Synchroniser::log($connection, 'conflict', 'warning', $mapping->graph_item_id, $file->name);

        return ['status' => 'conflict', 'reason' => $mapping->conflict_reason];
    }

    private static function recordMapping(
        SharePointConnection $connection,
        ?SharePointItem $mapping,
        FileItem $file,
        array $result,
        string $parentGraphId,
    ): void {
        $attributes = [
            'connection_id' => $connection->id,
            'graph_item_id' => $result['id'] ?? $mapping?->graph_item_id,
            'graph_parent_id' => $parentGraphId,
            'item_type' => 'file',
            'file_id' => $file->id,
            'etag' => $result['eTag'] ?? null,
            'ctag' => $result['cTag'] ?? null,
            'web_url' => $result['webUrl'] ?? null,
            'name' => $result['name'] ?? $file->name,
            'size' => $result['size'] ?? $file->size,
            'mime_type' => $file->mime_type,
            'graph_modified_at' => isset($result['lastModifiedDateTime'])
                ? \Illuminate\Support\Carbon::parse($result['lastModifiedDateTime']) : now(),
            'sync_status' => SharePointItem::SYNCED,
            'conflict_reason' => null,
            'last_error' => null,
            'failure_count' => 0,
            'last_synced_at' => now(),
            // Pushing an item up is the end of its time in the bin, a restore
            // in the portal comes through here.
            'recycled_at' => null,
        ];

        $mapping ? $mapping->update($attributes) : SharePointItem::create($attributes);
    }

    public static function pushRename(FileItem $file): array
    {
        return self::withMapping($file, function (SharePointConnection $c, SharePointItem $m) use ($file) {
            $result = Drive::rename($c->drive_id, $m->graph_item_id, $file->name);
            $m->update(['name' => $file->name, 'etag' => $result['eTag'] ?? $m->etag, 'last_synced_at' => now()]);

            return ['status' => 'renamed'];
        });
    }

    public static function pushMove(FileItem $file): array
    {
        return self::withMapping($file, function (SharePointConnection $c, SharePointItem $m) use ($file) {
            $parentGraphId = self::graphParentFor($c, $file->folder);
            if (! $parentGraphId) {
                return ['status' => 'no-parent'];
            }

            Drive::move($c->drive_id, $m->graph_item_id, $parentGraphId);
            $m->update(['graph_parent_id' => $parentGraphId, 'last_synced_at' => now()]);

            return ['status' => 'moved'];
        });
    }

    /**
     * Delete in SharePoint. Graph's DELETE sends the item to SharePoint's own
     * recycle bin, so this is recoverable on both sides, deleting in the
     * portal never destroys the firm's only copy.
     */
    public static function pushDelete(FileItem $file): array
    {
        return self::withMapping($file, function (SharePointConnection $c, SharePointItem $m) {
            Drive::delete($c->drive_id, $m->graph_item_id);
            // Flagged, not destroyed: the mapping is what lets the inbound pass
            // recognise this item if it is restored on either side, instead of
            // importing it back as a second copy.
            $m->update(['recycled_at' => now()]);

            return ['status' => 'deleted'];
        });
    }

    private static function withMapping(FileItem $file, callable $work): array
    {
        if (self::$suspended) {
            return ['status' => 'skipped'];
        }

        $connection = self::connectionForFile($file) ?? self::connectionForMapping($file);
        if (! $connection) {
            return ['status' => 'not-linked'];
        }

        $mapping = SharePointItem::where('connection_id', $connection->id)
            ->where('file_id', $file->id)->first();

        if (! $mapping) {
            return ['status' => 'not-mapped'];
        }

        try {
            return $work($connection, $mapping);
        } catch (GraphThrottledException $e) {
            return ['status' => 'throttled', 'retryAfter' => $e->retryAfter];
        } catch (\Throwable $e) {
            self::markFailure($mapping, $e->getMessage());
            Synchroniser::log($connection, 'push-failed', 'error', $mapping->graph_item_id, $e->getMessage());

            return ['status' => 'failed', 'reason' => $e->getMessage()];
        }
    }

    /** A moved/deleted file may no longer sit under its connection's folder. */
    private static function connectionForMapping(FileItem $file): ?SharePointConnection
    {
        $mapping = SharePointItem::where('file_id', $file->id)->first();

        return $mapping?->connection?->pushesBack() ? $mapping->connection : null;
    }

    private static function markFailure(?SharePointItem $mapping, string $error): void
    {
        $mapping?->update([
            'sync_status' => SharePointItem::FAILED,
            'last_error' => Str::limit($error, 500),
            'failure_count' => $mapping->failure_count + 1,
        ]);
    }
}
