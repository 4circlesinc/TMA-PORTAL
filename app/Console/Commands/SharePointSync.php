<?php

namespace App\Console\Commands;

use App\Jobs\SyncSharePointLibrary;
use App\Models\SharePointConnection;
use App\Support\SharePoint\Synchroniser;
use Illuminate\Console\Command;

class SharePointSync extends Command
{
    protected $signature = 'sharepoint:sync {--connection= : One connection uuid} {--queue : Dispatch instead of running inline}';

    protected $description = 'Pull changes from every connected SharePoint library';

    public function handle(): int
    {
        $connections = SharePointConnection::query()
            ->where('sync_enabled', true)
            ->when($this->option('connection'), fn ($q) => $q->where('uuid', $this->option('connection')))
            ->get();

        if ($connections->isEmpty()) {
            $this->warn('No connected libraries. Run sharepoint:connect first.');

            return self::SUCCESS;
        }

        foreach ($connections as $connection) {
            if ($this->option('queue')) {
                SyncSharePointLibrary::dispatch($connection->id);
                $this->line('Queued '.$connection->drive_name);

                continue;
            }

            $this->line('Syncing '.$connection->drive_name.'…');
            $stats = Synchroniser::sync($connection);

            foreach ($stats as $key => $value) {
                $this->line('  '.$key.': '.(is_scalar($value) ? $value : json_encode($value)));
            }
        }

        return self::SUCCESS;
    }
}
