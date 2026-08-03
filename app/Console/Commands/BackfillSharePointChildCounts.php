<?php

namespace App\Console\Commands;

use App\Models\SharePointConnection;
use App\Models\SharePointItem;
use App\Support\SharePoint\GraphClient;
use Illuminate\Console\Command;
use Throwable;

/**
 * Fill in folder child counts for libraries imported before they were stored.
 *
 * The sync records `childCount` on every folder it sees, which is what lets the
 * progress panel say "780 of 1,240" — Graph offers no recursive total, so the
 * sum of folder child counts is the only way to know how big a library is.
 *
 * Folders mapped before that existed have none, and delta will not re-emit an
 * unchanged folder, so they would stay blank indefinitely and the total would
 * read short for ever. One pass fixes them; after that the sync maintains it.
 */
class BackfillSharePointChildCounts extends Command
{
    protected $signature = 'sharepoint:backfill-counts {--connection= : Only this connection id}';

    protected $description = 'Fetch folder child counts for already-imported SharePoint folders';

    public function handle(): int
    {
        $connections = SharePointConnection::query()
            ->when($this->option('connection'), fn ($q, $id) => $q->where('id', $id))
            ->get();

        if ($connections->isEmpty()) {
            $this->warn('No connections to backfill.');

            return self::SUCCESS;
        }

        foreach ($connections as $connection) {
            $this->line("<info>{$connection->folder?->name}</info>");
            $this->backfillRoot($connection);
            $this->backfillFolders($connection);
        }

        return self::SUCCESS;
    }

    private function backfillRoot(SharePointConnection $connection): void
    {
        if ($connection->root_child_count !== null) {
            return;
        }

        try {
            // A scoped connection starts at a folder, not the drive root.
            $path = $connection->root_item_id
                ? "/drives/{$connection->drive_id}/items/{$connection->root_item_id}"
                : "/drives/{$connection->drive_id}/root";

            $count = GraphClient::get($path)['folder']['childCount'] ?? null;

            if ($count !== null) {
                $connection->update(['root_child_count' => $count]);
                $this->line("  root holds {$count} items");
            }
        } catch (Throwable $e) {
            $this->warn('  root: '.$e->getMessage());
        }
    }

    private function backfillFolders(SharePointConnection $connection): void
    {
        $pending = SharePointItem::where('connection_id', $connection->id)
            ->where('item_type', 'folder')
            ->whereNull('child_count')
            ->get();

        if ($pending->isEmpty()) {
            $this->line('  folders already counted');

            return;
        }

        $bar = $this->output->createProgressBar($pending->count());
        $bar->start();
        $failed = 0;

        foreach ($pending as $mapping) {
            try {
                $item = GraphClient::get("/drives/{$connection->drive_id}/items/{$mapping->graph_item_id}");
                // A folder deleted in SharePoint since the import answers 404
                // and lands in the catch; leaving it null is correct, it has no
                // children to contribute.
                $mapping->update(['child_count' => $item['folder']['childCount'] ?? 0]);
            } catch (Throwable $e) {
                $failed++;
            }

            $bar->advance();
        }

        $bar->finish();
        $this->newLine();

        $total = SharePointItem::where('connection_id', $connection->id)
            ->where('item_type', 'folder')->sum('child_count') + (int) $connection->fresh()->root_child_count;

        $this->line("  library total: {$total} items".($failed ? " ({$failed} folders unreadable)" : ''));
    }
}
