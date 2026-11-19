<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\Cip\PortalLibrary;
use App\Support\Files\FolderProvisioner;
use App\Support\Imports\ImportPause;
use App\Support\SharePoint\GraphClient;
use App\Support\SharePoint\GraphException;
use App\Support\SharePoint\LibraryConnector;
use Illuminate\Console\Command;

/**
 * Link the TMA CIP Applications Portal folder to its SharePoint site.
 *
 * Step one of two. Creates the portal folder (access copied from Citizenship
 * Applications), connects it to the site's document library, and pauses the
 * library's inbound sync so nothing is imported before the applications have
 * been moved in with `cip:library:migrate`. Pushes are not affected by the
 * pause; that is how the migration fills the site.
 *
 * Safe to run twice: an existing link is reported, not duplicated.
 */
class CipLibraryConnect extends Command
{
    protected $signature = 'cip:library:connect
        {--site= : SharePoint site URL (default: portal.cip_library.site)}
        {--library= : Document library name (default: the site\'s first library, normally "Documents")}
        {--owner= : Email of the portal account the link is recorded against (default: the firm\'s system account)}';

    protected $description = 'Connect the TMA CIP Applications Portal folder to its SharePoint site';

    public function handle(): int
    {
        if (! GraphClient::isConfigured()) {
            $this->error('Microsoft Graph is not configured (client id, secret and MICROSOFT_GRAPH_TENANT_ID).');

            return self::FAILURE;
        }

        if ($existing = PortalLibrary::connection()) {
            $this->info('Already connected: '.PortalLibrary::folderName().' → '.($existing->site_url ?: $existing->site_name).' / '.$existing->drive_name);

            return self::SUCCESS;
        }

        $owner = $this->option('owner')
            ? User::where('email', $this->option('owner'))->first()
            : User::find(FolderProvisioner::systemOwnerId());
        if (! $owner) {
            $this->error('No portal account found to record the link against. Pass --owner=someone@firm.com');

            return self::FAILURE;
        }

        $site = (string) ($this->option('site') ?: config('portal.cip_library.site'));
        $library = $this->option('library') ?: config('portal.cip_library.library');

        $root = PortalLibrary::ensureRoot();

        try {
            $result = LibraryConnector::connect($site, $library, $owner, null, $root);
        } catch (GraphException $e) {
            $this->error('Could not reach '.$site.': '.$e->getMessage());
            $this->line('The app needs access to that site (a Sites.Selected grant, or a broader permission).');
            $this->line('Check with: php artisan sharepoint:check '.LibraryConnector::normaliseSite($site));

            return self::FAILURE;
        }

        if (isset($result['error'])) {
            $this->error($result['error']);

            return self::FAILURE;
        }

        $connection = $result['connection'];

        // Nothing comes IN until the applications have been moved over:
        // importing first could mirror a half-filled site back into the
        // portal as duplicate folders.
        ImportPause::putTarget('library:'.$connection->uuid, true, $owner->id);

        $this->info('Connected '.PortalLibrary::folderName().' → '.($connection->site_url ?: $site).' / '.$connection->drive_name);
        $this->line('  connection: '.$connection->uuid);
        $this->line('  inbound sync: paused until the move is done');
        $this->reportSiteContents($connection->drive_id);
        $this->line('');
        $this->line('Next:  php artisan cip:library:migrate            (dry run, changes nothing)');
        $this->line('       php artisan cip:library:migrate --apply');

        return self::SUCCESS;
    }

    /** What the site already holds at the top, so a non-empty site is no surprise. */
    private function reportSiteContents(string $driveId): void
    {
        try {
            $children = GraphClient::get('/drives/'.$driveId.'/root/children', ['$select' => 'name,folder', '$top' => 200])['value'] ?? [];
        } catch (GraphException $e) {
            $this->warn('  could not list the site: '.$e->getMessage());

            return;
        }

        if ($children === []) {
            $this->line('  site: empty');

            return;
        }

        $this->line('  site already holds '.count($children).' item(s) at the top; same-named folders are reused, never duplicated:');
        foreach (array_slice($children, 0, 20) as $child) {
            $this->line('    '.(isset($child['folder']) ? '[folder] ' : '         ').($child['name'] ?? '?'));
        }
    }
}
