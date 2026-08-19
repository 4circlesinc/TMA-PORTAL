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
 * §17 — what freezes when a package is confirmed, and what does not.
 *
 * Confirm submission (§15) stamps `locked_at`. From that moment the original
 * per-person folders — Main Applicant, Sponsor, Dependent N, and everything
 * inside them — are view-only for everyone, including administrators. The
 * Additional Documents drawer hanging off the same client stays writable:
 * queries, non-compliance responses, supplementary papers and Unit requests
 * land there, and versioning stays on.
 *
 * Identification is by id, not by the folder's current name. Person folders
 * are `cip_people.folder_id`. Additional Documents is the child of the
 * application's client folder named {@see Tree::ADDITIONAL}. A file that is
 * a checklist slot is frozen even if it has wandered out of a person folder;
 * a loose file in Additional Documents is never frozen.
 */
class Package
{
    /** @var array<int, bool> folder id => frozen */
    private static array $folderLock = [];

    /** @var array{people: array<int, true>, additional: array<int, true>}|null */
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

        $slot->loadMissing('application');

        return $slot->application?->isLocked() === true;
    }

    /**
     * Is this folder (or anything inside it) part of a confirmed original
     * package?
     *
     * Additional Documents and its descendants answer no, even on a locked
     * application. That is the whole of §17's exception.
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
            $application = CipDocument::query()
                ->whereKey($request->document_id)
                ->with('application')
                ->first()?->application;

            if ($application?->isLocked()) {
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
     * Withdraw every open link that still targets this application's original
     * package — slot links and folder links into person trees. Links aimed at
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

    /** Drop the per-request answers. Folders moving, or a fresh lock, stale them. */
    public static function forget(): void
    {
        self::$folderLock = [];
        self::$maps = null;
    }

    private static function computeFolder(Folder $folder): bool
    {
        $maps = self::maps();

        if ($maps['people'] === [] && $maps['additional'] === []) {
            return false;
        }

        $chain = self::ancestorIds($folder);

        foreach ($chain as $id) {
            if (isset($maps['additional'][$id])) {
                return false;
            }
        }

        foreach ($chain as $id) {
            if (isset($maps['people'][$id])) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{people: array<int, true>, additional: array<int, true>}
     */
    private static function maps(): array
    {
        if (self::$maps !== null) {
            return self::$maps;
        }

        $apps = CipApplication::query()
            ->whereNotNull('locked_at')
            ->get(['id', 'folder_id']);

        if ($apps->isEmpty()) {
            return self::$maps = ['people' => [], 'additional' => []];
        }

        $people = CipPerson::query()
            ->whereIn('application_id', $apps->pluck('id'))
            ->whereNotNull('folder_id')
            ->pluck('folder_id')
            ->all();

        $additional = Folder::query()
            ->whereIn('parent_id', $apps->pluck('folder_id')->filter()->all())
            ->where('name', Tree::ADDITIONAL)
            ->pluck('id')
            ->all();

        return self::$maps = [
            'people' => array_fill_keys(array_map('intval', $people), true),
            'additional' => array_fill_keys(array_map('intval', $additional), true),
        ];
    }

    /** @return list<int> */
    private static function originalFolderIds(CipApplication $application): array
    {
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

    /**
     * The folder and its ancestors, self first.
     *
     * Reads FileAccess's chain cache rather than keeping a second one: the
     * §17 check runs inside FileAccess::can, so by the time we are here that
     * chain has usually been fetched already — and when it has not, a listing
     * has warmed it for the whole page in one pass.
     *
     * @return list<int>
     */
    private static function ancestorIds(Folder $folder): array
    {
        return $folder->id ? FileAccess::chainIds((int) $folder->id) : [];
    }
}
