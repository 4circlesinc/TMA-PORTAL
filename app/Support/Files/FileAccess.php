<?php

namespace App\Support\Files;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\CompanyMember;
use App\Models\CompanyStaffAssignment;
use App\Models\FileItem;
use App\Models\FileLibrarySetting;
use App\Models\Folder;
use App\Models\Share;
use App\Models\SharePointConnection;
use App\Models\User;
use App\Support\Access\PortalPermissions;
use App\Support\Access\Role;
use App\Support\Cip\Package;
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

    /** Writes against a confirmed original package (§15 / §17). */
    private const PACKAGE_LOCKED = ['upload', 'rename', 'move', 'copy', 'delete', 'restore'];

    public static function isAdmin(User $user): bool
    {
        return Role::isAdmin($user);
    }

    /**
     * Whether this file sits inside a personal OneDrive space.
     *
     * Used by AccessSources to decide whether to include the administrators
     * source in the "Shared with" panel. Admin access is bypassed for personal
     * drives, so the panel must not advertise it.
     */
    public static function isInPersonalDrive(FileItem $file): bool
    {
        return self::personalSpaceOwner($file->folder_id, $file->owner_id) !== null;
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

    /** folder_id => is a connected personal drive. */
    private static array $personalDrives = [];

    /**
     * Is this folder a connected personal OneDrive?
     *
     * This used to run an uncached exists() per folder per call — over a
     * thousand queries to list one folder, the largest single cost in a file
     * listing. The note that stood here said memoising it fails OPEN, and it
     * was right: a naive static let a colleague open somebody's drive, and the
     * tests caught it within minutes.
     *
     * What makes caching safe is invalidation, not avoidance. The answer only
     * changes when a connection is written, so AppServiceProvider drops this
     * whenever one is saved or deleted. A drive connected mid-request is seen
     * by the next call, not the next deploy — and the failure mode is now
     * closed rather than open, because a cleared cache re-queries.
     */
    private static function isPersonalDriveFolder(Folder $folder): bool
    {
        if (! array_key_exists($folder->id, self::$personalDrives)) {
            self::$personalDrives[$folder->id] = SharePointConnection::where('drive_kind', 'onedrive')
                ->where('folder_id', $folder->id)
                ->exists();
        }

        return self::$personalDrives[$folder->id];
    }

    /** Called whenever a SharePoint connection changes — see AppServiceProvider. */
    public static function forgetPersonalDrives(): void
    {
        self::$personalDrives = [];
        self::$personalRootOwnerIds = null;
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

    /** Per-request cache of user ids that have a root-mirrored OneDrive. */
    private static ?array $personalRootOwnerIds = null;

    /**
     * Whether a user has a root-mirrored OneDrive connection.
     *
     * Previously ran a live DB query on every call — one per unique user id
     * encountered while walking file/folder chains, which on a busy listing
     * could mean dozens of identical queries. We now resolve the full set once
     * per request and answer from that set.
     *
     * Failure mode is identical to isPersonalDriveFolder: clearing
     * forgetPersonalDrives() drops this cache too, so a connection added or
     * removed mid-request is seen by the next call.
     */
    private static function hasPersonalRootConnection(int $userId): bool
    {
        return in_array($userId, self::personalRootOwnerIds(), true);
    }

    /** Users whose OneDrive mirrors into the root of their own library. */
    public static function personalRootOwnerIds(): array
    {
        if (self::$personalRootOwnerIds === null) {
            self::$personalRootOwnerIds = SharePointConnection::where('drive_kind', 'onedrive')
                ->whereNull('folder_id')
                ->whereNotNull('created_by')
                ->pluck('created_by')
                ->map(fn ($id) => (int) $id)
                ->all();
        }

        return self::$personalRootOwnerIds;
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

        if (! in_array($ability, self::CAPS[$role] ?? [], true)) {
            return false;
        }

        /*
         * §17: a confirmed original package is view-only.
         *
         * Checked after the role (so view/download/comment still pass) and
         * after the admin/owner short-circuit inside fileRole()/folderRole()
         * (so neither full rights nor owning the bytes can rewrite a package
         * the Unit is about to be handed). Person folders freeze; Additional
         * Documents does not. View, preview, download and comment stay.
         */
        if (in_array($ability, self::PACKAGE_LOCKED, true)) {
            $frozen = $item instanceof FileItem
                ? Package::locksFile($item)
                : Package::locksFolder($item);

            if ($frozen) {
                return false;
            }
        }

        /* A client's right to re-share is the firm's to decide, not the item
           role's — an owner or editor role says what they may do with the
           file, not who else may end up holding it. Settings > Advanced
           Preferences > Permissions turns this on; it is off by default, so a
           client sharing onward is something a firm opts into. Every share
           path in the portal reaches this method, which is why the rule lives
           here rather than in each controller. */
        if ($ability === 'share' && Role::isClient($user) && ! PortalPermissions::allowsClientSharing()) {
            return false;
        }

        /*
         * A client's records are not assigned file by file.
         *
         * Who works on a client is a client assignment — ClientAssignment,
         * with a job role and an end date, kept in step by AccessSync — and
         * everything under that client's folder follows from it. A share
         * bolted onto one document would be a second, invisible door: nothing
         * closes it when the assignment ends, it appears in no client's
         * assigned-staff list, and it says the person works on that file
         * rather than that client, which is not a thing the firm tracks.
         *
         * So assignment is refused on anything inside a client's tree, and
         * refused here rather than in the menu that surfaces it: the endpoint
         * is the door, and the applicant's Documents tab, the File Library and
         * anything added later all reach this method.
         *
         * The rest of the row menu is untouched. Naming a colleague in a
         * comment still lets them in ({@see AccessGrants}) — that is the way
         * in for a document, and it leaves a record of who was asked and why.
         */
        if ($ability === 'assign' && self::inClientTree($item)) {
            return false;
        }

        return true;
    }

    /**
     * Is this item part of a client's records?
     *
     * Asked of the whole chain rather than the item's own folder. `client_id`
     * is inherited as subfolders are created (FolderProvisioner, Cip\Tree), so
     * the parent alone would usually answer it — but a folder made by hand
     * inside a client's tree carries whatever `create()` gave it, and "usually
     * inherited" is not a permission rule. The chain is already cached from
     * the role check a few lines above, so this costs no query.
     */
    private static function inClientTree(FileItem|Folder $item): bool
    {
        $folderId = $item instanceof FileItem ? $item->folder_id : $item->id;

        return self::chainFolders($folderId)->contains(fn (Folder $f) => $f->client_id !== null);
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

    /**
     * Ancestor folder ids for a folder id, self first, walking up to the root.
     *
     * Reads the same cached rows {@see self::chainFolders} walks, so a caller
     * that only wants ids does not re-query the chain a level at a time.
     *
     * @return list<int>
     */
    public static function chainIds(?int $folderId): array
    {
        return self::chainFolders($folderId)->map(fn (Folder $f) => (int) $f->id)->all();
    }

    /**
     * The folder and its ancestors as rows (self first), so callers can read
     * folder_type/audience/client_id without a query each. Cycle-safe.
     *
     * @return Collection<int, Folder>
     */
    /**
     * Folder rows already fetched, by id.
     *
     * Rows, not answers. The distinction matters: memoising *whether a folder
     * is a personal drive* fails open, because a drive connected mid-flight
     * would be read from a cache that says otherwise. A folder's own row is
     * not a permission decision — every rule above is still evaluated against
     * it on every call — and it is invalidated the moment any folder is
     * written, from the observer that already watches them.
     */
    private static array $folders = [];

    /**
     * Fetch whole ancestor chains up front, one query per depth level.
     *
     * chainFolders below caches a row once it has seen it, but it can only
     * discover the next ancestor after fetching the current one — so a cold
     * cache costs one round trip per level, per chain. A listing asks about
     * dozens of chains and pays that serially: 11 folder lookups and 11
     * personal-drive checks, ~6s of a 19s response, purely in latency.
     *
     * Given the whole page's folder ids at once, the walk goes level by level
     * across every chain together, and the personal-drive flags they will all
     * be asked for resolve in one more query. Rows that do not exist are
     * cached as null so a missing parent is not re-asked either.
     *
     * @param  iterable<int|null>  $folderIds
     */
    public static function warmChains(iterable $folderIds): void
    {
        $queue = [];
        foreach ($folderIds as $id) {
            $id = (int) $id;
            if ($id && ! array_key_exists($id, self::$folders)) {
                $queue[$id] = true;
            }
        }

        $warmed = [];

        while ($queue) {
            $ids = array_keys($queue);
            $rows = Folder::withTrashed()->whereIn('id', $ids)->get();
            // Seed every id asked for as absent first; the rows that came
            // back overwrite it. Without this a folder whose parent_id points
            // nowhere would be re-queried on every chain that reaches it.
            foreach ($ids as $id) {
                self::$folders[$id] = null;
            }

            $queue = [];
            foreach ($rows as $row) {
                self::$folders[$row->id] = $row;
                $warmed[] = (int) $row->id;
                $parent = (int) $row->parent_id;
                if ($parent && ! array_key_exists($parent, self::$folders)) {
                    $queue[$parent] = true;
                }
            }
        }

        $unknown = array_values(array_filter(
            $warmed,
            fn (int $id) => ! array_key_exists($id, self::$personalDrives),
        ));

        if ($unknown === []) {
            return;
        }

        $connected = SharePointConnection::where('drive_kind', 'onedrive')
            ->whereIn('folder_id', $unknown)
            ->pluck('folder_id')
            ->map(fn ($id) => (int) $id)
            ->flip();

        foreach ($unknown as $id) {
            self::$personalDrives[$id] = $connected->has($id);
        }
    }

    /** Every caller here walks the same few chains; this fetches each once. */
    private static function chainFolders(?int $folderId): Collection
    {
        $chain = collect();
        $seen = [];

        while ($folderId !== null && ! isset($seen[$folderId])) {
            $seen[$folderId] = true;

            if (! array_key_exists($folderId, self::$folders)) {
                self::$folders[$folderId] = Folder::withTrashed()->find($folderId);
            }

            $folder = self::$folders[$folderId];
            if (! $folder) {
                break;
            }

            $chain->push($folder);
            $folderId = $folder->parent_id;
        }

        return $chain;
    }

    /**
     * Drop the folder rows.
     *
     * Called whenever a folder is created, moved, renamed or removed — a move
     * changes parent_id, which is the one field this cache is walking, so a
     * stale row would evaluate the rules against a tree that no longer exists.
     */
    public static function forgetFolders(): void
    {
        Package::forget();

        self::$folders = [];

        /*
         * The personal-drive answers go with them. Both caches are keyed by
         * folder id, and ids are reused — by a fresh database between tests,
         * and by any deployment restoring one. An id cached as "is a personal
         * drive" and then handed to a different folder is wrong in whichever
         * direction it lands: it denied firm-wide access to four ordinary
         * files before this line existed.
         */
        self::$personalDrives = [];
        self::$personalRootOwnerIds = null;
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
