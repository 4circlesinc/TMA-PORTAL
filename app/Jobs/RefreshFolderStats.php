<?php

namespace App\Jobs;

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
        /*
         * Query-builder reads streamed into primitive arrays, never Eloquent:
         * hydrating the production tree (74k folders) as models exhausted a
         * 256MB worker before the walk even started.
         */
        $parent = [];
        $current = [];
        foreach (DB::table('folders')->whereNull('deleted_at')
            ->select('id', 'parent_id', 'subtree_file_count', 'subtree_folder_count', 'subtree_size')
            ->orderBy('id')->cursor() as $row) {
            $id = (int) $row->id;
            $parent[$id] = $row->parent_id === null ? null : (int) $row->parent_id;
            $current[$id] = $row->subtree_size === null ? null : [
                'files' => (int) $row->subtree_file_count,
                'folders' => (int) $row->subtree_folder_count,
                'size' => (int) $row->subtree_size,
            ];
        }

        $fileCount = [];
        $size = [];
        foreach (DB::table('files')->whereNull('deleted_at')
            ->selectRaw('folder_id, count(*) as n, coalesce(sum(size), 0) as bytes')
            ->groupBy('folder_id')->orderBy('folder_id')->cursor() as $row) {
            if ($row->folder_id === null) {
                continue;
            }
            $fileCount[(int) $row->folder_id] = (int) $row->n;
            $size[(int) $row->folder_id] = (int) $row->bytes;
        }

        $children = [];
        foreach ($parent as $id => $parentId) {
            if ($parentId !== null) {
                $children[$parentId][] = $id;
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

        foreach (array_keys($parent) as $rootId) {
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
        foreach (array_keys($parent) as $id) {
            $s = $stats[$id] ?? null;
            if (! $s) {
                continue;
            }

            if ($current[$id] === null || $current[$id] !== $s) {
                $changed[$id] = $s;
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
     * Every id and value is inlined, not bound, on purpose: with all-bound
     * CASE branches Postgres cannot infer the CASE's type, defaults it to
     * text, and refuses the bigint assignment (SQLSTATE 42804 - SQLite let
     * it through, which is why tests alone missed it). All of these are
     * integers this job just computed, so there is nothing to escape.
     *
     * @param  array<int, int>  $ids
     * @param  array<int, array{files: int, folders: int, size: int}>  $stats
     */
    private function writeChunk(array $ids, array $stats): void
    {
        $fileCase = 'case id ';
        $folderCase = 'case id ';
        $sizeCase = 'case id ';

        foreach ($ids as $id) {
            $id = (int) $id;
            $fileCase .= 'when '.$id.' then '.(int) $stats[$id]['files'].' ';
            $folderCase .= 'when '.$id.' then '.(int) $stats[$id]['folders'].' ';
            $sizeCase .= 'when '.$id.' then '.(int) $stats[$id]['size'].' ';
        }

        $in = implode(',', array_map('intval', $ids));

        DB::update(
            'update folders set '
            .'subtree_file_count = '.$fileCase.'end, '
            .'subtree_folder_count = '.$folderCase.'end, '
            .'subtree_size = '.$sizeCase.'end '
            ."where id in ($in)",
        );
    }
}
