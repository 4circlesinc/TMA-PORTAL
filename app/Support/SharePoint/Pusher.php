<?php

namespace App\Support\SharePoint;

use App\Jobs\PushFileToSharePoint;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\SharePointItem;
use App\Support\Files\Vault;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Pushes portal changes back into SharePoint.
 *
 * The conflict rule is the firm's own decision, and it is applied here:
 * **portal wins for portal-originated files.** A file the portal authored is
 * pushed even if SharePoint has moved on; a file SharePoint authored is never
 * overwritten behind its back, it is flagged as a conflict for a person to
 * resolve. Section 25 forbids silently discarding either side's changes, and this is
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
            if ($connection?->pushesBack()) {
                return $connection;
            }

            /*
             * CIP trees live under Citizenship Applications, whose site
             * library is switched off. The same folders are already mapped
             * on the portal OneDrive. A disabled ancestor must not hide
             * that live mapping or the photos never leave the portal.
             */
            $mapped = SharePointItem::query()
                ->where('folder_id', $node->id)
                ->with('connection')
                ->orderBy('id')
                ->get()
                ->first(fn (SharePointItem $item) => $item->connection?->pushesBack());
            if ($mapped?->connection) {
                return $mapped->connection;
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

        /*
         * A SharePoint folder of this name may already be here: the same
         * drawer provisioned twice, or one whose portal folder was binned.
         * Reusing it stops a second, numbered copy. But a namesake that
         * belongs to a DIFFERENT live portal folder is somebody else's
         * folder: a client moved to another provider leaves its old copy
         * behind under this name, and sharing it put two clients' documents
         * in one folder, where same-named files overwrote each other.
         */
        $named = SharePointItem::query()
            ->where('connection_id', $connection->id)
            ->where('graph_parent_id', $parentGraphId)
            ->where('item_type', 'folder')
            ->where('name', $folder->name)
            ->orderBy('id')
            ->get()
            ->first(fn (SharePointItem $item) => self::mayShareFolder($item, $folder));
        if ($named) {
            if ($named->folder_id === null || self::folderGone($named->folder_id)) {
                $named->update(['folder_id' => $folder->id]);
            }

            return $named->graph_item_id;
        }

        $created = Drive::createFolder($connection->drive_id, $parentGraphId, $folder->name);

        $mapped = SharePointItem::query()->firstOrCreate(
            [
                'connection_id' => $connection->id,
                'graph_item_id' => $created['id'],
            ],
            [
                'graph_parent_id' => $parentGraphId,
                'item_type' => 'folder',
                'folder_id' => $folder->id,
                'etag' => $created['eTag'] ?? null,
                'name' => $created['name'] ?? $folder->name,
                'web_url' => $created['webUrl'] ?? null,
                'sync_status' => SharePointItem::SYNCED,
                'last_synced_at' => now(),
            ],
        );

        if ($mapped->folder_id === null) {
            $mapped->update(['folder_id' => $folder->id]);
        }

        return $mapped->graph_item_id;
    }

    /**
     * May this portal folder use an existing SharePoint folder mapped to
     * another row? Yes when nothing live owns it, or when the owner is the
     * same drawer twice under the same portal parent (provisioning folds
     * those twins). Not when the owner is a different folder elsewhere.
     */
    private static function mayShareFolder(SharePointItem $item, Folder $folder): bool
    {
        if ($item->folder_id === null || (int) $item->folder_id === (int) $folder->id) {
            return true;
        }

        $owner = Folder::withTrashed()->find($item->folder_id);

        return $owner === null
            || $owner->trashed()
            || (int) $owner->parent_id === (int) $folder->parent_id;
    }

    private static function folderGone(int $folderId): bool
    {
        $folder = Folder::withTrashed()->find($folderId);

        return $folder === null || $folder->trashed();
    }

    /**
     * Is this portal folder somewhere the connection already reaches: the
     * connection's own folder, or under a folder it has mapped? Only then
     * can a move be mirrored; anything else would be resolved against the
     * drive root and scatter the folder there.
     */
    private static function anchoredIn(SharePointConnection $connection, ?Folder $folder): bool
    {
        $seen = [];

        for ($node = $folder; $node !== null && ! isset($seen[$node->id]); $node = $node->parent) {
            $seen[$node->id] = true;

            if ($connection->folder_id !== null && (int) $node->id === (int) $connection->folder_id) {
                return true;
            }

            $mapped = SharePointItem::query()
                ->where('connection_id', $connection->id)
                ->where('folder_id', $node->id)
                ->where('item_type', 'folder')
                ->exists();
            if ($mapped) {
                return true;
            }
        }

        return false;
    }

    /**
     * Where a mapped folder's SharePoint copy must move to, or null when it
     * is already in place (or the portal parent cannot be placed safely).
     *
     * "In place" means under ANY of the parent's mapped copies: a drawer
     * that SharePoint holds twice is not a reason to shuffle its children
     * from one copy to the other.
     */
    private static function moveTarget(SharePointConnection $connection, Folder $folder, SharePointItem $mapping): ?string
    {
        if ($connection->folder_id !== null && (int) $folder->id === (int) $connection->folder_id) {
            return null;
        }

        $parent = $folder->parent;
        if ($parent === null || ! self::anchoredIn($connection, $parent)) {
            return null;
        }

        $placed = SharePointItem::query()
            ->where('connection_id', $connection->id)
            ->where('folder_id', $parent->id)
            ->where('item_type', 'folder')
            ->pluck('graph_item_id')
            ->all();
        if ($mapping->graph_parent_id !== null && in_array($mapping->graph_parent_id, $placed, true)) {
            return null;
        }

        $target = self::graphParentFor($connection, $parent);
        if (! $target || $target === $mapping->graph_parent_id || $target === $mapping->graph_item_id) {
            return null;
        }

        return $target;
    }

    /**
     * Materialise a portal folder in SharePoint without waiting for its
     * first file. Client folders are provisioned empty, and someone working
     * from SharePoint or OneDrive should see the folder the moment the
     * portal makes it — not whenever a first document happens to land.
     * Idempotent: a folder already mapped is simply confirmed.
     *
     * @return array{status:string}
     */
    public static function pushFolder(Folder $folder, ?SharePointItem $copy = null): array
    {
        if (self::$suspended) {
            return ['status' => 'skipped'];
        }

        $connection = self::connectionFor($folder);
        if (! $connection) {
            return ['status' => 'not-linked'];
        }

        /*
         * A folder SharePoint holds twice ("Name" and "Name 1") has two
         * mappings. The caller may name the copy to place; only the first
         * is ever renamed, since renaming the twin onto the same name can
         * only collide.
         */
        $primary = SharePointItem::query()
            ->where('connection_id', $connection->id)
            ->where('folder_id', $folder->id)
            ->where('item_type', 'folder')
            ->orderBy('id')
            ->first();

        if ($copy && $primary
            && (int) $copy->connection_id === (int) $connection->id
            && (int) $copy->folder_id === (int) $folder->id) {
            return self::reconcileFolder($connection, $copy, $folder, $copy->id === $primary->id);
        }

        /*
         * A folder SharePoint already has is renamed there, not created again.
         *
         * The portal names a new filing "Application IGA26-00005" and later
         * renames that folder to the applicant. Creating a second folder for
         * the new name left SharePoint on the old one, and Graph's conflict
         * rule then stored the next copy as "Application IGA26-00005 1".
         */
        if ($primary) {
            return self::reconcileFolder($connection, $primary, $folder, true);
        }

        return self::graphParentFor($connection, $folder)
            ? ['status' => 'ok']
            : ['status' => 'no-parent'];
    }

    /**
     * Bring a folder SharePoint already holds to the portal's name AND place.
     *
     * Only the name used to be pushed. Moving a client to another service
     * provider moved the portal folder but left the SharePoint copy under
     * the old provider, and every later upload followed the stale mapping
     * there. The inbound pass then read SharePoint's placement back and
     * could put the portal folder under the old provider too.
     *
     * @return array{status:string, reason?:string, retryAfter?:int}
     */
    private static function reconcileFolder(SharePointConnection $connection, SharePointItem $mapping, Folder $folder, bool $mayRename): array
    {
        try {
            $renamed = $mayRename && strcasecmp((string) $mapping->name, $folder->name) !== 0;
            $target = self::moveTarget($connection, $folder, $mapping);

            if ($target === null && ! $renamed) {
                return ['status' => 'ok'];
            }

            $result = $target !== null
                ? Drive::move($connection->drive_id, $mapping->graph_item_id, $target, $renamed ? $folder->name : null)
                : Drive::rename($connection->drive_id, $mapping->graph_item_id, $folder->name);

            $mapping->update([
                'name' => $result['name'] ?? $folder->name,
                'graph_parent_id' => $result['parentReference']['id'] ?? $target ?? $mapping->graph_parent_id,
                'etag' => $result['eTag'] ?? $mapping->etag,
                'sync_status' => SharePointItem::SYNCED,
                'last_error' => null,
                'failure_count' => 0,
                'last_synced_at' => now(),
            ]);

            if ($target !== null) {
                Synchroniser::log($connection, 'folder-moved', 'info', $mapping->graph_item_id, $folder->name);

                return ['status' => 'moved'];
            }

            return ['status' => 'renamed'];
        } catch (GraphThrottledException $e) {
            return ['status' => 'throttled', 'retryAfter' => $e->retryAfter];
        } catch (\Throwable $e) {
            self::markFailure($mapping, $e->getMessage());
            Synchroniser::log($connection, 'push-failed', 'error', $mapping->graph_item_id, $e->getMessage());

            return ['status' => 'failed', 'reason' => $e->getMessage()];
        }
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
            /*
             * The item this file already is in SharePoint, if it is still
             * there. Only Graph's own 404 says it is gone; a throttle or a
             * network blip fails the push to be retried, rather than being
             * read as "gone" and answered with a second copy.
             */
            $remote = $mapping ? Drive::find($connection->drive_id, $mapping->graph_item_id) : null;

            if ($remote !== null) {
                $conflict = self::detectConflict($connection, $mapping, $file, $remote);
                if ($conflict) {
                    return $conflict;
                }
            }

            // A file SharePoint holds is updated where it sits; a move is
            // pushMove's business. Only a new file is placed by folder.
            $parentGraphId = $remote !== null
                ? ($remote['parentReference']['id'] ?? $mapping->graph_parent_id)
                : self::graphParentFor($connection, $file->folder);
            if ($remote === null && ! $parentGraphId) {
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
                $result = $remote !== null
                    ? Drive::uploadToItem($connection->drive_id, $mapping->graph_item_id, $local)
                    : Drive::upload(
                        $connection->drive_id,
                        $parentGraphId,
                        $file->name,
                        $local,
                        self::nameHeldByAnother($connection, $parentGraphId, $file) ? 'rename' : 'replace',
                    );
            } finally {
                Vault::cleanupLocalCopy($local);
            }

            self::recordMapping($connection, $mapping, $file, $result, $result['parentReference']['id'] ?? $parentGraphId);
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
    private static function detectConflict(SharePointConnection $connection, SharePointItem $mapping, FileItem $file, array $remote): ?array
    {
        $remoteCtag = $remote['cTag'] ?? null;

        if ($remoteCtag === null || $remoteCtag === $mapping->ctag) {
            return null;   // unchanged since our last sync
        }

        /*
         * Not every moved cTag is somebody's edit. A push that died on a
         * gateway timeout can still have landed — SharePoint's "newer"
         * content is then OUR OWN bytes, and flagging that as a conflict
         * told the owner their file had diverged when nothing had (seen
         * live: a 504 stamped 01:45:40 against a remote modified 01:45:39
         * by this very app). Identical bytes are an acknowledgement, not a
         * conflict: adopt SharePoint's cursor and upload nothing.
         */
        $remoteHash = $remote['file']['hashes']['quickXorHash'] ?? null;
        if ($remoteHash !== null
            && (int) ($remote['size'] ?? -1) === (int) $file->size
            && self::contentMatches($file, $remoteHash)) {
            $mapping->update([
                'sync_status' => SharePointItem::SYNCED,
                'etag' => $remote['eTag'] ?? $mapping->etag,
                'ctag' => $remoteCtag,
                'conflict_reason' => null,
                'last_error' => null,
                'failure_count' => 0,
                'last_synced_at' => now(),
            ]);
            Synchroniser::log($connection, 'push-acknowledged', 'info', $mapping->graph_item_id,
                'SharePoint already holds these exact bytes; adopted its cursor.');

            return ['status' => 'unchanged'];
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

    /**
     * Do our stored bytes hash to what Graph says SharePoint holds?
     * QuickXorHash, streamed, so size never matters to worker memory.
     */
    private static function contentMatches(FileItem $file, string $remoteHash): bool
    {
        $local = Vault::localCopy($file);
        if (! $local) {
            return false;
        }

        try {
            $stream = @fopen($local, 'rb');
            if (! $stream) {
                return false;
            }

            try {
                $hash = QuickXorHash::ofStream($stream);
            } finally {
                fclose($stream);
            }

            return $hash !== null && hash_equals($remoteHash, $hash);
        } catch (\Throwable) {
            return false;
        } finally {
            Vault::cleanupLocalCopy($local);
        }
    }

    /**
     * Does another live portal file already hold this name in that
     * SharePoint folder? Then a new upload must not use `replace`: that
     * wrote this document's bytes over the other one and, in recordMapping,
     * took its mapping too, which is how two clients' same-named scans
     * swapped places.
     */
    private static function nameHeldByAnother(SharePointConnection $connection, string $parentGraphId, FileItem $file): bool
    {
        return SharePointItem::query()
            ->where('connection_id', $connection->id)
            ->where('graph_parent_id', $parentGraphId)
            ->where('item_type', 'file')
            ->whereNull('recycled_at')
            ->whereNotNull('file_id')
            ->where('file_id', '!=', $file->id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($file->name)])
            ->whereHas('file')
            ->exists();
    }

    private static function recordMapping(
        SharePointConnection $connection,
        ?SharePointItem $mapping,
        FileItem $file,
        array $result,
        ?string $parentGraphId,
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
                ? Carbon::parse($result['lastModifiedDateTime']) : now(),
            'sync_status' => SharePointItem::SYNCED,
            'conflict_reason' => null,
            'last_error' => null,
            'failure_count' => 0,
            'last_synced_at' => now(),
            // Pushing an item up is the end of its time in the bin, a restore
            // in the portal comes through here.
            'recycled_at' => null,
        ];

        /*
         * `(connection_id, graph_item_id)` is the table's unique key, and the
         * row we were handed was found by `file_id`, which is NOT unique. One
         * portal file can hold two mappings — the same document uploaded to
         * SharePoint twice, so two driveItems point back at one local file.
         *
         * When that happens the upload returns the OTHER row's graph id, and
         * stamping it onto this row violates the unique index. The throw
         * escaped mid-push and, because markFailure() then tried the same
         * doomed update, it escaped from the error handler too: the job died
         * before it could record a failure, and every later push in that run
         * went with it.
         *
         * So the graph id decides which row is written. If another row already
         * holds it, that row IS this item's mapping; the row we arrived with
         * is the stale duplicate and is dropped rather than left to collide
         * again on the next pass.
         */
        $graphItemId = $attributes['graph_item_id'];

        $owner = $graphItemId
            ? SharePointItem::where('connection_id', $connection->id)
                ->where('graph_item_id', $graphItemId)
                ->first()
            : null;

        /*
         * The row that owns the id may belong to a DIFFERENT live file: the
         * upload replaced that document's bytes (a namesake our table did
         * not know about). SharePoint now holds this file there, so the row
         * is this file's; the displaced file is pushed again so it comes
         * back beside it under its own name instead of vanishing.
         */
        $displaced = ($owner && $owner->file_id && (int) $owner->file_id !== (int) $file->id)
            ? (int) $owner->file_id
            : null;

        if ($owner && $mapping && $owner->id !== $mapping->id) {
            $mapping->delete();
            $mapping = $owner;
        } elseif ($owner && ! $mapping) {
            $mapping = $owner;
        }

        $mapping ? $mapping->update($attributes) : SharePointItem::create($attributes);

        if ($displaced !== null && FileItem::query()->whereKey($displaced)->exists()) {
            Synchroniser::log($connection, 'push-displaced', 'warning', $graphItemId,
                'Upload landed on an item mapped to another file; re-pushing file '.$displaced.'.');
            PushFileToSharePoint::dispatch($displaced, 'content');
        }
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
            /*
             * Moved out of this library altogether. Resolving the new folder
             * against this connection walks past its top and answers the
             * drive root, so the document was dumped there. Leave the
             * SharePoint copy where it was; a library that does cover the new
             * folder gets the file through an ordinary push.
             */
            $topOfPersonalDrive = $file->folder === null && $c->folder_id === null;
            if (! $topOfPersonalDrive && ! self::anchoredIn($c, $file->folder)) {
                $elsewhere = self::connectionForFile($file);

                return ($elsewhere && $elsewhere->id !== $c->id)
                    ? self::pushFile($file)
                    : ['status' => 'outside-library'];
            }

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

        $mapping = SharePointItem::query()
            ->where('file_id', $file->id)
            ->orderBy('id')
            ->first();
        $connection = $mapping?->connection
            ?? self::connectionForFile($file)
            ?? self::connectionForMapping($file);
        if (! $connection) {
            return ['status' => 'not-linked'];
        }

        if (! $mapping) {
            return self::pushFile($file);
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

    /**
     * Record that this item's push failed.
     *
     * This runs inside a `catch`, which makes it the last place that may
     * throw: an exception here replaces the real error with its own and
     * takes down the job that was in the middle of handling it. That is how
     * a single unmappable file stopped a whole library's push — the write
     * below hit the unique index, and the failure it was trying to record
     * was never written, so the item came back and failed the same way on
     * every later run.
     *
     * Writing only the failure columns cannot collide (the unique key is not
     * among them), but the row may also be gone by now, so the write is
     * guarded and the original error is preserved for the caller to report.
     */
    private static function markFailure(?SharePointItem $mapping, string $error): void
    {
        if (! $mapping) {
            return;
        }

        try {
            $mapping->forceFill([
                'sync_status' => SharePointItem::FAILED,
                'last_error' => Str::limit($error, 500),
                'failure_count' => $mapping->failure_count + 1,
            ])->saveQuietly();
        } catch (\Throwable $e) {
            Log::warning('Could not record a SharePoint push failure', [
                'mapping' => $mapping->id,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
