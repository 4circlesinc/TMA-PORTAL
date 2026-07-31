<?php

namespace App\Console\Commands;

use App\Support\SharePoint\GraphClient;
use App\Support\SharePoint\GraphException;
use Illuminate\Console\Command;

/**
 * Reports exactly what the portal can and cannot reach in SharePoint.
 *
 * Written because "it's authorised" has several distinct failure modes that all
 * look the same from the outside: no admin consent, consent for the wrong
 * permission, `Sites.Selected` granted but no site actually authorised. This
 * distinguishes them instead of guessing.
 */
class SharePointCheck extends Command
{
    protected $signature = 'sharepoint:check {site? : Hostname and path, e.g. contoso.sharepoint.com:/sites/Advisory}';

    protected $description = 'Verify the app-only Microsoft Graph connection and per-site access';

    public function handle(): int
    {
        $this->line('');
        $this->line('<options=bold>Configuration</>');

        if (! GraphClient::isConfigured()) {
            $this->error('  ✗ Missing MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_GRAPH_TENANT_ID');

            return self::FAILURE;
        }
        $this->info('  ✓ Client id, secret and tenant id are set');
        $this->line('    tenant: '.config('services.microsoft.graph_tenant_id'));

        $this->line('');
        $this->line('<options=bold>App-only token</>');
        try {
            GraphClient::forgetToken();
            $token = GraphClient::token();
            $this->info('  ✓ Acquired ('.strlen((string) $token).' chars)');
            $this->reportRoles($token);
        } catch (GraphException $e) {
            $this->error('  ✗ '.$e->getMessage());
            $this->line('');
            $this->line('  Usually means the client secret has expired, or the tenant id is wrong.');

            return self::FAILURE;
        }

        $this->line('');
        $this->line('<options=bold>Site access</>');

        $site = $this->argument('site');

        if (! $site) {
            $this->warn('  No site given. With Sites.Selected the app can only reach sites an');
            $this->warn('  administrator has explicitly granted, and it cannot list them.');
            $this->line('');
            $this->line('  Re-run with the site, e.g.:');
            $this->line('    php artisan sharepoint:check contoso.sharepoint.com:/sites/Advisory');

            return self::SUCCESS;
        }

        try {
            $data = GraphClient::get('/sites/'.$site);
            $this->info('  ✓ Reached "'.($data['displayName'] ?? $site).'"');
            $this->line('    id:  '.($data['id'] ?? '—'));
            $this->line('    url: '.($data['webUrl'] ?? '—'));
        } catch (GraphException $e) {
            $this->error('  ✗ '.$e->getMessage());
            if ($e->status === 403) {
                $this->line('');
                $this->line('  403 with Sites.Selected means the TOKEN is fine but this SITE has not');
                $this->line('  been granted to the app. An administrator must run, once per site:');
                $this->line('    POST /sites/{site-id}/permissions  { roles: ["write"], … }');
            }

            return self::FAILURE;
        }

        $this->line('');
        $this->line('<options=bold>Document libraries</>');
        try {
            $drives = GraphClient::get('/sites/'.$site.'/drives');
            foreach ($drives['value'] ?? [] as $drive) {
                $this->line('  • '.($drive['name'] ?? '?').'  ('.($drive['id'] ?? '').')');
            }
            if (empty($drives['value'])) {
                $this->warn('  none returned');
            }
        } catch (GraphException $e) {
            $this->error('  ✗ '.$e->getMessage());

            return self::FAILURE;
        }

        $this->line('');
        $this->info('Connection is usable for sync.');

        return self::SUCCESS;
    }

    /** The JWT's `roles` claim is the honest answer to "what was consented?". */
    private function reportRoles(?string $token): void
    {
        $parts = explode('.', (string) $token);
        if (count($parts) < 2) {
            return;
        }

        $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')) ?: '', true);
        $roles = $payload['roles'] ?? [];

        if (! $roles) {
            $this->warn('  ! The token carries no application roles — no admin consent has been');
            $this->warn('    granted, so every Graph call will 403.');

            return;
        }

        $this->line('    granted: '.implode(', ', $roles));

        foreach (['Sites.Selected', 'Sites.ReadWrite.All', 'Files.ReadWrite.All'] as $wanted) {
            if (in_array($wanted, $roles, true)) {
                $this->info('  ✓ '.$wanted.' is present');
            }
        }
    }
}
