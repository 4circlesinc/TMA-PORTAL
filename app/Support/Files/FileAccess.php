<?php

namespace App\Support\Files;

use App\Models\ClientAssignment;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;
use Illuminate\Support\Collection;

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
        'viewer' => ['view', 'preview'],
        'downloader' => ['view', 'preview', 'download'],
        'editor' => ['view', 'preview', 'download', 'upload', 'rename', 'move', 'copy'],
        'full' => ['view', 'preview', 'download', 'upload', 'rename', 'move', 'copy',
            'delete', 'restore', 'share', 'assign', 'link'],
    ];

    public static function isAdmin(User $user): bool
    {
        return $user->account_type === 'Administrator';
    }

    /** Staff = internal users (never clients). Drives org/client/staff access. */
    public static function isStaff(User $user): bool
    {
        return in_array($user->account_type, ['Administrator', 'Employee'], true);
    }

    /** Effective role a user holds over a file (null = no access). */
    public static function fileRole(User $user, FileItem $file): ?string
    {
        if (self::isAdmin($user) || $file->owner_id === $user->id) {
            return 'full';
        }

        $roles = [self::shareRole($user, 'file', $file->id)];
        foreach (self::chainFolders($file->folder_id) as $folder) {
            $roles[] = self::shareRole($user, 'folder', $folder->id);
            $roles[] = self::systemFolderRole($user, $folder);
        }

        return self::highest(array_filter($roles));
    }

    /** Effective role a user holds over a folder (null = no access). */
    public static function folderRole(User $user, Folder $folder): ?string
    {
        if (self::isAdmin($user) || $folder->owner_id === $user->id) {
            return 'full';
        }

        $roles = [];
        foreach (self::chainFolders($folder->id) as $f) {
            $roles[] = self::shareRole($user, 'folder', $f->id);
            $roles[] = self::systemFolderRole($user, $f);
        }

        return self::highest(array_filter($roles));
    }

    /**
     * Access a folder's kind grants directly - independent of shares.
     * Organization folders open to all staff, a staff member's own personal
     * folder, and a client folder for the staff assigned to that client.
     * Clients (non-staff) match none of these: they reach content only through
     * explicit shares, which is what keeps internal folders invisible to them.
     */
    private static function systemFolderRole(User $user, Folder $folder): ?string
    {
        if ($folder->folder_type === Folder::TYPE_ORGANIZATION
            && $folder->audience === 'all_staff'
            && self::isStaff($user)) {
            return $folder->audience_role ?: 'viewer';
        }

        if ($folder->folder_type === Folder::TYPE_STAFF
            && $folder->subject_user_id === $user->id) {
            return 'full';
        }

        if ($folder->folder_type === Folder::TYPE_CLIENT
            && $folder->client_id !== null
            && self::isStaff($user)) {
            $assignment = ClientAssignment::where('client_id', $folder->client_id)
                ->where('user_id', $user->id)
                ->first();

            return $assignment?->fileRole();
        }

        return null;
    }

    /**
     * Folder ids a user can see at the top level through system rules (not
     * shares or ownership): organization folders open to all staff, their own
     * staff folder, and their assigned client folders. Empty for clients.
     */
    public static function systemVisibleFolderIds(User $user): array
    {
        if (! self::isStaff($user)) {
            return [];
        }

        $orgIds = Folder::where('folder_type', Folder::TYPE_ORGANIZATION)
            ->where('audience', 'all_staff')
            ->pluck('id')->all();

        $staffIds = Folder::where('folder_type', Folder::TYPE_STAFF)
            ->where('subject_user_id', $user->id)
            ->pluck('id')->all();

        $clientIds = Folder::where('folder_type', Folder::TYPE_CLIENT)
            ->whereIn('client_id', ClientAssignment::where('user_id', $user->id)->pluck('client_id'))
            ->pluck('id')->all();

        return array_values(array_unique([...$orgIds, ...$staffIds, ...$clientIds]));
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

    /**
     * The folder and its ancestors as rows (self first), so callers can read
     * folder_type/audience/client_id without a query each. Cycle-safe.
     *
     * @return Collection<int, Folder>
     */
    private static function chainFolders(?int $folderId): Collection
    {
        $chain = collect();
        $seen = [];

        while ($folderId !== null && ! isset($seen[$folderId])) {
            $seen[$folderId] = true;
            $folder = Folder::withTrashed()->find($folderId);
            if (! $folder) {
                break;
            }
            $chain->push($folder);
            $folderId = $folder->parent_id;
        }

        return $chain;
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
