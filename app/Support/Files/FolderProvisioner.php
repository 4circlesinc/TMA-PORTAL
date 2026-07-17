<?php

namespace App\Support\Files;

use App\Models\Client;
use App\Models\FileLibrarySetting;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * Creates and maintains the system-managed folders: the "Client Files" and
 * "Staff Files" roots, one main folder per client (linked by client_id, never
 * by name), each client's configured default subfolders, and per-staff folders.
 *
 * Everything here is idempotent - safe to call again without creating
 * duplicates - because provisioning is triggered by events (a client is
 * created, a staff account is approved) that can retry.
 */
class FolderProvisioner
{
    public const ROOT_CLIENTS = 'Client Files';

    public const ROOT_STAFF = 'Staff Files';

    /** The stable owner for system folders: the earliest administrator. */
    public static function systemOwnerId(?User $fallback = null): int
    {
        $adminId = User::where('account_type', 'Administrator')->orderBy('id')->value('id');

        return $adminId ?? $fallback?->id ?? User::orderBy('id')->value('id');
    }

    public static function clientsRoot(): Folder
    {
        return self::ensureRoot(self::ROOT_CLIENTS);
    }

    public static function staffRoot(): Folder
    {
        return self::ensureRoot(self::ROOT_STAFF);
    }

    private static function ensureRoot(string $name): Folder
    {
        $root = Folder::whereNull('parent_id')
            ->where('folder_type', Folder::TYPE_ROOT)
            ->where('name', $name)
            ->first();

        if ($root) {
            return $root;
        }

        $ownerId = self::systemOwnerId();

        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'folder_type' => Folder::TYPE_ROOT,
            'parent_id' => null,
            'owner_id' => $ownerId,
            'created_by' => $ownerId,
        ]);
    }

    /**
     * Ensure the client has a main folder (+ configured default subfolders) and
     * that clients.folder_id points at it. Returns the main folder.
     */
    public static function provisionClientFolder(Client $client, ?User $actor = null): Folder
    {
        $existing = $client->folder_id ? Folder::withTrashed()->find($client->folder_id) : null;
        if (! $existing) {
            $existing = Folder::where('folder_type', Folder::TYPE_CLIENT)
                ->where('client_id', $client->id)
                ->first();
        }

        if (! $existing) {
            $ownerId = self::systemOwnerId($actor);
            $root = self::clientsRoot();
            $existing = Folder::create([
                'uuid' => (string) Str::uuid(),
                'name' => self::uniqueChildName($client->name ?: 'Client', $root->id),
                'folder_type' => Folder::TYPE_CLIENT,
                'client_id' => $client->id,
                'parent_id' => $root->id,
                'owner_id' => $ownerId,
                'created_by' => $actor?->id ?? $ownerId,
            ]);
        }

        if ($client->folder_id !== $existing->id) {
            $client->forceFill(['folder_id' => $existing->id])->save();
        }

        self::ensureSubfolders($existing, FileLibrarySetting::clientSubfolders());

        return $existing;
    }

    /**
     * Create a personal staff folder for a user, linked by subject_user_id.
     * No-op if one already exists. Returns the folder, or null if disabled.
     */
    public static function provisionStaffFolder(User $staff, ?User $actor = null): ?Folder
    {
        $existing = Folder::where('folder_type', Folder::TYPE_STAFF)
            ->where('subject_user_id', $staff->id)
            ->first();

        if ($existing) {
            return $existing;
        }

        $ownerId = self::systemOwnerId($actor);
        $root = self::staffRoot();

        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => self::uniqueChildName($staff->name ?: $staff->email, $root->id),
            'folder_type' => Folder::TYPE_STAFF,
            'subject_user_id' => $staff->id,
            'parent_id' => $root->id,
            'owner_id' => $ownerId,
            'created_by' => $actor?->id ?? $ownerId,
        ]);
    }

    /**
     * Keep the visible folder name in step with the client's name, without ever
     * changing the folder relationship. Only renames the main client folder.
     */
    public static function syncClientFolderName(Client $client): void
    {
        if (! $client->folder_id) {
            return;
        }

        $folder = Folder::find($client->folder_id);
        $desired = Naming::clean($client->name ?: 'Client');

        if (! $folder || $desired === '' || $folder->name === $desired) {
            return;
        }

        $folder->forceFill(['name' => self::uniqueChildName($desired, $folder->parent_id, $folder->id)])->save();
    }

    /** Create any of the named subfolders that don't already exist. */
    private static function ensureSubfolders(Folder $parent, array $names): void
    {
        foreach ($names as $name) {
            $clean = Naming::clean((string) $name);
            if ($clean === '') {
                continue;
            }

            $exists = Folder::where('parent_id', $parent->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($clean)])
                ->exists();

            if ($exists) {
                continue;
            }

            Folder::create([
                'uuid' => (string) Str::uuid(),
                'name' => $clean,
                'folder_type' => Folder::TYPE_USER,
                'parent_id' => $parent->id,
                'owner_id' => $parent->owner_id,
                'created_by' => $parent->created_by,
            ]);
        }
    }

    /** A sibling-unique name under a parent, appending " (2)", " (3)" as needed. */
    private static function uniqueChildName(string $base, ?int $parentId, ?int $ignoreId = null): string
    {
        $base = Naming::clean($base) ?: 'Folder';

        return Naming::nextAvailable($base, fn ($candidate) => Folder::where('parent_id', $parentId)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($candidate)])
            ->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId))
            ->exists());
    }
}
