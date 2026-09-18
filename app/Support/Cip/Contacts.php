<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;

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
        ] as $recipient) {
            $recipients[mb_strtolower($recipient['email'])] = $recipient;
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

        $company = $application->provider?->company;

        if ($company) {
            foreach ($company->members()->where('status', CompanyMember::STATUS_ACTIVE)->get() as $member) {
                $email = $member->email ?: $member->user?->email;

                if ($email) {
                    $recipients[mb_strtolower($email)] = [
                        'email' => $email,
                        'name' => $member->name,
                        'userId' => $member->user_id,
                    ];
                }
            }
        }

        // The registry's own contact address, where it is nobody already on
        // the list, a firm may route notices to a mailbox no member owns.
        $contact = $application->provider?->contact_email;

        if ($contact && ! isset($recipients[mb_strtolower($contact)])) {
            $recipients[mb_strtolower($contact)] = [
                'email' => $contact,
                'name' => $application->provider->contact_name,
                'userId' => null,
            ];
        }

        // The company's own mailbox, when it is not already a member or the
        // registry contact, that is the service provider email on the firm
        // record, and CIP notices have to reach it too.
        $firmEmail = $company?->email;

        if ($firmEmail && ! isset($recipients[mb_strtolower($firmEmail)])) {
            $recipients[mb_strtolower($firmEmail)] = [
                'email' => $firmEmail,
                'name' => $company->name,
                'userId' => null,
            ];
        }

        // A private client is their own provider side.
        if ($recipients === [] && $application->client) {
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

        return Pages::application($application->client->uid, $query);
    }

    public static function url(CipApplication $application, ?string $status = null): string
    {
        return rtrim(config('app.url'), '/').self::path($application, $status);
    }
}
