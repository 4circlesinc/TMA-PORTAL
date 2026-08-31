<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CompanyMember;
use App\Models\Group;
use App\Models\User;
use App\Support\Access\Role;

/**
 * Who a CIP notice writes to. §22's four classes, unique by mailbox.
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
     * §22's four classes: CIP Distribution Group + Assigned Officer +
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
     * Members of the CIP Distribution Group, plus any extra mailboxes in
     * config. A Person who is also an administrator is still one recipient.
     *
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    public static function distributionGroup(): array
    {
        $recipients = [];

        $name = trim((string) config('cip.distribution_group', 'CIP Distribution Group'));

        if ($name !== '') {
            $group = Group::query()
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                ->where('is_archived', false)
                ->first();

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

        foreach (config('cip.distribution_emails', []) as $email) {
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
     * is named, the compliance officer. §22 says "Assigned Officer".
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
     * The facts every CIP notice names: number, applicant, firm, family.
     *
     * @return array{number:string, applicant:string, provider:string, familySize:int}
     */
    public static function facts(CipApplication $application): array
    {
        $application->loadMissing(['provider', 'client', 'people']);

        $applicant = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);

        return [
            'number' => $application->displayNumber(),
            'applicant' => $applicant?->fullName() ?: ($application->client?->name ?? 'Unnamed applicant'),
            'provider' => $application->provider?->name ?? 'Private client',
            'familySize' => $application->familySize(),
        ];
    }

    /** The portal path a notice's button opens. */
    public static function path(CipApplication $application, ?string $status = null): string
    {
        $application->loadMissing('client');

        if (! $application->client) {
            return Pages::home('q='.urlencode($application->displayNumber()));
        }

        $query = 'tab=folders';

        if ($status === Status::NON_COMPLIANT) {
            $additional = Tree::additionalFolder($application);
            if ($additional) {
                $query .= '&folder='.$additional->uuid;
            }
        }

        return Pages::application($application->client->uid, $query);
    }

    public static function url(CipApplication $application, ?string $status = null): string
    {
        return rtrim(config('app.url'), '/').self::path($application, $status);
    }
}
