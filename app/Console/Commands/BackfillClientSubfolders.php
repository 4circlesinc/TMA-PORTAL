<?php

namespace App\Console\Commands;

use App\Models\Client;
use App\Models\Folder;
use App\Models\FileLibrarySetting;
use App\Support\Files\FolderProvisioner;
use Illuminate\Console\Command;

/**
 * Apply the configured default subfolders to clients that already exist.
 *
 * `clients:backfill-folders` only helps a client with no folder at all — it
 * skips anyone who has one, which is everybody once the hub has been used. So
 * adding a name to the default list reached new clients and nobody else, and
 * the firm's own filing was split down the date they happened to configure it.
 *
 * Idempotent by way of FolderProvisioner::applySubfolders, which skips a name
 * a sibling already has: running it twice adds nothing, and a folder somebody
 * renamed by hand is left alone rather than recreated beside itself.
 */
class BackfillClientSubfolders extends Command
{
    protected $signature = 'clients:backfill-subfolders {--dry-run : List what would be created and change nothing}';

    protected $description = 'Create the configured default subfolders inside every existing client folder';

    public function handle(): int
    {
        $names = FileLibrarySetting::clientSubfolders();

        if ($names === []) {
            $this->warn('No default client subfolders are configured, so there is nothing to create.');
            $this->line('Set them in Settings → Advanced Preferences → Default Folders.');

            return self::SUCCESS;
        }

        $this->line('Default subfolders: '.implode(', ', $names));
        $dry = (bool) $this->option('dry-run');
        $touched = 0;
        $created = 0;

        Client::whereNotNull('folder_id')->orderBy('id')->each(function (Client $client) use ($names, $dry, &$touched, &$created) {
            $folder = Folder::find($client->folder_id);
            if (! $folder) {
                return;
            }

            if ($dry) {
                $missing = array_values(array_filter($names, fn (string $name) => ! Folder::query()
                    ->where('parent_id', $folder->id)
                    ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                    ->exists()));

                if ($missing !== []) {
                    $this->line("  · {$client->name}: ".implode(', ', $missing));
                    $touched++;
                    $created += count($missing);
                }

                return;
            }

            $made = FolderProvisioner::applySubfolders($folder, $names);
            if ($made !== []) {
                $this->line("  · {$client->name}: ".implode(', ', $made));
                $touched++;
                $created += count($made);
            }
        });

        $this->info($dry
            ? "Would create {$created} folder(s) across {$touched} client(s)."
            : "Created {$created} folder(s) across {$touched} client(s).");

        return self::SUCCESS;
    }
}
