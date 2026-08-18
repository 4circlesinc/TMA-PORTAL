<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;

/**
 * Who a CIP notice writes to — the provider side for §14, §15 and §18, and
 * the staff classes §20 and §21 name beside them.
 *
 * Deduplicated by address: a member whose mailbox is also the registry contact
 * is one recipient, not two, and a private client with no firm behind them is
 * their own provider side.
 */
class Contacts
{
    /**
     * Every approved Administrator account — the brief's "Administrator" as a
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
     * Administrator + Reviewing Officer + Service Provider, unique by mailbox.
     *
     * §20 names these three; §21's decision notice uses the same set. A person
     * in two classes is one recipient. An application with no reviewing
     * officer still writes to the other two.
     *
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    public static function parties(CipApplication $application): array
    {
        $recipients = [];

        foreach ([
            ...self::administrators(),
            ...self::reviewingOfficer($application),
            ...self::providerSide($application),
        ] as $recipient) {
            $recipients[mb_strtolower($recipient['email'])] = $recipient;
        }

        return array_values($recipients);
    }

    /**
     * The reviewing officer holding this file, if anybody is.
     *
     * Live assignments are the authority; the cache column is only what the
     * table draws. An application nobody holds contributes nobody — the other
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
        // the list — a firm may route notices to a mailbox no member owns.
        $contact = $application->provider?->contact_email;

        if ($contact && ! isset($recipients[mb_strtolower($contact)])) {
            $recipients[mb_strtolower($contact)] = [
                'email' => $contact,
                'name' => $application->provider->contact_name,
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
    public static function path(CipApplication $application): string
    {
        $application->loadMissing('client');

        return $application->client
            ? '/clients/'.$application->client->uid.'?tab=folders'
            : '/clients?q='.urlencode($application->displayNumber());
    }

    public static function url(CipApplication $application): string
    {
        return rtrim(config('app.url'), '/').self::path($application);
    }
}
