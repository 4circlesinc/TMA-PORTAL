<?php

namespace App\Console\Commands;

use App\Models\Client;
use App\Support\Files\FolderProvisioner;
use Illuminate\Console\Command;

/**
 * Give every existing client the main folder (+ default subfolders) that new
 * clients now get automatically. Idempotent: clients that already have a folder
 * are left alone.
 */
class BackfillClientFolders extends Command
{
    protected $signature = 'clients:backfill-folders';

    protected $description = 'Provision a File Library folder for every client that does not have one yet';

    public function handle(): int
    {
        $made = 0;

        Client::whereNull('folder_id')->orderBy('id')->each(function (Client $client) use (&$made) {
            FolderProvisioner::provisionClientFolder($client);
            $made++;
            $this->line("  · {$client->name}");
        });

        $this->info($made === 0 ? 'All clients already have folders.' : "Provisioned {$made} client folder(s).");

        return self::SUCCESS;
    }
}
