<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\CompanyLocation;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Companies\NotificationEmail;

/**
 * Who a CIP notice writes to. Section 22's four classes, unique by mailbox.
 *
 * A member whose mailbox is also the registry contact is one recipient, not
 * two, and a private client with no firm behind them is their own provider
 * side.
 */
class Contacts
{
    /**
     * Every approved Administrator account, the brief's "Administrator" as a
     * class, not the person who last touched the file.
     *
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    public static function administrators(): array
    {
        $recipients = [];

        User::query()
            ->where('account_type', Role::ADMINISTRATOR)
            ->where('status', User::STATUS_APPROVED)
            ->whereNotNull('email')
            ->get(['id', 'name', 'email'])
            ->each(function (User $admin) use (&$recipients) {
                if ($admin->email === '') {
                    return;
                }

                $recipients[mb_strtolower($admin->email)] = [
                    'email' => $admin->email,
                    'name' => $admin->name,
                    'userId' => $admin->id,
                ];
            });

        return array_values($recipients);
    }

    /**
     * Section 22's four classes: CIP Distribution Group + Assigned Officer +
     * Administrators + Service Provider Contact, unique by mailbox.
     *
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    public static function notices(CipApplication $application): array
    {
        $recipients = [];

        foreach ([
            ...self::distributionGroup(),
            ...self::assignedOfficers($application),
            ...self::administrators(),
            ...self::providerSide($application),
            // The developer or promoter behind the investment, whichever
            // firm filed: Settings › CIP Console › Investment Copies.
            ...InvestmentCopies::recipients($application),
        ] as $recipient) {
            // One mailbox reached through two classes is mailed if either
            // class mails it: a firm's choice of notification email quiets
            // its own contacts, never a copy another class is owed.
            NotificationEmail::fold($recipients, $recipient);
        }

        return array_values($recipients);
    }

    /**
     * Administrator + Reviewing Officer + Service Provider + CIP Distribution
     * Group, unique by mailbox. Alias of {@see notices()}.
     *
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    public static function parties(CipApplication $application): array
    {
        return self::notices($application);
    }

    /**
     * Members of the CIP Distribution Group, plus any extra mailboxes. A
     * person who is also an administrator is still one recipient.
     *
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    public static function distributionGroup(): array
    {
        $recipients = [];

        $name = Distribution::groupName();

        if ($name !== '') {
            $group = Distribution::group();

            foreach ($group?->members()->with('user:id,name,email')->get() ?? [] as $member) {
                $user = $member->user;
                $email = $user?->email;

                if (! $email) {
                    continue;
                }

                $recipients[mb_strtolower($email)] = [
                    'email' => $email,
                    'name' => $user->name,
                    'userId' => $user->id,
                ];
            }
        }

        foreach (Distribution::extraEmails() as $email) {
            $email = trim((string) $email);

            if ($email === '' || isset($recipients[mb_strtolower($email)])) {
                continue;
            }

            $recipients[mb_strtolower($email)] = [
                'email' => $email,
                'name' => null,
                'userId' => null,
            ];
        }

        return array_values($recipients);
    }

    /**
     * Everyone currently holding this file, reviewing officer and, when one
     * is named, the compliance officer. Section 22 says "Assigned Officer".
     *
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    public static function assignedOfficers(CipApplication $application): array
    {
        $recipients = [];

        foreach (Assignments::live($application) as $assignment) {
            $officer = $assignment->user;

            if ($officer === null || ! $officer->email) {
                continue;
            }

            $recipients[mb_strtolower($officer->email)] = [
                'email' => $officer->email,
                'name' => $officer->name,
                'userId' => $officer->id,
            ];
        }

        return array_values($recipients);
    }

    /**
     * The reviewing officer holding this file, if anybody is.
     *
     * Live assignments are the authority; the cache column is only what the
     * table draws. An application nobody holds contributes nobody, the other
     * classes still get the notice.
     *
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    public static function reviewingOfficer(CipApplication $application): array
    {
        $holder = Assignments::live($application)
            ->firstWhere('role', CipAccess::REVIEWING_OFFICER);
        $officer = $holder?->user;

        if ($officer === null || ! $officer->email) {
            return [];
        }

        return [[
            'email' => $officer->email,
            'name' => $officer->name,
            'userId' => $officer->id,
        ]];
    }

    /**
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    public static function providerSide(CipApplication $application): array
    {
        $application->loadMissing(['provider.company', 'client']);

        $recipients = [];

        if ($application->provider) {
            foreach (self::providerContacts($application->provider, $application) as $recipient) {
                $recipients[mb_strtolower($recipient['email'])] = $recipient;
            }
        }

        // A private client is their own provider side. That is a firm with
        // nobody on its standing list, not a branch whose own people happen
        // to be absent from this file. A mailbox that is there only because
        // the firm chose an invited member does not make the client any less
        // the one to tell.
        $standing = array_filter($recipients, fn (array $row) => ! ($row['invited'] ?? false));
        $firm = $application->provider ? self::providerContacts($application->provider) : [];
        $firmStanding = array_filter($firm, fn (array $row) => ! ($row['invited'] ?? false));

        if ($standing === [] && $firmStanding === [] && $application->client) {
            $email = $application->client->user?->email ?: $application->client->email;

            if ($email) {
                $recipients[mb_strtolower($email)] = [
                    'email' => $email,
                    'name' => $application->client->name,
                    'userId' => $application->client->user_id,
                ];
            }
        }

        return array_values($recipients);
    }

    /**
     * One firm's contacts: its active members, the registry's own contact
     * address, and the company mailbox, unique by email.
     *
     * The filing firm's provider side, and also what a firm copied because
     * of the investment ({@see InvestmentCopies}) receives, so a developer
     * on the register hears exactly what it would hear as the filing firm.
     *
     * A firm that chose one notification email ({@see NotificationEmail})
     * still gets the whole list back; every row but the chosen one carries
     * `mail => false`, which the two delivery loops read before they send.
     * That choice only narrows people who hear this application. A branch
     * that was not assigned the file is not on the list at all, so the
     * choice cannot hand it a notice meant for another office.
     *
     * Pass the application when the list is for one file. Without one, the
     * standing list is everyone at the firm, which is what a copied firm
     * receives and what the Access card previews.
     *
     * @return list<array{email:string, name:?string, userId:?int, mail?:false, invited?:true}>
     */
    public static function providerContacts(CipProvider $provider, ?CipApplication $application = null): array
    {
        $provider->loadMissing('company');
        $recipients = [];
        $company = $provider->company;
        // The one member the firm asked its notification emails to go to,
        // if it chose one, and where they sit on this list.
        $chosen = NotificationEmail::memberFor($company);
        $chosenKey = null;

        if ($company) {
            foreach ($company->members()->where('status', CompanyMember::STATUS_ACTIVE)->with(['user', 'location'])->get() as $member) {
                if (! self::hearsOffice($member, $application)) {
                    continue;
                }

                $email = $member->email ?: $member->user?->email;

                if ($email) {
                    $recipients[mb_strtolower($email)] = [
                        'email' => $email,
                        'name' => $member->name,
                        'userId' => $member->user_id,
                    ];

                    if ($chosen && $member->id === $chosen->id) {
                        $chosenKey = mb_strtolower($email);
                    }
                }
            }
        }

        // Chosen and still only invited: a shared mailbox that never signs
        // in is not an active member, and is where the firm wants its mail.
        // A branch mailbox only stands in for the applications on its branch.
        if ($chosen && $chosenKey === null && self::hearsOffice($chosen, $application)) {
            $email = (string) NotificationEmail::addressOf($chosen);
            $chosenKey = mb_strtolower($email);
            $recipients[$chosenKey] ??= [
                'email' => $email,
                'name' => $chosen->name,
                'userId' => $chosen->user_id,
                'invited' => true,
            ];
        }

        // The registry contact and the firm's own mailbox are the main
        // office's addresses. A file sitting on a branch is that branch's
        // notice, not a second copy to the main office.
        if (self::firmBook($application)) {
            $contact = $provider->contact_email;

            if ($contact && ! isset($recipients[mb_strtolower($contact)])) {
                $recipients[mb_strtolower($contact)] = [
                    'email' => $contact,
                    'name' => $provider->contact_name,
                    'userId' => null,
                ];
            }

            $firmEmail = $company?->email;

            if ($firmEmail && ! isset($recipients[mb_strtolower($firmEmail)])) {
                $recipients[mb_strtolower($firmEmail)] = [
                    'email' => $firmEmail,
                    'name' => $company->name,
                    'userId' => null,
                ];
            }
        }

        // Everyone else stays on the list without the email: the bell and
        // the live refresh are read from it too ({@see providerUserIds}).
        if ($chosenKey !== null) {
            $recipients = NotificationEmail::only($recipients, $chosenKey);
        }

        return array_values($recipients);
    }

    /**
     * Whether this member hears a notice about this application.
     *
     * No application means the standing list, and everyone is on it. A
     * service provider admin reads the firm's whole book, so they hear
     * every file. A branch hears only the files assigned to that branch.
     * The main office, and a member not placed on an office yet, hears the
     * firm book: files nobody has sent to a branch.
     */
    private static function hearsOffice(CompanyMember $member, ?CipApplication $application): bool
    {
        if ($application === null) {
            return true;
        }

        $member->loadMissing(['user', 'location']);

        if (Role::isServiceProviderAdmin($member->user)) {
            return true;
        }

        $location = $member->location;
        if ($location instanceof CompanyLocation && $location->kind === CompanyLocation::KIND_BRANCH) {
            return $application->location_id !== null
                && (int) $application->location_id === (int) $location->id;
        }

        return self::firmBook($application);
    }

    /**
     * A file still on the firm book: not assigned, or assigned to the main
     * office. A branch assignment is not.
     */
    private static function firmBook(?CipApplication $application): bool
    {
        if ($application === null || $application->location_id === null) {
            return true;
        }

        $application->loadMissing('location');

        return $application->location?->isMain() === true;
    }

    /**
     * The provider-side people who hold portal accounts — the reach of a
     * live signal. Staff hear every CIP write through Live::staff; without
     * this the provider watching the same application only learned of a
     * status move by reloading.
     *
     * @return list<int>
     */
    public static function providerUserIds(CipApplication $application): array
    {
        return array_values(array_unique(array_filter(
            array_column(self::providerSide($application), 'userId'),
        )));
    }

    /**
     * The facts every CIP notice names: number, applicant, firm, family.
     *
     * An Add-On notice also names the granted parent: CIP number, main
     * applicant, and the person being added. Section 10's assignment email
     * is built from those, not from the family-file labels.
     *
     * @return array{
     *     number: string,
     *     applicant: string,
     *     provider: string,
     *     familySize: int,
     *     addOn?: bool,
     *     cipNumber?: string,
     *     mainApplicant?: string,
     *     addonApplicant?: string
     * }
     */
    public static function facts(CipApplication $application): array
    {
        $application->loadMissing(['provider', 'client', 'people']);

        $applicant = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $name = CipPerson::upperName(
            $applicant?->fullName() ?: (string) ($application->client?->name ?? '')
        );

        $facts = [
            'number' => $application->displayNumber(),
            // The firm's own reference, for the notices that name it beside
            // the CIP number rather than instead of it (an Add-On's row).
            'internalNumber' => (string) ($application->internal_number ?? ''),
            'applicant' => $name !== null && $name !== '' ? $name : 'Unnamed applicant',
            'provider' => $application->provider?->name ?? 'Private client',
            'familySize' => $application->familySize(),
        ];

        if (! $application->isAddOn()) {
            return $facts;
        }

        // Always mark Add-On so subject lines drop (Fn) and say APPROVED,
        // even before the parent link is loaded for the postcard body.
        $facts['addOn'] = true;
        $facts['addonApplicant'] = $facts['applicant'];
        // The Add-On's own CIP number, once the Unit has issued one. Kept
        // apart from `cipNumber`, which names the parent for this lane.
        $facts['ownCipNumber'] = (string) ($application->cip_number ?? '');

        $application->loadMissing([
            'parent.client',
            'parent.people' => fn ($q) => $q->where('role', CipPerson::ROLE_MAIN_APPLICANT),
        ]);

        $parent = $application->parent;
        if ($parent === null) {
            return $facts;
        }

        $named = AddOn::parentPayload($parent);

        $facts['cipNumber'] = (string) ($named['cipNumber'] ?? '');
        $facts['mainApplicant'] = ($named['applicantName'] ?? '') !== ''
            ? (string) $named['applicantName']
            : 'Unnamed applicant';

        return $facts;
    }

    /** The portal path a notice's button opens. */
    public static function path(CipApplication $application, ?string $status = null): string
    {
        $application->loadMissing('client');

        if (! $application->client) {
            // `search`, not `q`: the applications list reads that one. A `q`
            // link landed on the unfiltered list with the term dropped.
            return Pages::home('search='.urlencode($application->displayNumber()));
        }

        $query = 'tab=folders';

        /*
         * Documents sent back: open the checklist line that needs the new
         * file, on its person's tab, where the Upload control is. The
         * Documents tab is the file browser and has no checklist.
         */
        if ($status === Status::UPDATE_REQUIRED) {
            $first = self::firstSentBack($application);
            if ($first !== null) {
                return self::documentPath($first);
            }
        }

        /*
         * A stage that asks for documents (Stage 1 COR, Stage 2 NIC, Stage 3
         * passport): the checklist on the main applicant's tab, which is
         * where those slots are uploaded. Each person's tab has their own.
         */
        if (in_array($status, [Status::POST_APPROVAL, Status::APPLY_FOR_NIC, Status::APPLY_FOR_PASSPORT], true)) {
            $query = 'tab=applicant';
        }

        /*
         * Ready to submit / Apply for COR ask the provider to press Confirm
         * submission. Carry that intent so the button opens the confirm
         * dialog itself instead of dropping the reader on the folders tab to
         * hunt for it. The dialog still does the confirming — this only opens it.
         */
        if ($status === Status::READY_TO_SUBMIT || $status === Status::APPLY_FOR_COR) {
            $query = 'tab=overview&confirm=1';
        }

        if ($status === Status::NON_COMPLIANT) {
            $additional = Tree::additionalFolder($application);
            if ($additional) {
                $query .= '&folder='.$additional->uuid;
            }
        }

        if ($status === Status::DD_QUERY) {
            $drawer = Tree::additionalDrawer($application, Tree::ADDITIONAL_DD_QUERY)
                ?? Tree::additionalFolder($application);
            if ($drawer) {
                $query .= '&folder='.$drawer->uuid;
            }
        }

        // "Open Appeal Documents" opens that folder, the only one taking
        // uploads while the file is under appeal.
        if ($status === Status::NEW_APPEAL || $status === Status::APPEAL_READY) {
            $appeal = Tree::appealFolder($application);
            if ($appeal) {
                $query .= '&folder='.$appeal->uuid;
            }
        }

        return Pages::application($application->client->uid, $query);
    }

    public static function url(CipApplication $application, ?string $status = null): string
    {
        return rtrim(config('app.url'), '/').self::path($application, $status);
    }

    /**
     * One checklist line: its person's tab, with the line named so the page
     * scrolls to it and marks it. Where a sent-back document is replaced and
     * where its comments are read, so the email button lands on the upload.
     */
    public static function documentPath(CipDocument $document): string
    {
        $document->loadMissing(['application.client', 'person']);
        $application = $document->application;

        if (! $application?->client) {
            return $application ? self::path($application) : Pages::home();
        }

        return Pages::application(
            $application->client->uid,
            'tab='.self::personTab($document->person).'&doc='.$document->uuid,
        );
    }

    public static function documentUrl(CipDocument $document): string
    {
        return rtrim(config('app.url'), '/').self::documentPath($document);
    }

    /** The application tab a person's checklist sits on. */
    public static function personTab(?CipPerson $person): string
    {
        return match ($person?->role) {
            CipPerson::ROLE_SPONSOR => 'sponsor',
            CipPerson::ROLE_DEPENDENT => 'dependents',
            default => 'applicant',
        };
    }

    /**
     * The first document on the current checklist waiting for a new file,
     * the one an Updates Required notice opens on.
     */
    private static function firstSentBack(CipApplication $application): ?CipDocument
    {
        return Review::constrainToCurrentChecklist(
            CipDocument::query()->where('application_id', $application->id),
            $application->phase ?? Phase::PRE_APPROVAL,
            $application,
        )
            ->where('status', DocumentStatus::UPDATE_REQUIRED)
            ->orderBy('id')
            ->first();
    }
}
