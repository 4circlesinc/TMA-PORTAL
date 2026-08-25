<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\CompanyMember;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Clients\Assignments;

/**
 * Which client folders a service-provider contact may open.
 *
 * Staff reach a client's files through {@see Assignments}.
 * A private client still reaches documents only through an explicit share,
 * so an "Internal Only" drawer in their own tree stays hidden. Provider
 * contacts are different: they already see every application their firm
 * filed ({@see ApplicationScope}), and the File Library has to follow that
 * without a share row on every new filing and every new contact.
 */
final class FolderAccess
{
    /** Enough to file documents, not enough to delete the tree. */
    public const ROLE = 'editor';

    /**
     * Client ids whose TYPE_CLIENT folder this account may open.
     *
     * Every client a firm they belong to referred, and (when CIP is on)
     * every client sitting on an application filed under one of those firms,
     * so an older row that never got a referral still opens.
     *
     * @return list<int>
     */
    public static function clientIdsFor(User $user): array
    {
        if (Role::isStaff($user) || ! CipAccess::enabled()) {
            return [];
        }

        $companyIds = CompanyMember::query()
            ->active()
            ->where('user_id', $user->id)
            ->pluck('company_id');

        if ($companyIds->isEmpty()) {
            return [];
        }

        $providers = CipProvider::query()
            ->whereIn('company_id', $companyIds)
            ->get(['id', 'company_id']);

        if ($providers->isEmpty()) {
            return [];
        }

        $ids = Client::query()
            ->whereIn('referred_by_company_id', $providers->pluck('company_id'))
            ->pluck('id');

        $ids = $ids->merge(
            CipApplication::query()
                ->whereIn('provider_id', $providers->pluck('id'))
                ->whereNotNull('client_id')
                ->pluck('client_id')
        );

        return $ids->map(fn ($id) => (int) $id)->unique()->values()->all();
    }

    /** The role this external account holds over a client folder, if any. */
    public static function folderRole(User $user, Folder $folder): ?string
    {
        if (Role::isStaff($user)
            || $folder->folder_type !== Folder::TYPE_CLIENT
            || $folder->client_id === null) {
            return null;
        }

        return in_array((int) $folder->client_id, self::clientIdsFor($user), true)
            ? self::ROLE
            : null;
    }
}
