<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\Folder;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Files\FolderTree;
use App\Support\Realtime\Live;
use Illuminate\Support\Facades\DB;

/**
 * Taking an application off the caseload.
 *
 * A draft and a filed file leave the same way. Both are soft-deleted, with
 * their people and checklist, and both show in the recycle bin so a reader
 * who removed the wrong one can put it back. The client the application was
 * for is never touched: they may have another filing, and the hub record is
 * a different question from this one.
 *
 * The application's folder_id is the client's folder. Recycle that tree and
 * the person disappears from the File Library with the application, which
 * is why owned folders (the people, and the extra drawers when this is
 * their last live file) are the only ones that go.
 */
class Removal
{
    /** Archive an application, draft or filed, into the recycle bin. */
    public static function delete(CipApplication $application, User $actor): void
    {
        self::archive($application, $actor);
    }

    /**
     * Take a draft off the form and into the recycle bin.
     *
     * Start over and an emptied form used to destroy the row. The file had
     * already been numbered and, once a name was on it, was something the
     * firm could see. Throwing that away with no way back is how a filing
     * disappeared between one save and the next. It now archives, the same
     * as Delete on the table.
     */
    public static function discardDraft(CipApplication $draft, ?User $actor = null): void
    {
        $actor ??= $draft->creator;
        if (! $actor instanceof User) {
            return;
        }

        self::archive($draft, $actor);
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
                'cipNumber' => $application->cip_number,
                'status' => $application->status,
            ]);

            self::recycleOwnedFolders($application, $actor);

            CipDocument::query()->where('application_id', $application->id)->delete();
            $application->people()->delete();

            /*
             * Free the numbers the unique indexes still hold.
             *
             * Soft-deleted rows stay in those indexes. Leaving the Unit
             * number set would block it for a filing nobody can see; it
             * rides in the deleted event above and is put back on restore.
             * A draft's submission key is how the open form finds its row,
             * and leaving that set would make the next save of the same
             * form collide with a file already in the bin.
             */
            $application->forceFill([
                'cip_number' => null,
                'submission_key' => $application->status === Status::DRAFT ? null : $application->submission_key,
            ])->save();
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
     * Put a file back on the caseload, with its people, checklist and paper.
     * A restored draft comes back as a draft.
     */
    public static function restore(CipApplication $application, User $actor): void
    {
        if (! $application->trashed()) {
            return;
        }

        $providerIds = Contacts::providerUserIds($application);
        $number = $application->displayNumber();
        $cipNumber = self::archivedCipNumber($application);

        if ($cipNumber !== null && $cipNumber !== '') {
            Submission::assertNumberFree($cipNumber, $application);
        }

        DB::transaction(function () use ($application, $actor, $cipNumber) {
            $application->restore();
            $application->people()->onlyTrashed()->restore();
            CipDocument::onlyTrashed()->where('application_id', $application->id)->restore();

            if ($cipNumber !== null && $cipNumber !== '' && $application->cip_number === null) {
                $application->forceFill(['cip_number' => $cipNumber])->save();
            }

            foreach (self::trashedOwnedFolders($application) as $folder) {
                FolderTree::restoreTree($folder);
            }

            Engine::record($application, CipEvent::ACTION_RESTORED, $actor, [
                'internalNumber' => $application->internal_number,
                'cipNumber' => $application->cip_number,
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

    /**
     * The Unit number this file held when it was archived.
     *
     * Cleared on the row so another filing can use it while this one sits in
     * the bin; recovered here from the deleted event.
     */
    private static function archivedCipNumber(CipApplication $application): ?string
    {
        if ($application->cip_number !== null && $application->cip_number !== '') {
            return $application->cip_number;
        }

        $event = CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_DELETED)
            ->orderByDesc('id')
            ->first();

        $meta = $event?->meta;

        if (! is_array($meta)) {
            return null;
        }

        $number = $meta['cipNumber'] ?? null;

        return is_string($number) && $number !== '' ? $number : null;
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
            ->with([
                'people' => fn ($q) => $q->withTrashed(),
                'client.user:id,avatar_url,provider_avatar_url',
            ])
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
     * The face the recycle bin draws for this file.
     *
     * The same order as the worklist: the passport likeness on the main
     * applicant, then the hub client's photo, then a live portal login.
     * A folder mark made a person look like a drawer.
     */
    public static function portrait(CipApplication $application): ?string
    {
        $application->loadMissing([
            'people' => fn ($q) => $q->withTrashed(),
            'client.user',
        ]);

        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);

        if ($main?->photo_url) {
            return $main->photo_url;
        }

        if ($main?->photo_path) {
            return '/portal/cip/people/'.$main->uuid.'/passport-photo?v='
                .substr(md5($main->photo_path.'|'.($main->updated_at?->getTimestamp() ?? 0)), 0, 8);
        }

        $client = $application->client;

        if ($client?->photo_url) {
            return $client->photo_url;
        }

        if ($client && $client->hasLiveLogin()) {
            return $client->user?->photoUrl();
        }

        return null;
    }

    /** The applicant's name alone, for the initials tile when there is no photo. */
    public static function portraitName(CipApplication $application): string
    {
        $application->loadMissing([
            'people' => fn ($q) => $q->withTrashed(),
            'client',
        ]);
        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $name = trim(($main?->first_name ?? '').' '.($main?->last_name ?? ''));

        return $name !== '' ? $name : (string) ($application->client?->name ?? '');
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
        // Both of a person's repositories: the package folder and the one
        // under Post-Approval Documents. A person holds two folders now, and
        // recycling only the first left the other loose in the bin's shadow.
        $personFolders = CipPerson::onlyTrashed()
            ->whereNotNull('folder_id')
            ->pluck('folder_id')
            ->merge(
                CipPerson::onlyTrashed()
                    ->whereNotNull('post_approval_folder_id')
                    ->pluck('post_approval_folder_id')
            )
            ->unique()
            ->values();
        $postApproval = CipApplication::onlyTrashed()
            ->whereNotNull('post_approval_folder_id')
            ->pluck('post_approval_folder_id');
        $appFolderIds = CipApplication::onlyTrashed()
            ->whereNotNull('folder_id')
            ->pluck('folder_id');
        $drawers = $appFolderIds->isEmpty()
            ? collect()
            : Tree::drawersNamed(
                $appFolderIds->all(),
                [Tree::ADDITIONAL, Tree::APPEAL, Tree::SUPPORTING, Tree::ASSESSMENT_FEEDBACK],
                trashed: true,
            )->pluck('id');

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
            // The package folder and the post-approval one both belong to the
            // person, so a deleted file takes both with it.
            foreach ([$person->folder_id, $person->post_approval_folder_id] as $folderId) {
                if (self::isOwnedFolder($folderId, $clientFolderId)) {
                    $ids[] = $folderId;
                }
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
                foreach ([
                    Tree::additionalFolder($application),
                    Tree::appealFolder($application),
                    Tree::supportingFolder($application),
                    Tree::assessmentFeedbackFolder($application),
                ] as $folder) {
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
            $ids = array_merge($ids, Tree::drawersNamed(
                [$application->folder_id],
                [Tree::ADDITIONAL, Tree::APPEAL, Tree::SUPPORTING, Tree::ASSESSMENT_FEEDBACK],
                trashed: true,
            )->pluck('id')->all());
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
            'avatarUrl' => self::portrait($application),
            'applicantName' => self::portraitName($application),
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

}
