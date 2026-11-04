<?php

namespace App\Console\Commands;

use App\Jobs\PushFileToSharePoint;
use App\Models\FileItem;
use App\Models\SharePointConnection;
use App\Support\SharePoint\Pusher;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

/**
 * Find portal files that belong in a linked SharePoint library but never
 * reached it, and (with --push) send them.
 *
 * Until the push job retried its own first attempt, one failed upload left a
 * file in the portal with no mapping row and nothing that would ever try
 * again. Those files are still missing; this is how they are found. It reads
 * by default and only queues uploads when told to, because what it finds is
 * worth a look before anything is written to SharePoint.
 */
class PushMissingToSharePoint extends Command
{
    protected $signature = 'sharepoint:push-missing
        {--push : Queue an upload for every file found (without it, only report)}
        {--since= : Only files created on or after this date (Y-m-d)}
        {--limit=1000 : Stop after finding this many files}';

    protected $description = 'Report (or push) portal files that a linked SharePoint library is missing';

    public function handle(): int
    {
        $push = (bool) $this->option('push');
        $limit = max(1, (int) $this->option('limit'));
        $since = $this->option('since') ? Carbon::parse((string) $this->option('since'))->startOfDay() : null;

        /** @var array<string, SharePointConnection|null> $connections keyed by folder + owner */
        $connections = [];
        $found = [];
        $count = 0;

        FileItem::query()
            // Imports from SharePoint are mapped as they arrive; an unmapped
            // one is a different problem and is not re-uploaded from here.
            ->where(fn ($q) => $q->whereNull('origin')->orWhere('origin', '!=', 'sharepoint'))
            ->whereNotExists(fn ($q) => $q->selectRaw('1')
                ->from('sharepoint_items')
                ->whereColumn('sharepoint_items.file_id', 'files.id'))
            ->when($since, fn ($q) => $q->where('created_at', '>=', $since))
            ->with('folder')
            ->orderBy('id')
            ->chunkById(500, function ($files) use (&$connections, &$found, &$count, $limit, $push) {
                foreach ($files as $file) {
                    $key = ($file->folder_id ?? 'root').':'.($file->owner_id ?? '-');
                    if (! array_key_exists($key, $connections)) {
                        $connections[$key] = Pusher::connectionForFile($file);
                    }

                    $connection = $connections[$key];
                    if ($connection === null) {
                        continue;   // outside every linked library: not missing, just not synced
                    }

                    $label = $connection->drive_name ?: $connection->uuid;
                    $found[$label][] = $file;
                    $count++;

                    if ($push) {
                        PushFileToSharePoint::dispatch($file->id, 'content');
                    }

                    if ($count >= $limit) {
                        return false;
                    }
                }
            });

        if ($count === 0) {
            $this->info('Every portal file in a linked library has reached SharePoint.');

            return self::SUCCESS;
        }

        foreach ($found as $library => $files) {
            $this->line('');
            $this->line('<options=bold>'.$library.'</> — '.count($files).' missing');

            foreach (array_slice($files, 0, 10) as $file) {
                $this->line('  '.$file->id.'  '.$file->name.'  ('.$file->created_at?->toDateString().')');
            }
            if (count($files) > 10) {
                $this->line('  … and '.(count($files) - 10).' more');
            }
        }

        $this->line('');
        if ($push) {
            $this->info("Queued {$count} upload(s). Progress shows in the sync log as they land.");
        } else {
            $this->warn("Found {$count} file(s) missing from SharePoint. Run again with --push to upload them.");
        }
        if ($count >= $limit) {
            $this->line("Stopped at --limit={$limit}; there may be more.");
        }

        return self::SUCCESS;
    }
}
