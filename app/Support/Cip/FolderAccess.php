<?php

namespace App\Support\Cip;

use App\Models\CipProvider;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Clients\Assignments;
use App\Support\Files\FileAccess;

/**
 * Which client folders a service-provider contact may open.
 *
 * Staff reach a client's files through {@see Assignments}.
 * A private client still reaches documents only through an explicit share,
 * so an "Internal Only" drawer in their own tree stays hidden. Provider
 * contacts are different: they already see every application their firm
 * filed ({@see ApplicationScope}), and the File Library has to follow that
 * without a share row on every new filing and every new contact.
 *
 * That slice is the portal application, not the SharePoint library. The
 * firm's drawer in Citizenship Applications holds every historical folder
 * the sync imported. A contact opens the client folder of an application
 * their firm has on file here, and nothing else in that drawer.
 */
final class FolderAccess
{
    /** Enough to file documents, not enough to delete the tree. */
    public const ROLE = 'editor';

    /**
     * Client ids whose TYPE_CLIENT folder this account may open.
     *
     * Only clients sitting on a CIP application filed under a firm they
     * belong to. A referral on its own is not enough: the SharePoint sync
     * and the older client import both hang a folder on every historical
     * applicant the firm once referred, and those folders are the library,
     * not an application this portal is working.
     *
     * @return list<int>
     */
    public static function clientIdsFor(User $user): array
    {
        self::ensure($user);

        return self::$clientIds[(int) $user->id];
    }

    /**
     * The firm's own drawer in the synced Citizenship Applications library.
     *
     * Opening it would list every folder SharePoint holds under that firm.
     * It is never a client folder a contact may browse, even when a bad
     * stamp has typed it as one.
     *
     * @return list<int>
     */
    public static function drawerIdsFor(User $user): array
    {
        self::ensure($user);

        return self::$drawerIds[(int) $user->id];
    }

    /**
     * Per-request memo, by user id.
     *
     * Four queries answer this, and one Feedback page asked nine times: once
     * to build the listing, once per folder in every chain the access walk
     * climbed, twice more for the badge counts. Over a remote database that
     * alone was a third of a 30-second request. Dropped whenever a
     * membership, provider, client or application is written, see
     * {@see FileAccess::forgetGrants()}.
     *
     * @var array<int, list<int>>
     */
    private static array $clientIds = [];

    /** @var array<int, list<int>> */
    private static array $drawerIds = [];

    public static function forget(): void
    {
        self::$clientIds = [];
        self::$drawerIds = [];
    }

    private static function ensure(User $user): void
    {
        $uid = (int) $user->id;
        if (array_key_exists($uid, self::$clientIds)) {
            return;
        }

        [$clients, $drawers] = self::compute($user);
        self::$clientIds[$uid] = $clients;
        self::$drawerIds[$uid] = $drawers;
    }

    /**
     * @return array{0: list<int>, 1: list<int>}
     */
    private static function compute(User $user): array
    {
        if (Role::isStaff($user) || ! CipAccess::enabled()) {
            return [[], []];
        }

        $providerIds = ApplicationScope::providerIdsFor($user);

        if ($providerIds === []) {
            return [[], []];
        }

        // withTrashed: a retired duplicate can still be the row the filings
        // point at. The same ids ApplicationScope already decided are this firm's.
        $providers = CipProvider::withTrashed()
            ->whereIn('id', $providerIds)
            ->get(['id', 'company_id', 'folder_id']);

        if ($providers->isEmpty()) {
            return [[], []];
        }

        // The same office limit as the application list. A branch does not
        // open another branch's client folder by sharing the firm's provider.
        $clients = ApplicationScope::query($user)
            ->whereIn('cip_applications.provider_id', $providers->pluck('id'))
            ->whereNotNull('cip_applications.client_id')
            ->pluck('cip_applications.client_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        $drawers = $providers->pluck('folder_id')
            ->filter()
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        return [$clients, $drawers];
    }

    /** The role this external account holds over a client folder, if any. */
    public static function folderRole(User $user, Folder $folder): ?string
    {
        if (Role::isStaff($user)
            || $folder->folder_type !== Folder::TYPE_CLIENT
            || $folder->client_id === null) {
            return null;
        }

        if (in_array((int) $folder->id, self::drawerIdsFor($user), true)) {
            return null;
        }

        return in_array((int) $folder->client_id, self::clientIdsFor($user), true)
            ? self::ROLE
            : null;
    }
}
