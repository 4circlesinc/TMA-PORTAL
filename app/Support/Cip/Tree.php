<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\Client;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\FolderTree;
use Illuminate\Support\Str;

/**
 * The application's folder tree (§6), and the client record it hangs from.
 *
 * §6 asks for one repository per individual, and they hang off the client:
 *
 *     Asem Haddad
 *       ├── Main Applicant
 *       ├── Sponsor              (only when there is one)
 *       ├── Dependent 1
 *       ├── Dependent 2
 *       └── Additional Documents
 *             ├── Queries
 *             ├── Non-Compliance Requests
 *             ├── Supplementary Documents
 *             └── Unit Requests
 *
 * **Where it hangs.** Every application's main applicant gets a lightweight
 * client-hub record, created here if the applicant is not already one, and
 * the people are provisioned straight into that client's folder. Two reasons.
 * It makes the Service-Provider path (the applicant has no portal account)
 * and the Private-Client path the same shape. And a client folder is carved
 * out of the firm-wide default that makes every staff member a downloader —
 * so an application's documents are not readable by the whole firm the moment
 * they are uploaded, which they would be anywhere else in the library.
 *
 * **Addressed by id.** `cip_applications.folder_id` and `cip_people.folder_id`
 * hold the links. Client folders rename themselves to follow the client's
 * name, so a tree that found its folders by name would detach the first time
 * anyone was renamed.
 *
 * **Owned by the service account.** Not the uploader: `folders.owner_id`
 * cascades on delete, and an owner's rights cannot be revoked, so a provider
 * contact owning the tree would take it with them when their account closed,
 * and would outrank Phase 7's submission lock.
 */
class Tree
{
    public const ADDITIONAL = 'Additional Documents';

    /** §17 — what still accepts paper after the original package is frozen. */
    public const ADDITIONAL_QUERIES = 'Queries';

    public const ADDITIONAL_NON_COMPLIANCE = 'Non-Compliance Requests';

    public const ADDITIONAL_SUPPLEMENTARY = 'Supplementary Documents';

    public const ADDITIONAL_UNIT = 'Unit Requests';

    /** @var list<string> */
    public const ADDITIONAL_DRAWERS = [
        self::ADDITIONAL_QUERIES,
        self::ADDITIONAL_NON_COMPLIANCE,
        self::ADDITIONAL_SUPPLEMENTARY,
        self::ADDITIONAL_UNIT,
    ];

    public const POST_APPROVAL = 'Post-Approval Documents';

    /**
     * Give the application a client record, a folder tree, and one folder per
     * person. Safe to call again: it fills in what is missing.
     *
     * The people hang directly off the client:
     *
     *     Asem Haddad
     *       ├── Main Applicant
     *       ├── Sponsor              (only when there is one)
     *       ├── Dependent 1
     *       ├── Dependent 2
     *       └── Additional Documents
     *             ├── Queries
     *             ├── Non-Compliance Requests
     *             ├── Supplementary Documents
     *             └── Unit Requests
     *
     * Not under a folder named for the application. Somebody opening a client
     * wants the people, and a numbered folder holding one more folder called
     * "Main Applicant" is a click that tells them nothing they did not know.
     * ⚠ The trade is that a second application for the same client shares
     * these folders rather than getting its own set.
     */
    public static function provision(CipApplication $application, ?User $actor = null): Folder
    {
        $application->loadMissing(['people', 'provider']);

        $client = self::client($application, $actor);
        $root = $client->folder ?: FolderProvisioner::provisionClientFolder($client, $actor);

        foreach ($application->people as $person) {
            self::personFolder($person, $root, $actor);
        }

        // One shared drawer for everything that belongs to the file rather
        // than to a person on it, plus the §17 purpose folders inside it.
        self::provisionAdditionalDrawers($application, $actor, $root);

        if ($application->folder_id !== $root->id) {
            $application->forceFill(['folder_id' => $root->id])->save();
        }

        self::stampClient($root, $client);

        return $root;
    }

    /**
     * Additional Documents and the four drawers §17 names for paper that
     * arrives after confirm: queries, non-compliance, supplementary files,
     * and Unit requests. Safe to call again; missing drawers are filled in.
     */
    public static function provisionAdditionalDrawers(
        CipApplication $application,
        ?User $actor = null,
        ?Folder $root = null,
    ): Folder {
        $root ??= $application->folder_id ? Folder::find($application->folder_id) : null;
        if ($root === null) {
            $root = self::provision($application, $actor);
        }

        $additional = self::childNamed($root, self::ADDITIONAL, $actor);
        foreach (self::ADDITIONAL_DRAWERS as $name) {
            self::childNamed($additional, $name, $actor);
        }

        return $additional;
    }

    /** The Additional Documents drawer, if this application already has a tree. */
    public static function additionalFolder(CipApplication $application): ?Folder
    {
        if (! $application->folder_id) {
            return null;
        }

        return Folder::query()
            ->where('parent_id', $application->folder_id)
            ->where('name', self::ADDITIONAL)
            ->first();
    }

    /**
     * The post-approval repository tree under the client folder.
     *
     * One drawer for the lane, then one folder per person on the file. The
     * link lives on {@see CipApplication::$post_approval_folder_id} so uploads
     * can be filed there without walking the tree by name.
     */
    public static function provisionPostApproval(CipApplication $application, ?User $actor = null): Folder
    {
        $application->loadMissing(['people', 'client']);

        $root = $application->folder_id
            ? Folder::find($application->folder_id)
            : self::provision($application, $actor);

        if ($root === null) {
            $root = self::provision($application, $actor);
        }

        $postRoot = self::childNamed($root, self::POST_APPROVAL, $actor);

        foreach ($application->people as $person) {
            self::postApprovalPersonFolder($person, $postRoot, $actor);
        }

        if ($application->post_approval_folder_id !== $postRoot->id) {
            $application->forceFill(['post_approval_folder_id' => $postRoot->id])->save();
        }

        return $postRoot;
    }

    /**
     * One person's folder inside the post-approval tree.
     */
    public static function postApprovalPersonFolder(
        CipPerson $person,
        ?Folder $postRoot = null,
        ?User $actor = null,
    ): Folder {
        $person->loadMissing('application');

        $postRoot ??= $person->application->post_approval_folder_id
            ? Folder::find($person->application->post_approval_folder_id)
            : null;

        if ($postRoot === null) {
            $postRoot = self::provisionPostApproval($person->application, $actor);
        }

        return self::childNamed($postRoot, self::folderName($person), $actor);
    }

    /**
     * Give every folder in the tree the client it sits under.
     *
     * `folders.client_id` is a denormalisation the readers lean on:
     * {@see \App\Support\Cip\Attention} and
     * {@see \App\Support\Files\CommentReads::unreadByClient} find a
     * client's documents by joining it, so a folder that does not carry it is
     * a folder whose conversations no indicator can see.
     *
     * It was only ever written at creation, copied from whatever the parent
     * held at that moment, and two paths leave it NULL: a tree built before
     * the client row existed, and {@see self::childNamed} finding a folder by
     * name instead of making one, which returns it as it is. Nothing went
     * back for either. Chen Wei's Main Applicant folder held 21 comments and
     * a NULL, so the dot that exists to find them could not see a single one.
     *
     * Only NULLs are filled. A folder naming a different client is making a
     * claim this method has no better information than, and quietly
     * reassigning documents between clients is not a repair.
     */
    private static function stampClient(Folder $root, Client $client): void
    {
        $ids = array_merge([$root->id], FolderTree::descendantIdsWithTrashed($root));

        Folder::withTrashed()
            ->whereIn('id', $ids)
            ->whereNull('client_id')
            ->update(['client_id' => $client->id]);
    }

    /**
     * The main applicant's client-hub record, created if this is the first
     * time the portal has heard of them.
     *
     * Not linked to a user account: most applicants never sign in, and a
     * client row without a `user_id` is the hub's normal shape for somebody
     * the firm holds a file on.
     */
    public static function client(CipApplication $application, ?User $actor = null): Client
    {
        if ($application->client) {
            /*
             * True the referral up while we are here.
             *
             * The hub's Company column and the provider tab's client count
             * both read referred_by_company_id, and a client attached to an
             * application some way other than this method, imported, made by
             * hand, linked before the referral was written, drifts: Galaxy
             * Partners showed three applications and zero clients. The filing
             * firm is the referrer, so a client an application names is
             * brought in step rather than left contradicting the table.
             */
            $firm = $application->provider?->company_id;

            if ($firm && $application->client->referred_by_company_id !== $firm) {
                $application->client->forceFill([
                    'referred_by_company_id' => $firm,
                    'referral_type' => Client::REFERRAL_COMPANY,
                ])->save();
            }

            return $application->client;
        }

        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $name = $main?->fullName() ?: ('Application '.$application->displayNumber());

        $client = Client::create([
            'uid' => self::uid($name, $application),
            'name' => $name,
            'client_type' => 'private',
            // The provider that filed it is the referring company, which is
            // exactly what the hub's referral column means.
            'referral_type' => $application->provider?->company_id
                ? Client::REFERRAL_COMPANY
                : Client::REFERRAL_PRIVATE,
            'referred_by_company_id' => $application->provider?->company_id,
            'initial' => Str::upper(Str::substr($name, 0, 1)),
            'initial_color' => 'blue',
            'data' => [
                'firstName' => $main?->first_name,
                'lastName' => $main?->last_name,
                // The join back, so the hub profile can open the application.
                'cip' => ['applicationUuid' => $application->uuid],
            ],
            'created_by' => $actor?->id,
        ]);

        $application->forceFill(['client_id' => $client->id])->save();
        $application->setRelation('client', $client);

        return $client;
    }

    /**
     * What a person's folder is called.
     *
     * Not {@see Dependents::label}, which answers the government's question —
     * "Qualified Dependent 2", or "Spouse", the classification §5 computes
     * from the dates of birth. A folder answers a simpler one: which of the
     * dependants is this. So they run 1, 2, 3 down the tree in the order the
     * classification puts them, and a spouse is a dependant like the rest.
     */
    public static function folderName(CipPerson $person): string
    {
        if ($person->role === CipPerson::ROLE_MAIN_APPLICANT) {
            return 'Main Applicant';
        }
        if ($person->role === CipPerson::ROLE_SPONSOR) {
            return 'Sponsor';
        }

        // One composite key, not a list of them: sortBy() reads an array as
        // [column, direction] pairs, so passing two closures sorted by
        // neither and a spouse came out ahead of the second qualified
        // dependent. Unnumbered people sort last, then by id so the order is
        // total and two dependants never swap places between renders.
        $order = $person->application?->people
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->sortBy(fn (CipPerson $p) => ($p->dependent_ordinal ?? 9999) * 1000000 + $p->id)
            ->values()
            ->search(fn (CipPerson $p) => $p->id === $person->id);

        return 'Dependent '.(is_int($order) ? $order + 1 : 1);
    }

    /**
     * One person, one repository. Renamed rather than recreated when the
     * numbering changes, the link is the id, so the name is free to follow.
     */
    public static function personFolder(CipPerson $person, Folder $root, ?User $actor = null): Folder
    {
        $name = self::folderName($person);

        if ($person->folder_id && $folder = Folder::find($person->folder_id)) {
            if ($folder->name !== $name) {
                $folder->forceFill(['name' => $name])->save();
            }

            return $folder;
        }

        $folder = self::childNamed($root, $name, $actor);
        $person->forceFill(['folder_id' => $folder->id])->save();

        return $folder;
    }

    /**
     * Rename every person's folder to match their current place. Called after
     * dependants are renumbered, so "Dependent 2" is never the folder of
     * somebody who has become the first.
     */
    public static function resyncNames(CipApplication $application): void
    {
        $application->loadMissing('people');

        foreach ($application->people as $person) {
            if (! $person->folder_id) {
                continue;
            }
            $person->setRelation('application', $application);
            $folder = Folder::find($person->folder_id);
            $name = self::folderName($person);
            if ($folder && $folder->name !== $name) {
                $folder->forceFill(['name' => $name])->save();
            }
        }
    }

    /**
     * A named drawer inside a folder the caller already holds.
     *
     * The public door for the requirement templates, whose `folder` column
     * says where a slot's uploads are filed ({@see DocumentSlots}). It is
     * deliberately this narrow: the caller hands over a parent and a NAME,
     * and the child is always created under that parent, there is no path
     * to walk and no other ancestor to reach, so a folder name typed on a
     * template can never file a document outside the person's own folder.
     */
    public static function subfolder(Folder $parent, string $name, ?User $actor = null): Folder
    {
        return self::childNamed($parent, $name, $actor);
    }

    /**
     * A child folder of this parent, found by name or created.
     *
     * Found by name only at creation time, once it exists the id is the
     * link. Two applications for the same client each have their own
     * "Main Applicant" under their own application folder, so the lookup is
     * scoped to the parent and never collides.
     */
    private static function childNamed(Folder $parent, string $name, ?User $actor): Folder
    {
        /*
         * Case is folded in PHP, on both sides.
         *
         * SQL lower() and Str::lower() disagree on anything beyond ASCII —
         * SQLite folds only A-Z, so comparing one against the other made a
         * drawer named "Ödeme" miss its own row and mint a duplicate sibling
         * on every batch. Drawer names are the administrator's to invent now,
         * in whatever language the firm works in, and one folder's children
         * are few enough that reading them is cheaper than being wrong.
         */
        $wanted = Str::lower(trim($name));
        $existing = Folder::query()
            ->where('parent_id', $parent->id)
            ->get()
            ->first(fn (Folder $child) => Str::lower($child->name) === $wanted);

        if ($existing) {
            return $existing;
        }

        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'folder_type' => Folder::TYPE_USER,
            'parent_id' => $parent->id,
            'client_id' => $parent->client_id,
            'owner_id' => $parent->owner_id,
            'created_by' => $actor?->id ?? $parent->owner_id,
        ]);
    }

    /** A hub uid nobody else holds. */
    private static function uid(string $name, CipApplication $application): string
    {
        $base = Str::slug($name) ?: 'applicant';
        $uid = $base.'-'.Str::lower($application->internal_number ?: Str::random(6));

        $i = 2;
        while (Client::withTrashed()->where('uid', $uid)->exists()) {
            $uid = $base.'-'.$i++;
        }

        return $uid;
    }
}
