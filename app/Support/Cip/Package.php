<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\FileItem;
use App\Models\FileRequest;
use App\Models\Folder;
use App\Support\Files\FileAccess;
use App\Support\Files\FolderTree;

/**
 * §17, what freezes when a package is confirmed, and what does not.
 *
 * Confirm submission (§15) stamps `locked_at`. From that moment the original
 * per-person folders. Main Applicant, Sponsor, Dependent N, and everything
 * inside them, are view-only for everyone, including administrators. The
 * Additional Documents drawer hanging off the same client stays writable:
 * queries, non-compliance responses, supplementary papers and Unit requests
 * land there, and versioning stays on.
 *
 * Identification is by id, not by the folder's current name. Person folders
 * are `cip_people.folder_id`. The application folder itself also freezes, so
 * later paper cannot land beside the original tree. Additional Documents
 * stays writable after the original lock. Post-Approval Documents stay
 * writable after the original lock; the COR drawers freeze when the COR
 * package is confirmed ({@see CipApplication::$cor_locked_at}), and NIC
 * and Passport drawers stay open until the file is closed. A closed file
 * freezes the original tree and the post-approval drawers; Additional
 * Documents stays writable. A file that is a checklist slot is frozen even
 * if it has wandered out of a person folder; a loose file in Additional
 * Documents is never frozen.
 */
class Package
{
    /** @var array<int, bool> folder id => frozen */
    private static array $folderLock = [];

    /** @var array{people: array<int, true>, roots: array<int, true>, additional: array<int, true>, cor: array<int, true>, postOpen: array<int, true>, closed: array<int, true>}|null */
    private static ?array $maps = null;

    /** Is this library file part of a confirmed original package? */
    public static function locksFile(FileItem $file): bool
    {
        if ($file->folder_id) {
            $folder = $file->relationLoaded('folder')
                ? $file->folder
                : Folder::withTrashed()->find($file->folder_id);

            if ($folder && self::locksFolder($folder)) {
                return true;
            }
        }

        $slot = $file->relationLoaded('cipDocument')
            ? $file->cipDocument
            : $file->cipDocument()->first();

        if ($slot === null) {
            return false;
        }

        $slot->loadMissing(['application', 'requirement']);

        if ($slot->application?->isClosed()) {
            return true;
        }

        $requirement = $slot->requirement;
        if (Pack::staysOpenAfterCorLock($requirement)) {
            return false;
        }

        if ($requirement && $requirement->at_post_approval && ! $requirement->at_pre_approval) {
            return $slot->application?->isCorLocked() === true;
        }

        if ($slot->application?->isLocked() !== true) {
            return false;
        }

        if ($requirement && $requirement->at_pre_approval) {
            return true;
        }

        return false;
    }

    /**
     * Is this folder (or anything inside it) part of a confirmed original
     * package?
     *
     * Additional Documents, and everything inside it, answers no even on a
     * locked or closed application. Post-Approval Documents stay writable except the
     * COR drawers, which freeze when the COR package is confirmed. A closed
     * file freezes the post-approval tree as well.
     */
    public static function locksFolder(Folder $folder): bool
    {
        if (array_key_exists($folder->id, self::$folderLock)) {
            return self::$folderLock[$folder->id];
        }

        return self::$folderLock[$folder->id] = self::computeFolder($folder);
    }

    /**
     * A pre-lock upload link that still points at the original package.
     *
     * Used as a second door on the public landing path: confirm already
     * revokes these, but a token that somehow survived must not write.
     */
    public static function refusesRequest(FileRequest $request): bool
    {
        if ($request->document_id) {
            $slot = CipDocument::query()
                ->whereKey($request->document_id)
                ->with(['application', 'requirement', 'file'])
                ->first();

            if ($slot && self::locksDocument($slot)) {
                return true;
            }
        }

        if (! $request->folder_id) {
            return false;
        }

        $folder = Folder::withTrashed()->find($request->folder_id);

        return $folder !== null && self::locksFolder($folder);
    }

    /**
     * Is this checklist slot part of a confirmed original or COR package?
     *
     * A filled slot follows its file. An empty pre-approval slot on a locked
     * file is frozen too, so a later upload cannot quietly refill it.
     * Post-approval-only requirements freeze with the COR confirm.
     */
    public static function locksDocument(CipDocument $document): bool
    {
        $document->loadMissing(['file', 'application', 'requirement']);

        if ($document->application?->isClosed()) {
            return true;
        }

        if ($document->file) {
            return self::locksFile($document->file);
        }

        $requirement = $document->requirement;
        if (Pack::staysOpenAfterCorLock($requirement)) {
            return false;
        }

        if ($requirement && $requirement->at_post_approval && ! $requirement->at_pre_approval) {
            return $document->application?->isCorLocked() === true;
        }

        if ($document->application?->isLocked() !== true) {
            return false;
        }

        return true;
    }

    /**
     * Withdraw every open link that still targets this application's original
     * package, slot links and folder links into person trees. Links aimed at
     * Additional Documents are left alone.
     */
    public static function revokeOutstandingLinks(CipApplication $application): void
    {
        $slotIds = CipDocument::query()
            ->where('application_id', $application->id)
            ->pluck('id');

        $folderIds = self::originalFolderIds($application);

        if ($slotIds->isEmpty() && $folderIds === []) {
            return;
        }

        FileRequest::query()
            ->whereNull('revoked_at')
            ->where(function ($query) use ($slotIds, $folderIds) {
                if ($slotIds->isNotEmpty()) {
                    $query->whereIn('document_id', $slotIds);
                }
                if ($folderIds !== []) {
                    $query->orWhereIn('folder_id', $folderIds);
                }
            })
            ->update(['revoked_at' => now()]);
    }

    /**
     * Withdraw every open link that still targets this application's COR
     * tree. Original-package and Additional Documents links are left alone.
     */
    public static function revokeCorLinks(CipApplication $application): void
    {
        $slotIds = Review::constrainToPack(
            CipDocument::query()->where('application_id', $application->id),
            Pack::COR,
            $application,
        )->pluck('id');

        $folderIds = self::namedFolderIds($application, CorRequirements::FOLDER);

        if ($slotIds->isEmpty() && $folderIds === []) {
            return;
        }

        FileRequest::query()
            ->whereNull('revoked_at')
            ->where(function ($query) use ($slotIds, $folderIds) {
                if ($slotIds->isNotEmpty()) {
                    $query->whereIn('document_id', $slotIds);
                }
                if ($folderIds !== []) {
                    $query->orWhereIn('folder_id', $folderIds);
                }
            })
            ->update(['revoked_at' => now()]);
    }

    /** Drop the per-request answers. Folders moving, or a fresh lock, stale them. */
    public static function forget(): void
    {
        self::$folderLock = [];
        self::$maps = null;
    }

    private static function computeFolder(Folder $folder): bool
    {
        $maps = self::maps();

        if ($maps['people'] === [] && $maps['roots'] === [] && $maps['additional'] === []
            && $maps['cor'] === [] && $maps['postOpen'] === [] && $maps['closed'] === []) {
            return false;
        }

        $chain = self::ancestorIds($folder);

        foreach ($chain as $id) {
            if (isset($maps['additional'][$id])) {
                return false;
            }
        }

        foreach ($chain as $id) {
            if (isset($maps['closed'][$id]) || isset($maps['cor'][$id])) {
                return true;
            }
        }

        foreach ($chain as $id) {
            if (isset($maps['postOpen'][$id])) {
                return false;
            }
        }

        foreach ($chain as $id) {
            if (isset($maps['people'][$id]) || isset($maps['roots'][$id])) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{people: array<int, true>, roots: array<int, true>, additional: array<int, true>, cor: array<int, true>, postOpen: array<int, true>, closed: array<int, true>}
     */
    private static function maps(): array
    {
        if (self::$maps !== null) {
            return self::$maps;
        }

        $empty = [
            'people' => [],
            'roots' => [],
            'additional' => [],
            'cor' => [],
            'postOpen' => [],
            'closed' => [],
        ];

        $apps = CipApplication::query()
            ->where(function ($query) {
                $query->whereNotNull('locked_at')
                    ->orWhereNotNull('cor_locked_at')
                    ->orWhere('status', Status::CLOSED);
            })
            ->get(['id', 'folder_id', 'post_approval_folder_id', 'locked_at', 'cor_locked_at', 'status']);

        if ($apps->isEmpty()) {
            return self::$maps = $empty;
        }

        $original = $apps->filter(fn (CipApplication $application) => $application->locked_at !== null);
        $corLocked = $apps->filter(fn (CipApplication $application) => $application->cor_locked_at !== null);

        $people = [];
        $rootIds = [];
        $additional = [];
        $postOpen = [];

        if ($original->isNotEmpty()) {
            $people = CipPerson::query()
                ->whereIn('application_id', $original->pluck('id'))
                ->whereNotNull('folder_id')
                ->pluck('folder_id')
                ->all();

            $rootIds = $original->pluck('folder_id')->filter()->map(fn ($id) => (int) $id)->all();

            $additional = $rootIds === [] ? [] : Folder::query()
                ->whereIn('parent_id', $rootIds)
                ->where('name', Tree::ADDITIONAL)
                ->pluck('id')
                ->all();

            $postOpen = $original
                ->pluck('post_approval_folder_id')
                ->filter()
                ->map(fn ($id) => (int) $id)
                ->all();
        }

        $corLockedPost = $corLocked
            ->pluck('post_approval_folder_id')
            ->filter()
            ->map(fn ($id) => (int) $id)
            ->all();

        $postOpen = array_values(array_unique(array_merge(
            $postOpen,
            $corLockedPost,
        )));

        $cor = self::namedDescendantIds($corLockedPost, CorRequirements::FOLDER);

        $closed = [];
        $closedApps = $apps->filter(fn (CipApplication $application) => $application->isClosed());
        foreach ($closedApps as $application) {
            foreach ([$application->folder_id, $application->post_approval_folder_id] as $rootId) {
                if (! $rootId) {
                    continue;
                }
                $root = Folder::find($rootId);
                if (! $root) {
                    continue;
                }
                $closed[] = (int) $root->id;
                $closed = array_merge($closed, FolderTree::descendantIds($root));
            }
        }

        $closedRoots = $closedApps
            ->pluck('folder_id')
            ->filter()
            ->map(fn ($id) => (int) $id)
            ->all();
        if ($closedRoots !== []) {
            $additional = array_merge(
                $additional,
                Folder::query()
                    ->whereIn('parent_id', $closedRoots)
                    ->where('name', Tree::ADDITIONAL)
                    ->pluck('id')
                    ->all(),
            );
        }

        return self::$maps = [
            'people' => array_fill_keys(array_map('intval', $people), true),
            'roots' => array_fill_keys($rootIds, true),
            'additional' => array_fill_keys(array_map('intval', $additional), true),
            'cor' => array_fill_keys($cor, true),
            'postOpen' => array_fill_keys($postOpen, true),
            'closed' => array_fill_keys(array_map('intval', array_values(array_unique($closed))), true),
        ];
    }

    /**
     * Named drawers under a post-approval tree, including what sits
     * inside them.
     *
     * @param  list<int>  $rootIds
     * @return list<int>
     */
    private static function namedDescendantIds(array $rootIds, string $name): array
    {
        if ($rootIds === []) {
            return [];
        }

        $ids = [];

        foreach ($rootIds as $rootId) {
            $root = Folder::find($rootId);
            if (! $root) {
                continue;
            }

            $tree = array_merge([(int) $root->id], FolderTree::descendantIds($root));
            $named = Folder::query()
                ->whereIn('id', $tree)
                ->where('name', $name)
                ->get();

            foreach ($named as $folder) {
                $ids[] = (int) $folder->id;
                $ids = array_merge($ids, FolderTree::descendantIds($folder));
            }
        }

        return array_values(array_unique($ids));
    }

    /** @return list<int> */
    private static function namedFolderIds(CipApplication $application, string $name): array
    {
        $root = $application->post_approval_folder_id
            ? (int) $application->post_approval_folder_id
            : 0;

        return $root === 0 ? [] : self::namedDescendantIds([$root], $name);
    }

    /** @return list<int> */
    private static function originalFolderIds(CipApplication $application): array
    {
        $root = $application->folder_id ? Folder::find($application->folder_id) : null;

        if (! $root) {
            $application->loadMissing('people');
            $ids = [];
            foreach ($application->people as $person) {
                if (! $person->folder_id) {
                    continue;
                }
                $ids[] = (int) $person->folder_id;
                $folder = Folder::find($person->folder_id);
                if ($folder) {
                    $ids = array_merge($ids, FolderTree::descendantIds($folder));
                }
            }

            return array_values(array_unique($ids));
        }

        $ids = array_merge([(int) $root->id], FolderTree::descendantIds($root));
        $skip = [];

        foreach (
            Folder::query()
                ->where('parent_id', $root->id)
                ->whereIn('name', [Tree::ADDITIONAL, Tree::POST_APPROVAL])
                ->get() as $open
        ) {
            $skip[] = (int) $open->id;
            $skip = array_merge($skip, FolderTree::descendantIds($open));
        }

        $skip = array_fill_keys($skip, true);

        return array_values(array_filter(
            $ids,
            fn ($id) => ! isset($skip[(int) $id]),
        ));
    }

    /**
     * The folder and its ancestors, self first.
     *
     * Reads FileAccess's chain cache rather than keeping a second one: the
     * §17 check runs inside FileAccess::can, so by the time we are here that
     * chain has usually been fetched already, and when it has not, a listing
     * has warmed it for the whole page in one pass.
     *
     * @return list<int>
     */
    private static function ancestorIds(Folder $folder): array
    {
        return $folder->id ? FileAccess::chainIds((int) $folder->id) : [];
    }
}
