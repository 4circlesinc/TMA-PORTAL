<?php

namespace App\Http\Controllers\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\CipAccess;
use App\Support\Files\FileAccess;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\SyncScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The one listing endpoint behind every file area (All / Clients / My /
 * Shared with me / Shared folders / Favourites / File Box / Recent /
 * Recycle bin). Search, sort, filter and pagination all run in the database,
 * the browser never receives the whole table.
 */
class BrowserController extends BaseFilesController
{
    private const SECTIONS = ['all', 'my', 'shared', 'shared-folders', 'favorites', 'filebox', 'recent', 'recycle', 'clients'];

    public function index(Request $request): JsonResponse
    {
        $user = $this->user($request);
        $section = $request->query('section', 'all');
        if (! in_array($section, self::SECTIONS, true)) {
            $section = 'all';
        }

        // perPage=0 means everything: the library shows whole folders, not
        // windows of them. The ceiling is a runaway guard, not a page size.
        $requested = (int) $request->query('perPage', 60);
        $perPage = $requested === 0 ? 100000 : min(max($requested, 1), 200);
        $page = max((int) $request->query('page', 1), 1);
        $search = trim((string) $request->query('search', ''));

        // Browsing into a folder (breadcrumb navigation) is available in any
        // section; it lists that folder's children once the viewer may see it.
        $current = null;
        if ($uuid = $request->query('folder')) {
            $current = $this->findFolder($uuid);
            FileAccess::authorize($user, 'view', $current);
        }

        [$folderQuery, $fileQuery] = $this->queriesFor($section, $user, $current, $request);

        // Optional: return only files or only folders. Used by Overview
        // "Latest Files" so a flood of recent folders can't starve the file list
        // (folder-first windowing below would otherwise return 0 files).
        $only = strtolower((string) $request->query('only', ''));
        if ($only === 'files') {
            $folderQuery = null;
        } elseif ($only === 'folders') {
            $fileQuery = null;
        }

        if ($folderQuery) {
            $this->applyFolderFilters($folderQuery, $request, $search);
        }
        if ($fileQuery) {
            $this->applyFileFilters($fileQuery, $request, $search);
        }

        /*
         * Who owns things here, with a count each, what the Owner column's
         * filter offers.
         *
         * Measured before the owner constraint is applied, and that ordering is
         * the whole trick: a facet that narrowed itself would list only the
         * owner already chosen, leaving no way back to anyone else.
         */
        $owners = $this->ownerFacet($folderQuery, $fileQuery);

        $this->applyOwnerFilter($folderQuery, $fileQuery, $request);

        [$sort, $dir] = $this->sort($request, $section);

        $folderTotal = $folderQuery ? (clone $folderQuery)->count() : 0;
        $fileTotal = $fileQuery ? (clone $fileQuery)->count() : 0;
        $total = $folderTotal + $fileTotal;

        $offset = ($page - 1) * $perPage;
        $folders = collect();
        $files = collect();

        if ($section === 'recent' && $folderQuery && $fileQuery) {
            [$folders, $files] = $this->recencyWindow($folderQuery, $fileQuery, $sort, $dir, $offset, $perPage);
        } else {
            // Folder-first windowing across the two tables without loading either.
            if ($folderQuery) {
                $this->orderFolders($folderQuery, $sort, $dir);
                $folders = $folderQuery->with(['owner', 'creator', 'parent'])
                    ->offset($offset)->limit($perPage)->get();
            }

            $taken = $folders->count();
            if ($fileQuery && $taken < $perPage) {
                $fileOffset = max(0, $offset - $folderTotal);
                $this->orderFiles($fileQuery, $sort, $dir);
                $files = $fileQuery->with(['owner', 'uploader', 'folder'])
                    ->offset($fileOffset)->limit($perPage - $taken)->get();
            }
        }

        $used = $folders->count();

        $presenter = $this->presenter($request);
        $presenter->prime($files->all(), $folders->all());

        $withStats = $section !== 'recycle';

        return response()->json([
            'section' => $section,
            'folder' => $current ? ['id' => $current->uuid, 'name' => $current->name] : null,
            'breadcrumb' => $current ? $this->breadcrumb($current) : [],
            'folders' => $folders->map(fn (Folder $f) => $presenter->folder($f, $withStats))->values(),
            'files' => $files->map(fn (FileItem $f) => $presenter->file($f))->values(),
            'page' => $page,
            'perPage' => $perPage,
            'total' => $total,
            'hasMore' => ($offset + $used + $files->count()) < $total,
            'counts' => ['folders' => $folderTotal, 'files' => $fileTotal],
            'owners' => $owners,
        ]);
    }

    /**
     * The owners of everything in scope, with how much each holds.
     *
     * Two grouped counts, one per table, rather than a row per item, so the
     * facet costs the same whether the folder holds ten files or ten thousand.
     * Both queries arrive already narrowed to what this account may see, which
     * is what keeps the facet from naming people whose files the viewer cannot
     * open.
     *
     * @return array<int, array{id: int, name: string, n: int}>
     */
    private function ownerFacet(?Builder $folderQuery, ?Builder $fileQuery): array
    {
        $counts = [];

        foreach ([$folderQuery, $fileQuery] as $query) {
            if (! $query) {
                continue;
            }

            // reorder(): the listing sorts by columns this GROUP BY does not
            // name, which Postgres rejects outright.
            $rows = (clone $query)->reorder()
                ->selectRaw('owner_id, count(*) as n')
                ->groupBy('owner_id')
                ->pluck('n', 'owner_id');

            foreach ($rows as $ownerId => $n) {
                if (! $ownerId) {
                    continue;
                }
                $counts[$ownerId] = ($counts[$ownerId] ?? 0) + (int) $n;
            }
        }

        if (! $counts) {
            return [];
        }

        $names = User::query()->whereIn('id', array_keys($counts))->pluck('name', 'id');

        $owners = [];
        foreach ($counts as $id => $n) {
            // A deleted account still owns rows; without a name there is
            // nothing to put in the menu, so it is left out rather than
            // offered as a blank line that filters to something.
            if (! isset($names[$id])) {
                continue;
            }
            $owners[] = ['id' => (int) $id, 'name' => $names[$id], 'n' => $n];
        }

        // Busiest first, the useful end of a list nobody wants to read.
        usort($owners, fn ($a, $b) => [$b['n'], strtolower($a['name'])] <=> [$a['n'], strtolower($b['name'])]);

        return $owners;
    }

    private function applyOwnerFilter(?Builder $folderQuery, ?Builder $fileQuery, Request $request): void
    {
        $owner = (int) $request->query('owner', 0);
        if (! $owner) {
            return;
        }

        foreach ([$folderQuery, $fileQuery] as $query) {
            if ($query) {
                $query->where('owner_id', $owner);
            }
        }
    }

    /** @return array{0: ?Builder, 1: ?Builder} [folderQuery, fileQuery] */
    private function queriesFor(string $section, User $user, ?Folder $current, Request $request): array
    {
        // When browsing inside a folder, list that folder's direct children,
        // scoped to what this user may actually see. Without the visibility
        // scope an admin browsing a client folder returns every subfolder and
        // file even if they have no access, and a large client folder returns
        // the whole unindexed table for non-admin users.
        if ($current) {
            return [
                $this->visibleFolders($user)->where('parent_id', $current->id),
                $this->visibleFiles($user)->where('folder_id', $current->id),
            ];
        }

        return match ($section) {
            'my' => [
                $this->ownedFolders($user)->whereNull('parent_id'),
                $this->ownedFiles($user)->whereNull('folder_id'),
            ],
            'filebox' => [
                null,
                $this->ownedFiles($user)->whereNull('folder_id'),
            ],
            'favorites' => [
                $this->favoriteFolders($user),
                $this->favoriteFiles($user),
            ],
            'shared' => [
                Folder::query()->whereIn('id', FileAccess::sharedFolderIds($user) ?: [0]),
                FileItem::query()->whereIn('id', FileAccess::sharedFileIds($user) ?: [0]),
            ],
            'shared-folders' => [
                $this->sharedOutFolders($user),
                null,
            ],
            'recent' => [
                // Recency, not tree position, so unlike 'all'/'my' this isn't
                // scoped to `whereNull('parent_id')`, a nested folder that
                // was just touched belongs here too. A trashed folder's whole
                // subtree is soft-deleted with it (FolderTree::softDeleteTree),
                // so the default non-trashed scope already excludes orphans.
                // The bare "Clients"/"Staff Files" root anchors are
                // structural scaffolding auto-provisioned for every user, not
                // activity, excluded, or a brand new user's Recent would show
                // nothing but two empty containers created moments earlier.
                // Actual client/organization/staff folders (not the root type)
                // still belong here.
                $this->visibleFolders($user)
                    ->where('folder_type', '!=', Folder::TYPE_ROOT)
                    ->orderByDesc('updated_at'),
                // File Box files (folder_id null) must be included: `folder_id
                // NOT IN (...)` is never true for NULL, so they'd silently drop.
                $this->visibleFiles($user)
                    ->where(fn ($q) => $q->whereNull('folder_id')
                        ->orWhereNotIn('folder_id', $this->trashedFolderIds() ?: [0]))
                    ->orderByDesc('updated_at'),
            ],
            'recycle' => [
                $this->trashedTopFolders($user),
                $this->trashedTopFiles($user),
            ],
            'clients' => [
                // The main folder for each client this account may open, not
                // the "Clients" root (that root lists every client and is
                // administrator-only). Staff see assigned clients, a provider
                // contact sees the folders their firm filed.
                $this->visibleFolders($user)->where('folder_type', Folder::TYPE_CLIENT),
                null,
            ],
            default => $this->allSectionQueries($user),
        };
    }

    /**
     * All Files. Staff see the organization tree. External CIP accounts see
     * only the Clients library, never Staff Files or anyone else's drive.
     *
     * @return array{0: ?Builder, 1: ?Builder}
     */
    private function allSectionQueries(User $user): array
    {
        if (! Role::can($user, 'files.viewOrg')) {
            $root = $this->clientsRootFor($user);

            return [
                Folder::query()->where('id', $root?->id ?: 0),
                null,
            ];
        }

        return [
            $this->visibleFolders($user)->whereNull('parent_id'),
            $this->visibleFiles($user)->whereNull('folder_id'),
        ];
    }

    private function clientsRootFor(User $user): ?Folder
    {
        if (! CipAccess::canReach($user)) {
            return null;
        }

        $root = FolderProvisioner::clientsRoot();

        return FileAccess::can($user, 'view', $root) ? $root : null;
    }

    /* ── visibility scopes ─────────────────────────── */

    private function visibleFolders(User $user): Builder
    {
        return Folder::query()->when(! FileAccess::isAdmin($user), function ($q) use ($user) {
            // Non-admin access flows downward from visible roots (assigned
            // client folders, org folders, their own staff folder). Using only
            // those root ids made "Clients" open to an empty listing for
            // assigned staff because the contents live beneath the granted
            // folder, not at the root id itself.
            $ids = SyncScope::folderIds($user);
            $q->whereIn('id', $ids ?: [0]);
        })->when(FileAccess::isAdmin($user), function ($q) use ($user) {
            // Administrators see the whole library EXCEPT other people's
            // root-mirrored OneDrive space: FileAccess denies opening it, so
            // listing it would only advertise names nobody may click.
            $hidden = array_values(array_diff(FileAccess::personalRootOwnerIds(), [$user->id]));
            if ($hidden !== []) {
                $q->whereNot(fn ($w) => $w->where('folder_type', Folder::TYPE_USER)
                    ->whereIn('owner_id', $hidden)
                    ->whereNotIn('id', FileAccess::sharedFolderIds($user) ?: [0]));
            }
        });
    }

    private function visibleFiles(User $user): Builder
    {
        return FileItem::query()->when(! FileAccess::isAdmin($user), function ($q) use ($user) {
            $folderIds = SyncScope::folderIds($user);
            $ids = FileAccess::sharedFileIds($user);
            $q->where(fn ($w) => $w->where('owner_id', $user->id)
                ->orWhereIn('id', $ids ?: [0])
                ->orWhereIn('folder_id', $folderIds ?: [0]));
        })->when(FileAccess::isAdmin($user), function ($q) use ($user) {
            // Mirror of the folder rule, at ANY depth. Recent and search list
            // nested files, so "top level only" here leaked the inside of
            // people's drives. A hidden owner's file is personal space when it
            // is unfiled or inside a personal (user-type) folder; only an
            // explicit share overrides that.
            $hidden = array_values(array_diff(FileAccess::personalRootOwnerIds(), [$user->id]));
            if ($hidden !== []) {
                $q->whereNot(fn ($w) => $w->whereIn('owner_id', $hidden)
                    ->where(fn ($p) => $p->whereNull('folder_id')
                        ->orWhereIn('folder_id', Folder::query()->select('id')
                            ->where('folder_type', Folder::TYPE_USER)
                            ->whereIn('owner_id', $hidden)))
                    ->whereNotIn('id', FileAccess::sharedFileIds($user) ?: [0]));
            }
        });
    }

    private function ownedFolders(User $user): Builder
    {
        return Folder::query()->where('owner_id', $user->id);
    }

    private function ownedFiles(User $user): Builder
    {
        return FileItem::query()->where('owner_id', $user->id);
    }

    private function favoriteFolders(User $user): Builder
    {
        $ids = $user->favorites()->where('item_type', 'folder')->pluck('item_id')->all();

        return Folder::query()->whereIn('id', $ids ?: [0]);
    }

    private function favoriteFiles(User $user): Builder
    {
        $ids = $user->favorites()->where('item_type', 'file')->pluck('item_id')->all();

        return FileItem::query()->whereIn('id', $ids ?: [0]);
    }

    private function sharedOutFolders(User $user): Builder
    {
        $ids = Share::query()
            ->where('item_type', 'folder')->whereNull('revoked_at')
            ->pluck('item_id')->unique()->all();

        return $this->visibleFolders($user)->whereIn('id', $ids ?: [0]);
    }

    private function trashedFolderIds(): array
    {
        return Folder::onlyTrashed()->pluck('id')->all() ?: [0];
    }

    private function trashedTopFolders(User $user): Builder
    {
        $trashed = $this->trashedFolderIds();

        return Folder::onlyTrashed()
            ->when(! FileAccess::isAdmin($user), fn ($q) => $q->where('owner_id', $user->id))
            // Only the top of a deleted subtree, so contents aren't listed twice.
            ->where(fn ($q) => $q->whereNull('parent_id')->orWhereNotIn('parent_id', $trashed));
    }

    private function trashedTopFiles(User $user): Builder
    {
        $trashed = $this->trashedFolderIds();

        return FileItem::onlyTrashed()
            ->when(! FileAccess::isAdmin($user), fn ($q) => $q->where('owner_id', $user->id))
            ->where(fn ($q) => $q->whereNull('folder_id')->orWhereNotIn('folder_id', $trashed));
    }

    /* ── filters, search, sort ─────────────────────── */

    private function applyFolderFilters(Builder $q, Request $request, string $search): void
    {
        if ($search !== '') {
            $like = '%'.mb_strtolower($search).'%';
            $q->whereRaw('LOWER(name) LIKE ?', [$like]);
        }
        if ($request->boolean('favorite')) {
            $q->whereIn('id', $request->user()->favorites()->where('item_type', 'folder')->pluck('item_id')->all() ?: [0]);
        }
    }

    private function applyFileFilters(Builder $q, Request $request, string $search): void
    {
        if ($search !== '') {
            $like = '%'.mb_strtolower($search).'%';
            $q->where(function ($w) use ($search, $like) {
                $w->whereRaw('LOWER(name) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(extension) = ?', [mb_strtolower($search)])
                    ->orWhereHas('owner', fn ($o) => $o->whereRaw('LOWER(name) LIKE ?', [$like]))
                    ->orWhereHas('uploader', fn ($o) => $o->whereRaw('LOWER(name) LIKE ?', [$like]));
            });
        }
        if ($type = $request->query('type')) {
            $exts = $this->extensionsForCategory($type);
            if ($exts) {
                $q->whereIn('extension', $exts);
            }
        }
        if ($ext = $request->query('extension')) {
            $q->where('extension', strtolower($ext));
        }
        if ($request->boolean('favorite')) {
            $q->whereIn('id', $request->user()->favorites()->where('item_type', 'file')->pluck('item_id')->all() ?: [0]);
        }
    }

    /**
     * @param  string  $section  Recent is ordered by when things changed, so
     *                           that is its default rather than by name — the
     *                           alphabetical default made the section a second
     *                           copy of All Files that happened to be flatter.
     */
    private function sort(Request $request, string $section = 'all'): array
    {
        $default = $section === 'recent' ? 'modified' : 'name';
        $sort = $request->query('sort', $default);
        $defaultDir = $section === 'recent' && $sort === 'modified' ? 'desc' : 'asc';
        $dir = strtolower($request->query('dir', $defaultDir)) === 'desc' ? 'desc' : 'asc';
        $allowed = ['name', 'created', 'modified', 'size', 'type', 'owner'];

        return [in_array($sort, $allowed, true) ? $sort : $default, $dir];
    }

    /**
     * One window over both tables, ordered together.
     *
     * Everywhere else the listing takes folders first and gives files what is
     * left, which is how a file manager should read a folder. Recent is not a
     * folder: it is a single list in time order, and folders-first turned it
     * into "every folder you can see, alphabetically, and files only once you
     * run out of folders" — which for any real library meant never. The
     * Overview widget worked around it by asking for `only=files`, so the same
     * account saw recent files there and an empty table here.
     *
     * Both sides are read to the end of the requested window and merged in
     * PHP. That costs `offset + perPage` rows per table, which is bounded by
     * the same clamp as any other page.
     *
     * @return array{0: \Illuminate\Support\Collection, 1: \Illuminate\Support\Collection}
     */
    private function recencyWindow(Builder $folderQuery, Builder $fileQuery, string $sort, string $dir, int $offset, int $perPage): array
    {
        $reach = $offset + $perPage;

        $this->orderFolders($folderQuery, $sort, $dir);
        $this->orderFiles($fileQuery, $sort, $dir);

        $folders = $folderQuery->with(['owner', 'creator', 'parent'])->limit($reach)->get();
        $files = $fileQuery->with(['owner', 'uploader', 'folder'])->limit($reach)->get();

        // Microseconds, not seconds: a bulk import writes hundreds of rows
        // inside one second, and a whole-second key would order them by which
        // table they came out of rather than by when they landed.
        $key = match ($sort) {
            'created' => fn ($row) => $row->created_at?->getPreciseTimestamp(6) ?? 0,
            'modified' => fn ($row) => $row->updated_at?->getPreciseTimestamp(6) ?? 0,
            // Folders have no size or extension to compare against a file's,
            // so those orderings fall back to the one column both tables share.
            default => fn ($row) => mb_strtolower((string) $row->name),
        };

        $merged = $folders->map(fn ($row) => ['kind' => 'folder', 'row' => $row, 'key' => $key($row)])
            ->concat($files->map(fn ($row) => ['kind' => 'file', 'row' => $row, 'key' => $key($row)]))
            ->sortBy('key', SORT_REGULAR, $dir === 'desc')
            ->values()
            ->slice($offset, $perPage);

        return [
            $merged->where('kind', 'folder')->pluck('row')->values(),
            $merged->where('kind', 'file')->pluck('row')->values(),
        ];
    }

    private function orderFolders(Builder $q, string $sort, string $dir): void
    {
        match ($sort) {
            'created' => $q->orderBy('created_at', $dir),
            'modified' => $q->orderBy('updated_at', $dir),
            default => $q->orderBy('name', $dir),
        };
    }

    private function orderFiles(Builder $q, string $sort, string $dir): void
    {
        match ($sort) {
            'created' => $q->orderBy('created_at', $dir),
            'modified' => $q->orderBy('updated_at', $dir),
            'size' => $q->orderBy('size', $dir),
            'type' => $q->orderBy('extension', $dir)->orderBy('name', 'asc'),
            default => $q->orderBy('name', $dir),
        };
    }

    private function extensionsForCategory(string $category): array
    {
        $map = [
            'pdf' => ['pdf'],
            'word' => ['doc', 'docx', 'rtf', 'odt'],
            'excel' => ['xls', 'xlsx', 'ods', 'csv'],
            'powerpoint' => ['ppt', 'pptx', 'odp'],
            'image' => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'svg'],
            'video' => ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'],
            'audio' => ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'],
            'archive' => ['zip', 'rar', '7z', 'tar', 'gz'],
            'text' => ['txt', 'md', 'log'],
        ];

        return $map[strtolower($category)] ?? [];
    }

    private function breadcrumb(Folder $folder): array
    {
        $trail = [];
        $seen = [];
        $node = $folder;

        while ($node && ! isset($seen[$node->id])) {
            $seen[$node->id] = true;
            array_unshift($trail, ['id' => $node->uuid, 'name' => $node->name]);
            $node = $node->parent;
        }

        return $trail;
    }
}
