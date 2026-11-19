<?php

namespace App\Support\Cip;

use App\Models\CipProvider;
use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Support\Files\FolderProvisioner;
use Illuminate\Support\Str;

/**
 * The one folder every portal application is filed in.
 *
 *     TMA CIP Applications Portal        ↔ the tmacipapplicationsportal site
 *       └── <service provider>
 *             └── <applicant>            (the client folder Tree builds)
 *
 * Applications used to land wherever their provider's drawer happened to be:
 * the Citizenship Applications library, a OneDrive copy of it, or the retired
 * clients root. This gives them one home with one SharePoint site behind it.
 *
 * The older libraries are not touched. Their historical folders stay where
 * they are and keep syncing; a provider remembers its old drawer in
 * `legacy_folder_id` so those folders keep their guard and their home.
 */
final class PortalLibrary
{
    /** The old library whose provider drawers this replaces. */
    public const LEGACY_LIBRARY = 'Citizenship Applications';

    public static function folderName(): string
    {
        return trim((string) config('portal.cip_library.folder')) ?: 'TMA CIP Applications Portal';
    }

    /** The portal folder, once it has been set up. */
    public static function root(): ?Folder
    {
        return Folder::query()
            ->whereNull('parent_id')
            ->where('folder_type', Folder::TYPE_ORGANIZATION)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower(self::folderName())])
            ->orderBy('id')
            ->first();
    }

    /** The SharePoint link behind it, once connected. */
    public static function connection(): ?SharePointConnection
    {
        $root = self::root();

        return $root ? SharePointConnection::query()->where('folder_id', $root->id)->first() : null;
    }

    /** The old Citizenship Applications library folder, if this install has one. */
    public static function legacyRoot(): ?Folder
    {
        return Folder::query()
            ->where('folder_type', Folder::TYPE_ORGANIZATION)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower(self::LEGACY_LIBRARY)])
            ->orderBy('id')
            ->first();
    }

    /**
     * The portal folder, created on first use.
     *
     * Its access is copied from the Citizenship Applications folder it takes
     * over from, so moving an application never widens or narrows who on the
     * staff can see it. Provider contacts reach their applicants' folders
     * through {@see FolderAccess}, which follows the client, not the place.
     */
    public static function ensureRoot(): Folder
    {
        if ($existing = self::root()) {
            return $existing;
        }

        $legacy = self::legacyRoot();
        $owner = $legacy?->owner_id ?? FolderProvisioner::systemOwnerId();

        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => self::folderName(),
            'parent_id' => null,
            'folder_type' => Folder::TYPE_ORGANIZATION,
            'audience' => $legacy ? $legacy->audience : 'all_staff',
            'audience_role' => $legacy ? $legacy->audience_role : 'editor',
            'org_wide' => (bool) ($legacy->org_wide ?? false),
            'owner_id' => $owner,
            'created_by' => $owner,
            'origin' => 'portal',
        ]);
    }

    /**
     * The provider's folder inside the portal folder, created on first use,
     * and the provider re-pointed at it.
     *
     * Its previous drawer is kept as `legacy_folder_id`: historical folders
     * the old library sync imported still live there, and stay there.
     * Idempotent: a provider already filed here is returned untouched.
     */
    public static function providerFolder(CipProvider $provider): Folder
    {
        $root = self::root() ?? throw new \RuntimeException('The '.self::folderName().' folder has not been set up.');

        $current = $provider->folder_id ? Folder::find($provider->folder_id) : null;
        if ($current && (int) $current->parent_id === (int) $root->id) {
            return $current;
        }

        $folder = Folder::query()
            ->where('parent_id', $root->id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower(trim($provider->name))])
            ->orderBy('id')
            ->first();

        $folder ??= Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => trim($provider->name),
            'parent_id' => $root->id,
            // Same type a provider drawer has always had (Providers::ensureFolder).
            'folder_type' => Folder::TYPE_USER,
            'owner_id' => $root->owner_id,
            'created_by' => $root->owner_id,
            'origin' => 'portal',
        ]);

        $provider->forceFill([
            'legacy_folder_id' => $provider->legacy_folder_id ?? $current?->id,
            'folder_id' => $folder->id,
        ])->save();

        return $folder;
    }

    /** Is this folder somewhere inside the portal folder? */
    public static function contains(Folder $folder): bool
    {
        $root = self::root();
        if (! $root) {
            return false;
        }

        $seen = [];
        for ($node = $folder; $node !== null && ! isset($seen[$node->id]); $node = $node->parent) {
            $seen[$node->id] = true;
            if ((int) $node->id === (int) $root->id) {
                return true;
            }
        }

        return false;
    }
}
