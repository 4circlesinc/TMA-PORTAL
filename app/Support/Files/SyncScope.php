<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

/**
 * Everything in the File Library one account may see, as two queries.
 *
 * The listing endpoints never need this whole set at once: browsing shows one
 * folder's children behind a "may you open this folder" gate, and the section
 * roots come from FileAccess id lists. The sync cursor is the first caller
 * that has to answer "all of it", a desktop pulling the library down cannot
 * ask folder by folder.
 *
 * CONTAINMENT IS THE PART THE ID LISTS DON'T GIVE
 *
 * FileAccess::sharedFolderIds and systemVisibleFolderIds name the ROOTS a
 * person can reach, the org folder, their staff folder, an assigned client's
 * folder. Access flows downward from there (folderRole walks ancestors), so
 * the visible set is those roots plus every descendant; and a file is visible
 * when it is owned, directly shared, or sitting anywhere inside that closure.
 * Recent's `visibleFiles` never expands containment, for a non-admin it
 * quietly shows only owned and directly-shared files, which is fine for a
 * recency feed and wrong for a replica.
 *
 * TRASHED ROWS ARE IN SCOPE ON PURPOSE
 *
 * The cursor's contract is "deletions are recorded, not inferred" (the
 * SharePoint bin lesson, docs/offline-plan.md). A soft delete bumps
 * updated_at, so the deleted row IS the deletion record, scope must not
 * filter it out, and the expansion walks trashed branches too, or a deleted
 * subtree's files would go silently missing rather than reported deleted.
 */
class SyncScope
{
    /**
     * Every folder id this account may see, descendants included.
     *
     * @return list<int>
     */
    public static function folderIds(User $user): array
    {
        if (FileAccess::isAdmin($user)) {
            return self::adminFolderQuery($user)->pluck('id')->all();
        }

        $roots = array_values(array_unique(array_merge(
            FileAccess::sharedFolderIds($user),
            FileAccess::systemVisibleFolderIds($user),
        )));

        $owned = Folder::withTrashed()->where('owner_id', $user->id)->pluck('id')->all();

        return array_values(array_unique(array_merge(
            $owned,
            $roots,
            self::descendantsOf($roots),
        )));
    }

    /** The folder half of the cursor, scoped. */
    public static function folders(User $user): Builder
    {
        if (FileAccess::isAdmin($user)) {
            return self::adminFolderQuery($user);
        }

        return Folder::withTrashed()->whereIn('id', self::folderIds($user) ?: [0]);
    }

    /** The file half of the cursor, scoped: owned, shared, or contained. */
    public static function files(User $user): Builder
    {
        if (FileAccess::isAdmin($user)) {
            return self::adminFileQuery($user);
        }

        $folderIds = self::folderIds($user);
        $sharedIds = FileAccess::sharedFileIds($user);

        return FileItem::withTrashed()->where(function ($q) use ($user, $folderIds, $sharedIds) {
            $q->where('owner_id', $user->id)
                ->orWhereIn('id', $sharedIds ?: [0])
                ->orWhereIn('folder_id', $folderIds ?: [0]);
        });
    }

    /**
     * Administrators see the library whole, except other people's
     * root-mirrored OneDrive space, the same carve-out the browser makes,
     * for the same reason: FileAccess denies opening it, so replicating it
     * would only ship names nobody may click (and a citizenship client's
     * scan besides). @see BrowserController::visibleFolders
     */
    private static function adminFolderQuery(User $user): Builder
    {
        return Folder::withTrashed()->when(true, function ($q) use ($user) {
            $hidden = array_values(array_diff(FileAccess::personalRootOwnerIds(), [$user->id]));
            if ($hidden !== []) {
                $q->whereNot(fn ($w) => $w->where('folder_type', Folder::TYPE_USER)
                    ->whereIn('owner_id', $hidden)
                    ->whereNotIn('id', FileAccess::sharedFolderIds($user) ?: [0]));
            }
        });
    }

    private static function adminFileQuery(User $user): Builder
    {
        return FileItem::withTrashed()->when(true, function ($q) use ($user) {
            $hidden = array_values(array_diff(FileAccess::personalRootOwnerIds(), [$user->id]));
            if ($hidden !== []) {
                $q->whereNot(fn ($w) => $w->whereIn('owner_id', $hidden)
                    ->where(fn ($p) => $p->whereNull('folder_id')
                        ->orWhereIn('folder_id', Folder::withTrashed()->select('id')
                            ->where('folder_type', Folder::TYPE_USER)
                            ->whereIn('owner_id', $hidden)))
                    ->whereNotIn('id', FileAccess::sharedFileIds($user) ?: [0]));
            }
        });
    }

    /**
     * Every descendant of a set of roots, trashed branches included, the
     * same BFS as FolderTree::descendantIdsWithTrashed, seeded with a set
     * instead of one folder so the whole closure costs one query per depth
     * level rather than one walk per root.
     *
     * @param  list<int>  $roots
     * @return list<int>
     */
    private static function descendantsOf(array $roots): array
    {
        $ids = [];
        $queue = $roots;

        while ($queue) {
            $childIds = Folder::withTrashed()->whereIn('parent_id', $queue)->pluck('id')->all();
            // Guard against a cycle ever appearing in the tree: a child
            // already collected is not walked again.
            $childIds = array_values(array_diff($childIds, $ids, $roots));
            if ($childIds === []) {
                break;
            }
            $ids = array_merge($ids, $childIds);
            $queue = $childIds;
        }

        return $ids;
    }
}
