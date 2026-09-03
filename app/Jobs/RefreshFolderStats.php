<?php

namespace App\Jobs;

use App\Models\FileItem;
use App\Models\Folder;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;

/**
 * Rolls every live folder's subtree totals (files, folders, bytes) up into
 * the subtree_* columns the File Library reads.
 *
 * Two grouped reads and a PHP walk, instead of the recursive CTE that cost
 * 5.7s against the production tree: one pass over the files table for
 * direct sums, the folder tree in memory, children folded into parents
 * bottom-up. Writes go through the query builder on purpose - Folder carries
 * SharePoint and live-update observers, and a stats refresh must not bump
 * updated_at, mirror anything out, or ring any doorbells - and only rows
 * whose numbers actually changed are written, so the steady-state run
 * writes almost nothing.
 */
class RefreshFolderStats implements ShouldQueue, ShouldBeUniqueUntilProcessing
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 600;

    public int $uniqueFor = 540;

    /** Chunk size for the CASE-batched updates. */
    private const WRITE_CHUNK = 500;

    public function handle(): void
    {
        $folders = Folder::query()
            ->reorder()
            ->get(['id', 'parent_id', 'subtree_file_count', 'subtree_folder_count', 'subtree_size']);

        $direct = FileItem::query()
            ->reorder()
            ->selectRaw('folder_id, count(*) as n, coalesce(sum(size), 0) as bytes')
            ->groupBy('folder_id')
            ->get();

        $fileCount = [];
        $size = [];
        foreach ($direct as $row) {
            $fileCount[(int) $row->folder_id] = (int) $row->n;
            $size[(int) $row->folder_id] = (int) $row->bytes;
        }

        $children = [];
        foreach ($folders as $f) {
            if ($f->parent_id !== null) {
                $children[(int) $f->parent_id][] = (int) $f->id;
            }
        }

        /*
         * Iterative post-order from every folder (roots included), children
         * folded into parents once all of theirs are done. The visited set
         * guards a parent_id cycle: a broken tree gets wrong numbers, never
         * a spinning worker.
         */
        $stats = [];
        $visited = [];

        foreach ($folders as $f) {
            $rootId = (int) $f->id;
            if (isset($visited[$rootId])) {
                continue;
            }

            $stack = [[$rootId, false]];

            while ($stack) {
                [$id, $childrenDone] = array_pop($stack);

                if ($childrenDone) {
                    $totals = [
                        'files' => $fileCount[$id] ?? 0,
                        'folders' => 0,
                        'size' => $size[$id] ?? 0,
                    ];
                    foreach ($children[$id] ?? [] as $childId) {
                        $c = $stats[$childId] ?? null;
                        if ($c) {
                            $totals['files'] += $c['files'];
                            $totals['folders'] += 1 + $c['folders'];
                            $totals['size'] += $c['size'];
                        }
                    }
                    $stats[$id] = $totals;

                    continue;
                }

                if (isset($visited[$id])) {
                    continue;
                }
                $visited[$id] = true;

                $stack[] = [$id, true];
                foreach ($children[$id] ?? [] as $childId) {
                    if (! isset($visited[$childId])) {
                        $stack[] = [$childId, false];
                    }
                }
            }
        }

        $changed = [];
        foreach ($folders as $f) {
            $s = $stats[(int) $f->id] ?? null;
            if (! $s) {
                continue;
            }

            if ((int) $f->subtree_file_count !== $s['files']
                || (int) $f->subtree_folder_count !== $s['folders']
                || (int) $f->subtree_size !== $s['size']
                || $f->subtree_size === null) {
                $changed[(int) $f->id] = $s;
            }
        }

        foreach (array_chunk(array_keys($changed), self::WRITE_CHUNK) as $ids) {
            $this->writeChunk($ids, $changed);
        }
    }

    /**
     * One UPDATE for up to WRITE_CHUNK rows, CASE-keyed by id. The query
     * builder (not Eloquent) so observers stay quiet and updated_at is left
     * alone - a stats refresh is not an edit.
     *
     * @param  array<int, int>  $ids
     * @param  array<int, array{files: int, folders: int, size: int}>  $stats
     */
    private function writeChunk(array $ids, array $stats): void
    {
        $fileCase = 'case id ';
        $folderCase = 'case id ';
        $sizeCase = 'case id ';
        $bindings = [];

        foreach ($ids as $id) {
            $fileCase .= 'when ? then ? ';
            $bindings[] = $id;
            $bindings[] = $stats[$id]['files'];
        }
        foreach ($ids as $id) {
            $folderCase .= 'when ? then ? ';
            $bindings[] = $id;
            $bindings[] = $stats[$id]['folders'];
        }
        foreach ($ids as $id) {
            $sizeCase .= 'when ? then ? ';
            $bindings[] = $id;
            $bindings[] = $stats[$id]['size'];
        }

        $in = implode(',', array_fill(0, count($ids), '?'));
        foreach ($ids as $id) {
            $bindings[] = $id;
        }

        DB::update(
            'update folders set '
            .'subtree_file_count = '.$fileCase.'end, '
            .'subtree_folder_count = '.$folderCase.'end, '
            .'subtree_size = '.$sizeCase.'end '
            ."where id in ($in)",
            $bindings,
        );
    }
}
