<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\Folder;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Files\FolderTree;
use App\Support\Realtime\Live;
use Illuminate\Support\Facades\DB;

/**
 * Taking an application off the caseload.
 *
 * Two exits, because a draft and a filed file are not the same kind of
 * record. An unfinished form that somebody threw away is not something
 * anybody should have to find later, so it is removed outright. A numbered
 * application is a file the firm referred to — it is soft-deleted, its
 * people and checklist go with it, and the paper lands in the recycle bin
 * rather than vanishing. The client the application was for is never
 * touched: they may have another filing, and the hub record is a different
 * question from this one.
 *
 * The application's folder_id is the client's folder. Recycle that tree and
 * the person disappears from the File Library with the application, which
 * is why owned folders (the people, and the extra drawers when this is
 * their last live file) are the only ones that go.
 */
class Removal
{
    /** Throw a draft away for good, or archive a filed application. */
    public static function delete(CipApplication $application, User $actor): void
    {
        if ($application->status === Status::DRAFT) {
            self::discardDraft($application, $actor);

            return;
        }

        self::archive($application, $actor);
    }

    /**
     * Throw a draft away for good.
     *
     * A hard delete, unlike a filed application, and deliberately: the
     * recycle bin is for work somebody did, and an abandoned half-filled
     * form that a reader explicitly discarded is not something anybody
     * should have to find and empty later.
     */
    public static function discardDraft(CipApplication $draft, ?User $actor = null): void
    {
        $providerIds = Contacts::providerUserIds($draft);

        /*
         * The folder goes to the recycle bin, not with it.
         *
         * A draft keeps its scans now, so throwing one away throws away
         * documents — and a reader who deletes the wrong draft has lost six
         * passports with no way back. The application and its people are
         * removed outright, because an unfiled form is not a record anybody
         * refers to; the paper is soft-deleted, so it can be restored from
         * the bin like anything else.
         */
        foreach (self::foldersOf($draft) as $folder) {
            FolderTree::softDeleteTree($folder, $actor?->id ?? $draft->created_by);
        }

        CipDocument::query()->where('application_id', $draft->id)->forceDelete();
        $draft->people()->forceDelete();
        $draft->forceDelete();

        Live::staffAnd(Live::CIP, $providerIds);
    }

    /** Soft-delete a numbered application; keep the client. */
    private static function archive(CipApplication $application, User $actor): void
    {
        $application->loadMissing(['client', 'people', 'provider']);
        $providerIds = Contacts::providerUserIds($application);
        $client = $application->client;
        $number = $application->displayNumber();

        DB::transaction(function () use ($application, $actor) {
            Engine::record($application, CipEvent::ACTION_DELETED, $actor, [
                'internalNumber' => $application->internal_number,
                'status' => $application->status,
            ]);

            self::recycleOwnedFolders($application, $actor);

            CipDocument::query()->where('application_id', $application->id)->delete();
            $application->people()->delete();
            $application->delete();
        });

        ActivityLogger::log([
            'actor' => $actor,
            'type' => 'cip.application_deleted',
            'module' => 'cip',
            'description' => $actor->name.' deleted application '.$number,
            'subject' => $application,
            'client' => $client,
        ]);

        Live::staffAnd(Live::CIP, $providerIds);
    }

    /**
     * Put a numbered file back on the caseload, with its people, checklist
     * and paper. Drafts never land here: they are discarded outright.
     */
    public static function restore(CipApplication $application, User $actor): void
    {
        if (! $application->trashed()) {
            return;
        }

        $providerIds = Contacts::providerUserIds($application);
        $number = $application->displayNumber();

        DB::transaction(function () use ($application, $actor) {
            $application->restore();
            $application->people()->onlyTrashed()->restore();
            CipDocument::onlyTrashed()->where('application_id', $application->id)->restore();

            foreach (self::trashedOwnedFolders($application) as $folder) {
                FolderTree::restoreTree($folder);
            }

            Engine::record($application, CipEvent::ACTION_RESTORED, $actor, [
                'internalNumber' => $application->internal_number,
                'status' => $application->status,
            ]);
        });

        ActivityLogger::log([
            'actor' => $actor,
            'type' => 'cip.application_restored',
            'module' => 'cip',
            'description' => $actor->name.' restored application '.$number,
            'subject' => $application,
            'client' => $application->client,
        ]);

        Live::staffAnd(Live::CIP, $providerIds);
    }

    /** Erase a numbered file that is already in the recycle bin. */
    public static function purge(CipApplication $application, ?User $actor = null): void
    {
        $actor ??= $application->creator;

        if (! $application->trashed()) {
            if ($actor === null) {
                return;
            }
            self::delete($application, $actor);

            $application = CipApplication::withTrashed()->find($application->id);
            if ($application === null) {
                return;
            }
        }

        $providerIds = Contacts::providerUserIds($application);

        foreach (self::trashedOwnedFolders($application) as $folder) {
            FolderTree::purgeTree($folder);
        }

        CipDocument::withTrashed()->where('application_id', $application->id)->forceDelete();
        $application->people()->withTrashed()->forceDelete();
        $application->forceDelete();

        Live::staffAnd(Live::CIP, $providerIds);
    }

    /**
     * Numbered files currently in the bin, as File Library rows.
     *
     * @return list<array<string, mixed>>
     */
    public static function recycleBinRows(?User $user): array
    {
        if ($user === null) {
            return [];
        }

        return ApplicationScope::query($user, CipApplication::onlyTrashed())
            ->with(['people' => fn ($q) => $q->withTrashed(), 'client'])
            ->orderByDesc('deleted_at')
            ->limit(150)
            ->get()
            ->filter(fn (CipApplication $app) => CipAccess::canDelete($user, $app))
            ->map(fn (CipApplication $app) => self::fileLibraryRow($app))
            ->values()
            ->all();
    }

    /** The label Recycle Bin uses: the file number, then the applicant. */
    public static function recycleLabel(CipApplication $application): string
    {
        $application->loadMissing(['people' => fn ($q) => $q->withTrashed(), 'client']);
        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $applicant = CipPerson::upperName(trim(($main?->first_name ?? '').' '.($main?->last_name ?? '')))
            ?: CipPerson::upperName((string) ($application->client?->name ?? ''));
        $number = $application->displayNumber();

        if ($number !== '' && $applicant !== '') {
            return $number.' · '.$applicant;
        }

        return $number !== '' ? $number : ($applicant !== '' ? $applicant : 'Application');
    }

    /**
     * Paper folders already in the bin because their application was deleted.
     *
     * Recycle Bin lists the application itself, not "Main Applicant" and
     * "Additional Documents" beside it, so those folders are kept off the
     * folder listing. Restore of the application puts them back.
     *
     * @return list<int>
     */
    public static function recycledFolderIds(): array
    {
        $personFolders = CipPerson::onlyTrashed()->whereNotNull('folder_id')->pluck('folder_id');
        $postApproval = CipApplication::onlyTrashed()
            ->whereNotNull('post_approval_folder_id')
            ->pluck('post_approval_folder_id');
        $appFolderIds = CipApplication::onlyTrashed()
            ->whereNotNull('folder_id')
            ->pluck('folder_id');
        $drawers = $appFolderIds->isEmpty()
            ? collect()
            : Folder::onlyTrashed()
                ->whereIn('parent_id', $appFolderIds)
                ->whereIn('name', [Tree::ADDITIONAL, Tree::APPEAL])
                ->pluck('id');

        return $personFolders
            ->merge($postApproval)
            ->merge($drawers)
            ->unique()
            ->filter()
            ->values()
            ->all();
    }

    /**
     * Paper that belongs to this application, not the client's own folder.
     *
     * Person folders and the post-approval drawer are this file's. Additional
     * Documents and Appeal Documents sit on the client and are shared if the
     * client has another live application, so they only go when this is the
     * last one.
     */
    private static function recycleOwnedFolders(CipApplication $application, User $actor): void
    {
        $application->loadMissing(['people', 'client']);

        $rootId = $application->folder_id;
        $clientFolderId = $application->client?->folder_id;
        $shared = $rootId !== null && $rootId === $clientFolderId;

        $ids = [];
        foreach ($application->people as $person) {
            if (self::isOwnedFolder($person->folder_id, $clientFolderId)) {
                $ids[] = $person->folder_id;
            }
        }

        $others = $application->client_id
            ? CipApplication::query()
                ->where('id', '!=', $application->id)
                ->where('client_id', $application->client_id)
                ->exists()
            : false;

        if (! $others) {
            if (self::isOwnedFolder($application->post_approval_folder_id, $clientFolderId)) {
                $ids[] = $application->post_approval_folder_id;
            }
            if ($shared) {
                foreach ([Tree::additionalFolder($application), Tree::appealFolder($application)] as $folder) {
                    if ($folder) {
                        $ids[] = $folder->id;
                    }
                }
            } elseif ($rootId && ! $shared) {
                $ids[] = $rootId;
            }
        }

        $ids = array_values(array_unique(array_filter($ids)));
        if ($ids === []) {
            return;
        }

        foreach (Folder::query()->whereIn('id', $ids)->get() as $folder) {
            FolderTree::softDeleteTree($folder, $actor->id);
        }
    }

    /**
     * Folders this deleted filing took with it, still sitting in the bin.
     *
     * @return list<Folder>
     */
    private static function trashedOwnedFolders(CipApplication $application): array
    {
        $application->loadMissing(['people' => fn ($q) => $q->withTrashed()]);

        $ids = $application->people->pluck('folder_id')->all();
        $ids[] = $application->post_approval_folder_id;

        if ($application->folder_id) {
            $ids = array_merge($ids, Folder::onlyTrashed()
                ->where('parent_id', $application->folder_id)
                ->whereIn('name', [Tree::ADDITIONAL, Tree::APPEAL])
                ->pluck('id')
                ->all());
        }

        $ids = array_values(array_unique(array_filter($ids)));
        if ($ids === []) {
            return [];
        }

        return Folder::onlyTrashed()->whereIn('id', $ids)->get()->all();
    }

    /** @return array<string, mixed> */
    private static function fileLibraryRow(CipApplication $application): array
    {
        return [
            'id' => $application->uuid,
            'type' => 'application',
            'name' => self::recycleLabel($application),
            'category' => 'application',
            'deletedAt' => optional($application->deleted_at)->toIso8601String(),
            'modifiedAt' => optional($application->deleted_at)->toIso8601String(),
            'colour' => null,
            'iconName' => null,
            'fileCount' => null,
            'folderCount' => null,
            'size' => null,
            'sizeLabel' => null,
            'owner' => null,
            'people' => [],
            'assignedTo' => [],
            'permissions' => ['delete' => true],
            'favorite' => false,
        ];
    }

    /** A folder this application owns, rather than the client's home. */
    private static function isOwnedFolder(?int $folderId, ?int $clientFolderId): bool
    {
        return $folderId !== null && $folderId !== $clientFolderId;
    }

    /**
     * Every folder this draft owns, deepest first.
     *
     * The application's own folder covers the people inside it, but a person
     * whose folder was provisioned before the tree existed can sit outside
     * it, so both are collected rather than assuming the shape.
     *
     * @return list<Folder>
     */
    private static function foldersOf(CipApplication $draft): array
    {
        $ids = $draft->people()->pluck('folder_id')->all();
        $ids[] = $draft->folder_id;
        $ids[] = $draft->post_approval_folder_id;

        $ids = array_values(array_unique(array_filter($ids)));

        if ($ids === []) {
            return [];
        }

        return Folder::query()->whereIn('id', $ids)->get()->all();
    }
}
