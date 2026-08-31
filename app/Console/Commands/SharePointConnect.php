<?php

namespace App\Console\Commands;

use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\User;
use App\Support\Microsoft\ChangeNotifications;
use App\Support\SharePoint\Drive;
use App\Support\SharePoint\GraphClient;
use App\Support\SharePoint\GraphException;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Link a SharePoint document library to a portal folder.
 *
 * Creating the link does not import anything — that is the sync job's work, so
 * connecting is instant and a huge library cannot time out a console command.
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
        try {
            $site = GraphClient::get('/sites/'.$this->argument('site'));
        } catch (GraphException $e) {
            $this->error('Could not reach that site: '.$e->getMessage());

            return self::FAILURE;
        }

        $libraries = Drive::libraries($site['id']);
        if (! $libraries) {
            $this->error('That site has no document libraries the app can see.');

            return self::FAILURE;
        }

        $wanted = $this->option('library');
        $drive = $wanted
            ? collect($libraries)->firstWhere('name', $wanted)
            : $libraries[0];

        if (! $drive) {
            $this->error('No library called "'.$wanted.'". Available: '.
                collect($libraries)->pluck('name')->join(', '));

            return self::FAILURE;
        }

        $owner = $this->option('owner')
            ? User::where('email', $this->option('owner'))->first()
            : User::where('account_type', 'Administrator')->orderBy('id')->first();

        if (! $owner) {
            $this->error('No owner account found. Pass --owner=someone@example.com');

            return self::FAILURE;
        }

        $existing = SharePointConnection::where('site_id', $site['id'])
            ->where('drive_id', $drive['id'])->first();

        if ($existing) {
            $this->warn('That library is already connected ('.$existing->uuid.').');

            return self::SUCCESS;
        }

        $folderName = $this->option('folder') ?: ($drive['name'] ?? 'SharePoint');

        /*
         * A site library appears as an organization folder: a shared library is
         * firm-wide by nature, and this keeps it out of anyone's private area.
         *
         * This command only ever connects SITE libraries. Personal drives go
         * through sharepoint:connect-onedrive, which deliberately does NOT type
         * them this way — `all_staff` on somebody's OneDrive would publish it.
         */
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $folderName,
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
            'folder_type' => Folder::TYPE_ORGANIZATION,
            'audience' => 'all_staff',
            'audience_role' => 'editor',
            'origin' => 'sharepoint',
        ]);

        $connection = SharePointConnection::create([
            'uuid' => (string) Str::uuid(),
            'tenant_id' => config('services.microsoft.graph_tenant_id'),
            'site_id' => $site['id'],
            'site_name' => $site['displayName'] ?? null,
            'site_url' => $site['webUrl'] ?? null,
            'drive_id' => $drive['id'],
            'drive_name' => $drive['name'] ?? null,
            'folder_id' => $folder->id,
            'created_by' => $owner->id,
        ]);

        $this->info('Connected "'.($drive['name'] ?? '?').'" → File Library folder "'.$folderName.'"');
        $this->line('  connection: '.$connection->uuid);
        $this->line('  owner:      '.$owner->email);
        $this->line('');
        $this->line('Nothing has been imported yet. Run:');
        $this->line('  php artisan sharepoint:sync');

        rescue(fn () => ChangeNotifications::ensureDrive($connection), report: false);

        return self::SUCCESS;
    }
}
