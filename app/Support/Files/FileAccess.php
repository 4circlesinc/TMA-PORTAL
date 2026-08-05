<?php

namespace App\Support\Files;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\CompanyMember;
use App\Models\CompanyStaffAssignment;
use App\Models\FileItem;
use App\Models\FileLibrarySetting;
use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\Share;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Companies\CompanyAccess;
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

    /**
     * `comment` is held by every role, including viewer: if you can open a file
     * you can say something about it. Discussion is not a privileged action,
     * and withholding it from the people asked to look at something is what
     * pushes that conversation into email where nobody else can find it.
     */
    private const CAPS = [
        'viewer' => ['view', 'preview', 'comment'],
        'downloader' => ['view', 'preview', 'download', 'comment'],
        'editor' => ['view', 'preview', 'download', 'upload', 'rename', 'move', 'copy', 'comment'],
        'full' => ['view', 'preview', 'download', 'upload', 'rename', 'move', 'copy',
            'delete', 'restore', 'share', 'assign', 'link', 'comment'],
    ];

    public static function isAdmin(User $user): bool
    {
        return Role::isAdmin($user);
    }

    /** Staff = internal users (never clients). Drives org/client/staff access. */
    public static function isStaff(User $user): bool
    {
        return Role::isStaff($user);
    }

    /** Effective role a user holds over a file (null = no access). */
    public static function fileRole(User $user, FileItem $file): ?string
    {
        // Checked BEFORE the admin short-circuit on purpose — see the method.
        $driveOwner = self::personalSpaceOwner($file->folder_id, $file->owner_id);
        if ($driveOwner !== null) {
            if ($driveOwner === $user->id) {
                return 'full';
            }

            /*
             * Everyone else gets EXACTLY what the owner handed out, and
             * nothing else. Not the firm-wide default, not an all-staff folder
             * grant, not administrator reach — but a share the owner chose to
             * make still works, because choosing who sees your own files is
             * the point of keeping the drive private in the first place.
             */
            $shared = [self::shareRole($user, 'file', $file->id)];
            foreach (self::chainFolders($file->folder_id) as $folder) {
                $shared[] = self::shareRole($user, 'folder', $folder->id);
            }

            return self::highest(array_filter($shared));
        }

        if (self::isAdmin($user) || $file->owner_id === $user->id) {
            return 'full';
        }

        $roles = [self::shareRole($user, 'file', $file->id)];
        foreach (self::chainFolders($file->folder_id) as $folder) {
            $roles[] = self::shareRole($user, 'folder', $folder->id);
            $roles[] = self::systemFolderRole($user, $folder);
        }

        $roles[] = self::organizationDefaultRole($user, $file);

        return self::highest(array_filter($roles));
    }

    /**
     * The firm-wide default: ordinary files are visible to everyone on staff.
     *
     * The library is meant to be shared, and making every upload private until
     * somebody remembers to share it is what pushes documents back into email.
     * Administrators can turn this off in File Library settings.
     *
     * Scope, decided by the firm (2026-07-31): **everything is firm-wide**,
     * including personal staff folders and unfiled File Box uploads. Staff
     * folders are a filing convenience here, not a privacy boundary.
     *
     * Exactly TWO things are still excluded, and both are load-bearing:
     *
     *  - **Clients are never covered.** `isStaff` excludes them, so this can
     *    never widen what a client account sees.
     *  - **Anything under a client folder** stays limited to that client's
     *    assigned team. §2 and §21 are explicit that client-private documents
     *    are not shared with every organization member unless chosen, and a
     *    client's contracts leaking firm-wide is a different order of mistake
     *    from a colleague seeing a draft early.
     *  - **Anything synced from a personal OneDrive.** A SharePoint library is
     *    shared by intent; somebody's OneDrive is not. It holds meeting
     *    recordings, auto-saved chat attachments and drafts they never chose to
     *    publish. The firm-wide default must never reach into one: the owner
     *    decides who sees their own files, file by file.
     */
    private static function organizationDefaultRole(User $user, FileItem $file): ?string
    {
        if (! self::isStaff($user) || ! FileLibrarySetting::defaultOrgAccess()) {
            return null;
        }

        foreach (self::chainFolders($file->folder_id) as $folder) {
            if ($folder->folder_type === Folder::TYPE_CLIENT) {
                return null;
            }

            if (self::isPersonalDriveFolder($folder)) {
                return null;
            }
        }

        return FileLibrarySetting::defaultOrgRole();
    }

    /**
     * Is this folder the root of — or inside — a synced personal OneDrive?
     *
     * Checked against the CONNECTION rather than a flag on the folder, because
     * the connection is what knows whose drive it is. A folder carries no
     * memory of where it came from, and copying that fact onto every folder at
     * import time would mean one missed write silently publishes a drive.
     */
    /**
     * Whose personal OneDrive this sits in, if it sits in one at all.
     *
     * Returns null for everything that is not inside a synced personal drive —
     * which is almost everything — and the owner's id when it is.
     *
     * This runs ahead of the administrator short-circuit, which is the whole
     * point. `isAdmin` grants 'full' over the entire library, so without this
     * every administrator could read every colleague's OneDrive: their drafts,
     * their meeting recordings, their auto-saved chat attachments. The firm's
     * rule is that a personal drive is the owner's alone (2026-08-05), and
     * "alone" has to mean alone or it means nothing.
     *
     * A leaving employee's files are still reachable — in Microsoft 365, by a
     * tenant administrator, which is where that decision belongs. It is not
     * something the portal should quietly grant.
     */
    private static function personalDriveOwner(?int $folderId): ?int
    {
        if ($folderId === null) {
            return null;
        }

        foreach (self::chainFolders($folderId) as $folder) {
            if (self::isPersonalDriveFolder($folder)) {
                return $folder->owner_id;
            }
        }

        return null;
    }

    private static function isPersonalDriveFolder(Folder $folder): bool
    {
        // Deliberately not memoised in a static. Nothing else in this class
        // caches, and a privacy answer held over from an earlier request — or
        // an earlier test — fails OPEN, publishing a drive that was since
        // connected. An extra indexed lookup is the cheaper mistake.
        return SharePointConnection::where('drive_kind', 'onedrive')
            ->where('folder_id', $folder->id)
            ->exists();
    }

    /**
     * Whose personal space this sits in, if anyone's.
     *
     * Two shapes of "personal OneDrive in the portal":
     *
     *  - **Folder-linked** (onedrive:connect): the drive appears as one portal
     *    folder; anything under that folder is the drive owner's alone.
     *  - **Root-mirrored** (connect via OAuth): the drive syncs into the top
     *    of its owner's own library — the connection has no portal folder. The
     *    personal space is then the owner's tree of ordinary user folders and
     *    their unfiled root files, because that tree IS the drive's mirror,
     *    and anything added to it flows back into the drive.
     *
     * Same consequence either way: owner gets full, everyone else — including
     * administrators — gets exactly what an explicit share hands out.
     */
    private static function personalSpaceOwner(?int $folderId, ?int $ownerId): ?int
    {
        $viaDrive = self::personalDriveOwner($folderId);
        if ($viaDrive !== null) {
            return $viaDrive;
        }

        if ($folderId === null) {
            return ($ownerId !== null && self::hasPersonalRootConnection($ownerId)) ? $ownerId : null;
        }

        $treeOwner = null;
        foreach (self::chainFolders($folderId) as $folder) {
            // Any system folder in the chain means this is firm structure,
            // not a personal tree.
            if ($folder->folder_type !== Folder::TYPE_USER || ! $folder->owner_id) {
                return null;
            }
            $treeOwner = (int) $folder->owner_id; // ends at the topmost ancestor
        }

        return ($treeOwner !== null && self::hasPersonalRootConnection($treeOwner)) ? $treeOwner : null;
    }

    private static function hasPersonalRootConnection(int $userId): bool
    {
        // Same deliberate non-memoisation as isPersonalDriveFolder: a stale
        // answer here fails OPEN.
        return SharePointConnection::where('drive_kind', 'onedrive')
            ->whereNull('folder_id')
            ->where('created_by', $userId)
            ->exists();
    }

    /** Users whose OneDrive mirrors into the root of their own library. */
    public static function personalRootOwnerIds(): array
    {
        return SharePointConnection::where('drive_kind', 'onedrive')
            ->whereNull('folder_id')
            ->whereNotNull('created_by')
            ->pluck('created_by')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /** Effective role a user holds over a folder (null = no access). */
    public static function folderRole(User $user, Folder $folder): ?string
    {
        $driveOwner = self::personalSpaceOwner($folder->id, $folder->owner_id);
        if ($driveOwner !== null) {
            if ($driveOwner === $user->id) {
                return 'full';
            }

            // Same rule as fileRole: only an explicit share reaches inside.
            $shared = [];
            foreach (self::chainFolders($folder->id) as $f) {
                $shared[] = self::shareRole($user, 'folder', $f->id);
            }

            return self::highest(array_filter($shared));
        }

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
            // A personal drive is never firm-wide, whatever it is typed as.
            // The connect flow no longer types one this way, but this is the
            // grant that would publish a whole OneDrive to every colleague, so
            // it does not rely on that alone.
            return self::isPersonalDriveFolder($folder) ? null : ($folder->audience_role ?: 'viewer');
        }

        if ($folder->folder_type === Folder::TYPE_STAFF
            && $folder->subject_user_id === $user->id) {
            return 'full';
        }

        if ($folder->folder_type === Folder::TYPE_CLIENT
            && $folder->client_id !== null
            && self::isStaff($user)) {
            // Ended assignments are kept as history, so this must ask for the
            // live one — without the scope an expired row could be picked up
            // and hand back access that was taken away.
            $assignment = ClientAssignment::live()
                ->where('client_id', $folder->client_id)
                ->where('user_id', $user->id)
                ->first();

            // Staff assigned to the whole company reach the folders of the
            // contacts beneath it, when their assignment says it should.
            return self::highest(array_filter([
                $assignment?->fileRole(),
                self::companyStaffRole($user, $folder->client_id),
            ]));
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

        // Directly assigned clients, plus the ones reached through a company
        // assignment that covers the contacts beneath it.
        $reachable = array_unique(array_merge(
            ClientAssignment::live()->where('user_id', $user->id)->pluck('client_id')->all(),
            CompanyAccess::clientIdsThroughCompanies($user),
        ));

        $clientIds = Folder::where('folder_type', Folder::TYPE_CLIENT)
            ->whereIn('client_id', $reachable)
            ->pluck('id')->all();

        return array_values(array_unique([...$orgIds, ...$staffIds, ...$clientIds]));
    }

    /**
     * The role a staff member holds over a client's folder because they are
     * assigned to the company that client belongs to.
     */
    private static function companyStaffRole(User $user, int $clientId): ?string
    {
        if (! self::isStaff($user)) {
            return null;
        }

        $companyId = Client::whereKey($clientId)->value('company_id');

        if (! $companyId) {
            return null;
        }

        $assignment = CompanyStaffAssignment::live()
            ->where('company_id', $companyId)
            ->where('user_id', $user->id)
            ->first();

        // An assignment scoped to the company alone stops at the company's own
        // files — it is not a way to read every contact's folder.
        if (! $assignment || ! $assignment->reachesClients()) {
            return null;
        }

        if (! $assignment->reachesFutureClients()) {
            $addedAt = Client::whereKey($clientId)->value('created_at');
            if ($addedAt !== null && $addedAt > $assignment->created_at) {
                return null;
            }
        }

        return $assignment->fileRole();
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

        return self::highest(array_filter([
            $share?->role,
            self::companyShareRole($user, $type, $id),
        ]));
    }

    /**
     * Access that comes from being at a company the item was shared with.
     *
     * This is what makes company sharing worth having: one share row covers
     * everyone at the company, so joining grants access and being removed takes
     * it away with no share rows to maintain. A share may narrow itself to a
     * single company role — "Company finance contacts" — via
     * `target_company_role`; null means every member.
     */
    private static function companyShareRole(User $user, string $type, int $id): ?string
    {
        $memberships = CompanyMember::active()->where('user_id', $user->id)->get();

        if ($memberships->isEmpty()) {
            return null;
        }

        $shares = Share::where('kind', 'company')
            ->whereIn('target_company_id', $memberships->pluck('company_id'))
            ->where('item_type', $type)
            ->where('item_id', $id)
            ->whereNull('revoked_at')
            ->get()
            ->filter(fn (Share $s) => $s->isActive());

        $roles = [];

        foreach ($shares as $share) {
            $member = $memberships->firstWhere('company_id', $share->target_company_id);

            if (! $member) {
                continue;
            }

            // Scoped to one company role, and this person does not hold it.
            if ($share->target_company_role && $member->role !== $share->target_company_role) {
                continue;
            }

            // A company share still respects the member's own permissions: a
            // viewer does not become an editor because the folder was shared
            // with everyone.
            if (! $member->can('can_view_files')) {
                continue;
            }

            $roles[] = ($share->role === 'editor' || $share->role === 'full')
                && ! $member->can('can_upload_files')
                ? 'downloader'
                : $share->role;
        }

        return self::highest(array_filter($roles));
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
