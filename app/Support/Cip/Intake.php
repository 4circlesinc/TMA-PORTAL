<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Creating an application from the intake form (§2–§6).
 *
 * One request files the whole thing: the application, its number, the main
 * applicant, a sponsor when there is one, every dependent, the folder tree
 * and the document slots. The brief's "all fields are required" is about the
 * form, but the reason it is one transaction is sturdier than that, an
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
 * by {@see Numbering}. A third joins them here, a qualified dependent's
 * ordinal, computed by {@see Dependents} from the dates of birth.
 */
class Intake
{
    /** A scanned document: generous, but not a photo library. */
    public const MAX_DOCUMENT_KB = 10240;

    /** How many files one requirement may be answered with in a single filing. */
    public const MAX_DOCUMENTS_PER_SLOT = 10;

    /** The §2 uploads that take a list rather than a single file. */
    /**
     * §2's own three, by template key.
     *
     * The wizard's document fields come from the requirement templates now,
     * so what the form ASKS follows the admin screen, but what filing
     * DEMANDS stays §2's list. The brief makes exactly these three the
     * intake requirements; everything else on the checklist is completed
     * after filing, which is what the whole document-management phase is
     * for. A firm can still loosen even these: retire one, or mark it
     * optional, and filing stops demanding it.
     */
    private const AT_FILING = [
        DocumentTypes::PASSPORT_PHOTO,
        DocumentTypes::PASSPORT_BIO_PAGE,
        DocumentTypes::BIRTH_CERTIFICATE,
    ];

    /**
     * The upload fields one applicant type's wizard section carries, from the
     * live templates. The photo is not among them, it has measurement rules
     * and becomes the person's picture, so it keeps its own control, and the
     * field name is the template key in camel case, which lands the legacy
     * three on exactly the names the endpoint has always documented.
     *
     * @return Collection<int, array{key:string, field:string, label:string, help:?string, required:bool, realEstateOnly:bool, atFiling:bool}>
     */
    public static function documentFields(string $applicantType, string $phase = Phase::PRE_APPROVAL, ?CipApplication $application = null): Collection
    {
        $investment = $application?->investment_type ?? request()->input('investmentType');

        return Requirements::forPhase($applicantType, $phase, $application)
            ->reject(fn ($t) => $t->key === DocumentTypes::PASSPORT_PHOTO)
            ->reject(fn ($t) => $t->real_estate_only
                && $investment
                && $investment !== InvestmentType::REAL_ESTATE)
            ->map(fn ($t) => [
                'key' => $t->key,
                'field' => Str::camel($t->key),
                'label' => $t->label,
                'help' => $t->help,
                'required' => (bool) $t->required,
                'realEstateOnly' => (bool) $t->real_estate_only,
                // Only the main applicant's uploads gate filing. A sponsor's
                // paperwork is often added after the application exists, and
                // dependants follow the same rule — their required flags still
                // drive the checklist once the file is open.
                'atFiling' => $applicantType === ApplicantType::PRINCIPAL_APPLICANT
                    && (bool) $t->required,
            ])
            ->values();
    }

    /** The passport-photo template for one applicant type in a workflow lane. */
    public static function photoRequirement(string $applicantType, string $phase = Phase::PRE_APPROVAL): ?CipDocumentRequirement
    {
        return Requirements::forPhase($applicantType, $phase)
            ->firstWhere('key', DocumentTypes::PASSPORT_PHOTO);
    }

    /**
     * Which workflow lane a new filing belongs to.
     *
     * Updates inherit the application's existing phase elsewhere; this only
     * answers for create.
     */
    public static function filingPhase(): string
    {
        $phase = (string) request()->input('phase', Phase::PRE_APPROVAL);

        return Phase::isValid($phase) ? $phase : Phase::PRE_APPROVAL;
    }

    /**
     * Every upload field name the wizard might send, across applicant types.
     *
     * A dependant's type is not known until their date of birth and
     * relationship are, so the validator accepts the union rather than
     * guessing which list they will land on.
     *
     * @return Collection<int, string>
     */
    private static function allDocumentFieldNames(): Collection
    {
        return collect(ApplicantType::ALL)
            ->flatMap(function (string $type) {
                return collect([Phase::PRE_APPROVAL, Phase::POST_APPROVAL])
                    ->flatMap(fn (string $phase) => self::documentFields($type, $phase)->pluck('field'));
            })
            ->unique()
            ->values();
    }

    /** Is the photo still asked of this applicant type, and demanded? */
    private static function photoTemplate(string $applicantType, string $phase = Phase::PRE_APPROVAL): ?CipDocumentRequirement
    {
        return self::photoRequirement($applicantType, $phase);
    }

    /** The shared person field set. §2's list, which §4 says a sponsor repeats. */
    private const PERSON_FIELDS = [
        'firstName', 'lastName', 'gender', 'dateOfBirth', 'countryOfBirth',
        'countryOfResidence', 'occupation', 'passportNumber',
    ];

    /**
     * @param  bool  $editing  an update, where the uploads are already on file
     *
     * Editing keeps every answer required. §2 does not stop applying once a
     * draft exists, but stops demanding the files, because they were handed
     * over at creation and are sitting in the person's folder. Sending one
     * replaces it; sending nothing leaves it alone. The provider is not in the
     * list at all: its code is minted into the internal number, so changing it
     * afterwards would leave the number naming a firm that did not file.
     */
    public static function rules(bool $editing = false): array
    {
        return array_merge(
            $editing ? [] : [
                'providerId' => ['required', 'string'],
                'phase' => ['nullable', 'string', Rule::in(Phase::ALL)],
            ],
            self::personRules(),
            self::mainApplicantDocumentRules($editing),
            self::investmentRules(),
            self::sponsorRules($editing),
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
     * A scan is a LIST. One requirement is not always one sheet of paper, a
     * bio page can be a passport's two pages, a birth certificate can arrive
     * with its translation, and a control that takes only the last file
     * dropped on it quietly loses the rest. {@see normaliseDocuments()} lets a
     * single file still arrive on its own.
     */
    private static function mainApplicantDocumentRules(bool $editing = false): array
    {
        // On an edit they are already filed: sending one replaces it, sending
        // nothing keeps what is there.
        $need = $editing ? 'nullable' : 'required';
        $min = $editing ? [] : ['min:1'];
        $phase = self::filingPhase();

        $photo = self::photoTemplate(ApplicantType::PRINCIPAL_APPLICANT, $phase);
        $rules = [
            'passportPhoto' => [
                ! $editing && $photo && $photo->required ? 'required' : 'nullable',
                'file', self::photoRule(),
            ],
        ];

        foreach (self::documentFields(ApplicantType::PRINCIPAL_APPLICANT, $phase) as $doc) {
            $demanded = ! $editing && $doc['atFiling'];
            $rules[$doc['field']] = array_merge(
                [$demanded ? $need : 'nullable', 'array'],
                $demanded ? $min : [],
                ['max:'.self::MAX_DOCUMENTS_PER_SLOT],
            );
            $rules[$doc['field'].'.*'] = self::documentRule();
        }

        return $rules;
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
        foreach (self::allDocumentFieldNames() as $field) {
            /*
             * The bag, not $request->file().
             *
             * Reading a file through the request memoises the whole converted
             * set, and a later write to the bag does not invalidate that cache
             *, so the validator would go on seeing the single file we just
             * replaced, and reject it for not being an array. Both halves of
             * this have to talk to the same bag.
             */
            $value = $request->files->get($field);

            if ($value !== null && ! is_array($value)) {
                $request->files->set($field, [$value]);
            }
        }

        self::wrapNestedDocumentLists($request, 'sponsor', self::allDocumentFieldNames()->all());

        $dependents = $request->files->get('dependents');
        if (is_array($dependents)) {
            $fields = self::allDocumentFieldNames()->all();
            foreach ($dependents as $index => $row) {
                if (! is_array($row)) {
                    continue;
                }
                foreach ($fields as $field) {
                    if (isset($row[$field]) && $row[$field] instanceof UploadedFile) {
                        $dependents[$index][$field] = [$row[$field]];
                    }
                }
            }
            $request->files->set('dependents', $dependents);
        }
    }

    /**
     * @param  array<int, string>  $fields
     */
    private static function wrapNestedDocumentLists(Request $request, string $bag, array $fields): void
    {
        $nested = $request->files->get($bag);
        if (! is_array($nested)) {
            return;
        }

        foreach ($fields as $field) {
            if (isset($nested[$field]) && $nested[$field] instanceof UploadedFile) {
                $nested[$field] = [$nested[$field]];
            }
        }

        $request->files->set($bag, $nested);
    }

    private static function investmentRules(): array
    {
        return [
            'investmentType' => ['required', Rule::in(array_keys(InvestmentType::ALL))],
            // §3: "If Other is selected, the portal shall display a Specify
            // Investment Type free-text field", required exactly then.
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
     * birth certificate are offered but optional. §2's upload list is the
     * main applicant's, and making six files the price of starting a draft
     * would leave the sponsor as the reason nobody finishes one. The slots
     * are opened either way, so what is skipped here is still asked for.
     */
    private static function sponsorRules(bool $editing = false): array
    {
        $sponsored = fn () => filter_var(request()->input('sponsored'), FILTER_VALIDATE_BOOLEAN);

        $rules = [];
        foreach (self::personRules('sponsor.') as $field => $rule) {
            $rules[$field] = array_merge([Rule::requiredIf($sponsored)], array_slice($rule, 1));
        }

        // A sponsor already on file has a photo; only a new one must bring one.
        $rules['sponsor.passportPhoto'] = $editing
            ? ['nullable', 'file', self::photoRule()]
            : [Rule::requiredIf($sponsored), 'file', self::photoRule()];

        // The sponsor's scans are offered, never demanded at filing (§2): a
        // sponsor is often added before their paperwork is in hand, and the
        // checklist holds the door.
        foreach (self::documentFields(ApplicantType::SPONSOR, self::filingPhase()) as $doc) {
            $rules['sponsor.'.$doc['field']] = ['nullable', 'array', 'max:'.self::MAX_DOCUMENTS_PER_SLOT];
            $rules['sponsor.'.$doc['field'].'.*'] = self::documentRule();
        }

        return $rules;
    }

    /** §5: each dependent is a name, a date of birth, a relationship, and the same uploads the settings ask of their type. */
    private static function dependentRules(bool $editing = false): array
    {
        $rules = [
            'dependents' => ['nullable', 'array', 'max:20'],
            // The uuid of a dependant already on the application, so an edit
            // changes that person rather than replacing the family.
            'dependents.*.id' => ['nullable', 'string'],
            'dependents.*.firstName' => ['required', 'string', 'max:191'],
            'dependents.*.lastName' => ['required', 'string', 'max:191'],
            'dependents.*.dateOfBirth' => ['required', 'date', 'before:today'],
            'dependents.*.relationship' => ['required', Rule::in([
                CipPerson::RELATIONSHIP_SPOUSE, CipPerson::RELATIONSHIP_QUALIFIED,
            ])],
            // Offered, never demanded at filing, the same courtesy the
            // sponsor's scans get. The boxes are on the form so the files
            // can travel with the person; the checklist holds the door if
            // they are skipped.
            'dependents.*.passportPhoto' => ['nullable', 'file', self::photoRule()],
        ];

        foreach (self::allDocumentFieldNames() as $field) {
            $rules['dependents.*.'.$field] = ['nullable', 'array', 'max:'.self::MAX_DOCUMENTS_PER_SLOT];
            $rules['dependents.*.'.$field.'.*'] = self::documentRule();
        }

        return $rules;
    }

    /** The 2×2 rule, as a validator closure over {@see PassportPhoto}. */
    public static function photoRule(): \Closure
    {
        return function ($attribute, $value, $fail) {
            if (! $value instanceof UploadedFile) {
                $fail('Upload the passport photo again, that file did not arrive.');

                return;
            }
            if ($why = PassportPhoto::rejectUpload($value)) {
                $fail($why);
            }
        };
    }

    public static function documentRule(): array
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
        $announcePostApproval = false;

        $application = DB::transaction(function () use ($provider, $creator, $data, &$announcePostApproval) {
            $phase = Phase::PRE_APPROVAL;
            if (! empty($data['phase']) && Phase::isValid($data['phase'])) {
                $phase = $data['phase'];
            }

            $attributes = [
                'investment_type' => $data['investmentType'],
                'investment_type_other' => $data['investmentType'] === InvestmentType::OTHER
                    ? trim((string) ($data['investmentTypeOther'] ?? ''))
                    : null,
                'sponsored' => (bool) $data['sponsored'],
            ];

            $application = Applications::create($provider, $creator, $attributes);

            if ($phase === Phase::POST_APPROVAL) {
                $from = $application->status;
                $application->forceFill([
                    'phase' => Phase::POST_APPROVAL,
                    'status' => Status::POST_APPROVAL,
                    'post_approval_at' => now(),
                ])->save();
                Engine::record($application, CipEvent::ACTION_STATUS_CHANGED, $creator, [], $from, Status::POST_APPROVAL);
                Engine::record($application, CipEvent::ACTION_POST_APPROVAL_ENTERED, $creator, []);
                $announcePostApproval = true;
            }

            self::writePerson($application, CipPerson::ROLE_MAIN_APPLICANT, $data);

            if ((bool) $data['sponsored']) {
                self::writePerson($application, CipPerson::ROLE_SPONSOR, $data['sponsor'] ?? []);
            }

            $dependentUuids = [];
            foreach ($data['dependents'] ?? [] as $dependent) {
                $dependentUuids[] = self::writePerson($application, CipPerson::ROLE_DEPENDENT, $dependent)->uuid;
            }

            // Ordinals before folders: a dependent's folder is named after
            // the label the ordinal decides.
            Dependents::renumber($application);

            // Reload once, then work from that copy. Renumbering and folder
            // provisioning both write to people, and an instance from before
            // either of them would carry a null folder onto the uploads.
            $application->load('people');
            Tree::provision($application, $creator);

            if ($phase === Phase::POST_APPROVAL) {
                $application = PostApproval::prepare($application->fresh(), $creator);
            } else {
                foreach ($application->people as $person) {
                    DocumentSlots::open($person);
                }
            }

            foreach ($application->people as $person) {
                $person->setRelation('application', $application);
            }

            self::fileUploads($application, $data, $creator, $dependentUuids);

            return $application->fresh();
        });

        if ($announcePostApproval) {
            Notices::announce($application, Status::POST_APPROVAL, $creator);
        }

        return $application;
    }

    /**
     * Change an application that already exists.
     *
     * The same shape going in as {@see create}, because it is the same form —
     * a reader editing a draft should not be asked a different set of
     * questions than the one who started it. What differs is what happens to
     * the people already on it:
     *
     *  - The main applicant is updated in place. There is exactly one, and
     *    replacing them would orphan their folder and their filed documents.
     *  - Turning Sponsored off removes the sponsor, and turning it back on
     *    brings back the same person rather than a second one, the row is
     *    soft-deleted, so their folder and anything filed in it survives being
     *    changed your mind about.
     *  - A dependant carrying a uuid is that dependant; one without is new;
     *    one on the application but absent from the payload has been removed.
     *
     * Then the ordinals are recomputed and the folders renamed to match,
     * because who is QD1 changes the moment a date of birth does.
     *
     * @param  array<string, mixed>  $data  already validated by self::rules(editing: true)
     */
    public static function update(CipApplication $application, User $actor, array $data): CipApplication
    {
        return DB::transaction(function () use ($application, $actor, $data) {
            Confirmation::guard($application);
            $application->forceFill([
                'investment_type' => $data['investmentType'],
                'investment_type_other' => $data['investmentType'] === InvestmentType::OTHER
                    ? trim((string) ($data['investmentTypeOther'] ?? ''))
                    : null,
                'sponsored' => (bool) $data['sponsored'],
            ])->save();

            $application->load('people');

            $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
            $main
                ? self::applyPerson($main, $data)
                : $main = self::writePerson($application, CipPerson::ROLE_MAIN_APPLICANT, $data);

            self::syncSponsor($application, $data);
            $dependentUuids = array_map(
                fn (CipPerson $person) => $person->uuid,
                self::syncDependents($application, $data['dependents'] ?? []),
            );

            Dependents::renumber($application);

            // Reload: renumbering wrote ordinals, and the folder names read
            // from them. Anyone created just now still needs a folder too.
            $application->load('people');
            Tree::provision($application, $actor);
            Tree::resyncNames($application);

            foreach ($application->people as $person) {
                DocumentSlots::open($person);
            }

            self::fileUploads($application, $data, $actor, $dependentUuids);

            return $application->fresh();
        });
    }

    /**
     * The sponsor after an edit: created, updated, restored or removed.
     *
     * Soft-deleted rather than destroyed when Sponsored goes to No. Their
     * folder holds filed documents, and a firm that unticks a box by accident
     * should not lose a passport scan to it.
     */
    private static function syncSponsor(CipApplication $application, array $data): ?CipPerson
    {
        $existing = $application->people->firstWhere('role', CipPerson::ROLE_SPONSOR)
            ?: CipPerson::withTrashed()
                ->where('application_id', $application->id)
                ->where('role', CipPerson::ROLE_SPONSOR)
                ->first();

        if (! (bool) $data['sponsored']) {
            $existing?->delete();

            return null;
        }

        if (! $existing) {
            return self::writePerson($application, CipPerson::ROLE_SPONSOR, $data['sponsor'] ?? []);
        }

        if ($existing->trashed()) {
            $existing->restore();
        }

        self::applyPerson($existing, $data['sponsor'] ?? []);

        return $existing;
    }

    /**
     * The dependants after an edit, matched by uuid.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return list<CipPerson> in the order the form sent them
     */
    private static function syncDependents(CipApplication $application, array $rows): array
    {
        $kept = [];
        $ordered = [];

        foreach ($rows as $row) {
            $person = ! empty($row['id'])
                ? $application->people->firstWhere('uuid', $row['id'])
                : null;

            if ($person) {
                self::applyPerson($person, $row);
                $person->forceFill(['relationship' => $row['relationship']])->save();
            } else {
                $person = self::writePerson($application, CipPerson::ROLE_DEPENDENT, $row);
            }

            $ordered[] = $person;
            $kept[] = $person->id;
        }

        // Gone from the form means gone from the application. Soft-deleted, so
        // their folder and its contents outlive the removal.
        $application->people
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->reject(fn (CipPerson $p) => in_array($p->id, $kept, true))
            ->each(fn (CipPerson $p) => $p->delete());

        return $ordered;
    }

    /**
     * Write the answers onto somebody already on the application.
     *
     * @param  array<string, mixed>  $data
     */
    private static function applyPerson(CipPerson $person, array $data): CipPerson
    {
        $attributes = [];
        foreach (self::PERSON_FIELDS as $field) {
            if (array_key_exists($field, $data)) {
                $attributes[Str::snake($field)] = is_string($data[$field])
                    ? trim($data[$field])
                    : $data[$field];
            }
        }

        if (! empty($data['countryOfResidence'])) {
            $attributes['region'] = Countries::region($data['countryOfResidence']);
        }

        $person->forceFill($attributes)->save();

        return $person;
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
                $attributes[Str::snake($field)] = is_string($data[$field])
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
     * The photo answers two things at once, a document slot, because §2
     * requires it, and the person's likeness, because that is the profile
     * picture every list draws. One upload, recorded in both places.
     *
     * @param  list<string>  $dependentUuids  dependents in the order the form sent them
     */
    private static function fileUploads(CipApplication $application, array $data, User $creator, array $dependentUuids = []): void
    {
        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        if ($main) {
            self::filePhoto($main, $data['passportPhoto'] ?? null, $creator);
            self::fileDocuments($main, $data, $creator);
        }

        $sponsor = $application->people->firstWhere('role', CipPerson::ROLE_SPONSOR);
        if ($sponsor) {
            self::filePhoto($sponsor, $data['sponsor']['passportPhoto'] ?? null, $creator);
            self::fileDocuments($sponsor, $data['sponsor'] ?? [], $creator);
        }

        $rows = array_values($data['dependents'] ?? []);
        foreach ($dependentUuids as $index => $uuid) {
            $person = $application->people->firstWhere('uuid', $uuid);
            $row = $rows[$index] ?? [];
            if (! $person) {
                continue;
            }
            self::filePhoto($person, $row['passportPhoto'] ?? null, $creator);
            self::fileDocuments($person, $row, $creator);
        }
    }

    /**
     * A person's scans, requirement by requirement.
     *
     * The first file answers the requirement; the rest are filed beside it.
     * The slot is one question with one answer, the unique key on
     * (person, type) says so, so a second scan cannot be a second slot, and
     * making it a new *version* of the first would bury a separate document
     * inside another one's history. It goes in the person's folder, where a
     * reviewer opening the file list finds everything sent for that
     * requirement.
     *
     * @param  array<string, mixed>  $data  that person's own slice of the body
     */
    private static function fileDocuments(CipPerson $person, array $data, User $creator): void
    {
        $phase = $person->application?->phase ?? Phase::PRE_APPROVAL;

        foreach (self::documentFields(ApplicantType::for($person), $phase, $person->application)
            ->mapWithKeys(fn ($doc) => [$doc['key'] => $data[$doc['field']] ?? []])
            ->all() as $type => $uploads) {
            $existing = CipDocument::query()
                ->where('person_id', $person->id)
                ->where('type', $type)
                ->first();

            if ($existing?->file_id
                && ($existing->status ?? DocumentStatus::PENDING_UPLOAD) !== DocumentStatus::UPDATE_REQUIRED) {
                continue;
            }

            $filed = 0;

            foreach (Arr::wrap($uploads) as $upload) {
                if (! $upload instanceof UploadedFile) {
                    continue;
                }

                $filed === 0
                    ? DocumentSlots::fill($person, $type, $upload, $creator)
                    : DocumentSlots::attach($person, $type, $upload, $creator, $filed + 1);

                $filed++;
            }
        }
    }

    public static function filePhoto(CipPerson $person, mixed $upload, User $creator): void
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

        /*
         * The main applicant's face is the client's face.
         *
         * A CIP client IS the applicant, the hub record exists to hold their
         * file, so the portrait they filed with is the picture every list,
         * row and header should draw for them. Without this the passport photo
         * showed on the application while the client the application belongs
         * to went on wearing its initials, which is the same person twice with
         * two different faces.
         *
         * Only the main applicant: a sponsor and a dependant are people on the
         * application, not the client it is filed for.
         */
        if ($person->role === CipPerson::ROLE_MAIN_APPLICANT) {
            $person->application?->client?->forceFill(['photo_url' => $stored['url']])->save();
        }
    }

    /**
     * Which provider this account may file under.
     *
     * A provider contact files under their own firm and nobody else's; staff
     * choose from the registry. Returning the list rather than a boolean lets
     * the form show a picker to one and a fixed name to the other.
     *
     * @return Collection<int, CipProvider>
     */
    public static function providersFor(User $user): Collection
    {
        if (Role::isStaff($user)) {
            /*
             * Only firms that are really in the system.
             *
             * A provider's company row is what puts it on the Service
             * providers tab, and a registration whose company is missing or
             * in the bin is a half-present firm: the wizard offered Galaxy
             * Partners while the tab showed no such provider, which reads as
             * the module contradicting itself. A firm you cannot see in the
             * hub is not a firm you can file under.
             *
             * The PRI bucket is the one exception, private clients are not a
             * firm, so no company row is required of it.
             */
            return CipProvider::query()
                ->where('active', true)
                ->where(fn ($q) => $q
                    ->whereHas('company')
                    ->orWhere('code', CipProvider::PRIVATE_CLIENT_CODE))
                ->orderBy('name')
                ->get();
        }

        if (CipAccess::isProviderContact($user)) {
            return CipProvider::query()
                ->where('active', true)
                ->whereIn('company_id', CompanyMember::query()
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
