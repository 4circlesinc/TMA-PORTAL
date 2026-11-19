<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\SharePointItem;
use App\Support\Files\FolderTree;
use App\Support\Files\Naming;
use App\Support\SharePoint\Pusher;
use App\Support\SharePoint\RemoteContent;
use App\Support\SharePoint\Synchroniser;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Sleep;

/**
 * Moves the applications the portal filed into the TMA CIP Applications
 * Portal folder, and their files into its SharePoint site.
 *
 * Only client folders the PORTAL created move. A historical folder the old
 * library sync imported stays exactly where it is, still syncing with its
 * library, even when a new portal application (an Add-On, say) now uses it.
 *
 * Nothing is deleted anywhere. The copy already in Microsoft is kept as a
 * frozen archive: its mapping rows are marked archived, so the old library's
 * sync still recognises those items and leaves them alone, but nothing done
 * to them reaches the portal or drags the moved folder back.
 *
 * Per applicant folder, in this order, so a failure part-way never strands
 * anything:
 *  1. bytes that still live only in Microsoft are fetched while the old
 *     mapping can still reach them, and the folder is left alone if any
 *     cannot be;
 *  2. the old mappings are archived and the folder moves, in one transaction;
 *  3. folders then files are pushed to the new site;
 *  4. every file is checked against its new mapping.
 * Rerunning picks up wherever a previous run stopped.
 */
final class LibraryMigration
{
    /** Throttle waits per push before an item is reported rather than retried. */
    private const THROTTLE_RETRIES = 5;

    /** Longest single Retry-After honoured, seconds. */
    private const MAX_WAIT = 120;

    /**
     * Applicant folders to move: the client folder of every live portal
     * application, when the portal made it, with the provider it belongs
     * under. Where a client has several applications the newest one decides
     * the provider, matching where its next papers will be filed.
     *
     * @return Collection<int, array{folder: Folder, provider: CipProvider}>
     */
    public static function candidates(?CipProvider $only = null): Collection
    {
        $chosen = [];

        CipApplication::query()
            ->whereNotNull('client_id')
            ->when($only, fn ($q) => $q->where('provider_id', $only->id))
            ->with(['client.folder', 'provider'])
            ->orderByDesc('id')
            ->each(function (CipApplication $application) use (&$chosen) {
                $folder = $application->client?->folder;
                if (! $folder || ! $application->provider || $folder->origin === 'sharepoint') {
                    return;
                }

                $chosen[$folder->id] ??= ['folder' => $folder, 'provider' => $application->provider];
            });

        return collect(array_values($chosen));
    }

    /**
     * What moving one applicant folder involves, without changing anything.
     *
     * @return array{inPlace: bool, files: int, waiting: int, bytes: int, onSite: int}
     */
    public static function survey(Folder $folder, SharePointConnection $target): array
    {
        $files = FileItem::query()->whereIn('folder_id', self::treeIds($folder))->get(['id', 'size', 'content_state']);

        return [
            'inPlace' => PortalLibrary::contains($folder),
            'files' => $files->count(),
            'waiting' => $files->where('content_state', RemoteContent::PENDING)->count(),
            'bytes' => (int) $files->sum('size'),
            'onSite' => self::onSite($files->pluck('id')->all(), $target),
        ];
    }

    /**
     * Move one applicant folder in and push it to the site.
     *
     * @return array{status: string, reason?: string, renamed?: string, pushed: int, failed: list<string>, missing: int}
     */
    public static function migrate(Folder $folder, CipProvider $provider, SharePointConnection $target): array
    {
        $drawer = Pusher::suspend(fn () => PortalLibrary::providerFolder($provider));
        $renamed = null;

        if (! PortalLibrary::contains($folder)) {
            $unfetched = self::fetchRemoteBytes($folder);
            if ($unfetched !== null) {
                return ['status' => 'skipped', 'reason' => 'could not fetch "'.$unfetched.'" from Microsoft; nothing was moved',
                    'pushed' => 0, 'failed' => [], 'missing' => 0];
            }

            $renamed = self::archiveAndMove($folder, $drawer, $target);
        }

        return ['renamed' => $renamed] + self::pushTree($folder->fresh(), $target);
    }

    /** Every folder id in the applicant's tree, the folder itself first. */
    private static function treeIds(Folder $folder): array
    {
        return array_merge([$folder->id], FolderTree::descendantIds($folder));
    }

    /** @param  list<int>  $fileIds */
    private static function onSite(array $fileIds, SharePointConnection $target): int
    {
        if ($fileIds === []) {
            return 0;
        }

        return SharePointItem::query()
            ->where('connection_id', $target->id)
            ->whereIn('file_id', $fileIds)
            ->where('sync_status', SharePointItem::SYNCED)
            ->distinct()
            ->count('file_id');
    }

    /**
     * Bring down every byte that still lives only in Microsoft.
     *
     * Must happen BEFORE the old mappings are archived: those mappings are
     * the only way to reach the content. Returns the name of the first file
     * that could not be fetched, or null when everything is here.
     */
    private static function fetchRemoteBytes(Folder $folder): ?string
    {
        $waiting = FileItem::query()
            ->whereIn('folder_id', self::treeIds($folder))
            ->where('content_state', RemoteContent::PENDING)
            ->get();

        foreach ($waiting as $file) {
            if (! RemoteContent::ensure($file)) {
                return $file->name;
            }
        }

        return null;
    }

    /**
     * Freeze the old copies and move the folder, together.
     *
     * Returns the folder's new name when its applicant name was already
     * taken under that provider, otherwise null.
     */
    private static function archiveAndMove(Folder $folder, Folder $drawer, SharePointConnection $target): ?string
    {
        $folderIds = array_merge([$folder->id], FolderTree::descendantIdsWithTrashed($folder));
        $fileIds = FileItem::withTrashed()->whereIn('folder_id', $folderIds)->pluck('id')->all();

        return DB::transaction(fn () => Pusher::suspend(function () use ($folder, $drawer, $target, $folderIds, $fileIds) {
            $old = SharePointItem::query()
                ->where('connection_id', '!=', $target->id)
                ->where(fn ($q) => $q->whereIn('folder_id', $folderIds)->orWhereIn('file_id', $fileIds ?: [0]))
                ->get();

            foreach ($old->groupBy('connection_id') as $rows) {
                $connection = $rows->first()->connection;
                if ($connection) {
                    Synchroniser::log($connection, 'archived', 'info', null,
                        'Moved to '.PortalLibrary::folderName().': '.$folder->name.'. The copy here is kept as an archive.',
                        ['folder_id' => $folder->id, 'items' => $rows->map(fn (SharePointItem $row) => [
                            $row->graph_item_id, $row->item_type, $row->folder_id ?? $row->file_id,
                        ])->values()->all()]);
                }
            }

            SharePointItem::query()->whereIn('id', $old->pluck('id'))->update([
                'archived_at' => now(),
                'folder_id' => null,
                'file_id' => null,
                'sync_status' => SharePointItem::SYNCED,
                'failed_direction' => null,
                'failure_count' => 0,
                'last_error' => null,
            ]);

            $name = Naming::nextAvailable($folder->name, fn (string $candidate) => Folder::query()
                ->where('parent_id', $drawer->id)
                ->where('id', '!=', $folder->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($candidate)])
                ->exists());
            $renamed = $name !== $folder->name ? $name : null;
            if ($renamed !== null) {
                $folder->update(['name' => $name]);
            }

            FolderTree::move($folder, $drawer);

            return $renamed;
        }));
    }

    /**
     * Push the tree to the site and check every file landed.
     *
     * Folders go first, parents before children, so each file has its place.
     * A file already on the site is not sent again, which is what makes a
     * rerun cheap.
     *
     * @return array{status: string, pushed: int, failed: list<string>, missing: int}
     */
    private static function pushTree(Folder $folder, SharePointConnection $target): array
    {
        $failed = [];
        $pushed = 0;

        $drawer = $folder->parent;
        if ($drawer) {
            self::note($failed, $drawer->name, self::withPatience(fn () => Pusher::pushFolder($drawer)));
        }

        foreach (self::foldersTopDown($folder) as $node) {
            self::note($failed, $node->name, self::withPatience(fn () => Pusher::pushFolder($node)));
        }

        $files = FileItem::query()->whereIn('folder_id', self::treeIds($folder))->get();
        foreach ($files as $file) {
            if (self::onSite([$file->id], $target) > 0) {
                continue;
            }

            $result = self::withPatience(fn () => Pusher::pushFile($file));
            if (in_array($result['status'] ?? null, ['pushed', 'adopted', 'unchanged'], true)) {
                $pushed++;
            } else {
                $failed[] = $file->name.' ('.($result['reason'] ?? $result['status'] ?? 'unknown').')';
            }
        }

        $missing = $files->count() - self::onSite($files->pluck('id')->all(), $target);

        return [
            'status' => $missing === 0 && $failed === [] ? 'done' : 'incomplete',
            'pushed' => $pushed,
            'failed' => $failed,
            'missing' => $missing,
        ];
    }

    /** @return list<Folder> */
    private static function foldersTopDown(Folder $folder): array
    {
        $ordered = [$folder];
        $level = [$folder->id];

        while ($level !== []) {
            $children = Folder::query()->whereIn('parent_id', $level)->orderBy('id')->get();
            $ordered = array_merge($ordered, $children->all());
            $level = $children->pluck('id')->all();
        }

        return $ordered;
    }

    /** Run a push, waiting out Graph's throttling a few times before giving up. */
    private static function withPatience(callable $push): array
    {
        for ($attempt = 0; ; $attempt++) {
            $result = $push();

            if (($result['status'] ?? null) !== 'throttled' || $attempt >= self::THROTTLE_RETRIES) {
                return $result;
            }

            Sleep::for(min(self::MAX_WAIT, max(1, (int) ($result['retryAfter'] ?? 10))))->seconds();
        }
    }

    private static function note(array &$failed, string $name, array $result): void
    {
        if (in_array($result['status'] ?? null, ['failed', 'no-parent', 'throttled'], true)) {
            $failed[] = $name.'/ ('.($result['reason'] ?? $result['status']).')';
        }
    }
}
