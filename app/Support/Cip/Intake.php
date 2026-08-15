<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Creating an application from the intake form (§2–§6).
 *
 * One request files the whole thing: the application, its number, the main
 * applicant, a sponsor when there is one, every dependent, the folder tree
 * and the document slots. The brief's "all fields are required" is about the
 * form, but the reason it is one transaction is sturdier than that — an
 * application with no applicant is a number nobody can act on, and a sponsor
 * that had to be added afterwards is a step somebody would skip.
 *
 * It is multipart rather than JSON because three of the answers are files.
 * Base64 in a JSON body would double their size and put a scanned passport
 * through the request-size limit for no gain; an upload is what the rest of
 * the portal's file handling already takes.
 *
 * Two answers are still derived rather than accepted: the region follows the
 * country of residence ({@see Countries}), and the internal number is minted
 * by {@see Numbering}. A third joins them here — a qualified dependent's
 * ordinal, computed by {@see Dependents} from the dates of birth.
 */
class Intake
{
    /** A scanned document: generous, but not a photo library. */
    public const MAX_DOCUMENT_KB = 10240;

    /** How many files one requirement may be answered with in a single filing. */
    public const MAX_DOCUMENTS_PER_SLOT = 10;

    /** The §2 uploads that take a list rather than a single file. */
    private const DOCUMENT_LISTS = ['passportBioPage', 'birthCertificate'];

    /** The shared person field set — §2's list, which §4 says a sponsor repeats. */
    private const PERSON_FIELDS = [
        'firstName', 'lastName', 'gender', 'dateOfBirth', 'countryOfBirth',
        'countryOfResidence', 'occupation', 'passportNumber',
    ];

    public static function rules(): array
    {
        return array_merge(
            ['providerId' => ['required', 'string']],
            self::personRules(),
            self::mainApplicantDocumentRules(),
            self::investmentRules(),
            self::sponsorRules(),
            self::dependentRules(),
        );
    }

    /** The main applicant, straight from §2. */
    private static function personRules(string $prefix = ''): array
    {
        $required = $prefix === '' ? 'required' : 'required_with:'.rtrim($prefix, '.');

        return [
            $prefix.'firstName' => [$required, 'string', 'max:191'],
            $prefix.'lastName' => [$required, 'string', 'max:191'],
            $prefix.'gender' => [$required, Rule::in(['Male', 'Female'])],
            $prefix.'dateOfBirth' => [$required, 'date', 'before:today'],
            $prefix.'countryOfBirth' => [$required, 'string', Rule::in(Countries::all())],
            $prefix.'countryOfResidence' => [$required, 'string', Rule::in(Countries::all())],
            $prefix.'occupation' => [$required, 'string', 'max:191'],
            $prefix.'passportNumber' => [$required, 'string', 'max:64'],
        ];
    }

    /**
     * §2's three uploads. The photo has shape rules; the scans have limits.
     *
     * A scan is a LIST. One requirement is not always one sheet of paper — a
     * bio page can be a passport's two pages, a birth certificate can arrive
     * with its translation — and a control that takes only the last file
     * dropped on it quietly loses the rest. {@see normaliseDocuments()} lets a
     * single file still arrive on its own.
     */
    private static function mainApplicantDocumentRules(): array
    {
        return [
            'passportPhoto' => ['required', 'file', self::photoRule()],
            'passportBioPage' => ['required', 'array', 'min:1', 'max:'.self::MAX_DOCUMENTS_PER_SLOT],
            'passportBioPage.*' => self::documentRule(),
            'birthCertificate' => ['required', 'array', 'min:1', 'max:'.self::MAX_DOCUMENTS_PER_SLOT],
            'birthCertificate.*' => self::documentRule(),
        ];
    }

    /**
     * Let one file arrive where a list is expected.
     *
     * The form always sends `passportBioPage[]`, but the endpoint is also the
     * documented shape for a single upload, and a caller sending one file
     * should not have to know it is joining a list. Wrapping here rather than
     * loosening the rules keeps `passportBioPage.*` meaning exactly one thing.
     */
    public static function normaliseDocuments(Request $request): void
    {
        foreach (self::DOCUMENT_LISTS as $field) {
            /*
             * The bag, not $request->file().
             *
             * Reading a file through the request memoises the whole converted
             * set, and a later write to the bag does not invalidate that cache
             * — so the validator would go on seeing the single file we just
             * replaced, and reject it for not being an array. Both halves of
             * this have to talk to the same bag.
             */
            $value = $request->files->get($field);

            if ($value !== null && ! is_array($value)) {
                $request->files->set($field, [$value]);
            }
        }
    }

    private static function investmentRules(): array
    {
        return [
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

    /**
     * §4: sponsored means a sponsor, asked for now rather than later.
     *
     * The sponsor repeats the applicant's personal fields and their photo, so
     * they have a face in the portal like everyone else. Their bio page and
     * birth certificate are opened as empty slots instead of demanded here —
     * §2's upload list is the main applicant's, and asking for six files to
     * start a draft would make the sponsor the reason nobody finishes one.
     */
    private static function sponsorRules(): array
    {
        $sponsored = fn () => filter_var(request()->input('sponsored'), FILTER_VALIDATE_BOOLEAN);

        $rules = [];
        foreach (self::personRules('sponsor.') as $field => $rule) {
            $rules[$field] = array_merge([Rule::requiredIf($sponsored)], array_slice($rule, 1));
        }

        $rules['sponsor.passportPhoto'] = [Rule::requiredIf($sponsored), 'file', self::photoRule()];

        return $rules;
    }

    /** §5: each dependent is a name, a date of birth and a relationship. */
    private static function dependentRules(): array
    {
        return [
            'dependents' => ['nullable', 'array', 'max:20'],
            'dependents.*.firstName' => ['required', 'string', 'max:191'],
            'dependents.*.lastName' => ['required', 'string', 'max:191'],
            'dependents.*.dateOfBirth' => ['required', 'date', 'before:today'],
            'dependents.*.relationship' => ['required', Rule::in([
                CipPerson::RELATIONSHIP_SPOUSE, CipPerson::RELATIONSHIP_QUALIFIED,
            ])],
        ];
    }

    /** The 2×2 rule, as a validator closure over {@see PassportPhoto}. */
    private static function photoRule(): \Closure
    {
        return function ($attribute, $value, $fail) {
            if (! $value instanceof UploadedFile) {
                $fail('Upload the passport photo again — that file did not arrive.');

                return;
            }
            if ($why = PassportPhoto::rejectUpload($value)) {
                $fail($why);
            }
        };
    }

    private static function documentRule(): array
    {
        return [
            'required', 'file',
            'mimes:pdf,jpg,jpeg,png,webp,heic',
            'max:'.self::MAX_DOCUMENT_KB,
        ];
    }

    /** Human wording for the rules whose default message would puzzle. */
    public static function messages(): array
    {
        return [
            'dateOfBirth.before' => 'A date of birth has to be in the past.',
            'sponsor.dateOfBirth.before' => 'A date of birth has to be in the past.',
            'dependents.*.dateOfBirth.before' => 'A date of birth has to be in the past.',
            'investmentTypeOther.required' => 'Say which investment type this is.',
            'countryOfBirth.in' => 'Choose a country from the list.',
            'countryOfResidence.in' => 'Choose a country from the list.',
            'sponsor.countryOfBirth.in' => 'Choose a country from the list.',
            'sponsor.countryOfResidence.in' => 'Choose a country from the list.',
            'passportBioPage.required' => 'The bio page is required.',
            'birthCertificate.required' => 'The birth certificate is required.',
            'passportBioPage.*.mimes' => 'Upload the bio page as a PDF or an image.',
            'birthCertificate.*.mimes' => 'Upload the birth certificate as a PDF or an image.',
            'passportBioPage.*.max' => 'That file is too large. Keep it under 10MB.',
            'birthCertificate.*.max' => 'That file is too large. Keep it under 10MB.',
            'passportBioPage.max' => 'Up to '.self::MAX_DOCUMENTS_PER_SLOT.' files here.',
            'birthCertificate.max' => 'Up to '.self::MAX_DOCUMENTS_PER_SLOT.' files here.',
        ];
    }

    /**
     * File a new draft: the application, everyone on it, their folders and
     * their document slots.
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

            if ((bool) $data['sponsored']) {
                self::writePerson($application, CipPerson::ROLE_SPONSOR, $data['sponsor'] ?? []);
            }

            foreach ($data['dependents'] ?? [] as $dependent) {
                self::writePerson($application, CipPerson::ROLE_DEPENDENT, $dependent);
            }

            // Ordinals before folders: a dependent's folder is named after
            // the label the ordinal decides.
            Dependents::renumber($application);

            // Reload once, then work from that copy. Renumbering and folder
            // provisioning both write to people, and an instance from before
            // either of them would carry a null folder onto the uploads.
            $application->load('people');
            Tree::provision($application, $creator);

            foreach ($application->people as $person) {
                DocumentSlots::open($person);
            }

            self::fileUploads(
                $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT),
                $application->people->firstWhere('role', CipPerson::ROLE_SPONSOR),
                $data,
                $creator,
            );

            return $application->fresh();
        });
    }

    /**
     * One individual on the application.
     *
     * Tolerant of a partial field set on purpose: a dependent is four answers
     * (§5) where a main applicant or a sponsor is eight, and both come
     * through here so nobody ends up with a second way to write a person.
     *
     * @param  array<string, mixed>  $data
     */
    public static function writePerson(CipApplication $application, string $role, array $data): CipPerson
    {
        $attributes = ['role' => $role];
        foreach (self::PERSON_FIELDS as $field) {
            if (array_key_exists($field, $data)) {
                $attributes[\Illuminate\Support\Str::snake($field)] = is_string($data[$field])
                    ? trim($data[$field])
                    : $data[$field];
            }
        }

        if ($role === CipPerson::ROLE_DEPENDENT) {
            $attributes['relationship'] = $data['relationship'] ?? CipPerson::RELATIONSHIP_QUALIFIED;
        }

        $person = $application->people()->make($attributes);

        // Derived, never asked for.
        if (! empty($data['countryOfResidence'])) {
            $person->region = Countries::region($data['countryOfResidence']);
        }

        $person->save();

        return $person;
    }

    /**
     * The uploads, once everyone has a folder to put them in.
     *
     * The photo answers two things at once — a document slot, because §2
     * requires it, and the person's likeness, because that is the profile
     * picture every list draws. One upload, recorded in both places.
     */
    private static function fileUploads(CipPerson $main, ?CipPerson $sponsor, array $data, User $creator): void
    {
        self::filePhoto($main, $data['passportPhoto'] ?? null, $creator);

        /*
         * The first file answers the requirement; the rest are filed beside it.
         *
         * The slot is one question with one answer — the unique key on
         * (person, type) says so — so a second scan cannot be a second slot,
         * and making it a new *version* of the first would bury a separate
         * document inside another one's history. It goes in the person's
         * folder, where a reviewer opening the file list finds everything that
         * was sent for that requirement.
         */
        foreach ([
            DocumentTypes::PASSPORT_BIO_PAGE => $data['passportBioPage'] ?? [],
            DocumentTypes::BIRTH_CERTIFICATE => $data['birthCertificate'] ?? [],
        ] as $type => $uploads) {
            $filed = 0;

            foreach (Arr::wrap($uploads) as $upload) {
                if (! $upload instanceof UploadedFile) {
                    continue;
                }

                $filed === 0
                    ? DocumentSlots::fill($main, $type, $upload, $creator)
                    : DocumentSlots::attach($main, $type, $upload, $creator, $filed + 1);

                $filed++;
            }
        }

        if ($sponsor) {
            self::filePhoto($sponsor, $data['sponsor']['passportPhoto'] ?? null, $creator);
        }
    }

    private static function filePhoto(CipPerson $person, mixed $upload, User $creator): void
    {
        if (! $upload instanceof UploadedFile) {
            return;
        }

        // The slot first: Vault::store consumes the temp file, so the bytes
        // for the avatar have to be read before the file is moved.
        $binary = (string) file_get_contents($upload->getRealPath());
        DocumentSlots::fill($person, DocumentTypes::PASSPORT_PHOTO, $upload, $creator);

        $stored = PassportPhoto::store($binary, $person);
        $person->forceFill([
            'photo_path' => $stored['path'],
            'photo_url' => $stored['url'],
        ])->save();
    }

    /**
     * Which provider this account may file under.
     *
     * A provider contact files under their own firm and nobody else's; staff
     * choose from the registry. Returning the list rather than a boolean lets
     * the form show a picker to one and a fixed name to the other.
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
