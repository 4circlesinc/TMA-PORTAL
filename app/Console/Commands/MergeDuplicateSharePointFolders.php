<?php

namespace App\Console\Commands;

use App\Support\SharePoint\Pusher;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Merge the duplicate sibling folders the sync race left behind.
 *
 * Before the atomic run lock, two workers could walk the same delta cursor;
 * each applyCreate made its own portal folder for the same SharePoint
 * folder, the mapping's updateOrCreate re-pointed at the newest one, and
 * the losers were orphaned - same name, same parent, no sharepoint_items
 * row, with imported children scattered across the twins. The race ran for
 * days, so this is not ten folders: nine and a half thousand sibling groups.
 *
 * For every group of live same-named siblings with EXACTLY one mapped
 * member, that member is canonical: every child of the other twins is
 * re-parented into it, except an unmapped sharepoint-origin file whose name
 * canonical already holds - that is the surplus download, recycled. Emptied
 * twins are recycled too. Groups with zero or several mapped members are
 * counted and left alone. Runs to a fixpoint, because re-parenting can
 * surface the same situation one level down.
 *
 * Everything is planned from a few bulk reads and written in CASE-batched
 * statements - a per-group loop at this scale spent hours in round trips to
 * the remote database. Every write goes through the query builder: no
 * observers, no outbound pushes (the canonical layout IS SharePoint's -
 * "correcting" it outward would patch the real library), no live doorbells;
 * and everything removed is soft-deleted, never purged.
 */
class MergeDuplicateSharePointFolders extends Command
{
    protected $signature = 'sharepoint:merge-duplicates {--dry-run : Report what would happen without writing}';

    protected $description = 'Merge duplicate sibling folders left behind by overlapping sync runs';

    private const CHUNK = 500;

    private bool $dry = false;

    private array $totals = ['groups' => 0, 'movedFolders' => 0, 'movedFiles' => 0, 'recycledFiles' => 0, 'recycledFolders' => 0, 'skipped' => 0];

    public function handle(): int
    {
        $this->dry = (bool) $this->option('dry-run');

        Pusher::suspend(function () {
            for ($pass = 1; $pass <= 12; $pass++) {
                $acted = $this->mergeOnePass($pass);
                if (! $acted || $this->dry) {
                    // A dry pass writes nothing, so the same groups would
                    // simply be reported again for ever.
                    break;
                }
            }
        });

        $this->info(($this->dry ? '[dry-run] ' : '')
            .$this->totals['groups'].' group(s): '
            .$this->totals['movedFolders'].' folder(s) and '
            .$this->totals['movedFiles'].' file(s) re-parented, '
            .$this->totals['recycledFiles'].' surplus file(s) and '
            .$this->totals['recycledFolders'].' twin folder(s) recycled, '
            .$this->totals['skipped'].' group(s) skipped.');

        return self::SUCCESS;
    }

    private function mergeOnePass(int $pass): bool
    {
        $groups = DB::table('folders')
            ->whereNull('deleted_at')
            ->whereNotNull('parent_id')
            ->selectRaw('parent_id, lower(name) as lname')
            ->groupBy('parent_id', 'lname')
            ->havingRaw('count(*) > 1')
            ->get();

        if ($groups->isEmpty()) {
            return false;
        }

        // Membership: every live folder under a duplicated parent, filtered
        // to its (parent, name) group in PHP.
        $wanted = [];
        foreach ($groups as $g) {
            $wanted[(int) $g->parent_id][$g->lname] = true;
        }

        // lname comes from the database on both sides: PHP's mb_strtolower
        // and Postgres's lower() disagree on non-ASCII names (the library
        // holds Chinese-named applicant folders), and a key mismatch here
        // silently dissolves exactly those groups.
        $members = collect();
        foreach (array_chunk(array_keys($wanted), self::CHUNK) as $parentIds) {
            $members = $members->merge(
                DB::table('folders')->whereNull('deleted_at')
                    ->whereIn('parent_id', $parentIds)
                    ->selectRaw('id, parent_id, name, lower(name) as lname')
                    ->get()
                    ->filter(fn ($f) => isset($wanted[(int) $f->parent_id][$f->lname]))
            );
        }

        $mappedFolder = $this->mappedIds('folder', 'folder_id', $members->pluck('id'));

        // Resolve each group to canonical + twins.
        $twinTo = [];      // twin folder id => canonical folder id
        $canonicals = [];  // canonical folder id => true
        $grouped = $members->groupBy(fn ($f) => $f->parent_id.'|'.$f->lname);

        foreach ($grouped as $group) {
            $mapped = $group->filter(fn ($f) => isset($mappedFolder[(int) $f->id]));

            if ($mapped->count() !== 1) {
                $this->totals['skipped']++;

                continue;
            }

            $canonicalId = (int) $mapped->first()->id;
            $canonicals[$canonicalId] = true;
            $this->totals['groups']++;

            foreach ($group as $f) {
                if ((int) $f->id !== $canonicalId) {
                    $twinTo[(int) $f->id] = $canonicalId;
                }
            }
        }

        if ($twinTo === []) {
            return false;
        }

        // The twins' children, in bulk.
        $twinIds = array_keys($twinTo);
        $moveFolder = [];   // subfolder id => new parent id
        $moveFile = [];     // file id => new folder id
        $recycleFile = [];  // surplus copies

        foreach (array_chunk($twinIds, self::CHUNK) as $ids) {
            foreach (DB::table('folders')->whereNull('deleted_at')->whereIn('parent_id', $ids)->get(['id', 'parent_id']) as $sub) {
                $moveFolder[(int) $sub->id] = $twinTo[(int) $sub->parent_id];
            }
        }

        // Canonical folders' live file names, for the surplus test.
        $canonicalNames = [];
        foreach (array_chunk(array_keys($canonicals), self::CHUNK) as $ids) {
            foreach (DB::table('files')->whereNull('deleted_at')->whereIn('folder_id', $ids)->get(['folder_id', 'name']) as $f) {
                $canonicalNames[(int) $f->folder_id][mb_strtolower($f->name)] = true;
            }
        }

        $twinFiles = collect();
        foreach (array_chunk($twinIds, self::CHUNK) as $ids) {
            $twinFiles = $twinFiles->merge(
                DB::table('files')->whereNull('deleted_at')->whereIn('folder_id', $ids)->get(['id', 'folder_id', 'name', 'origin'])
            );
        }
        $mappedFile = $this->mappedIds('file', 'file_id', $twinFiles->pluck('id'));

        foreach ($twinFiles as $file) {
            $canonicalId = $twinTo[(int) $file->folder_id];
            $surplus = $file->origin === 'sharepoint'
                && ! isset($mappedFile[(int) $file->id])
                && isset($canonicalNames[$canonicalId][mb_strtolower($file->name)]);

            if ($surplus) {
                // The same bytes were downloaded once per racing run; the
                // mapped copy lives in canonical, this one goes to the bin.
                $recycleFile[] = (int) $file->id;
            } else {
                $moveFile[(int) $file->id] = $canonicalId;
            }
        }

        $this->totals['movedFolders'] += count($moveFolder);
        $this->totals['movedFiles'] += count($moveFile);
        $this->totals['recycledFiles'] += count($recycleFile);
        // Every child moves or recycles, so every twin ends the pass empty.
        $this->totals['recycledFolders'] += count($twinIds);

        $this->line(sprintf('pass %d: %d twin(s) into %d canonical folder(s), %d folder move(s), %d file move(s), %d surplus recycle(s)',
            $pass, count($twinIds), count($canonicals), count($moveFolder), count($moveFile), count($recycleFile)));

        if ($this->dry) {
            return true;
        }

        $this->caseUpdate('folders', 'parent_id', $moveFolder);
        $this->caseUpdate('files', 'folder_id', $moveFile);

        foreach (array_chunk($recycleFile, self::CHUNK) as $ids) {
            DB::table('files')->whereIn('id', $ids)->update(['deleted_at' => now()]);
        }
        foreach (array_chunk($twinIds, self::CHUNK) as $ids) {
            DB::table('folders')->whereIn('id', $ids)->update(['deleted_at' => now()]);
        }

        return true;
    }

    /** @return array<int, true> ids of rows a sharepoint_items row points at */
    private function mappedIds(string $type, string $column, $ids): array
    {
        $out = [];
        foreach ($ids->chunk(self::CHUNK) as $chunk) {
            foreach (DB::table('sharepoint_items')->where('item_type', $type)->whereIn($column, $chunk)->pluck($column) as $id) {
                $out[(int) $id] = true;
            }
        }

        return $out;
    }

    /**
     * Batched `update ... set col = case id ... end` - ids and values are
     * integers computed above, inlined because Postgres types an all-bound
     * CASE as text and refuses the integer assignment.
     *
     * @param  array<int, int>  $plan  row id => new value
     */
    private function caseUpdate(string $table, string $column, array $plan): void
    {
        foreach (array_chunk(array_keys($plan), self::CHUNK) as $ids) {
            $case = 'case id ';
            foreach ($ids as $id) {
                $case .= 'when '.(int) $id.' then '.(int) $plan[$id].' ';
            }
            $in = implode(',', array_map('intval', $ids));

            DB::update("update {$table} set {$column} = {$case}end where id in ({$in})");
        }
    }
}
