<?php

namespace App\Jobs;

use App\Models\ConnectedAccount;
use App\Models\SharePointConnection;
use App\Support\Access\Role;
use App\Support\SharePoint\GraphClient;
use App\Support\SharePoint\GraphException;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Link a staff member's personal OneDrive the moment they connect Microsoft —
 * the automated counterpart of the onedrive:connect command.
 *
 * The connection carries NO portal folder (folder_id null): the drive mirrors
 * into the root of the person's own library, so "All Files" simply is their
 * OneDrive plus whatever the firm shares with them. Their OneDrive stays
 * PRIVATE — FileAccess's personal-space rule keeps other accounts (including
 * administrators) to explicit shares only.
 *
 * Uses the app-only Graph client (Files.ReadWrite.All application permission),
 * so it only works for accounts in the firm's tenant; a personal outlook.com
 * account fails the drive lookup and is skipped quietly.
 */
class ProvisionPersonalOneDrive implements ShouldQueue, ShouldBeUnique
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    /** @var int[] */
    public array $backoff = [60, 300, 900];

    public function __construct(public int $accountId)
    {
    }

    public function uniqueId(): string
    {
        return 'provision-onedrive-'.$this->accountId;
    }

    public function handle(): void
    {
        $account = ConnectedAccount::find($this->accountId);

        if (! $account || $account->provider !== 'microsoft' || ! $account->sync_onedrive) {
            return;
        }

        $user = $account->user;
        if (! $user || Role::isClient($user)) {
            return;
        }

        if (! config('services.microsoft.graph_tenant_id')) {
            Log::info('OneDrive provisioning skipped: app-only Graph is not configured.');

            return;
        }

        $upn = $account->email;

        // One connection per drive is enough — an existing one (auto or via
        // onedrive:connect) means there is nothing to provision.
        if (SharePointConnection::where('drive_kind', 'onedrive')->where('owner_upn', $upn)->exists()) {
            return;
        }

        try {
            $drive = GraphClient::get('/users/'.$upn.'/drive');
            $root = GraphClient::get('/drives/'.$drive['id'].'/root');
        } catch (GraphException $e) {
            Log::warning('OneDrive provisioning failed', [
                'user' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return;
        }

        $connection = SharePointConnection::create([
            'uuid' => (string) Str::uuid(),
            'tenant_id' => config('services.microsoft.graph_tenant_id'),
            // A OneDrive has no site; the drive is addressed directly.
            'site_id' => 'onedrive:'.$upn,
            'site_name' => $upn,
            'site_url' => $drive['webUrl'] ?? null,
            'drive_id' => $drive['id'],
            'drive_name' => 'OneDrive — '.$upn,
            'drive_kind' => 'onedrive',
            'owner_upn' => $upn,
            'root_item_id' => null,
            'root_path' => null,
            'root_child_count' => $root['folder']['childCount'] ?? null,
            'folder_id' => null,
            'created_by' => $user->id,
            'direction' => 'both',
            'sync_enabled' => true,
        ]);

        SyncSharePointLibrary::dispatch($connection->id);
    }
}
