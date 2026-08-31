<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\SharePoint\GraphException;
use App\Support\SharePoint\LibraryConnector;
use Illuminate\Console\Command;

/**
 * Link a SharePoint document library to a portal folder.
 *
 * The real work lives in LibraryConnector, which the Background Operations
 * page shares — connecting from Settings and connecting from here must
 * behave identically.
 */
class SharePointConnect extends Command
{
    protected $signature = 'sharepoint:connect
        {site : e.g. tmant.sharepoint.com or tmant.sharepoint.com:/sites/Advisory}
        {--library= : Document library name (default: the first one)}
        {--folder= : Portal folder name to sync into (default: the library name)}
        {--owner= : Email of the account that will own imported files}';

    protected $description = 'Link a SharePoint document library to the File Library';

    public function handle(): int
    {
        $owner = $this->option('owner')
            ? User::where('email', $this->option('owner'))->first()
            : User::where('account_type', 'Administrator')->orderBy('id')->first();

        if (! $owner) {
            $this->error('No owner account found. Pass --owner=someone@example.com');

            return self::FAILURE;
        }

        try {
            $result = LibraryConnector::connect(
                $this->argument('site'),
                $this->option('library'),
                $owner,
                $this->option('folder'),
            );
        } catch (GraphException $e) {
            $this->error('Could not reach that site: '.$e->getMessage());

            return self::FAILURE;
        }

        if (isset($result['error'])) {
            $this->warn($result['error']);

            return str_contains($result['error'], 'already connected') ? self::SUCCESS : self::FAILURE;
        }

        $connection = $result['connection'];

        $this->info('Connected "'.($connection->drive_name ?? '?').'" → File Library folder "'.$connection->folder?->name.'"');
        $this->line('  connection: '.$connection->uuid);
        $this->line('  owner:      '.$owner->email);
        $this->line('');
        $this->line('Nothing has been imported yet. Run:');
        $this->line('  php artisan sharepoint:sync');

        return self::SUCCESS;
    }
}
