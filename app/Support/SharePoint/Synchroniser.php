<?php

namespace App\Support\SharePoint;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\SharePointItem;
use App\Models\User;
use App\Support\Files\Activity;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\FolderTree;
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

    /** How long a run may hold the lock before another may take over. */
    public const LOCK_MINUTES = 30;

    /** Rows read at a time where a whole table would not fit in memory. */
    private const CHUNK = 500;

    /**
     * The mappings for the page being processed, keyed by Graph item id.
     *
     * A SELECT per item is not affordable — every item costs a lookup for
     * itself and one for its parent, and against a database in another region,
     * where a round-trip is ~380ms rather than ~0.4ms, that alone is over an
     * hour for a few thousand items. So they are fetched in bulk.
     *
     * But in bulk PER PAGE, not per connection. Loading every mapping a
     * connection has took 370 MB on the firm's largest library — 85,404
     * mappings — which is more than the whole instance has, so the process was
     * killed before it could log anything. Three days of "Syncing 85,404 of
     * 85,404" was that: a run dying on the first breath, the lock going stale
     * half an hour later, and the next run dying in exactly the same place.
     *
     * A page is 200 items, so this is one query for at most a few hundred rows
     * and the cost stops growing with the library.
     *
     * @var array<string, SharePointItem|null>
     */
    private static array $mappings = [];

    /**
     * Fetch the mappings this page will ask for, in one query.
     *
     * Parents included: every item asks where its parent went, and a parent
     * that arrived on an earlier page would otherwise be a lookup of its own.
     *
     * @param  array<int, array>  $items
     */
    private static function primeMappings(SharePointConnection $connection, array $items): void
    {
        self::$mappings = [];
        $wanted = [];

        foreach ($items as $item) {
            if (! empty($item['id'])) {
                $wanted[$item['id']] = true;
            }
            if (! empty($item['parentReference']['id'])) {
                $wanted[$item['parentReference']['id']] = true;
            }
        }

        if ($wanted === []) {
            return;
        }

        self::$mappings = SharePointItem::where('connection_id', $connection->id)
            ->whereIn('graph_item_id', array_keys($wanted))
            ->get()->keyBy('graph_item_id')->all();
    }

    private static function mappingFor(SharePointConnection $connection, string $graphId): ?SharePointItem
    {
        // A miss is cached as null: the answer "there is no mapping" is worth
        // remembering too, or an unmapped parent is re-queried for every one
        // of its children on the page.
        if (array_key_exists($graphId, self::$mappings)) {
            return self::$mappings[$graphId];
        }

        return self::$mappings[$graphId] = SharePointItem::where('connection_id', $connection->id)
            ->where('graph_item_id', $graphId)->first();
    }

    private static function rememberMapping(SharePointItem $mapping): void
    {
        self::$mappings[$mapping->graph_item_id] = $mapping;
    }

    public static function sync(SharePointConnection $connection): array
    {
        if (! $connection->sync_enabled) {
            return ['skipped' => true];
        }

        // Fresh per run — a long-lived worker syncs many connections.
        self::$mappings = [];

        /*
         * One run at a time per connection.
         *
         * Two concurrent runs share a delta cursor, so they process the same
         * pages twice and race each other's writes — observed for real when a
         * manual run overlapped the scheduled one.
         *
         * The lock is the status column plus a staleness window rather than a
         * cache lock, because the failure that matters is a run that DIED
         * mid-sync: that leaves `syncing` set for ever and would block the
         * connection permanently. After the window, a new run takes over.
         */
        if ($connection->status === SharePointConnection::STATUS_SYNCING) {
            $startedAt = $connection->last_synced_at;

            if ($startedAt && $startedAt->gt(now()->subMinutes(self::LOCK_MINUTES))) {
                return ['skipped' => true, 'reason' => 'already running'];
            }

            self::log($connection, 'lock-recovered', 'warning', null,
                'A previous run did not finish; taking over.');
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

                // One query for this page's mappings, then none per item.
                self::primeMappings($connection, $batch['items']);

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

                // Remember where we got to, so a run that hits the page cap
                // resumes from there instead of starting over.
                $connection->update(['delta_link' => $link]);
            }

            self::reconcileDeletions($connection, $changedFolders, $stats);
            });

            /*
             * A pass only counts as SUCCESS if it ended holding a delta cursor.
             *
             * Without this the walk could stop early — page cap reached, or the
             * process killed — and still stamp last_success_at while leaving
             * delta_link null. That reads as "synced" in the UI, and because
             * there is no cursor the next run restarts from item one. The
             * library never converges and nothing looks wrong. Observed on
             * three real connections stuck at ~205 items for a day.
             */
            $complete = $connection->fresh()->delta_link !== null;

            $connection->update([
                'status' => SharePointConnection::STATUS_IDLE,
                'last_success_at' => $complete ? now() : $connection->last_success_at,
                'last_error' => $complete ? null : 'Import did not finish — more pages remain.',
                'error_count' => $complete ? 0 : $connection->error_count,
            ]);

            $stats['complete'] = $complete;

            self::log($connection, $complete ? 'sync-complete' : 'sync-incomplete',
                $complete ? 'info' : 'warning', null, json_encode($stats));
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
     * Settle what is really still in SharePoint, folder by folder.
     *
     * **This exists because delta does not reliably emit tombstones.** Verified
     * against a real library on 2026-08-01: deleting a file produced no
     * `deleted` facet even after twenty seconds — the item simply stopped
     * appearing. Trusting tombstones would have meant deletions silently never
     * propagating, which is the worst kind of sync bug because nothing looks
     * wrong until someone notices a file that should be gone.
     *
     * So absence from a listing is the *hint* that something went — never the
     * verdict. Absence has three other explanations, and all three were seen on
     * real drives: a truncated listing (see {@see Drive::childIds()}), an item
     * that moved elsewhere, and a listing that failed halfway. Acting on the
     * hint alone put 626 files nobody had touched into the recycle bin. So
     * every candidate is checked directly against Graph, and only Graph's own
     * "this item is gone" recycles anything.
     *
     * The same listing answers the opposite question for free: an item that is
     * back in the folder while the portal still has it in the bin was restored
     * from OneDrive's recycle bin, and belongs back in the library here too.
     *
     * Only the folders delta reported as changed are examined — a delete or a
     * restore always modifies the parent. The library is never re-walked
     * wholesale, which §1 forbids.
     */
    private static function reconcileDeletions(SharePointConnection $connection, array $folderGraphIds, array &$stats): void
    {
        foreach (array_unique($folderGraphIds) as $graphFolderId) {
            try {
                $present = array_flip(Drive::childIds($connection->drive_id, $graphFolderId));

                // Chunked: a folder can hold tens of thousands of items, and
                // the whole point of this pass is that it runs on libraries
                // too big to hold in memory.
                SharePointItem::where('connection_id', $connection->id)
                    ->where('graph_parent_id', $graphFolderId)
                    ->chunkById(self::CHUNK, function ($mappings) use ($connection, $present, &$stats) {
                        foreach ($mappings as $mapping) {
                            self::settle($connection, $mapping, $present, $stats);
                        }
                    });
            } catch (GraphThrottledException $e) {
                // Graph asked us to back off. Stopping the whole run is right:
                // continuing would mean reading half-listings as deletions.
                throw $e;
            } catch (\Throwable $e) {
                // A folder we cannot list is not a reason to fail the sync —
                // but it is emphatically not a reason to delete anything under
                // it either, so nothing in this folder is touched.
                self::log($connection, 'reconcile-failed', 'warning', $graphFolderId, $e->getMessage());
            }
        }
    }

    /**
     * One mapping, against what its folder actually holds now.
     *
     * @param  array<string, int>  $present  the folder's child ids, as a set
     */
    private static function settle(SharePointConnection $connection, SharePointItem $mapping, array $present, array &$stats): void
    {
        if (isset($present[$mapping->graph_item_id])) {
            // Back in the folder while the portal still has it in the bin:
            // somebody restored it from SharePoint's recycle bin.
            if ($mapping->isRecycled()) {
                self::applyRestore($connection, $mapping);
                $stats['restored'] = ($stats['restored'] ?? 0) + 1;
            }

            return;
        }

        // Already in the portal's bin: nothing left to do, and re-deleting
        // would reset the date it was recycled.
        if ($mapping->isRecycled()) {
            return;
        }

        if (! self::confirmRemoved($connection, $mapping)) {
            return;
        }

        self::applyDelete($connection, $mapping);
        $stats['deleted']++;
    }

    /**
     * Did SharePoint really lose this item?
     *
     * Yes only if Graph says so. A delete moves an item into SharePoint's own
     * recycle bin, out of the drive, and Graph then answers 404 for it — so a
     * 404 (or an explicit `deleted` facet) is the evidence, and nothing else
     * is. An item that answers normally is alive: it was missing from its old
     * parent's listing because it MOVED, so the mapping is re-pointed at
     * wherever it now lives instead of being recycled.
     *
     * Any other outcome — a 403, a timeout, a throttle — is uncertainty, and
     * uncertainty must fail towards keeping the file.
     */
    private static function confirmRemoved(SharePointConnection $connection, SharePointItem $mapping): bool
    {
        try {
            $remote = Drive::find($connection->drive_id, $mapping->graph_item_id);
        } catch (GraphThrottledException $e) {
            throw $e;
        } catch (\Throwable $e) {
            self::log($connection, 'delete-unverified', 'warning', $mapping->graph_item_id,
                'Left alone — could not confirm it was deleted: '.$e->getMessage());

            return false;
        }

        if ($remote === null) {
            return true;
        }

        if (isset($remote['deleted'])) {
            return true;
        }

        $parent = $remote['parentReference']['id'] ?? null;
        if ($parent && $parent !== $mapping->graph_parent_id) {
            $mapping->update(['graph_parent_id' => $parent]);
        }

        return false;
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
            // Not content, but it still knows how many items sit at the top
            // level — and those are part of the library total. Without this the
            // total is short by every loose file in the root.
            if (isset($item['folder']['childCount'])) {
                $connection->update(['root_child_count' => $item['folder']['childCount']]);
            }

            return;
        }

        $mapping = self::mappingFor($connection, $graphId);

        if (isset($item['deleted'])) {
            if ($mapping) {
                self::applyDelete($connection, $mapping);
                $stats['deleted']++;
            }

            return;
        }

        $isFolder = isset($item['folder']);

        if ($mapping) {
            /*
             * Back from OneDrive's recycle bin.
             *
             * This has to be tested BEFORE the eTag short-circuit below: a
             * restore does not have to change the item at all, so the eTag can
             * come back exactly as we stored it — and "nothing changed" would
             * leave the file sitting in the portal's bin for ever.
             */
            if ($mapping->isRecycled()) {
                self::applyRestore($connection, $mapping);
                $stats['restored'] = ($stats['restored'] ?? 0) + 1;
            }

            /*
             * eTag covers ANY change — content, name, or move. If it matches
             * what we stored, this item is byte-for-byte what we already have
             * and there is nothing to write.
             *
             * A full re-walk (after a cursor reset, or a first pass that had to
             * resume) replays every item in the library. Without this, each one
             * cost an UPDATE to record that nothing had happened.
             */
            $etag = $item['eTag'] ?? null;
            if ($etag !== null && $etag === $mapping->etag) {
                $stats['unchanged'] = ($stats['unchanged'] ?? 0) + 1;

                return;
            }

            self::applyUpdate($connection, $mapping, $item, $isFolder, $stats);

            return;
        }

        self::applyCreate($connection, $item, $isFolder, $stats);
    }

    /**
     * Who owns what this connection brings in.
     *
     * A personal OneDrive's contents belong to the person whose drive it is,
     * read from `owner_upn`. It used to be `created_by`, which is only the
     * same person when somebody connects their own drive — two of these
     * connections were made by a console command and have no creator at all,
     * so they were writing a null owner.
     *
     * Everything else is a site document library: the firm's own files, owned
     * by the firm's own account rather than by whichever administrator
     * happened to set the sync up. Attributing thirty thousand citizenship
     * documents to one partner is what this is correcting.
     */
    private static function ownerIdFor(SharePointConnection $connection): int
    {
        if ($connection->drive_kind === 'onedrive' && $connection->owner_upn) {
            $driveOwner = User::whereRaw('LOWER(email) = ?', [mb_strtolower($connection->owner_upn)])->value('id');
            if ($driveOwner) {
                return (int) $driveOwner;
            }

            // A drive whose person has no portal account yet: the account that
            // connected it is a better guess than handing it to the firm.
            if ($connection->created_by) {
                return (int) $connection->created_by;
            }
        }

        return FolderProvisioner::systemOwnerId();
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
                'owner_id' => self::ownerIdFor($connection),
                'created_by' => $connection->created_by,
                'origin' => 'sharepoint',
            ]);

            self::rememberMapping(self::mapFolder($connection, $item, $folder));
            $stats['created']++;

            return;
        }

        $file = self::downloadIntoLibrary($connection, $item, $parentFolder, $name);
        self::rememberMapping(self::mapFile($connection, $item, $file));
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
     *
     * The mapping is flagged, not destroyed. Destroying it severed the only
     * link between the Graph item and the portal row now in the bin, so putting
     * the item back in OneDrive imported a second copy and stranded the first.
     */
    private static function applyDelete(SharePointConnection $connection, SharePointItem $mapping): void
    {
        DB::transaction(function () use ($mapping, $connection) {
            if ($file = $mapping->trashedFile()) {
                if (! $file->trashed()) {
                    $file->update(['deleted_by' => $connection->created_by]);
                    $file->delete();
                    Activity::forFile($connection->created_by, $file, 'delete', ['via' => 'sharepoint']);
                }
            }
            if ($folder = $mapping->trashedFolder()) {
                if (! $folder->trashed()) {
                    $folder->update(['deleted_by' => $connection->created_by]);
                    // The whole subtree goes together, or its contents are left
                    // loose in a folder that no longer exists.
                    FolderTree::softDeleteTree($folder, (int) $connection->created_by);
                }
            }

            $mapping->update(['recycled_at' => now()]);
        });

        self::rememberMapping($mapping);

        self::log($connection, 'deleted', 'info', $mapping->graph_item_id, $mapping->name);
    }

    /**
     * Put back what SharePoint put back.
     *
     * Restoring an item from OneDrive's recycle bin restores it here, on the
     * same row — the file keeps its versions, comments, shares and link. That
     * is only possible because the mapping outlived the delete.
     *
     * Public because `sharepoint:recover-recycled` undoes the deletions made
     * before that was true, and must undo them exactly the same way.
     */
    public static function applyRestore(SharePointConnection $connection, SharePointItem $mapping): void
    {
        DB::transaction(function () use ($mapping) {
            if (($file = $mapping->trashedFile()) && $file->trashed()) {
                $file->restore();
                $file->update(['deleted_by' => null]);
            }
            if (($folder = $mapping->trashedFolder()) && $folder->trashed()) {
                FolderTree::restoreTree($folder);
                $folder->update(['deleted_by' => null]);
            }

            $mapping->update(['recycled_at' => null]);
        });

        // A relation loaded while the row was trashed came back null; drop it
        // so the update that follows sees the restored row.
        $mapping->unsetRelation('file')->unsetRelation('folder');
        self::rememberMapping($mapping);

        self::log($connection, 'restored', 'info', $mapping->graph_item_id, $mapping->name);
    }

    /**
     * Record a brand-new portal file WITHOUT moving its bytes.
     *
     * Downloading each file inline is what made a first import take hours: a
     * few thousand items at a couple of megabytes each is gigabytes pulled from
     * Graph and pushed to R2, one at a time, before anything at all showed up
     * in the library. The structure is what people need first, and it arrives
     * in a handful of delta pages.
     *
     * The bytes are fetched the first time someone opens the file, or ahead of
     * time by `sharepoint:warm-content`.
     */
    private static function downloadIntoLibrary(SharePointConnection $connection, array $item, ?Folder $parent, string $name): FileItem
    {
        $ext = pathinfo($name, PATHINFO_EXTENSION) ?: '';

        $file = FileItem::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'folder_id' => $parent?->id,
            'name' => $name,
            'extension' => strtolower($ext),
            'mime_type' => $item['file']['mimeType'] ?? null,
            // Graph's size, so the listing shows a real figure before the
            // bytes arrive. Replaced with the stored size on materialisation.
            'size' => $item['size'] ?? 0,
            'disk' => null,
            'storage_path' => null,
            'checksum' => null,
            'content_state' => RemoteContent::PENDING,
            'owner_id' => self::ownerIdFor($connection),
            'uploaded_by' => $connection->created_by,
            'source_modified_at' => isset($item['lastModifiedDateTime'])
                ? \Illuminate\Support\Carbon::parse($item['lastModifiedDateTime']) : null,
            // Origin drives conflict resolution: the firm chose that
            // SharePoint stays authoritative for the files it authored.
            'origin' => 'sharepoint',
        ]);

        // Version 1 is a placeholder too — RemoteContent fills both in together.
        Versions::recordInitial($file, $connection->created_by, 'Imported from SharePoint')
            ?->update(['content_state' => RemoteContent::PENDING]);
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

        $mapping = self::mappingFor($connection, $parentId);

        return ($mapping && $mapping->folder_id) ? $mapping->folder : $connection->folder;
    }

    /**
     * updateOrCreate, not create.
     *
     * The unique key on (connection, graph_item_id) is the anti-duplicate
     * guarantee, and it did its job — but hitting it should not cost an item.
     * The same id can legitimately reach here twice: an item can appear in two
     * delta pages, and re-scoping a connection replays ids that are already
     * mapped. Writing idempotently makes the second arrival a no-op instead of
     * a constraint violation.
     */
    public static function mapFile(SharePointConnection $connection, array $item, FileItem $file): SharePointItem
    {
        return SharePointItem::updateOrCreate(
            ['connection_id' => $connection->id, 'graph_item_id' => $item['id']],
            self::mappingAttributes($connection, $item) + ['item_type' => 'file', 'file_id' => $file->id],
        );
    }

    public static function mapFolder(SharePointConnection $connection, array $item, Folder $folder): SharePointItem
    {
        return SharePointItem::updateOrCreate(
            ['connection_id' => $connection->id, 'graph_item_id' => $item['id']],
            self::mappingAttributes($connection, $item) + [
                'item_type' => 'folder',
                'folder_id' => $folder->id,
                // Graph offers no recursive total, but every item has exactly
                // one parent — so the sum of these across folders IS the
                // library's size. See the child_count migration.
                'child_count' => $item['folder']['childCount'] ?? null,
            ],
        );
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
            // Written from a live Graph item, so by definition not recycled.
            'recycled_at' => null,
        ];
    }

    private static function touchMapping(SharePointItem $mapping, array $item): void
    {
        $mapping->update([
            'graph_parent_id' => $item['parentReference']['id'] ?? null,
            // Folders grow and shrink; a stale count here would freeze the
            // library total at whatever it was on the day of the first import.
            'child_count' => $item['folder']['childCount'] ?? $mapping->child_count,
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
