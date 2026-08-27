<?php

namespace App\Http\Controllers\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Support\Files\Presenter;
use App\Support\Files\SyncScope;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * Everything in the library that has changed since a device last looked.
 *
 * The File Library's half of the offline plan's phase 2, built to the shape
 * the applications cursor proved out: the cursor is `updated_at` AND the row
 * id, so two rows saved in the same second cannot straddle a page boundary
 * and lose one; no cursor means everything, so the first walk and the
 * catch-up are one loop. Folders and files each carry their own cursor —
 * they are separate id sequences, and one shared cursor would let a burst of
 * file changes starve the folder half of the page.
 *
 * DELETIONS ARE ROWS, NOT ABSENCES
 *
 * Both models soft-delete, and a soft delete bumps `updated_at`, so the
 * deleted row itself arrives through the cursor, as a small tombstone rather
 * than a presented record. This is the SharePoint-bin lesson made structural:
 * the one thing a mirror must never do is infer a deletion from something no
 * longer being mentioned.
 *
 * Two honest limits, both settled by a fresh full walk rather than papered
 * over here: a purge (emptying the recycle bin) removes the row entirely, so
 * the tombstone a device already holds is the last it hears; and revoking a
 * share moves no row's `updated_at`, so a replica keeps records the account
 * can no longer reach until it next walks from nothing, the server refuses
 * the actual bytes either way.
 */
class SyncController extends BaseFilesController
{
    /*
     * Rows per kind per page. Presented rows are heavier than they look —
     * shares, people, review status, but the Presenter primes per page, so
     * the cost is a handful of queries per 200 rather than four per row.
     */
    private const PAGE = 200;

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $presenter = new Presenter($user);

        [$folders, $folderCursor, $moreFolders] = $this->page(
            SyncScope::folders($user),
            $request->query('foldersSince'),
            (int) $request->query('foldersAfter', 0),
        );

        [$files, $fileCursor, $moreFiles] = $this->page(
            SyncScope::files($user),
            $request->query('filesSince'),
            (int) $request->query('filesAfter', 0),
        );

        $presenter->prime(
            $files->filter(fn ($f) => ! $f->trashed())->values()->all(),
            $folders->filter(fn ($f) => ! $f->trashed())->values()->all(),
            folderExtras: false,
        );

        return response()->json([
            'folders' => $folders->map(fn (Folder $f) => $f->trashed()
                ? $this->tombstone($f, 'folder')
                // withStats false: aggregating a subtree per folder is the
                // one per-row cost priming cannot amortise, and a replica
                // recomputes counts from what it holds anyway.
                : $presenter->folder($f, withStats: false))->values()->all(),
            'files' => $files->map(fn (FileItem $f) => $f->trashed()
                ? $this->tombstone($f, 'file')
                : $presenter->file($f))->values()->all(),
            'cursor' => [
                'folders' => $folderCursor,
                'files' => $fileCursor,
            ],
            'more' => $moreFolders || $moreFiles,
        ]);
    }

    /** @return array{0: Collection, 1: array, 2: bool} */
    private function page(Builder $query, ?string $since, int $after): array
    {
        $time = $this->cursorTime($since);

        if ($time !== null) {
            /*
             * `>=` on the id tie-break, not `>`, the row the cursor ENDED on
             * is included again when its timestamp still equals the cursor's.
             * That row can change again inside the same instant (delete then
             * restore is the concrete case), and strictly-greater would skip
             * the second change for ever: the replica keeps a tombstone for a
             * file the server restored. The cost is one re-delivered row per
             * walk, which an upsert absorbs; the alternative is the silent
             * permanent kind of wrong.
             */
            $query->where(function (Builder $q) use ($time, $after) {
                $q->where('updated_at', '>', $time)
                    ->orWhere(fn (Builder $same) => $same
                        ->where('updated_at', '=', $time)
                        ->where('id', '>=', $after));
            });
        }

        $rows = $query
            ->orderBy('updated_at')
            ->orderBy('id')
            ->limit(self::PAGE)
            ->get();

        $last = $rows->last();

        return [
            $rows,
            [
                'since' => $last ? $last->updated_at?->toIso8601String() : $since,
                'after' => $last ? $last->id : $after,
            ],
            $rows->count() === self::PAGE,
        ];
    }

    /**
     * A deletion, as a record. Deliberately tiny: the device holds the full
     * row from before, and everything it needs to know now is which one and
     * that it is gone, shipping a presented corpse would cost the Presenter
     * work per deleted row for fields whose only reader is the bin.
     */
    private function tombstone(FileItem|Folder $row, string $type): array
    {
        return [
            'id' => $row->uuid,
            'type' => $type,
            'deleted' => true,
            'deletedAt' => $row->deleted_at?->toIso8601String(),
        ];
    }

    /**
     * A cursor timestamp, or null. An unparseable value is no cursor at all
     * rather than an error, the worst case is re-reading a page the device
     * already holds, and the alternative is a client that can never recover
     * from a corrupt value it stored itself.
     */
    private function cursorTime(?string $value): ?CarbonImmutable
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        try {
            return CarbonImmutable::parse($value);
        } catch (\Throwable) {
            return null;
        }
    }
}
