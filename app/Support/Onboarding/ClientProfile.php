<?php

namespace App\Support\Onboarding;

use App\Models\Client;
use App\Models\Company;
use App\Models\OnboardingProgress;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Turns onboarding answers into a real user account and client record.
 *
 * The client record already exists — a staff member created it before sending
 * the invitation — so this merges into it rather than replacing it. Anything
 * the client did not answer is left exactly as the firm entered it; onboarding
 * is the client filling in the gaps, not overwriting the firm's own notes.
 *
 * The profile blob follows the shape the Clients hub reads (see
 * Client::toRecord and ClientsController::columns): scalar name parts at the
 * top, `work` for company details, and `emails`/`phones`/`addresses` as
 * `[{type, value}, …]` collections.
 */
final class ClientProfile
{
    /** The client record linked to this account, if any. */
    public static function for(User $user): ?Client
    {
        return Client::where('user_id', $user->id)->first();
    }

    /**
     * Apply every answer gathered so far. Safe to call more than once — it is
     * run on completion, so a resumed flow lands the same as an unbroken one.
     */
    public static function apply(User $user, OnboardingProgress $progress): void
    {
        DB::transaction(function () use ($user, $progress) {
            self::applyToUser($user, $progress);
            self::applyToClient($user, $progress);
        });
    }

    private static function applyToUser(User $user, OnboardingProgress $progress): void
    {
        $name = $progress->answers('name');
        $phone = $progress->answers('phone');

        $attrs = [];

        if (! empty($name['first_name']) && ! empty($name['last_name'])) {
            $attrs['first_name'] = $name['first_name'];
            $attrs['middle_name'] = ($name['middle_name'] ?? null) ?: null;
            $attrs['last_name'] = $name['last_name'];
            $attrs['name'] = trim(implode(' ', array_filter([
                $name['first_name'], $name['middle_name'] ?? null, $name['last_name'],
            ])));
        }

        if (! empty($phone['phone'])) {
            $attrs['phone'] = $phone['phone'];
        }

        if (! empty($progress->answers('company')['company_role'])) {
            $attrs['job_title'] = $progress->answers('company')['company_role'];
        }

        if ($attrs !== []) {
            $user->forceFill($attrs)->save();
        }
    }

    private static function applyToClient(User $user, OnboardingProgress $progress): void
    {
        $client = self::for($user);

        if (! $client) {
            return;
        }

        $profile = $client->data ?? [];
        $name = $progress->answers('name');
        $phone = $progress->answers('phone');
        $whatsapp = $progress->answers('whatsapp');
        $address = $progress->answers('address');
        $company = $progress->answers('company');
        $isCompany = ($progress->answers('account-type')['account_type'] ?? null) === 'company';

        if (! empty($name['first_name'])) {
            $profile['firstName'] = $name['first_name'];
            $profile['middleName'] = ($name['middle_name'] ?? null) ?: null;
            $profile['lastName'] = $name['last_name'] ?? null;
        }

        // The invited address is authoritative — it is the one they just proved
        // they can receive mail at — so it goes to the front of the list.
        $profile['emails'] = self::upsertValue($profile['emails'] ?? [], 'work', $user->email, true);

        if (! empty($phone['phone'])) {
            $profile['phones'] = self::upsertValue($profile['phones'] ?? [], 'mobile', $phone['phone'], true);
        }

        if (! empty($whatsapp['whatsapp'])) {
            $profile['phones'] = self::upsertValue($profile['phones'] ?? [], 'whatsapp', $whatsapp['whatsapp']);
        }

        if ($address && array_filter($address)) {
            $profile['addresses'] = self::upsertAddress($profile['addresses'] ?? [], $address);
        }

        if (! empty($progress->answers('contact-preference')['preferred_contact'])) {
            $profile['preferredContact'] = $progress->answers('contact-preference')['preferred_contact'];
        }

        $extra = array_values(array_filter(
            $progress->answers('contacts')['contacts'] ?? [],
            fn ($row) => ! empty($row['name']) || ! empty($row['email']),
        ));
        if ($extra !== []) {
            $profile['additionalContacts'] = $extra;
        }

        $companyRecord = null;

        if ($isCompany && ! empty($company['company_name'])) {
            $companyRecord = self::resolveCompany($company, $user);
            $profile['work'] = array_merge($profile['work'] ?? [], array_filter([
                'company' => $companyRecord->name,
                'jobTitle' => $company['company_role'] ?? null,
            ]));
        }

        $columns = [
            'data' => $profile,
            'email' => $user->email,
        ];

        if (! empty($phone['phone'])) {
            $columns['phone'] = $phone['phone'];
        }

        if (! empty($name['first_name'])) {
            $columns['name'] = trim(implode(' ', array_filter([
                $name['first_name'], $name['middle_name'] ?? null, $name['last_name'] ?? null,
            ]))) ?: $client->name;
        }

        if ($companyRecord) {
            $columns['company_id'] = $companyRecord->id;
            $columns['company'] = $companyRecord->name;
        }

        $client->forceFill($columns)->save();
    }

    /**
     * Find or create the company the client says they belong to. Matching by
     * name first keeps two contacts from the same firm on one company record —
     * the spec's "do not create a separate company record for every contact".
     */
    private static function resolveCompany(array $answers, User $user): Company
    {
        $name = trim($answers['company_name']);

        $existing = Company::whereRaw('LOWER(name) = ?', [mb_strtolower($name)])->first();

        if ($existing) {
            if (! $existing->website && ! empty($answers['company_website'])) {
                $existing->forceFill(['website' => $answers['company_website']])->save();
            }

            return $existing;
        }

        return Company::create([
            'uid' => self::companyUid($name),
            'name' => $name,
            'website' => $answers['company_website'] ?: null,
            'created_by' => $user->id,
        ]);
    }

    private static function companyUid(string $name): string
    {
        $base = Str::slug($name) ?: 'company';
        $uid = $base;
        $n = 2;

        while (Company::where('uid', $uid)->exists()) {
            $uid = $base.'-'.$n++;
        }

        return $uid;
    }

    /**
     * Put a {type, value} row into a collection, replacing any row of the same
     * type and optionally moving it to the front.
     *
     * @param  array<int, mixed>  $rows
     * @return array<int, array<string, string>>
     */
    private static function upsertValue(array $rows, string $type, string $value, bool $first = false): array
    {
        $kept = array_values(array_filter(
            $rows,
            fn ($row) => is_array($row)
                && ! empty($row['value'])
                && mb_strtolower((string) $row['value']) !== mb_strtolower($value),
        ));

        $entry = ['type' => $type, 'value' => $value];

        return $first ? array_merge([$entry], $kept) : array_merge($kept, [$entry]);
    }

    /** @param  array<int, mixed>  $rows */
    private static function upsertAddress(array $rows, array $address): array
    {
        $entry = array_filter([
            'type' => 'main',
            'street' => $address['street'] ?? null,
            'city' => $address['city'] ?? null,
            'region' => $address['region'] ?? null,
            'postcode' => $address['postcode'] ?? null,
            'country' => $address['country'] ?? null,
        ]);

        // Replace the main address rather than stacking a second one up.
        $kept = array_values(array_filter(
            $rows,
            fn ($row) => is_array($row) && ($row['type'] ?? null) !== 'main',
        ));

        return array_merge([$entry], $kept);
    }
}
