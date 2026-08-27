<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use ZipArchive;

/**
 * Folder-tree operations: create / rename / move / copy with a circular-parent
 * guard, recursive aggregation (counts + size), and ZIP export. Multi-record
 * operations run inside DB transactions so a failure never leaves a half-moved
 * or half-copied tree.
 */
class FolderTree
{
    /**
     * How far {@see self::aggregateMany} will descend.
     *
     * A stop condition, not a limit anyone should reach: the deepest tree in
     * the firm's library is eleven levels, and SharePoint itself will not
     * serve a path much past this. Its job is to make a `parent_id` cycle
     * terminate, the recursion has no other reason to stop.
     */
    private const MAX_DEPTH = 64;

    public static function create(User $user, string $name, ?Folder $parent): Folder
    {
        $name = Naming::assertValid($name);
        self::assertUniqueSibling($name, $parent, null);

        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'parent_id' => $parent?->id,
            'owner_id' => $parent?->owner_id ?? $user->id,
            'created_by' => $user->id,
        ]);
    }

    /**
     * Create a folder whose name is auto-numbered to avoid clashing with a
     * sibling: "Untitled folder", "Untitled folder (1)", … Used by the
     * instant "New folder" action.
     */
    public static function createAutoNamed(User $user, string $baseName, ?Folder $parent): Folder
    {
        $baseName = Naming::assertValid($baseName);
        $name = Naming::nextAvailable($baseName, fn ($candidate) => self::siblingExists($candidate, $parent, null));

        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'parent_id' => $parent?->id,
            'owner_id' => $parent?->owner_id ?? $user->id,
            'created_by' => $user->id,
        ]);
    }

    public static function rename(Folder $folder, string $name): Folder
    {
        $name = Naming::assertValid($name);
        self::assertUniqueSibling($name, $folder->parent, $folder->id);

        $folder->update(['name' => $name]);

        return $folder;
    }

    /**
     * Move a folder under a new parent (null = root). Rejects moving a folder
     * into itself or one of its own descendants.
     */
    public static function move(Folder $folder, ?Folder $newParent): Folder
    {
        if ($newParent !== null) {
            if ($newParent->id === $folder->id) {
                throw new FileValidationException('A folder can’t be moved into itself.');
            }
            if (self::isDescendant($folder, $newParent)) {
                throw new FileValidationException('A folder can’t be moved into one of its own subfolders.');
            }
        }

        self::assertUniqueSibling($folder->name, $newParent, $folder->id);

        $folder->update(['parent_id' => $newParent?->id]);

        return $folder;
    }

    /** Recursively copy a folder (and its files' bytes) under a new parent. */
    public static function copy(Folder $folder, ?Folder $newParent, User $user): Folder
    {
        return DB::transaction(function () use ($folder, $newParent, $user) {
            $name = Naming::nextAvailable(
                $folder->name,
                fn ($candidate) => self::siblingExists($candidate, $newParent, null)
            );

            return self::copyInto($folder, $newParent?->id, $user, $name);
        });
    }

    private static function copyInto(Folder $source, ?int $parentId, User $user, ?string $nameOverride = null): Folder
    {
        $copy = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $nameOverride ?? $source->name,
            'parent_id' => $parentId,
            'owner_id' => $user->id,
            'created_by' => $user->id,
        ]);

        foreach ($source->files()->get() as $file) {
            $stored = Vault::duplicate($file);
            FileItem::create([
                'uuid' => $stored['uuid'],
                'folder_id' => $copy->id,
                'name' => $file->name,
                'extension' => $file->extension,
                'mime_type' => $file->mime_type,
                'size' => $file->size,
                'disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'checksum' => $file->checksum,
                'owner_id' => $user->id,
                'uploaded_by' => $user->id,
                'source_modified_at' => $file->source_modified_at,
            ]);
        }

        foreach ($source->children()->get() as $child) {
            self::copyInto($child, $copy->id, $user);
        }

        return $copy;
    }

    /** True when $node sits somewhere beneath $ancestor. */
    public static function isDescendant(Folder $ancestor, Folder $node): bool
    {
        $parentId = $node->parent_id;
        $seen = [];

        while ($parentId !== null && ! isset($seen[$parentId])) {
            if ($parentId === $ancestor->id) {
                return true;
            }
            $seen[$parentId] = true;
            $parentId = Folder::withTrashed()->where('id', $parentId)->value('parent_id');
        }

        return false;
    }

    /** Recursive [fileCount, folderCount, totalSize] for a folder's contents. */
    public static function aggregate(Folder $folder): array
    {
        return self::aggregateMany([$folder])[$folder->id]
            ?? ['fileCount' => 0, 'folderCount' => 0, 'size' => 0];
    }

    /**
     * Direct children only: how many folders, how many files, how many bytes
     * sit in each of these, not beneath them.
     *
     * A listing used to ask {@see self::aggregateMany} so a closed folder could
     * report everything it hid. That is one recursive CTE joining every file
     * in those subtrees. Opening All Files therefore summed the whole library
     * (Clients, Staff Files, …) before it could draw five rows; opening the
     * Clients directory walked every client tree on the page. Against the
     * remote database that was the two-minute hang, and past a gateway timeout
     * it was the spinner that never finished.
     *
     * Direct counts answer the question the row actually asks — is this folder
     * empty, how many things are in it — with two indexed GROUP BYs on the
     * page's ids. Recursive totals stay on {@see self::aggregate} for the
     * one-folder callers that still want them (ZIP, a details panel).
     *
     * @param  Folder[]  $folders
     * @return array<int, array{fileCount: int, folderCount: int, size: int}>
     */
    public static function directCounts(array $folders): array
    {
        if ($folders === []) {
            return [];
        }

        $ids = [];
        foreach ($folders as $folder) {
            $ids[(int) $folder->id] = true;
        }
        $ids = array_keys($ids);

        $empty = ['fileCount' => 0, 'folderCount' => 0, 'size' => 0];
        $out = array_fill_keys($ids, $empty);

        $childFolders = Folder::query()
            ->whereIn('parent_id', $ids)
            ->reorder()
            ->selectRaw('parent_id, count(*) as n')
            ->groupBy('parent_id')
            ->pluck('n', 'parent_id');

        foreach ($childFolders as $parentId => $n) {
            $out[(int) $parentId]['folderCount'] = (int) $n;
        }

        $childFiles = FileItem::query()
            ->whereIn('folder_id', $ids)
            ->reorder()
            ->selectRaw('folder_id, count(*) as file_count, coalesce(sum(size), 0) as total_size')
            ->groupBy('folder_id')
            ->get();

        foreach ($childFiles as $row) {
            $out[(int) $row->folder_id]['fileCount'] = (int) $row->file_count;
            $out[(int) $row->folder_id]['size'] = (int) $row->total_size;
        }

        return $out;
    }

    /**
     * Recursive counts for many folders, in one query.
     *
     * A listing of twenty subfolders used to run twenty descendant walks plus
     * a COUNT and a SUM per folder, that is what made opening a client's
     * Documents tab stall against Cloud Postgres. A combined breadth-first
     * walk replaced that, and was itself the largest remaining cost once the
     * N+1s went: one round trip per level of the tree (eleven, here), then
     * every folder id in the library, forty-two thousand of them, carried
     * back out to the database inside a single IN list to sum the files.
     *
     * The database can walk its own tree. One recursive CTE descends from all
     * the roots at once and joins the files as it goes, so the whole thing is
     * a single statement whose result is already the answer, and no id list
     * ever crosses the wire.
     *
     * Bounded by MAX_DEPTH: a cycle in parent_id would otherwise recurse for
     * ever, where the PHP walk it replaces merely stopped. A tree that deep is
     * already broken, and a wrong count is a better failure than a hung page.
     *
     * @param  Folder[]  $folders
     * @return array<int, array{fileCount: int, folderCount: int, size: int}>
     */
    public static function aggregateMany(array $folders): array
    {
        if ($folders === []) {
            return [];
        }

        $rootIds = [];
        foreach ($folders as $folder) {
            $rootIds[(int) $folder->id] = true;
        }
        $rootIds = array_keys($rootIds);

        $empty = ['fileCount' => 0, 'folderCount' => 0, 'size' => 0];
        $out = array_fill_keys($rootIds, $empty);

        $placeholders = implode(',', array_fill(0, count($rootIds), '?'));
        $rows = DB::select(
            "with recursive tree(root_id, id, depth) as (
                 -- The roots are whatever the caller handed us, trashed or
                 -- not (a folder in the recycle bin still reports what is
                 -- inside it); their descendants are the live ones only,
                 -- which is what the walk this replaces counted.
                 select id, id, 0 from folders
                  where id in ($placeholders)
                 union all
                 select t.root_id, f.id, t.depth + 1
                   from folders f
                   join tree t on f.parent_id = t.id
                  where f.deleted_at is null and t.depth < ".self::MAX_DEPTH.'
             )
             select t.root_id as root_id,
                    count(distinct case when t.id <> t.root_id then t.id end) as folder_count,
                    count(f.id) as file_count,
                    coalesce(sum(f.size), 0) as total_size
               from tree t
               left join files f on f.folder_id = t.id and f.deleted_at is null
              group by t.root_id',
            $rootIds,
        );

        foreach ($rows as $row) {
            $out[(int) $row->root_id] = [
                'fileCount' => (int) $row->file_count,
                'folderCount' => (int) $row->folder_count,
                'size' => (int) $row->total_size,
            ];
        }

        return $out;
    }

    /**
     * Every folder id beneath each of these, keyed by the one it came from.
     *
     * The same walk aggregateMany does — one recursive pass rather than a
     * query per level per folder — exposed so callers that need to ask
     * something else about a subtree (what is unread in it, say) do not have
     * to write the descent again and get a different answer.
     *
     * The root is included in its own list: a document filed directly in a
     * client folder is as much "in" it as one three levels down.
     *
     * @param  list<int>  $rootIds
     * @return array<int, list<int>> root id => folder ids in its subtree
     */
    public static function subtreeMap(array $rootIds): array
    {
        $rootIds = array_values(array_unique(array_filter($rootIds)));

        if ($rootIds === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($rootIds), '?'));
        $rows = DB::select(
            "with recursive tree(root_id, id, depth) as (
                 select id, id, 0 from folders
                  where id in ($placeholders)
                 union all
                 select t.root_id, f.id, t.depth + 1
                   from folders f
                   join tree t on f.parent_id = t.id
                  where f.deleted_at is null and t.depth < ".self::MAX_DEPTH.'
             )
             select root_id, id from tree',
            $rootIds,
        );

        $out = array_fill_keys($rootIds, []);

        foreach ($rows as $row) {
            $out[(int) $row->root_id][] = (int) $row->id;
        }

        return $out;
    }

    /** All descendant folder ids (not including the folder itself). */
    public static function descendantIds(Folder $folder): array
    {
        $ids = [];
        $queue = [$folder->id];

        while ($queue) {
            $childIds = Folder::whereIn('parent_id', $queue)->pluck('id')->all();
            $ids = array_merge($ids, $childIds);
            $queue = $childIds;
        }

        return $ids;
    }

    /** Descendant folder ids including already-trashed ones. */
    public static function descendantIdsWithTrashed(Folder $folder): array
    {
        $ids = [];
        $queue = [$folder->id];

        while ($queue) {
            $childIds = Folder::withTrashed()->whereIn('parent_id', $queue)->pluck('id')->all();
            $ids = array_merge($ids, $childIds);
            $queue = $childIds;
        }

        return $ids;
    }

    /**
     * Soft-delete a folder and its whole subtree (folders + files) so the tree
     * lands in the recycle bin together. Files are NOT purged, only recycled.
     */
    public static function softDeleteTree(Folder $folder, int $userId): void
    {
        DB::transaction(function () use ($folder, $userId) {
            $ids = array_merge([$folder->id], self::descendantIdsWithTrashed($folder));

            FileItem::whereIn('folder_id', $ids)->get()->each(function (FileItem $file) use ($userId) {
                $file->update(['deleted_by' => $userId]);
                $file->delete();
            });

            Folder::whereIn('id', $ids)->update(['deleted_by' => $userId]);
            Folder::whereIn('id', $ids)->delete();
        });
    }

    /** Restore a trashed folder and everything beneath it. */
    public static function restoreTree(Folder $folder): void
    {
        DB::transaction(function () use ($folder) {
            $ids = array_merge([$folder->id], self::descendantIdsWithTrashed($folder));

            FileItem::withTrashed()->whereIn('folder_id', $ids)->restore();
            Folder::withTrashed()->whereIn('id', $ids)->restore();
        });
    }

    /** Permanently delete a folder subtree, removing physical bytes first. */
    public static function purgeTree(Folder $folder): void
    {
        $ids = array_merge([$folder->id], self::descendantIdsWithTrashed($folder));

        FileItem::withTrashed()->whereIn('folder_id', $ids)->get()
            ->each(function (FileItem $file) {
                Vault::delete($file);
                $file->forceDelete();
            });

        DB::transaction(function () use ($ids) {
            Folder::withTrashed()->whereIn('id', $ids)->forceDelete();
        });
    }

    /** Build a ZIP of a folder's full structure; returns the temp file path. */
    public static function zip(Folder $folder): string
    {
        $zipPath = tempnam(sys_get_temp_dir(), 'tmazip_').'.zip';
        $zip = new ZipArchive;

        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new FileValidationException('The ZIP file could not be created.');
        }

        // ZipArchive reads added files lazily at close(), so any temp copies we
        // pull down from remote storage must survive until after close().
        $tempCopies = [];
        self::addFolderToZip($zip, $folder, self::sanitizeZipSegment($folder->name), $tempCopies);
        $zip->close();

        foreach ($tempCopies as $tmp) {
            Vault::cleanupLocalCopy($tmp);
        }

        return $zipPath;
    }

    private static function addFolderToZip(ZipArchive $zip, Folder $folder, string $prefix, array &$tempCopies): void
    {
        $zip->addEmptyDir($prefix);

        foreach ($folder->files()->get() as $file) {
            $abs = Vault::localCopy($file);
            if ($abs !== null && is_file($abs)) {
                $zip->addFile($abs, $prefix.'/'.self::sanitizeZipSegment($file->name));
                $tempCopies[] = $abs;
            }
        }

        foreach ($folder->children()->get() as $child) {
            self::addFolderToZip($zip, $child, $prefix.'/'.self::sanitizeZipSegment($child->name), $tempCopies);
        }
    }

    private static function sanitizeZipSegment(string $name): string
    {
        return str_replace(['/', '\\', "\0"], '_', $name);
    }

    private static function assertUniqueSibling(string $name, ?Folder $parent, ?int $ignoreId): void
    {
        if (self::siblingExists($name, $parent, $ignoreId)) {
            throw new FileValidationException('A folder with that name already exists here.');
        }
    }

    private static function siblingExists(string $name, ?Folder $parent, ?int $ignoreId): bool
    {
        return Folder::query()
            ->where('parent_id', $parent?->id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
            ->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId))
            ->exists();
    }
}
