<?php

namespace App\Support\Cbi;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\Files\FolderProvisioner;

/**
 * Who owns files and folders created by an automated CBI sync.
 *
 * Manual "Sync now" prefers the administrator who clicked. The scheduler has
 * nobody at the keyboard, so it uses the firm system account (the same one
 * SharePoint sync files under), then the oldest approved administrator.
 */
class SyncActor
{
    public static function resolve(?User $preferred = null): ?User
    {
        if ($preferred) {
            return $preferred;
        }

        $systemId = FolderProvisioner::systemAccountId();
        if ($systemId) {
            $system = User::find($systemId);
            if ($system) {
                return $system;
            }
        }

        return User::query()
            ->where('account_type', Role::ADMINISTRATOR)
            ->where('status', 'approved')
            ->orderBy('id')
            ->first();
    }
}
