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
 * row, with imported children scattered across the twins.
 *
 * For every group of live same-named siblings with EXACTLY one mapped
 * member, that member is canonical: every child of the other twins is
 * re-parented into it, except an unmapped sharepoint-origin file whose name
 * canonical already holds - that is the surplus download, recycled. Emptied
 * twins are recycled too. Groups with zero or several mapped members are
 * reported and left alone. Runs to a fixpoint, because re-parenting can
 * surface the same situation one level down.
 *
 * Every write goes through the query builder: no observers, no outbound
 * pushes (the canonical layout IS SharePoint's - "correcting" it outward
 * would patch the real library), no live doorbells; and everything removed
 * is soft-deleted, never purged.
 */
class MergeDuplicateSharePointFolders extends Command
{
    protected $signature = 'sharepoint:merge-duplicates {--dry-run : Report what would happen without writing}';

    protected $description = 'Merge duplicate sibling folders left behind by overlapping sync runs';

    private bool $dry = false;

    private array $totals = ['groups' => 0, 'movedFolders' => 0, 'movedFiles' => 0, 'recycledFiles' => 0, 'recycledFolders' => 0, 'skipped' => 0];

    public function handle(): int
    {
        $this->dry = (bool) $this->option('dry-run');

        Pusher::suspend(function () {
            for ($pass = 1; $pass <= 12; $pass++) {
                $acted = $this->mergeOnePass();
                if (! $acted) {
                    break;
                }
                if ($this->dry) {
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

    private function mergeOnePass(): bool
    {
        $groups = DB::table('folders')
            ->whereNull('deleted_at')
            ->whereNotNull('parent_id')
            ->selectRaw('parent_id, lower(name) as lname')
            ->groupBy('parent_id', 'lname')
            ->havingRaw('count(*) > 1')
            ->get();

        $acted = false;

        foreach ($groups as $group) {
            $members = DB::table('folders')
                ->whereNull('deleted_at')
                ->where('parent_id', $group->parent_id)
                ->whereRaw('lower(name) = ?', [$group->lname])
                ->orderBy('id')
                ->get(['id', 'name', 'origin']);

            $mappedIds = DB::table('sharepoint_items')
                ->where('item_type', 'folder')
                ->whereIn('folder_id', $members->pluck('id'))
                ->pluck('folder_id')
                ->map(fn ($id) => (int) $id);

            if ($mappedIds->count() !== 1) {
                $this->totals['skipped']++;
                $this->line(sprintf('skip "%s" under folder %d: %d of %d twins mapped',
                    $members->first()->name, $group->parent_id, $mappedIds->count(), $members->count()));

                continue;
            }

            $canonicalId = $mappedIds->first();
            $this->totals['groups']++;
            $acted = true;

            foreach ($members as $twin) {
                if ((int) $twin->id === $canonicalId) {
                    continue;
                }
                $this->mergeTwin((int) $twin->id, $canonicalId, $twin->name);
            }
        }

        return $acted;
    }

    private function mergeTwin(int $twinId, int $canonicalId, string $name): void
    {
        // Subfolders all move across; same-named collisions become their own
        // duplicate group and are merged on the next pass.
        $subfolders = DB::table('folders')->whereNull('deleted_at')->where('parent_id', $twinId)->pluck('id');
        if ($subfolders->isNotEmpty()) {
            $this->totals['movedFolders'] += $subfolders->count();
            if (! $this->dry) {
                DB::table('folders')->whereIn('id', $subfolders)->update(['parent_id' => $canonicalId]);
            }
        }

        $files = DB::table('files')->whereNull('deleted_at')->where('folder_id', $twinId)
            ->get(['id', 'name', 'origin']);
        $mappedFiles = DB::table('sharepoint_items')->where('item_type', 'file')
            ->whereIn('file_id', $files->pluck('id'))->pluck('file_id')
            ->map(fn ($id) => (int) $id)->flip();
        $canonicalNames = DB::table('files')->whereNull('deleted_at')->where('folder_id', $canonicalId)
            ->pluck('name')->map(fn ($n) => mb_strtolower($n))->flip();

        foreach ($files as $file) {
            $surplus = $file->origin === 'sharepoint'
                && ! isset($mappedFiles[(int) $file->id])
                && isset($canonicalNames[mb_strtolower($file->name)]);

            if ($surplus) {
                // The same bytes were downloaded once per racing run; the
                // mapped copy lives in canonical, this one goes to the bin.
                $this->totals['recycledFiles']++;
                if (! $this->dry) {
                    DB::table('files')->where('id', $file->id)->update(['deleted_at' => now()]);
                }
            } else {
                $this->totals['movedFiles']++;
                if (! $this->dry) {
                    DB::table('files')->where('id', $file->id)->update(['folder_id' => $canonicalId]);
                }
            }
        }

        $leftover = $this->dry ? 0
            : DB::table('folders')->whereNull('deleted_at')->where('parent_id', $twinId)->count()
                + DB::table('files')->whereNull('deleted_at')->where('folder_id', $twinId)->count();

        if ($leftover === 0) {
            $this->totals['recycledFolders']++;
            if (! $this->dry) {
                DB::table('folders')->where('id', $twinId)->update(['deleted_at' => now()]);
            }
            $this->line(sprintf('merged twin %d of "%s" into %d', $twinId, $name, $canonicalId));
        }
    }
}
