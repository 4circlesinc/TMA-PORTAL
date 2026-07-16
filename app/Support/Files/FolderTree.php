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
        $folderIds = self::descendantIds($folder);
        $allIds = array_merge([$folder->id], $folderIds);

        $fileCount = FileItem::whereIn('folder_id', $allIds)->count();
        $size = (int) FileItem::whereIn('folder_id', $allIds)->sum('size');

        return [
            'fileCount' => $fileCount,
            'folderCount' => count($folderIds),
            'size' => $size,
        ];
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
     * lands in the recycle bin together. Files are NOT purged — only recycled.
     */
    public static function softDeleteTree(Folder $folder, int $userId): void
    {
        DB::transaction(function () use ($folder, $userId) {
            $ids = array_merge([$folder->id], self::descendantIdsWithTrashed($folder));

            FileItem::whereIn('folder_id', $ids)->update(['deleted_by' => $userId]);
            FileItem::whereIn('folder_id', $ids)->delete();

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
            ->each(fn (FileItem $f) => Vault::delete($f));

        DB::transaction(function () use ($ids) {
            FileItem::withTrashed()->whereIn('folder_id', $ids)->forceDelete();
            Folder::withTrashed()->whereIn('id', $ids)->forceDelete();
        });
    }

    /** Build a ZIP of a folder's full structure; returns the temp file path. */
    public static function zip(Folder $folder): string
    {
        $zipPath = tempnam(sys_get_temp_dir(), 'tmazip_').'.zip';
        $zip = new ZipArchive();

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
