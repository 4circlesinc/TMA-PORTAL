<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;

/**
 * The single server-side authorization surface for file/folder actions.
 * Every controller action runs through here — hidden buttons on the client are
 * never trusted. Access comes from ownership, the admin role, or an active
 * share/assignment (directly on the item or on an ancestor folder).
 */
class FileAccess
{
    private const RANK = ['viewer' => 1, 'downloader' => 2, 'editor' => 3, 'full' => 4];

    private const CAPS = [
        'viewer'     => ['view'],
        'downloader' => ['view', 'preview', 'download'],
        'editor'     => ['view', 'preview', 'download', 'upload', 'rename', 'move', 'copy'],
        'full'       => ['view', 'preview', 'download', 'upload', 'rename', 'move', 'copy',
                         'delete', 'restore', 'share', 'assign', 'link'],
    ];

    public static function isAdmin(User $user): bool
    {
        return $user->account_type === 'Administrator';
    }

    /** Effective role a user holds over a file (null = no access). */
    public static function fileRole(User $user, FileItem $file): ?string
    {
        if (self::isAdmin($user) || $file->owner_id === $user->id) {
            return 'full';
        }

        $roles = array_filter([
            self::shareRole($user, 'file', $file->id),
            ...array_map(
                fn ($fid) => self::shareRole($user, 'folder', $fid),
                self::folderChainIds($file->folder_id)
            ),
        ]);

        return self::highest($roles);
    }

    /** Effective role a user holds over a folder (null = no access). */
    public static function folderRole(User $user, Folder $folder): ?string
    {
        if (self::isAdmin($user) || $folder->owner_id === $user->id) {
            return 'full';
        }

        $roles = array_map(
            fn ($fid) => self::shareRole($user, 'folder', $fid),
            array_merge([$folder->id], self::folderChainIds($folder->parent_id))
        );

        return self::highest(array_filter($roles));
    }

    public static function can(User $user, string $ability, FileItem|Folder $item): bool
    {
        $role = $item instanceof FileItem
            ? self::fileRole($user, $item)
            : self::folderRole($user, $item);

        if ($role === null) {
            return false;
        }

        return in_array($ability, self::CAPS[$role] ?? [], true);
    }

    /** Abort with a clear 403 unless the user may perform the ability. */
    public static function authorize(User $user, string $ability, FileItem|Folder $item): void
    {
        abort_unless(self::can($user, $ability, $item), 403, 'Permission denied.');
    }

    /** Uploading to the File Box (null folder) is always allowed for the user's own area. */
    public static function canUploadTo(User $user, ?Folder $folder): bool
    {
        return $folder === null ? true : self::can($user, 'upload', $folder);
    }

    /** File ids shared/assigned directly to the user (for "Shared with me"). */
    public static function sharedFileIds(User $user): array
    {
        return self::activeUserShares($user, 'file')->pluck('item_id')->all();
    }

    /** Folder ids shared/assigned directly to the user. */
    public static function sharedFolderIds(User $user): array
    {
        return self::activeUserShares($user, 'folder')->pluck('item_id')->all();
    }

    private static function shareRole(User $user, string $type, int $id): ?string
    {
        $share = Share::where('kind', 'user')
            ->where('target_user_id', $user->id)
            ->where('item_type', $type)
            ->where('item_id', $id)
            ->whereNull('revoked_at')
            ->get()
            ->first(fn (Share $s) => $s->isActive());

        return $share?->role;
    }

    private static function activeUserShares(User $user, string $type)
    {
        return Share::where('kind', 'user')
            ->where('target_user_id', $user->id)
            ->where('item_type', $type)
            ->whereNull('revoked_at')
            ->get()
            ->filter(fn (Share $s) => $s->isActive())
            ->values();
    }

    /** Ancestor folder ids for a folder id, walking up to the root (cycle-safe). */
    private static function folderChainIds(?int $folderId): array
    {
        $ids = [];
        $seen = [];

        while ($folderId !== null && ! isset($seen[$folderId])) {
            $seen[$folderId] = true;
            $ids[] = $folderId;
            $folderId = Folder::withTrashed()->where('id', $folderId)->value('parent_id');
        }

        return $ids;
    }

    private static function highest(array $roles): ?string
    {
        $best = null;
        $bestRank = 0;

        foreach ($roles as $role) {
            $rank = self::RANK[$role] ?? 0;
            if ($rank > $bestRank) {
                $bestRank = $rank;
                $best = $role;
            }
        }

        return $best;
    }
}
