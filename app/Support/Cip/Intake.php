<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Creating an application from the intake wizard (§2).
 *
 * The brief's main-applicant block is "All fields are required", so the rules
 * live in one place and every surface — the wizard, a future import, a
 * provider's own API call — files the same complete record or none at all.
 * Application and applicant are written in one transaction: an application
 * with no applicant is a number nobody can act on.
 *
 * Two answers are derived rather than accepted: the region follows the
 * country of residence ({@see Countries}), and the internal number is minted
 * by {@see Numbering}. A form that offered either would be offering a way to
 * contradict the record.
 */
class Intake
{
    /** The main applicant's fields, straight from §2. */
    public static function rules(): array
    {
        return [
            'providerId' => ['required', 'string'],
            'firstName' => ['required', 'string', 'max:191'],
            'lastName' => ['required', 'string', 'max:191'],
            'gender' => ['required', Rule::in(['Male', 'Female'])],
            'dateOfBirth' => ['required', 'date', 'before:today'],
            'countryOfBirth' => ['required', 'string', Rule::in(Countries::all())],
            'countryOfResidence' => ['required', 'string', Rule::in(Countries::all())],
            'occupation' => ['required', 'string', 'max:191'],
            'passportNumber' => ['required', 'string', 'max:64'],
            'investmentType' => ['required', Rule::in(array_keys(InvestmentType::ALL))],
            // §3: "If Other is selected, the portal shall display a Specify
            // Investment Type free-text field" — required exactly then.
            'investmentTypeOther' => [
                'nullable', 'string', 'max:191',
                Rule::requiredIf(fn () => request()->input('investmentType') === InvestmentType::OTHER),
            ],
            'sponsored' => ['required', 'boolean'],
        ];
    }

    /** Human wording for the two rules whose default message would puzzle. */
    public static function messages(): array
    {
        return [
            'dateOfBirth.before' => 'A date of birth has to be in the past.',
            'investmentTypeOther.required' => 'Say which investment type this is.',
            'countryOfBirth.in' => 'Choose a country from the list.',
            'countryOfResidence.in' => 'Choose a country from the list.',
        ];
    }

    /**
     * File a new draft: the application, its number, and the main applicant.
     *
     * @param  array<string, mixed>  $data  already validated by self::rules()
     */
    public static function create(CipProvider $provider, User $creator, array $data): CipApplication
    {
        return DB::transaction(function () use ($provider, $creator, $data) {
            $application = Applications::create($provider, $creator, [
                'investment_type' => $data['investmentType'],
                'investment_type_other' => $data['investmentType'] === InvestmentType::OTHER
                    ? trim((string) ($data['investmentTypeOther'] ?? ''))
                    : null,
                'sponsored' => (bool) $data['sponsored'],
            ]);

            self::writePerson($application, CipPerson::ROLE_MAIN_APPLICANT, $data);

            return $application->fresh();
        });
    }

    /**
     * One individual on the application. The sponsor (§4) duplicates exactly
     * this field set, which is why it is a parameter rather than a copy.
     *
     * @param  array<string, mixed>  $data
     */
    public static function writePerson(CipApplication $application, string $role, array $data): CipPerson
    {
        $person = $application->people()->make([
            'role' => $role,
            'first_name' => trim((string) $data['firstName']),
            'last_name' => trim((string) $data['lastName']),
            'gender' => $data['gender'],
            'date_of_birth' => $data['dateOfBirth'],
            'country_of_birth' => $data['countryOfBirth'],
            'country_of_residence' => $data['countryOfResidence'],
            'occupation' => trim((string) $data['occupation']),
            'passport_number' => trim((string) $data['passportNumber']),
        ]);

        // Derived, never asked for.
        $person->region = Countries::region($data['countryOfResidence']);
        $person->save();

        return $person;
    }

    /**
     * Which provider this account may file under.
     *
     * A provider contact files under their own firm and nobody else's; staff
     * choose from the registry. Returning the list rather than a boolean lets
     * the wizard show a picker to one and a fixed name to the other.
     *
     * @return \Illuminate\Support\Collection<int, CipProvider>
     */
    public static function providersFor(User $user): \Illuminate\Support\Collection
    {
        if (\App\Support\Access\Role::isStaff($user)) {
            return CipProvider::query()->where('active', true)->orderBy('name')->get();
        }

        if (CipAccess::isProviderContact($user)) {
            return CipProvider::query()
                ->where('active', true)
                ->whereIn('company_id', \App\Models\CompanyMember::query()
                    ->select('company_id')->active()->where('user_id', $user->id))
                ->orderBy('name')
                ->get();
        }

        // A private client files under the reserved PRI bucket.
        return CipProvider::query()
            ->where('active', true)
            ->where('code', CipProvider::PRIVATE_CLIENT_CODE)
            ->get();
    }
}
