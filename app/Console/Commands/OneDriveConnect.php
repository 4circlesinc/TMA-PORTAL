<?php

namespace App\Console\Commands;

use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\User;
use App\Support\SharePoint\GraphClient;
use App\Support\SharePoint\GraphException;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Link a OneDrive — or, preferably, ONE FOLDER of a OneDrive — to the portal.
 *
 * Listing is separated from connecting on purpose. A personal drive holds
 * things nobody intended to publish (auto-saved chat attachments, meeting
 * recordings, half-finished work), and with firm-wide default access an
 * unscoped import would expose all of it. Look first, then choose.
 */
class OneDriveConnect extends Command
{
    protected $signature = 'onedrive:connect
        {user : The account whose OneDrive, e.g. someone@firm.com}
        {--list : Show the top-level folders and exit, without connecting}
        {--path= : Sync only this top-level folder (recommended)}
        {--all : Sync the WHOLE drive, including auto-saved chat files and recordings}
        {--folder= : Portal folder name (default: the OneDrive folder name)}
        {--owner= : Portal account that will own imported files}';

    protected $description = 'Link a OneDrive folder to the File Library';

    public function handle(): int
    {
        $upn = $this->argument('user');

        try {
            $drive = GraphClient::get("/users/{$upn}/drive");
        } catch (GraphException $e) {
            $this->error('Could not reach that OneDrive: '.$e->getMessage());
            $this->line('Needs the Files.ReadWrite.All application permission.');

            return self::FAILURE;
        }

        $driveId = $drive['id'];

        if ($this->option('list') || (! $this->option('path') && ! $this->option('all'))) {
            $this->line('');
            $this->line('<options=bold>Top level of '.$upn.'\'s OneDrive</>');

            $children = GraphClient::get("/drives/{$driveId}/root/children")['value'] ?? [];
            foreach ($children as $child) {
                $kind = isset($child['folder'])
                    ? 'folder ('.($child['folder']['childCount'] ?? 0).' items)'
                    : 'file';
                $this->line(sprintf('  %-34s %s', $child['name'], $kind));
            }

            $this->line('');
            $this->warn('Nothing has been connected.');
            $this->line('Choose ONE folder to sync — a whole personal drive usually contains');
            $this->line('things that should not become firm-wide:');
            $this->line('');
            $this->line('  php artisan onedrive:connect '.$upn.' --path="Clio Migration"');

            return self::SUCCESS;
        }

        if ($this->option('all')) {
            // Whole drive: root_item_id stays null, which is what makes the
            // synchroniser walk from the root.
            $item = GraphClient::get("/drives/{$driveId}/root");
            $path = null;
            $this->warn('Connecting the WHOLE drive — everything in it becomes firm-wide.');
        } else {
            $path = trim($this->option('path'), '/');

            try {
                $item = GraphClient::get("/drives/{$driveId}/root:/".rawurlencode($path));
            } catch (GraphException $e) {
                $this->error('No folder called "'.$path.'" at the top level of that OneDrive.');

                return self::FAILURE;
            }

            if (! isset($item['folder'])) {
                $this->error('"'.$path.'" is a file, not a folder.');

                return self::FAILURE;
            }
        }

        $owner = $this->option('owner')
            ? User::where('email', $this->option('owner'))->first()
            : User::where('account_type', 'Administrator')->orderBy('id')->first();

        if (! $owner) {
            $this->error('No portal account found to own imported files. Pass --owner=');

            return self::FAILURE;
        }

        $scopeId = $this->option('all') ? null : $item['id'];

        if (SharePointConnection::where('drive_id', $driveId)->where('root_item_id', $scopeId)->exists()) {
            $this->warn('That folder is already connected.');

            return self::SUCCESS;
        }

        $folderName = $this->option('folder')
            ?: ($this->option('all') ? 'OneDrive — '.explode('@', $upn)[0] : $item['name']);

        /*
         * A personal OneDrive is PRIVATE. It is not firm property.
         *
         * This used to be created as an organization folder with
         * `audience = all_staff` and `audience_role = editor`, which grants
         * every colleague edit rights through systemFolderRole — a grant no
         * file-level rule can undo. Connecting one drive would have published
         * somebody's meeting recordings, chat attachments and unsent drafts to
         * the whole firm, editable.
         *
         * It belongs to the person whose drive it is, and they share out of it
         * one file at a time. Prefer the real owner over the connecting admin:
         * `owner_id` is what grants 'full' in FileAccess, so getting this wrong
         * hands someone else's drive to whoever ran the command.
         */
        $driveOwner = User::where('email', $upn)->first() ?: $owner;

        // folder_type stays the 'user' default — the column is NOT NULL, and
        // an explicit null here used to break folder creation on Postgres.
        $portalFolder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $folderName,
            'owner_id' => $driveOwner->id,
            'created_by' => $owner->id,
            'audience' => null,
            'audience_role' => null,
            'origin' => 'sharepoint',
        ]);

        $connection = SharePointConnection::create([
            'uuid' => (string) Str::uuid(),
            'tenant_id' => config('services.microsoft.graph_tenant_id'),
            // A OneDrive has no site; the drive is addressed directly.
            'site_id' => 'onedrive:'.$upn,
            'site_name' => $upn,
            'site_url' => $drive['webUrl'] ?? null,
            'drive_id' => $driveId,
            'drive_name' => 'OneDrive — '.$upn,
            'drive_kind' => 'onedrive',
            'owner_upn' => $upn,
            'root_item_id' => $scopeId,
            'root_path' => $path,
            'folder_id' => $portalFolder->id,
            'created_by' => $owner->id,
        ]);

        $this->info('Connected "'.($path ?: 'the whole drive').'" → File Library folder "'.$folderName.'"');
        $this->line('  items in that folder: '.($item['folder']['childCount'] ?? '?'));
        $this->line('  connection: '.$connection->uuid);
        $this->line('');
        $this->line('Run:  php artisan sharepoint:sync');

        return self::SUCCESS;
    }
}
