<?php

namespace App\Support\SharePoint;

use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\User;
use App\Support\Microsoft\ChangeNotifications;
use Illuminate\Support\Str;

/**
 * Link a SharePoint site library to the File Library.
 *
 * Shared by the sharepoint:connect command and the Background Operations
 * page so the two doors cannot drift. Linking imports nothing — that is the
 * sync job's work, which keeps connecting instant no matter the library size.
 */
class LibraryConnector
{
    /**
     * Accept what an administrator will actually paste — a full browser URL —
     * alongside the host:/path form Graph wants.
     */
    public static function normaliseSite(string $input): string
    {
        $input = trim($input);
        if (! str_starts_with($input, 'http://') && ! str_starts_with($input, 'https://')) {
            return $input;
        }

        $parts = parse_url($input);
        $host = $parts['host'] ?? '';
        $path = rtrim($parts['path'] ?? '', '/');

        return $path !== '' ? $host.':'.$path : $host;
    }

    /**
     * @return array{connection?: SharePointConnection, error?: string}
     *
     * @throws GraphException when the site cannot be reached
     */
    public static function connect(string $siteInput, ?string $libraryName, User $owner, ?string $folderName = null): array
    {
        $site = GraphClient::get('/sites/'.self::normaliseSite($siteInput));

        $libraries = Drive::libraries($site['id']);
        if (! $libraries) {
            return ['error' => 'That site has no document libraries the app can see.'];
        }

        $drive = $libraryName
            ? collect($libraries)->firstWhere('name', $libraryName)
            : $libraries[0];

        if (! $drive) {
            return ['error' => 'No library called "'.$libraryName.'". Available: '.
                collect($libraries)->pluck('name')->join(', ')];
        }

        $existing = SharePointConnection::where('site_id', $site['id'])
            ->where('drive_id', $drive['id'])->first();

        if ($existing) {
            return ['error' => 'That library is already connected.'];
        }

        /*
         * A site library appears as an organization folder: a shared library is
         * firm-wide by nature, and this keeps it out of anyone's private area.
         *
         * This path only ever connects SITE libraries. Personal drives are
         * provisioned separately and deliberately NOT typed this way —
         * `all_staff` on somebody's OneDrive would publish it.
         */
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $folderName ?: ($drive['name'] ?? 'SharePoint'),
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

        rescue(fn () => ChangeNotifications::ensureDrive($connection), report: false);

        return ['connection' => $connection];
    }
}
