<?php

namespace App\Console\Commands;

use App\Models\SharePointItem;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Collapse the second mapping row a portal file should never have had.
 *
 * `sharepoint_items` is unique on `(connection_id, graph_item_id)` but only
 * indexed on `file_id`, so one local file can end up with two rows pointing
 * at two different driveItems — the same document uploaded to SharePoint
 * twice. The push path then reads one row by `file_id`, uploads, and tries
 * to stamp the id the OTHER row already holds onto it, which throws a unique
 * violation and kills the job mid-run.
 *
 * Pusher::recordMapping now resolves by graph id, so new duplicates collapse
 * on their own. This clears the ones already in the table, which would
 * otherwise keep failing until each file happens to be pushed again.
 *
 * Keeps the row SharePoint agrees with (`synced`, most recently synced) and
 * deletes the rest. Only the mapping rows go — no portal file and nothing in
 * SharePoint is touched, so a wrongly dropped mapping is re-imported by the
 * next delta pass rather than lost.
 */
class DeduplicateSharePointItems extends Command
{
    protected $signature = 'sharepoint:dedupe-items {--apply : Write the changes; without it the command only reports}';

    protected $description = 'Collapse duplicate sharepoint_items rows that share one portal file';

    public function handle(): int
    {
        $fileIds = DB::table('sharepoint_items')
            ->select('file_id')
            ->whereNotNull('file_id')
            ->groupBy('file_id')
            ->havingRaw('count(*) > 1')
            ->pluck('file_id');

        if ($fileIds->isEmpty()) {
            $this->info('No duplicate mappings.');

            return self::SUCCESS;
        }

        $apply = (bool) $this->option('apply');
        $this->line($fileIds->count().' file(s) with more than one mapping row.');
        $this->line('');

        $removed = 0;

        foreach ($fileIds as $fileId) {
            $rows = SharePointItem::where('file_id', $fileId)->orderBy('id')->get();

            // The row SharePoint last confirmed is the one worth keeping; if
            // none is synced, keep the oldest so the mapping still exists.
            $keep = $rows->where('sync_status', SharePointItem::SYNCED)
                ->sortByDesc('last_synced_at')
                ->first() ?? $rows->first();

            foreach ($rows as $row) {
                if ($row->id === $keep->id) {
                    continue;
                }

                $this->line(sprintf(
                    '  file %-9s drop row %-8s (%s)  keep %-8s  %s',
                    $fileId,
                    $row->id,
                    $row->sync_status,
                    $keep->id,
                    $row->name,
                ));

                if ($apply) {
                    $row->delete();
                }

                $removed++;
            }
        }

        $this->line('');
        $this->info($apply
            ? $removed.' duplicate row(s) removed.'
            : $removed.' duplicate row(s) would be removed. Re-run with --apply.');

        return self::SUCCESS;
    }
}
