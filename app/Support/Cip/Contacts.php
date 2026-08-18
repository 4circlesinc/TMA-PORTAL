<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CompanyMember;

/**
 * Who "the Service Provider" is for one application — the people §14 and §15
 * write to when the file needs the firm, or when it is ready for them to
 * confirm.
 *
 * Deduplicated by address: a member whose mailbox is also the registry contact
 * is one recipient, not two, and a private client with no firm behind them is
 * their own provider side.
 */
class Contacts
{
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
