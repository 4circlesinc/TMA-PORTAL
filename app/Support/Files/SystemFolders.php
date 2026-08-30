<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;

/**
 * System-managed folders (the Clients / Staff Files roots, every
 * organization / client / staff folder, and everything nested inside them) are
 * owned and created by an administrator so storage has a stable owner. Folders
 * and files both cascade on those columns, so before an account is erased for
 * good that whole subtree has to be handed to another admin, otherwise purging
 * an administrator would take client and organization content with it.
 *
 * This only matters at the point of a real delete. An account sitting in the
 * Recycle Bin still has its row, so nothing cascades and ownership is left
 * exactly as it was, ready to come back on restore.
 */
final class SystemFolders
{
    /**
     * Hand every system folder and file owned by $userIds to a surviving
     * administrator, falling back to the actor when none is left.
     *
     * @param  array<int, int>  $userIds
     */
    public static function rehome(array $userIds, int $actorId): void
    {
        if (! $userIds) {
            return;
        }

        $heir = User::withTrashed()
            ->where('account_type', 'Administrator')
            ->whereNull('deleted_at')
            ->whereNotIn('id', $userIds)
            ->orderBy('id')
            ->value('id') ?? $actorId;

        // Seed from the structural system nodes, then walk down to every
        // descendant folder so nested subfolders and files are covered too.
        $ids = Folder::withTrashed()
            ->whereIn('folder_type', ['root', 'organization', 'client', 'staff'])
            ->pluck('id')->all();

        $frontier = $ids;
        while ($frontier) {
            $children = Folder::withTrashed()->whereIn('parent_id', $frontier)->pluck('id')->all();
            $children = array_values(array_diff($children, $ids));
            if (! $children) {
                break;
            }
            $ids = array_merge($ids, $children);
            $frontier = $children;
        }

        if (! $ids) {
            return;
        }

        Folder::withTrashed()->whereIn('id', $ids)
            ->whereIn('owner_id', $userIds)->update(['owner_id' => $heir]);
        Folder::withTrashed()->whereIn('id', $ids)
            ->whereIn('created_by', $userIds)->update(['created_by' => $heir]);

        FileItem::withTrashed()->whereIn('folder_id', $ids)
            ->whereIn('owner_id', $userIds)->update(['owner_id' => $heir]);
        // uploaded_by is nullOnDelete and named from company_member_id /
        // actor_name. Re-homing it to a surviving admin used to make every
        // document the contact uploaded look like the administrator's.
    }
}
