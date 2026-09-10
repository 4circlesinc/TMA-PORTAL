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
use App\Support\Security\IdentityFields;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Creating an application from the intake form (section 2–section 6).
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

    /** The wizard offers twenty dependent rows; a draft may hold that many. */
    public const MAX_DEPENDENTS_DRAFT = 20;

    /** The section 2 uploads that take a list rather than a single file. */
    /**
     * Section 2's own three, by template key.
     *
     * The wizard's document fields come from the requirement templates now,
     * so what the form ASKS follows the admin screen, but what filing
     * DEMANDS stays section 2's list. The brief makes exactly these three the
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
     * @return Collection<int, array{key:string, field:string, label:string, help:?string, required:bool, realEstateOnly:bool, femaleOnly:bool, atFiling:bool}>
     */
    public static function documentFields(
        string $applicantType,
        string $phase = Phase::PRE_APPROVAL,
        ?CipApplication $application = null,
        ?CipPerson $person = null,
    ): Collection {
        $investment = $application?->investment_type ?? request()->input('investmentType');

        /*
         * The person travels through when there is one, so a template that
         * asks only of some people is judged the same way here as it is on
         * the checklist itself. Without them, {@see Requirements::catalogue}
         * cannot apply female_only and the wizard would offer a document the
         * person's own slot would never open — see the Settings screen, which
         * is where such a row gets added.
         */
        return Requirements::forPhase($applicantType, $phase, $application, $person)
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
                // Sent for the same reason realEstateOnly is: the form is
                // drawn before anybody's gender is chosen, so the filtering
                // has to happen live in the wizard as the answer changes.
                'femaleOnly' => (bool) $t->female_only,
                // Only the main applicant's uploads gate filing, and
                // pre-approval only section 2's three: the official checklist runs to
                // thirty-odd rows, and demanding every required one before the
                // application may exist would mean no application exists. The
                // rest of the checklist is what the document-management phase
                // collects once the file is open. A post-approval filing still
                // demands its pack's required documents, which is its own
                // documented behaviour.
                'atFiling' => $applicantType === ApplicantType::PRINCIPAL_APPLICANT
                    && (bool) $t->required
                    && ($phase !== Phase::PRE_APPROVAL || in_array($t->key, self::AT_FILING, true)),
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

    /**
     * A scan already sitting on the draft this filing completes.
     *
     * The wizard does not re-send files it has already kept: a reopened
     * draft shows the picture and lists the scans as filed, then posts the
     * typed answers. Demanding those files again is the form showing the
     * photo and answering "The passport photo field is required."
     */
    private static function draftHolds(
        ?CipApplication $draft,
        string $type,
        string $role = CipPerson::ROLE_MAIN_APPLICANT,
    ): bool {
        if ($draft === null) {
            return false;
        }

        $person = $draft->people->firstWhere('role', $role);
        if ($person === null) {
            return false;
        }

        if ($type === DocumentTypes::PASSPORT_PHOTO && filled($person->photo_path)) {
            return true;
        }

        $slot = $person->relationLoaded('documents')
            ? $person->documents->firstWhere('type', $type)
            : $person->documents()->where('type', $type)->first();

        return $slot !== null && $slot->isFilled();
    }

    /** The shared person field set. Section 2's list, which section 4 says a sponsor repeats. */
    private const PERSON_FIELDS = [
        'firstName', 'lastName', 'gender', 'dateOfBirth', 'countryOfBirth',
        'countryOfResidence', 'occupation', 'passportNumber',
    ];

    /**
     * @param  bool  $editing  an update, where the uploads are already on file
     *
     * Editing keeps every answer required. Section 2 does not stop applying once a
     * draft exists, but stops demanding the files already sitting on that
     * row: the wizard does not re-send a photo it has already kept, and
     * asking for it again is the form showing the picture and calling it
     * missing. Sending one replaces it; sending nothing leaves it alone. The
     * provider is not in the list at all: its code is minted into the
     * internal number, so changing it afterwards would leave the number naming
     * a firm that did not file.
     * @param  CipApplication|null  $draft  the row this filing completes, when
     *                                      there is one: files already on it
     *                                      count as answered
     */
    public static function rules(bool $editing = false, ?CipApplication $draft = null): array
    {
        return array_merge(
            $editing ? [
                /*
                 * Correcting the Unit's number on a file already in
                 * post-approval. Optional, because most edits are not about
                 * the number and most readers may not change it at all: the
                 * form only offers the field to a reviewing officer, and
                 * {@see Submission::correct} refuses the write from anyone
                 * else rather than trusting that.
                 */
                'cipNumber' => ['nullable', 'string', 'max:'.Submission::MAX_LENGTH],
            ] : [
                'providerId' => ['required', 'string'],
                'phase' => ['nullable', 'string', Rule::in(Phase::ALL)],
                /*
                 * A post-approval filing arrives with the Unit's number
                 * already on it: the file was approved before the portal saw
                 * it, so there is a letter to read it off and no submission
                 * step left that would ask for it. A pre-approval filing has
                 * no such number yet — {@see Submission::record} is where
                 * that one is entered — so the field is not offered there and
                 * is not accepted if sent.
                 */
                'cipNumber' => self::filingPhase() === Phase::POST_APPROVAL
                    ? ['required', 'string', 'max:'.Submission::MAX_LENGTH]
                    : ['prohibited'],
                // Minted once when the wizard opens, so a retry after a
                // timeout names the submission it repeats — see store().
                'submissionId' => ['nullable', 'string', 'max:64'],
                // The draft this filing completes, when it was reopened from
                // the table rather than typed in one sitting.
                'draftId' => ['nullable', 'string', 'max:64'],
            ],
            self::personRules(),
            self::mainApplicantDocumentRules($editing, $draft),
            self::investmentRules(),
            self::sponsorRules($editing, $draft),
            self::dependentRules(),
        );
    }

    /**
     * The same form, judged as an unfinished draft rather than a filing.
     *
     * Everything is optional, because "not filled in yet" is the ordinary
     * state of a draft and the whole point of saving one. What is still
     * enforced is shape: a date that is not a date, a country that is not on
     * the list, a gender that is neither offered answer — those are wrong
     * however unfinished the form is, and storing them would put a value in
     * the record that the filing step can never accept.
     *
     * The scans travel with it. A draft is the application, so a photo chosen
     * on an unfinished form is kept in the same slot a filed one uses rather
     * than asked for again when the reader comes back.
     */
    public static function draftRules(): array
    {
        $rules = [
            'providerId' => ['required', 'string'],
            'phase' => ['nullable', 'string', Rule::in(Phase::ALL)],
            'submissionId' => ['nullable', 'string', 'max:64'],
            'investmentType' => ['nullable', 'string', Rule::in(array_keys(InvestmentType::ALL))],
            'investmentTypeOther' => ['nullable', 'string', 'max:191'],
            'sponsored' => ['nullable', 'boolean'],
            'cipNumber' => ['nullable', 'string', 'max:'.Submission::MAX_LENGTH],
            'dependents' => ['nullable', 'array', 'max:'.self::MAX_DEPENDENTS_DRAFT],
        ];

        foreach (['', 'sponsor.', 'dependents.*.'] as $prefix) {
            $rules = array_merge($rules, self::optionalPersonRules($prefix));
        }

        // A dependant carries one answer the other two do not.
        $rules['dependents.*.relationship'] = ['nullable', 'string', 'max:64'];
        $rules['dependents.*.id'] = ['nullable', 'string', 'max:64'];

        /*
         * A draft keeps its scans.
         *
         * They were left out at first, on the reasoning that an unfiled
         * application should not put an unreviewed document in a client's
         * folders — but a reader who uploads six passports and comes back to
         * an empty form has lost the part of the work that took longest. The
         * folder question is answered by the draft being deletable instead:
         * throwing one away recycles its folder with it.
         *
         * Optional, like everything else here. Nothing is required of a form
         * that is not finished.
         */
        foreach (['', 'sponsor.'] as $prefix) {
            $rules[$prefix.'passportPhoto'] = ['nullable', 'file', self::photoRule()];
        }
        $rules['dependents.*.passportPhoto'] = ['nullable', 'file', self::photoRule()];

        foreach (self::allDocumentFieldNames() as $field) {
            foreach (['', 'sponsor.', 'dependents.*.'] as $prefix) {
                $rules[$prefix.$field] = ['nullable', 'array', 'max:'.self::MAX_DOCUMENTS_PER_SLOT];
                $rules[$prefix.$field.'.*'] = self::documentRule();
            }
        }

        return $rules;
    }

    /** A person, with every answer allowed to be missing but none malformed. */
    private static function optionalPersonRules(string $prefix): array
    {
        return [
            $prefix.'firstName' => ['nullable', 'string', 'max:191'],
            $prefix.'lastName' => ['nullable', 'string', 'max:191'],
            $prefix.'gender' => ['nullable', Rule::in(['Male', 'Female'])],
            $prefix.'dateOfBirth' => ['nullable', 'date', 'before:today'],
            $prefix.'countryOfBirth' => ['nullable', 'string', Rule::in(Countries::all())],
            $prefix.'countryOfResidence' => ['nullable', 'string', Rule::in(Countries::all())],
            $prefix.'occupation' => ['nullable', 'string', 'max:191'],
            $prefix.'passportNumber' => ['nullable', 'string', 'max:64'],
        ];
    }

    /** The main applicant, straight from section 2. */
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
     * Section 2's three uploads. The photo has shape rules; the scans have limits.
     *
     * A scan is a LIST. One requirement is not always one sheet of paper, a
     * bio page can be a passport's two pages, a birth certificate can arrive
     * with its translation, and a control that takes only the last file
     * dropped on it quietly loses the rest. {@see normaliseDocuments()} lets a
     * single file still arrive on its own.
     */
    private static function mainApplicantDocumentRules(bool $editing = false, ?CipApplication $draft = null): array
    {
        $phase = self::filingPhase();

        $photo = self::photoTemplate(ApplicantType::PRINCIPAL_APPLICANT, $phase);
        $photoKept = $editing || self::draftHolds($draft, DocumentTypes::PASSPORT_PHOTO);
        $rules = [
            'passportPhoto' => [
                ! $photoKept && $photo && $photo->required ? 'required' : 'nullable',
                'file', self::photoRule(),
            ],
        ];

        foreach (self::documentFields(ApplicantType::PRINCIPAL_APPLICANT, $phase) as $doc) {
            $kept = $editing || self::draftHolds($draft, $doc['key']);
            $demanded = ! $kept && $doc['atFiling'];
            $rules[$doc['field']] = array_merge(
                [$demanded ? 'required' : 'nullable', 'array'],
                $demanded ? ['min:1'] : [],
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
            // Section 3: "If Other is selected, the portal shall display a Specify
            // Investment Type free-text field", required exactly then.
            'investmentTypeOther' => [
                'nullable', 'string', 'max:191',
                Rule::requiredIf(fn () => request()->input('investmentType') === InvestmentType::OTHER),
            ],
            'sponsored' => ['required', 'boolean'],
        ];
    }

    /**
     * Section 4: sponsored means a sponsor, asked for now rather than later.
     *
     * The sponsor repeats the applicant's personal fields and their photo, so
     * they have a face in the portal like everyone else. Their bio page and
     * birth certificate are offered but optional. Section 2's upload list is the
     * main applicant's, and making six files the price of starting a draft
     * would leave the sponsor as the reason nobody finishes one. The slots
     * are opened either way, so what is skipped here is still asked for.
     */
    private static function sponsorRules(bool $editing = false, ?CipApplication $draft = null): array
    {
        $sponsored = fn () => filter_var(request()->input('sponsored'), FILTER_VALIDATE_BOOLEAN);

        $rules = [];
        foreach (self::personRules('sponsor.') as $field => $rule) {
            $rules[$field] = array_merge([Rule::requiredIf($sponsored)], array_slice($rule, 1));
        }

        // A sponsor already on file — or on the draft being completed — has
        // a photo; only a new one must bring one.
        $rules['sponsor.passportPhoto'] = ($editing || self::draftHolds(
            $draft,
            DocumentTypes::PASSPORT_PHOTO,
            CipPerson::ROLE_SPONSOR,
        ))
            ? ['nullable', 'file', self::photoRule()]
            : [Rule::requiredIf($sponsored), 'file', self::photoRule()];

        // The sponsor's scans are offered, never demanded at filing (section 2): a
        // sponsor is often added before their paperwork is in hand, and the
        // checklist holds the door.
        foreach (self::documentFields(ApplicantType::SPONSOR, self::filingPhase()) as $doc) {
            $rules['sponsor.'.$doc['field']] = ['nullable', 'array', 'max:'.self::MAX_DOCUMENTS_PER_SLOT];
            $rules['sponsor.'.$doc['field'].'.*'] = self::documentRule();
        }

        return $rules;
    }

    /** Section 5: each dependent is a name, a date of birth, a relationship, and the same uploads the settings ask of their type. */
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
            'cipNumber.required' => 'Enter the CIP application number from the Unit.',
            'cipNumber.prohibited' => 'A CIP number is recorded when the application is submitted to the Unit.',
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
     * The live application this filing would repeat, if any.
     *
     * The same human, not the same form: a match on the main applicant's
     * name and date of birth, or on their passport number, whatever provider
     * either was filed under. Withdrawn or decided applications still count
     * — refiling for a person already in the caseload is exactly the
     * duplicate an administrator has to approve.
     *
     * @param  array<string, mixed>  $data  already validated by self::rules()
     */
    /**
     * @param  CipApplication|null  $ignore  The application being filed, when
     *                                       it already exists as a draft: a
     *                                       row cannot duplicate itself.
     */
    public static function duplicateOf(array $data, ?CipApplication $ignore = null): ?CipApplication
    {
        $first = mb_strtolower(trim((string) $data['firstName']));
        $last = mb_strtolower(trim((string) $data['lastName']));
        $passport = mb_strtolower(trim((string) $data['passportNumber']));
        $dobLookup = IdentityFields::lookup((string) ($data['dateOfBirth'] ?? ''));
        $passportLookup = $passport !== '' ? IdentityFields::lookup($passport) : null;

        return CipApplication::query()
            /*
             * A draft is not something to be warned about.
             *
             * It is an application somebody is still typing, and it is
             * usually THIS one: the wizard autosaves into a draft row, so
             * filing found the applicant already on file and warned the
             * reader about their own unfinished work. Nobody is duplicating
             * anything until an application has actually been filed.
             */
            ->where('status', '!=', Status::DRAFT)
            // Belt and braces: the row being filed is never its own duplicate,
            // whatever status it is standing in by the time this is asked.
            ->when($ignore, fn ($q) => $q->whereKeyNot($ignore->getKey()))
            ->whereHas('people', function ($q) use ($first, $last, $passportLookup, $dobLookup) {
                $q->where('role', CipPerson::ROLE_MAIN_APPLICANT)
                    ->where(function ($q) use ($first, $last, $passportLookup, $dobLookup) {
                        $q->where(fn ($person) => $person
                            ->whereRaw('lower(first_name) = ?', [$first])
                            ->whereRaw('lower(last_name) = ?', [$last])
                            ->when(
                                $dobLookup,
                                fn ($person) => $person->where('date_of_birth_lookup', $dobLookup),
                            ));
                        if ($passportLookup) {
                            $q->orWhere('passport_number_lookup', $passportLookup);
                        }
                    });
            })
            ->latest('id')
            ->first();
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
                'submission_key' => ($data['submissionId'] ?? '') !== '' ? $data['submissionId'] : null,
            ];

            $application = Applications::create($provider, $creator, $attributes);

            if ($phase === Phase::POST_APPROVAL) {
                $from = $application->status;
                $application->forceFill([
                    'phase' => Phase::POST_APPROVAL,
                    'status' => Status::POST_APPROVAL,
                    'post_approval_at' => now(),
                ])->save();
                /*
                 * The Unit's number, adopted rather than minted: this file was
                 * approved before it reached us, and every surface renders
                 * displayNumber(), so writing it here is what stops a
                 * post-approval file wearing an internal number it outgrew
                 * before it was created.
                 */
                Submission::adopt($application, $creator, (string) $data['cipNumber']);
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

        /*
         * An officer who files an application is already working it.
         *
         * Section 10 makes assignment what starts the review, so handing the
         * file to its own author is not bookkeeping tidied up after the fact:
         * it is the true statement that somebody has it, and the move out of
         * NEW that {@see Assignments::assign} makes for us follows from that.
         * Left out, every officer would file an application and immediately
         * assign it to themselves by hand, and the ones who forgot would sit
         * in New Applications looking like nobody's work.
         *
         * Only a creator who may actually hold a file. A service provider
         * contact and a private client file applications and never carry
         * them, so theirs stay unassigned for an administrator to route,
         * which is the queue New Applications exists to be. An administrator
         * filing on somebody's behalf is doing the same routing job, so their
         * filing stays unassigned too and they hand it to an officer.
         *
         * Outside the transaction, deliberately: assign() opens its own and
         * announces the status change, the same reason the post-approval
         * announcement above waits for the commit.
         */
        if ($application->status === Status::NEW
            && Assignments::mayHold($creator)
            && in_array($creator->account_type, Role::OFFICERS, true)) {
            Assignments::assign($application, $creator, $creator,
                CipAccess::REVIEWING_OFFICER, systemStatusMove: true);
            $application = $application->fresh();
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
    /**
     * Start a draft application: a real row, at DRAFT, with whatever is typed.
     *
     * A draft is an application from the first keystroke rather than a note
     * about one. That is what puts it in the table beside everything else,
     * gives it a number to be referred to, and means filing it is a status
     * change rather than a second act of creation with its own way to fail.
     *
     * Folders and slots are opened as soon as there is a scan to keep: a
     * draft is the application, and the paper belongs in the same tree a
     * filed one uses rather than a second home that would have to move later.
     */
    public static function createDraft(CipProvider $provider, User $creator, array $data): CipApplication
    {
        return DB::transaction(function () use ($provider, $creator, $data) {
            $phase = Phase::PRE_APPROVAL;
            if (! empty($data['phase']) && Phase::isValid($data['phase'])) {
                $phase = $data['phase'];
            }

            $application = Applications::create($provider, $creator, [
                'submission_key' => ($data['submissionId'] ?? '') !== '' ? $data['submissionId'] : null,
            ], Status::DRAFT);

            /*
             * The phase is recorded now, but the post-approval ENTRY is not.
             * A post-approval draft has not entered post-approval — it is
             * being typed — so adopting the Unit's number and announcing the
             * entry both wait for the filing, where Intake::create does them.
             */
            if ($phase === Phase::POST_APPROVAL) {
                $application->forceFill(['phase' => Phase::POST_APPROVAL])->save();
            }

            self::saveDraftAnswers($application, $creator, $data);

            return $application->fresh();
        });
    }

    /**
     * Put the newest answers on a draft that already exists.
     *
     * Refuses anything that is no longer a draft: a filed application is
     * edited through {@see update}, which validates what a filing must
     * contain. Without this an autosave still running in a stale tab could
     * quietly overwrite a live application with a half-typed form.
     */
    public static function updateDraft(CipApplication $application, User $actor, array $data): CipApplication
    {
        if ($application->status !== Status::DRAFT) {
            throw new \RuntimeException('This application has been filed and is no longer a draft.');
        }

        return DB::transaction(function () use ($application, $actor, $data) {
            self::saveDraftAnswers($application, $actor, $data);

            return $application->fresh();
        });
    }

    /**
     * File a draft: the same landing {@see create} would have given a form
     * typed in one sitting.
     *
     * The answers and scans are already on the row. What remains is the
     * status change. Pre-approval becomes New Applications. Post-approval
     * cannot: NEW is a pre-approval label, and driving it from a draft
     * whose phase is already post-approval threw rather than filing.
     *
     * @param  array<string, mixed>  $data  already validated by self::rules()
     */
    public static function fileDraft(CipApplication $application, User $actor, array $data): CipApplication
    {
        if ($application->status !== Status::DRAFT) {
            throw new \RuntimeException('This application has been filed and is no longer a draft.');
        }

        $application = self::update($application, $actor, $data);

        $phase = $application->phase ?? Phase::PRE_APPROVAL;
        if (! empty($data['phase']) && Phase::isValid($data['phase'])) {
            $phase = $data['phase'];
        }

        if ($phase === Phase::POST_APPROVAL) {
            return self::filePostApprovalDraft($application, $actor, $data);
        }

        /*
         * New Applications is a lifecycle label. Officers and administrators
         * drive it through the engine; a service provider who may file but
         * may not pick statuses still has to land there, which is the same
         * place {@see create} puts a first-sitting filing.
         */
        if (Engine::canTransition($application, Status::NEW)
            && Engine::allows($actor, $application, Status::NEW)) {
            $application = Engine::apply($application, Status::NEW, $actor, []);
        } else {
            $from = $application->status;
            $application->forceFill(['status' => Status::NEW])->save();
            Engine::record($application, CipEvent::ACTION_STATUS_CHANGED, $actor, [], $from, Status::NEW);
            Notices::announce($application, Status::NEW, $actor);
        }

        if (Assignments::mayHold($actor)
            && in_array($actor->account_type, Role::OFFICERS, true)) {
            Assignments::assign($application, $actor, $actor,
                CipAccess::REVIEWING_OFFICER, systemStatusMove: true);
            $application = $application->fresh();
        }

        return $application;
    }

    /**
     * The post-approval half of {@see create}, for a row that already exists.
     *
     * The Unit's number is adopted rather than corrected: a draft never
     * held one, and {@see Submission::correct} is a compliance edit of a
     * number already on file.
     *
     * @param  array<string, mixed>  $data
     */
    private static function filePostApprovalDraft(CipApplication $application, User $creator, array $data): CipApplication
    {
        $from = $application->status;
        $application->forceFill([
            'phase' => Phase::POST_APPROVAL,
            'status' => Status::POST_APPROVAL,
            'post_approval_at' => $application->post_approval_at ?? now(),
        ])->save();

        Submission::adopt($application, $creator, (string) ($data['cipNumber'] ?? ''));
        Engine::record($application, CipEvent::ACTION_STATUS_CHANGED, $creator, [], $from, Status::POST_APPROVAL);
        Engine::record($application, CipEvent::ACTION_POST_APPROVAL_ENTERED, $creator, []);

        $application = PostApproval::prepare($application->fresh(), $creator);
        Notices::announce($application, Status::POST_APPROVAL, $creator);

        return $application;
    }

    /**
     * The answers, written onto a draft row.
     *
     * Shared by both draft paths. People are synced the same way a filed
     * application's are, then folders, slots and uploads are written so a
     * photo chosen while drafting is still there when the form is filed.
     */
    private static function saveDraftAnswers(CipApplication $application, User $actor, array $data): void
    {
        $investment = $data['investmentType'] ?? null;
        $application->forceFill([
            'investment_type' => $investment ?: null,
            'investment_type_other' => $investment === InvestmentType::OTHER
                ? trim((string) ($data['investmentTypeOther'] ?? '')) ?: null
                : null,
            'sponsored' => (bool) ($data['sponsored'] ?? false),
        ])->save();

        $application->load('people');

        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $main
            ? self::applyPerson($main, $data)
            : self::writePerson($application, CipPerson::ROLE_MAIN_APPLICANT, $data);

        self::syncSponsor($application, $data);
        $dependentUuids = array_map(
            fn (CipPerson $person) => $person->uuid,
            self::syncDependents($application, $data['dependents'] ?? []),
        );
        Dependents::renumber($application);

        /*
         * A draft keeps its scans, so it needs somewhere to keep them.
         *
         * The same folders and the same slots a filed application uses: a
         * draft is an application from the first keystroke, and giving its
         * uploads a second home would mean moving them at filing and finding
         * out then what the move missed. Filing adds the checklist and the
         * notices; the paper is already where it belongs.
         *
         * Reloaded first because renumbering wrote ordinals and a folder is
         * named after them.
         */
        $application->load('people');
        Tree::provision($application, $actor);

        foreach ($application->people as $person) {
            DocumentSlots::open($person);
            $person->setRelation('application', $application);
        }

        self::fileUploads($application, $data, $actor, $dependentUuids);
    }

    public static function update(CipApplication $application, User $actor, array $data): CipApplication
    {
        return DB::transaction(function () use ($application, $actor, $data) {
            $locked = $application->isLocked();
            /*
             * Confirm submission freezes the scans the Unit was handed, not
             * the names on the file. A locked row still accepts a detail
             * correction; the original package is left alone by skipping the
             * upload pass below.
             */
            if (! $locked) {
                Confirmation::guard($application);
            }
            self::guardIdentityEdits($application, $actor, $data);
            self::syncCipNumber($application, $actor, $data);
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

            if (! $locked) {
                self::fileUploads($application, $data, $actor, $dependentUuids);
            }

            return $application->fresh();
        });
    }

    /**
     * Identity is an administrator's to change, in either lane.
     *
     * Who somebody is — their name, their date of birth, their passport
     * number — is what the Unit checks against the document in front of it,
     * so it is not a field an officer corrects on their own say-so. An
     * administrator writes it; everyone else asks, through the person-edit
     * request that post-approval already used.
     *
     * Enforced here as well as on that request because this form is the other
     * door onto the same eight fields: leaving it open would mean a reader
     * refused at one and waved through at the other.
     *
     * @param  array<string, mixed>  $data
     */
    private static function guardIdentityEdits(CipApplication $application, User $actor, array $data): void
    {
        if (PersonEdits::editsDirectly($actor, $application)) {
            return;
        }

        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        if ($main === null) {
            return;
        }

        foreach (PersonEdits::FIELDS as $field) {
            if (! array_key_exists($field, $data)) {
                continue;
            }

            if (PersonEdits::differs($main, $field, $data[$field])) {
                abort(422, 'Ask an administrator to change '.$main->fullName().'’s details.');
            }
        }
    }

    /**
     * The Unit's number after an edit: changed, or left exactly alone.
     *
     * Three ways this does nothing, and they are all the common case. The
     * field is not sent at all, by a reader the form never offered it to. It
     * is sent unchanged, because the form posts every control it drew whether
     * or not this one was touched. Or the file is still pre-approval, where
     * the number does not exist yet and {@see Submission::record} is the only
     * thing that may write one.
     *
     * What is left is somebody who typed a different number, and that goes
     * through {@see Submission::correct}, which is where the capability is
     * checked, the number is cleaned, uniqueness is enforced and the change is
     * audited with what it was before. Deliberately not a second
     * implementation of any of that: a number corrected here and one corrected
     * from the file's own screen must be the same act.
     *
     * @param  array<string, mixed>  $data  already validated by self::rules(editing: true)
     */
    private static function syncCipNumber(CipApplication $application, User $actor, array $data): void
    {
        if (! array_key_exists('cipNumber', $data)) {
            return;
        }

        $given = trim((string) ($data['cipNumber'] ?? ''));

        /*
         * Blank clears nothing. A file that has a number keeps it: emptying
         * the box is how a reader without the capability sees the field, and
         * an application the Unit has numbered does not go back to being
         * unnumbered.
         */
        if ($given === '') {
            return;
        }

        /*
         * A draft has not entered the lane. The Unit's number is adopted
         * when the form is filed ({@see fileDraft}), the same moment a
         * first-sitting post-approval filing writes it. Correcting it here
         * asked cip.compliance of a form that is still being typed, and a
         * reader who may file could not Save.
         */
        if ($application->status === Status::DRAFT) {
            return;
        }

        if (($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            abort(422, 'A CIP number is recorded when the application is submitted to the Unit.');
        }

        // Compared the way the number is stored, so re-posting the same value
        // with the spaces it was pasted with is not a change.
        if (preg_replace('/\s+/u', '', $given) === (string) $application->cip_number) {
            return;
        }

        Submission::correct($application, $actor, $given);
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

        // A draft may not have answered the sponsored question yet, and an
        // unanswered question is not a Yes.
        if (! (bool) ($data['sponsored'] ?? false)) {
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
                // A draft row may have no relationship chosen yet; keep the
                // one it has rather than writing a null over it.
                if (! empty($row['relationship'])) {
                    $person->forceFill(['relationship' => $row['relationship']])->save();
                }
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
     * (section 5) where a main applicant or a sponsor is eight, and both come
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
     * The photo answers two things at once, a document slot, because section 2
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

        foreach (self::documentFields(ApplicantType::for($person), $phase, $person->application, $person)
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

        /*
         * A photo already filed stays filed.
         *
         * The same rule fileDocuments has kept all along, and the photo
         * needed it once a draft began keeping its scans: the wizard posts
         * the whole form on every autosave, so the second save re-sent a
         * photo the first had filed and DocumentSlots::fill threw — a 500 on
         * a keystroke. Replacing a filed answer is the file viewer's Upload
         * new version, not a side effect of typing a surname.
         */
        $slot = CipDocument::query()
            ->where('person_id', $person->id)
            ->where('type', DocumentTypes::PASSPORT_PHOTO)
            ->first();

        if ($slot?->file_id
            && ($slot->status ?? DocumentStatus::PENDING_UPLOAD) !== DocumentStatus::UPDATE_REQUIRED) {
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
             * Every active firm on the CIP register, including ones the
             * library sync created without a company row.
             *
             * Requiring a live company hid the real book: SharePoint folders
             * become providers with no hub firm, and deleting a company
             * nulls the link, so Galaxy Partners vanished from Create New
             * Application while it was still the firm people file under.
             * A company that is in the bin and still linked stays off the
             * list — that firm was put away on purpose. PRI has no company
             * by design.
             */
            return CipProvider::query()
                ->where('active', true)
                ->where(fn ($q) => $q
                    ->whereNull('company_id')
                    ->orWhereHas('company')
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
