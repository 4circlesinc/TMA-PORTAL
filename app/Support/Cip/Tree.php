<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\Client;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\FolderProvisioner;
use Illuminate\Support\Str;

/**
 * The application's folder tree (§6), and the client record it hangs from.
 *
 * §6 asks for one repository per individual:
 *
 *     Application GAL26-00001
 *       ├── Main Applicant
 *       ├── Sponsor              (only when there is one)
 *       ├── Qualified Dependent 1
 *       └── Additional Documents
 *
 * **Where it hangs.** Every application's main applicant gets a lightweight
 * client-hub record, created here if the applicant is not already one, and
 * the tree is provisioned under that client's folder. Two reasons. It makes
 * the Service-Provider path (the applicant has no portal account) and the
 * Private-Client path the same shape. And a client folder is carved out of
 * the firm-wide default that makes every staff member a downloader — so an
 * application's documents are not readable by the whole firm the moment they
 * are uploaded, which they would be anywhere else in the library.
 *
 * **Addressed by id.** `cip_applications.folder_id` and `cip_people.folder_id`
 * hold the links. Client folders rename themselves to follow the client's
 * name, so a tree that found its folders by name would detach the first time
 * anyone was renamed.
 *
 * **Owned by the service account.** Not the uploader: `folders.owner_id`
 * cascades on delete, and an owner's rights cannot be revoked — so a provider
 * contact owning the tree would take it with them when their account closed,
 * and would outrank Phase 7's submission lock.
 */
class Tree
{
    public const ADDITIONAL = 'Additional Documents';

    /**
     * Give the application a client record, a folder tree, and one folder per
     * person. Safe to call again: it fills in what is missing.
     */
    public static function provision(CipApplication $application, ?User $actor = null): Folder
    {
        $application->loadMissing(['people', 'provider']);

        $client = self::client($application, $actor);
        $clientFolder = $client->folder ?: FolderProvisioner::provisionClientFolder($client, $actor);

        $root = self::applicationFolder($application, $clientFolder, $actor);

        foreach ($application->people as $person) {
            self::personFolder($person, $root, $actor);
        }

        // One shared drawer for everything that belongs to the file rather
        // than to a person on it.
        self::childNamed($root, self::ADDITIONAL, $actor);

        return $root;
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

        return $client;
    }

    /** The application's own folder, under the client's. */
    private static function applicationFolder(CipApplication $application, Folder $parent, ?User $actor): Folder
    {
        if ($application->folder_id && $folder = Folder::find($application->folder_id)) {
            return $folder;
        }

        $folder = self::childNamed($parent, 'Application '.$application->displayNumber(), $actor);
        $application->forceFill(['folder_id' => $folder->id])->save();

        return $folder;
    }

    /**
     * One person, one repository. Renamed rather than recreated when a
     * dependent's ordinal changes — the link is the id, so the name is free
     * to follow {@see Dependents::label}.
     */
    public static function personFolder(CipPerson $person, Folder $root, ?User $actor = null): Folder
    {
        $name = Dependents::label($person);

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
     * Rename every person's folder to match their current label. Called after
     * dependents are renumbered, so "Qualified Dependent 2" is never the
     * folder of somebody who has become QD1.
     */
    public static function resyncNames(CipApplication $application): void
    {
        $application->loadMissing('people');

        foreach ($application->people as $person) {
            if (! $person->folder_id) {
                continue;
            }
            $folder = Folder::find($person->folder_id);
            $name = Dependents::label($person);
            if ($folder && $folder->name !== $name) {
                $folder->forceFill(['name' => $name])->save();
            }
        }
    }

    /**
     * A child folder of this parent, found by name or created.
     *
     * Found by name only at creation time — once it exists the id is the
     * link. Two applications for the same client each have their own
     * "Main Applicant" under their own application folder, so the lookup is
     * scoped to the parent and never collides.
     */
    private static function childNamed(Folder $parent, string $name, ?User $actor): Folder
    {
        $existing = Folder::query()
            ->where('parent_id', $parent->id)
            ->whereRaw('lower(name) = ?', [Str::lower($name)])
            ->first();

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
