<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\Client;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\CommentReads;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\FolderTree;
use App\Support\Files\Naming;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The application's folder tree (section 6), and the client record it hangs from.
 *
 * Section 6 asks for one repository per individual, and they hang off the client:
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

    /** Section 17 — what still accepts paper after the original package is frozen. */
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

    /*
     * Where an appeal's paper goes, and the only drawer open while the file
     * is in the appeal lane. The original package is frozen by then and the
     * Additional Documents drawers belong to the Unit's queries on the first
     * decision; an appeal answers the decision itself, so it gets its own.
     */
    public const APPEAL = 'Appeal Documents';

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

        /*
         * A file filed straight into post-approval has no pre-approval paper,
         * so it gets no person folders out here. Its people live under
         * Post-Approval Documents, which provisionPostApproval builds, and
         * making them in both places left every person listed twice in the
         * client folder — one of each pair permanently empty.
         *
         * A file that REACHED post-approval the ordinary way keeps its
         * pre-approval folders: they hold the package that was submitted.
         * The test is what the application carries, not where it stands now.
         */
        if (! self::filedIntoPostApproval($application)) {
            foreach ($application->people as $person) {
                self::personFolder($person, $root, $actor);
            }
        }

        // One shared drawer for everything that belongs to the file rather
        // than to a person on it, plus the section 17 purpose folders inside it.
        self::provisionAdditionalDrawers($application, $actor, $root);

        if ($application->folder_id !== $root->id) {
            $application->forceFill(['folder_id' => $root->id])->save();
        }

        self::stampClient($root, $client);

        return $root;
    }

    /**
     * Was this application filed directly into post-approval?
     *
     * Not "is it post-approval now": a file that walked the ordinary lane has
     * pre-approval folders full of the package it submitted, and those stay.
     * A file created in the post-approval phase never had that paper, so the
     * only tree it needs is the one under Post-Approval Documents.
     *
     * `submitted_at` is the marker, because it is stamped when a file goes to
     * the Unit and is null on a file that was entered after that happened.
     */
    private static function filedIntoPostApproval(CipApplication $application): bool
    {
        return ($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL
            && $application->submitted_at === null;
    }

    /**
     * Additional Documents and the four drawers section 17 names for paper that
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

        /*
         * One drawer, found by purpose, not by the exact letters currently
         * painted on it.
         *
         * SharePoint's create-folder conflict rule is `rename`, which yields
         * "Additional Documents 1" (no parentheses). Inbound sync used to
         * copy that name back onto the portal row, after which the next
         * provision could not see the drawer it had just made and minted
         * another. Opening a client then showed Additional Documents 1, 3,
         * 5, 8… each with the four empty purpose folders. Numbered siblings
         * are the same drawer; they are folded back into one here.
         */
        $additional = self::ensureChildDrawer($root, self::ADDITIONAL, $actor);
        foreach (self::ADDITIONAL_DRAWERS as $name) {
            self::ensureChildDrawer($additional, $name, $actor);
        }

        return $additional;
    }

    /**
     * Open the Appeal Documents drawer, creating the tree if it is missing.
     *
     * Same shape as {@see provisionAdditionalDrawers}: called when the file
     * enters the appeal lane, so the folder exists before anybody is told to
     * upload into it.
     */
    public static function provisionAppeal(
        CipApplication $application,
        ?User $actor = null,
        ?Folder $root = null,
    ): Folder {
        $root ??= $application->folder_id ? Folder::find($application->folder_id) : null;
        if ($root === null) {
            $root = self::provision($application, $actor);
        }

        return self::ensureChildDrawer($root, self::APPEAL, $actor);
    }

    /** The Appeal Documents drawer, if this application already has a tree. */
    public static function appealFolder(CipApplication $application): ?Folder
    {
        if (! $application->folder_id) {
            return null;
        }

        $root = Folder::find($application->folder_id);

        return $root ? self::existingDrawer($root, self::APPEAL) : null;
    }

    /** The Additional Documents drawer, if this application already has a tree. */
    public static function additionalFolder(CipApplication $application): ?Folder
    {
        if (! $application->folder_id) {
            return null;
        }

        $root = Folder::find($application->folder_id);

        return $root ? self::existingDrawer($root, self::ADDITIONAL) : null;
    }

    /**
     * Is this the name of a managed CIP drawer, including the numbered
     * copies Graph's conflict-rename leaves behind ("Additional Documents 1")?
     */
    public static function isDrawerVariant(string $canonical, string $name): bool
    {
        $name = trim($name);
        $canonical = trim($canonical);
        if ($name === '' || $canonical === '') {
            return false;
        }
        if (strcasecmp($name, $canonical) === 0) {
            return true;
        }

        return (bool) preg_match(
            '/^'.preg_quote($canonical, '/').'(?:\s+\(?\d+\)?)?$/iu',
            $name,
        );
    }

    /** The canonical drawer this name is a copy of, if it is one. */
    public static function canonicalDrawerName(string $name): ?string
    {
        foreach (array_merge(
            [self::ADDITIONAL, self::APPEAL, self::POST_APPROVAL],
            self::ADDITIONAL_DRAWERS,
        ) as $canonical) {
            if (self::isDrawerVariant($canonical, $name)) {
                return $canonical;
            }
        }

        return null;
    }

    /**
     * Drawers hanging off these parents whose names match any of the
     * canonical labels, including numbered copies.
     *
     * @param  list<int>  $parentIds
     * @param  list<string>  $canonicals
     * @return Collection<int, Folder>
     */
    public static function drawersNamed(array $parentIds, array $canonicals, bool $trashed = false): Collection
    {
        $parentIds = array_values(array_unique(array_filter($parentIds)));
        if ($parentIds === [] || $canonicals === []) {
            return collect();
        }

        $query = $trashed ? Folder::onlyTrashed() : Folder::query();

        return $query
            ->whereIn('parent_id', $parentIds)
            ->get()
            ->filter(function (Folder $folder) use ($canonicals) {
                foreach ($canonicals as $canonical) {
                    if (self::isDrawerVariant($canonical, $folder->name)) {
                        return true;
                    }
                }

                return false;
            })
            ->values();
    }

    /** The existing managed drawer under this parent, if there is one. */
    public static function existingDrawer(Folder $parent, string $canonical, ?int $exceptId = null): ?Folder
    {
        $matches = Folder::query()
            ->where('parent_id', $parent->id)
            ->get()
            ->filter(fn (Folder $child) => self::isDrawerVariant($canonical, $child->name))
            ->when($exceptId, fn ($rows) => $rows->reject(fn (Folder $child) => $child->id === $exceptId))
            ->sortBy('id')
            ->values();

        return $matches->first(fn (Folder $child) => strcasecmp($child->name, $canonical) === 0)
            ?? $matches->first();
    }

    /**
     * The post-approval repository tree under the client folder.
     *
     * One drawer for the lane, then one folder per person, then the COR / NIC /
     * Passport pack drawers inside each person. The link lives on
     * {@see CipApplication::$post_approval_folder_id} so uploads can be filed
     * there without walking the tree by name.
     *
     *     Post-Approval Documents
     *       ├── Main Applicant
     *       │     ├── COR
     *       │     ├── NIC
     *       │     └── Passport
     *       └── Dependent 1
     *             ├── COR
     *             ├── NIC
     *             └── Passport
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

        $postRoot = self::ensureChildDrawer($root, self::POST_APPROVAL, $actor);

        foreach ($application->people as $person) {
            $person->setRelation('application', $application);
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

        $folder = self::childNamed($postRoot, self::folderName($person), $actor);
        self::provisionPackFolders($folder, $actor);

        return $folder;
    }

    /**
     * COR, NIC and Passport drawers inside one post-approval person folder.
     *
     * Created empty so the Documents tab has somewhere to file each pack
     * before the first scan lands. Uploads still go through
     * {@see DocumentSlots}; these drawers are the filing place, not the
     * checklist.
     */
    public static function provisionPackFolders(Folder $personFolder, ?User $actor = null): void
    {
        foreach ([Pack::COR, Pack::NIC, Pack::PASSPORT] as $pack) {
            self::childNamed($personFolder, Pack::folder($pack), $actor);
        }
    }

    /**
     * The person this folder belongs to: their pre-approval repository, or
     * their folder under Post-Approval Documents.
     *
     * Pack drawers (COR / NIC / Passport) are children of the person folder,
     * so the caller walks up until this matches.
     */
    public static function personAt(Folder $folder): ?CipPerson
    {
        $person = CipPerson::where('folder_id', $folder->id)->first();

        if ($person !== null) {
            return $person;
        }

        if ($folder->parent_id === null) {
            return null;
        }

        $application = CipApplication::query()
            ->where('post_approval_folder_id', $folder->parent_id)
            ->first();

        if ($application === null) {
            return null;
        }

        $application->loadMissing('people');

        foreach ($application->people as $candidate) {
            $candidate->setRelation('application', $application);

            if (strcasecmp(self::folderName($candidate), $folder->name) === 0) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * Give every folder in the tree the client it sits under.
     *
     * `folders.client_id` is a denormalisation the readers lean on:
     * {@see Attention} and
     * {@see CommentReads::unreadByClient} find a
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

            self::syncClientName($application);

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
     * "Qualified Dependent 2", or "Spouse", the classification section 5 computes
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
        $application->load('people');
        self::syncClientName($application, force: true);

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
     * Name the hub record for the person, not the file.
     *
     * {@see self::client()} mints "Application {number}" when the main
     * applicant has no name yet — a draft's first autosave, a photo before
     * the identity fields. Later answers write the person and used to leave
     * the hub answering twice: the table from the person, the profile from
     * the client. The person is the name.
     *
     * Opening a file only replaces that fallback. A hub already named for
     * somebody — mixed case from before names were printed in capitals,
     * a name typed on the client itself — is left alone. Callers that just
     * wrote the person pass `$force` so a correction follows through.
     */
    public static function syncClientName(CipApplication $application, bool $force = false): void
    {
        $application->loadMissing(['client', 'people']);

        $client = $application->client;
        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $name = trim((string) ($main?->fullName() ?? ''));

        if (! $client || $name === '') {
            return;
        }

        if (! $force && ! self::clientNameIsFileFallback($client, $application)) {
            return;
        }

        $data = $client->data ?? [];
        $same = $client->name === $name
            && ($data['firstName'] ?? null) === $main->first_name
            && ($data['lastName'] ?? null) === $main->last_name;

        if ($same) {
            return;
        }

        $data['firstName'] = $main->first_name;
        $data['lastName'] = $main->last_name;

        $client->forceFill([
            'name' => $name,
            'initial' => Str::upper(Str::substr($name, 0, 1)),
            'data' => $data,
        ])->save();

        FolderProvisioner::syncClientFolderName($client);
    }

    /** Was this client minted as a stand-in for the file number? */
    private static function clientNameIsFileFallback(Client $client, CipApplication $application): bool
    {
        $name = trim((string) $client->name);
        if ($name === '') {
            return true;
        }

        $needles = array_filter([
            'Application '.$application->displayNumber(),
            $application->internal_number ? 'Application '.$application->internal_number : null,
            $application->cip_number ? 'Application '.$application->cip_number : null,
        ]);

        foreach ($needles as $needle) {
            if (strcasecmp($name, $needle) === 0) {
                return true;
            }
        }

        return (bool) preg_match('/^Application\s+[A-Z]{2,}\d{2}-\d+$/iu', $name);
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

        return self::createChild($parent, $name, $actor);
    }

    /**
     * One managed drawer under this parent: found, healed, or created.
     *
     * Numbered copies ("Additional Documents 1") are the same drawer as
     * the canonical name. They are folded into the oldest row and renamed
     * back, so a later provision cannot mistake the copy for a missing
     * folder and mint another.
     */
    private static function ensureChildDrawer(Folder $parent, string $canonical, ?User $actor): Folder
    {
        return DB::transaction(function () use ($parent, $canonical, $actor) {
            Folder::query()->whereKey($parent->id)->lockForUpdate()->first();

            $matches = Folder::query()
                ->where('parent_id', $parent->id)
                ->get()
                ->filter(fn (Folder $child) => self::isDrawerVariant($canonical, $child->name))
                ->sortBy('id')
                ->values();

            if ($matches->isEmpty()) {
                return self::createChild($parent, $canonical, $actor);
            }

            $keeper = $matches->first(
                fn (Folder $child) => strcasecmp($child->name, $canonical) === 0,
            ) ?? $matches->first();

            if (strcasecmp($keeper->name, $canonical) !== 0) {
                $keeper->forceFill(['name' => $canonical])->save();
            }

            foreach ($matches as $dupe) {
                if ($dupe->id === $keeper->id) {
                    continue;
                }
                self::absorbFolder($dupe, $keeper, $actor);
            }

            return $keeper->refresh();
        });
    }

    /** Move everything in $source into $target, then recycle the empty shell. */
    private static function absorbFolder(Folder $source, Folder $target, ?User $actor): void
    {
        foreach (FileItem::query()->where('folder_id', $source->id)->get() as $file) {
            $name = Naming::nextAvailable(
                $file->name,
                fn (string $candidate) => FileItem::query()
                    ->where('folder_id', $target->id)
                    ->whereRaw('LOWER(name) = ?', [mb_strtolower($candidate)])
                    ->exists(),
            );
            $file->forceFill([
                'folder_id' => $target->id,
                'name' => $name,
            ])->save();
        }

        foreach (Folder::query()->where('parent_id', $source->id)->get() as $child) {
            $wanted = Str::lower($child->name);
            $existing = Folder::query()
                ->where('parent_id', $target->id)
                ->get()
                ->first(fn (Folder $sibling) => Str::lower($sibling->name) === $wanted);

            if ($existing) {
                self::absorbFolder($child, $existing, $actor);
            } else {
                $child->forceFill(['parent_id' => $target->id])->save();
            }
        }

        FolderTree::softDeleteTree($source, (int) ($actor?->id ?? $source->owner_id));
    }

    private static function createChild(Folder $parent, string $name, ?User $actor): Folder
    {
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
