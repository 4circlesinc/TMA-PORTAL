<?php

namespace App\Http\Controllers\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;
use App\Support\Files\FileAccess;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The one listing endpoint behind every file area (All / My / Shared with me /
 * Shared folders / Favourites / File Box / Recent / Recycle bin). Search,
 * sort, filter and pagination all run in the database — the browser never
 * receives the whole table.
 */
class BrowserController extends BaseFilesController
{
    private const SECTIONS = ['all', 'my', 'shared', 'shared-folders', 'favorites', 'filebox', 'recent', 'recycle'];

    public function index(Request $request): JsonResponse
    {
        $user = $this->user($request);
        $section = $request->query('section', 'all');
        if (! in_array($section, self::SECTIONS, true)) {
            $section = 'all';
        }

        $perPage = min(max((int) $request->query('perPage', 60), 1), 200);
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

        if ($folderQuery) {
            $this->applyFolderFilters($folderQuery, $request, $search);
        }
        if ($fileQuery) {
            $this->applyFileFilters($fileQuery, $request, $search);
        }

        [$sort, $dir] = $this->sort($request);

        $folderTotal = $folderQuery ? (clone $folderQuery)->count() : 0;
        $fileTotal = $fileQuery ? (clone $fileQuery)->count() : 0;
        $total = $folderTotal + $fileTotal;

        // Folder-first windowing across the two tables without loading either.
        $offset = ($page - 1) * $perPage;
        $folders = collect();
        $files = collect();

        if ($folderQuery) {
            $this->orderFolders($folderQuery, $sort, $dir);
            $folders = $folderQuery->with(['owner', 'creator', 'parent'])
                ->offset($offset)->limit($perPage)->get();
        }

        $used = $folders->count();
        if ($fileQuery && $used < $perPage) {
            $fileOffset = max(0, $offset - $folderTotal);
            $this->orderFiles($fileQuery, $sort, $dir);
            $files = $fileQuery->with(['owner', 'uploader', 'folder'])
                ->offset($fileOffset)->limit($perPage - $used)->get();
        }

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
        ]);
    }

    /** @return array{0: ?Builder, 1: ?Builder} [folderQuery, fileQuery] */
    private function queriesFor(string $section, User $user, ?Folder $current, Request $request): array
    {
        // When browsing inside a folder, list that folder's direct children.
        if ($current) {
            return [
                Folder::query()->where('parent_id', $current->id),
                FileItem::query()->where('folder_id', $current->id),
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
                // scoped to `whereNull('parent_id')` — a nested folder that
                // was just touched belongs here too. A trashed folder's whole
                // subtree is soft-deleted with it (FolderTree::softDeleteTree),
                // so the default non-trashed scope already excludes orphans.
                // The bare "Client Files"/"Staff Files" root anchors are
                // structural scaffolding auto-provisioned for every user, not
                // activity — excluded, or a brand new user's Recent would show
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
            default => [ // 'all'
                $this->visibleFolders($user)->whereNull('parent_id'),
                $this->visibleFiles($user)->whereNull('folder_id'),
            ],
        };
    }

    /* ── visibility scopes ─────────────────────────── */

    private function visibleFolders(User $user): Builder
    {
        return Folder::query()->when(! FileAccess::isAdmin($user), function ($q) use ($user) {
            // Owned, shared to them, or reachable through a system rule
            // (organization folders, their staff folder, assigned clients).
            $ids = array_merge(
                FileAccess::sharedFolderIds($user),
                FileAccess::systemVisibleFolderIds($user),
            );
            $q->where(fn ($w) => $w->where('owner_id', $user->id)->orWhereIn('id', $ids ?: [0]));
        });
    }

    private function visibleFiles(User $user): Builder
    {
        return FileItem::query()->when(! FileAccess::isAdmin($user), function ($q) use ($user) {
            $ids = FileAccess::sharedFileIds($user);
            $q->where(fn ($w) => $w->where('owner_id', $user->id)->orWhereIn('id', $ids ?: [0]));
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
        if ($owner = $request->query('owner')) {
            $q->whereHas('owner', fn ($o) => $o->where('uuid', $owner)->orWhere('id', $owner));
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
        if ($owner = $request->query('owner')) {
            $q->whereHas('owner', fn ($o) => $o->where('id', $owner));
        }
    }

    private function sort(Request $request): array
    {
        $sort = $request->query('sort', 'name');
        $dir = strtolower($request->query('dir', 'asc')) === 'desc' ? 'desc' : 'asc';
        $allowed = ['name', 'created', 'modified', 'size', 'type', 'owner'];

        return [in_array($sort, $allowed, true) ? $sort : 'name', $dir];
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
