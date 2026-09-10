<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\Folder;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
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
