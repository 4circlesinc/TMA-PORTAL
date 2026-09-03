<?php

namespace App\Support\Files;

use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\CompanyMember;
use App\Models\CompanyStaffAssignment;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\CipAccess;
use App\Support\Cip\FolderAccess;

/**
 * Who hears about a comment on a file, beyond the thread itself.
 *
 * A conversation on a document is not private to the people who happen to have
 * typed in it. Administrators hold every capability in the portal and answer
 * for every file in it, so a question asked on any document has to reach them;
 * and the people the file was actually shared with — the client's team, the
 * colleague it was shared with by name, the firm that filed it — are the ones
 * the question is usually FOR.
 *
 * **The one deliberate exclusion: the firm-wide audience.** Nearly every
 * ordinary library file is readable by all staff through the File Library's
 * default (see {@see FileAccess::organizationDefaultRole}) and through
 * `all_staff` organization folders. Counting that as "has access" would mean
 * every comment on every routine document notifies every member of staff, which
 * is not a signal, it is a reason to switch notifications off. So this answers
 * a narrower question than {@see FileAccess::fileRole}: who has a grant on
 * **this file** in particular.
 *
 * Every id here is derived from a live grant read at send time, never from
 * history, so an assignment that has ended or a share that was revoked stops
 * delivering on its own. That is also why the result is not re-checked through
 * fileRole() afterwards: the grants below ARE the check, and re-walking the
 * chain once per candidate would cost a query storm on every comment posted.
 * The one rule that cannot be read off a grant row is the personal-drive
 * carve-out, which is why it is handled first and explicitly.
 */
class CommentAudience
{
    /**
     * User ids with a grant on this file, administrators included.
     *
     * @return list<int>
     */
    public static function forFile(FileItem $file): array
    {
        $ids = [(int) $file->owner_id];

        $chain = FileAccess::chainIds($file->folder_id);

        /*
         * A personal OneDrive is the owner's alone — FileAccess bypasses the
         * administrator short-circuit for one, and so must this. Naming a file
         * in somebody's drive in an administrator's bell would leak exactly
         * what that rule exists to keep private. Inside a personal drive an
         * explicit share is the only door, which is all this collects.
         */
        if (FileAccess::isInPersonalDrive($file)) {
            return self::approved(array_merge($ids, self::shareTargets($file, $chain)));
        }

        $ids = array_merge(
            $ids,
            self::administrators(),
            self::shareTargets($file, $chain),
            self::folderGrants($chain),
        );

        return self::approved($ids);
    }

    /** @return list<int> */
    private static function administrators(): array
    {
        return User::query()
            ->where('account_type', Role::ADMINISTRATOR)
            ->where('status', User::STATUS_APPROVED)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * People reached by an active share of the file or of any folder above it,
     * whether it names them or their firm. Mirrors FileAccess::shareRole.
     *
     * @param  list<int>  $chain
     * @return list<int>
     */
    private static function shareTargets(FileItem $file, array $chain): array
    {
        $shares = Share::query()
            ->whereNull('revoked_at')
            ->where(function ($q) use ($file, $chain) {
                $q->where(fn ($f) => $f->where('item_type', 'file')->where('item_id', $file->id));

                if ($chain !== []) {
                    $q->orWhere(fn ($f) => $f->where('item_type', 'folder')->whereIn('item_id', $chain));
                }
            })
            ->get()
            ->filter(fn (Share $s) => $s->isActive());

        $ids = [];
        $companyShares = [];

        foreach ($shares as $share) {
            if ($share->kind === 'user' && $share->target_user_id) {
                $ids[] = (int) $share->target_user_id;

                continue;
            }

            // A link share reaches nobody in particular; there is no one to tell.
            if ($share->target_company_id) {
                $companyShares[] = $share;
            }
        }

        foreach ($companyShares as $share) {
            $ids = array_merge($ids, CompanyMember::query()
                ->active()
                ->where('company_id', $share->target_company_id)
                // A share scoped to one company role reaches only that role,
                // the same test companyShareRole applies per person.
                ->when($share->target_company_role,
                    fn ($q) => $q->where('role', $share->target_company_role))
                ->pluck('user_id')
                ->map(fn ($id) => (int) $id)
                ->all());
        }

        return $ids;
    }

    /**
     * What the folders above the file grant by their own type: a staff folder
     * to its subject, a client folder to that client's team and to the firm
     * that filed for them. Mirrors FileAccess::systemFolderRole, minus the
     * `all_staff` organization branch — see the class note.
     *
     * @param  list<int>  $chain
     * @return list<int>
     */
    private static function folderGrants(array $chain): array
    {
        if ($chain === []) {
            return [];
        }

        $ids = [];

        foreach (Folder::whereIn('id', $chain)->get() as $folder) {
            if ($folder->folder_type === Folder::TYPE_STAFF && $folder->subject_user_id) {
                $ids[] = (int) $folder->subject_user_id;

                continue;
            }

            if ($folder->folder_type === Folder::TYPE_CLIENT && $folder->client_id !== null) {
                $ids = array_merge($ids, self::clientTeam((int) $folder->client_id));
            }
        }

        return $ids;
    }

    /**
     * Everyone a client folder opens to: staff assigned to the client, staff
     * assigned to the client's company whose assignment reaches its contacts,
     * and the service-provider contacts whose firm the client belongs to.
     *
     * @return list<int>
     */
    private static function clientTeam(int $clientId): array
    {
        $ids = ClientAssignment::live()
            ->where('client_id', $clientId)
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $client = Client::query()->whereKey($clientId)->first(['id', 'company_id', 'referred_by_company_id', 'created_at']);

        if ($client === null) {
            return $ids;
        }

        if ($client->company_id) {
            $company = CompanyStaffAssignment::live()
                ->where('company_id', $client->company_id)
                ->get();

            foreach ($company as $assignment) {
                if (! $assignment->reachesClients()) {
                    continue;
                }

                // An assignment that covers existing clients only does not
                // reach one added after it was made.
                if (! $assignment->reachesFutureClients()
                    && $client->created_at !== null
                    && $client->created_at > $assignment->created_at) {
                    continue;
                }

                $ids[] = (int) $assignment->user_id;
            }
        }

        return array_merge($ids, self::providerContacts($client));
    }

    /**
     * The provider side, read the way {@see FolderAccess}
     * reads it from the other end: a contact reaches a client when their firm
     * referred them, or when their firm filed an application for them.
     *
     * @return list<int>
     */
    private static function providerContacts(Client $client): array
    {
        if (! CipAccess::enabled()) {
            return [];
        }

        $companyIds = CipProvider::query()
            ->where(function ($q) use ($client) {
                if ($client->referred_by_company_id) {
                    $q->where('company_id', $client->referred_by_company_id);
                }

                $q->orWhereIn('id', CipApplication::query()
                    ->where('client_id', $client->id)
                    ->whereNotNull('provider_id')
                    ->select('provider_id'));
            })
            ->pluck('company_id')
            ->filter()
            ->unique()
            ->all();

        if ($companyIds === []) {
            return [];
        }

        return CompanyMember::query()
            ->active()
            ->whereIn('company_id', $companyIds)
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * Keep the ids that belong to a live account. A suspended or pending
     * account is not somebody you can tell anything.
     *
     * @param  list<int>  $ids
     * @return list<int>
     */
    private static function approved(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids)));

        if ($ids === []) {
            return [];
        }

        return User::query()
            ->whereIn('id', $ids)
            ->where('status', User::STATUS_APPROVED)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }
}
