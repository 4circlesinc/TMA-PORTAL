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
use Illuminate\Support\Carbon;
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

    /**
     * The upload fields one applicant type's wizard section carries, from the
     * live templates. The photo is not among them, it has measurement rules
     * and becomes the person's picture, so it keeps its own control, and the
     * field name is the template key in camel case, which lands the legacy
     * three on exactly the names the endpoint has always documented.
     *
     * `required` and `atFiling` are the same fact: Document Requirements
     * settings are the source of truth for the asterisk, for Add, and for
     * editing a filed application. A draft does not demand them. Optional
     * rows stay optional. A firm that unticks Required, or retires a row,
     * is what stops filing from asking for it.
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
                'atFiling' => (bool) $t->required,
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
                return collect([Phase::PRE_APPROVAL, Phase::POST_APPROVAL, Phase::ADD_ON])
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
     * A scan already sitting on the draft or filed application this request
     * completes.
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

        $person = $draft->people()->withTrashed()->where('role', $role)->first();
        $person?->loadMissing('documents');

        return self::personHolds($person, $type);
    }

    private static function personHolds(?CipPerson $person, string $type): bool
    {
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

    /** Female-only templates apply only when this person is Female. */
    private static function documentAppliesToGender(array $doc, mixed $gender): bool
    {
        if (! ($doc['femaleOnly'] ?? false)) {
            return true;
        }

        return strcasecmp((string) $gender, 'Female') === 0;
    }

    /**
     * The workflow lane the document rules should judge against.
     *
     * A filing takes the phase the form sent. An edit, or completing a
     * draft, takes the row's own phase: the body does not repeat it, and
     * guessing pre-approval would demand the wrong pack.
     */
    private static function rulesPhase(?CipApplication $existing = null): string
    {
        $fromFile = (string) ($existing?->phase ?? '');

        if ($existing && Phase::isValid($fromFile)) {
            return $fromFile;
        }

        return self::filingPhase();
    }

    /** @return array<string, mixed> */
    private static function scanFieldRules(bool $demanded): array
    {
        return array_merge(
            [$demanded ? 'required' : 'nullable', 'array'],
            $demanded ? ['min:1'] : [],
            ['max:'.self::MAX_DOCUMENTS_PER_SLOT],
        );
    }

    /** The shared person field set. Section 2's list, which section 4 says a sponsor repeats. */
    private const PERSON_FIELDS = [
        'firstName', 'lastName', 'gender', 'dateOfBirth', 'countryOfBirth',
        'countryOfResidence', 'nationality', 'occupation', 'passportNumber',
    ];

    /**
     * @param  bool  $editing  an update of a row that already exists
     *
     * Editing keeps every typed answer required. It does not demand files
     * already sitting on that row: the wizard does not re-send a photo it
     * has already kept, and asking for it again is the form showing the
     * picture and calling it missing. Sending one replaces it; sending
     * nothing leaves it alone. Outstanding pack scans stay on the checklist
     * rather than blocking Save — Document Requirements gate Add, not a
     * name correction on a file the firm already has. The provider is not
     * in the list at all: its code is minted into the internal number, so
     * changing it afterwards would leave the number naming a firm that did
     * not file.
     * @param  CipApplication|null  $draft  the row this filing completes, when
     *                                      there is one: files already on it
     *                                      count as answered
     */
    public static function rules(bool $editing = false, ?CipApplication $draft = null): array
    {
        if (self::isAddOnRequest($draft)) {
            return self::addOnRules($editing, $draft);
        }

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
            self::mainApplicantDocumentRules($draft, $editing),
            self::investmentRules(),
            self::sponsorRules($draft, $editing),
            self::dependentRules($draft, $editing),
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
        if (self::filingPhase() === Phase::ADD_ON) {
            return self::addOnDraftRules();
        }

        $rules = [
            'providerId' => ['required', 'string'],
            'phase' => ['nullable', 'string', Rule::in(Phase::ALL)],
            'submissionId' => ['nullable', 'string', 'max:64'],
            'investmentType' => ['nullable', 'string', Rule::in(array_keys(InvestmentType::ALL))],
            'investmentTypeOther' => self::investmentTypeOtherRules(required: false),
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
     * Uploads Document Requirements marks required gate Add — including
     * filing a draft through the create door. An edit of a row that already
     * exists does not: Save has to land a detail correction even when the
     * pack is still outstanding, and the checklist is where those rows stay
     * visible. Sending a file on an edit still files it.
     */
    private static function demandsUploads(bool $editing): bool
    {
        return ! $editing;
    }

    /**
     * The uploads Document Requirements asks of the main applicant.
     *
     * Required rows gate Add; a file already on the draft counts as
     * answered. An edit does not re-demand them. Optional rows never do.
     * A scan is a LIST. One requirement is not always one sheet of paper, a
     * bio page can be a passport's two pages, a birth certificate can arrive
     * with its translation, and a control that takes only the last file
     * dropped on it quietly loses the rest. {@see normaliseDocuments()} lets a
     * single file still arrive on its own.
     */
    private static function mainApplicantDocumentRules(?CipApplication $existing = null, bool $editing = false): array
    {
        $phase = self::rulesPhase($existing);
        $gender = request()->input('gender');
        $demand = self::demandsUploads($editing);

        $photo = self::photoTemplate(ApplicantType::PRINCIPAL_APPLICANT, $phase);
        $photoKept = self::draftHolds($existing, DocumentTypes::PASSPORT_PHOTO);
        $rules = [
            'passportPhoto' => [
                $demand && ! $photoKept && $photo && $photo->required ? 'required' : 'nullable',
                'file', self::photoRule(),
            ],
        ];

        foreach (self::documentFields(ApplicantType::PRINCIPAL_APPLICANT, $phase, $existing) as $doc) {
            $kept = self::draftHolds($existing, $doc['key']);
            $demanded = $demand && ! $kept && $doc['required'] && self::documentAppliesToGender($doc, $gender);
            $rules[$doc['field']] = self::scanFieldRules($demanded);
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
            // Investment Type free-text field", required exactly then. Enterprise
            // Project likewise needs one of its three categories.
            'investmentTypeOther' => self::investmentTypeOtherRules(required: true),
            'sponsored' => ['required', 'boolean'],
        ];
    }

    /**
     * Detail beside the investment type: free text once Other is chosen, a
     * fixed category once Enterprise Project is. Drafts may leave it blank.
     *
     * @return list<mixed>
     */
    private static function investmentTypeOtherRules(bool $required): array
    {
        $type = fn () => request()->input('investmentType');

        $rules = ['nullable', 'string', 'max:191'];

        if ($required) {
            $rules[] = Rule::requiredIf(fn () => in_array($type(), [
                InvestmentType::OTHER,
                InvestmentType::ENTERPRISE_PROJECT,
            ], true));
        }

        $rules[] = Rule::when(
            fn () => $type() === InvestmentType::ENTERPRISE_PROJECT
                && filled(request()->input('investmentTypeOther')),
            [Rule::in(array_keys(InvestmentType::ENTERPRISE_CATEGORIES))],
        );

        return $rules;
    }

    /**
     * Section 4: sponsored means a sponsor, asked for now rather than later.
     *
     * The sponsor repeats the applicant's personal fields and their photo, so
     * they have a face in the portal like everyone else. Their document list
     * is the Document Requirements settings for the sponsor type: required
     * rows gate filing, optional rows do not. A file already on the draft
     * counts as answered; an edit does not re-demand them.
     */
    private static function sponsorRules(?CipApplication $existing = null, bool $editing = false): array
    {
        $sponsored = fn () => filter_var(request()->input('sponsored'), FILTER_VALIDATE_BOOLEAN);
        $phase = self::rulesPhase($existing);
        $gender = request()->input('sponsor.gender');
        $demand = self::demandsUploads($editing);

        $rules = [];
        foreach (self::personRules('sponsor.') as $field => $rule) {
            $rules[$field] = array_merge([Rule::requiredIf($sponsored)], array_slice($rule, 1));
        }

        $photo = self::photoTemplate(ApplicantType::SPONSOR, $phase);
        $photoKept = self::draftHolds($existing, DocumentTypes::PASSPORT_PHOTO, CipPerson::ROLE_SPONSOR);
        $photoDemanded = $demand && ! $photoKept && ($photo?->required ?? true);
        $rules['sponsor.passportPhoto'] = $photoDemanded
            ? [Rule::requiredIf($sponsored), 'file', self::photoRule()]
            : ['nullable', 'file', self::photoRule()];

        foreach (self::documentFields(ApplicantType::SPONSOR, $phase, $existing) as $doc) {
            $kept = self::draftHolds($existing, $doc['key'], CipPerson::ROLE_SPONSOR);
            $demanded = $demand && ! $kept && $doc['required'] && self::documentAppliesToGender($doc, $gender);
            $rules['sponsor.'.$doc['field']] = array_merge(
                [$demanded ? Rule::requiredIf($sponsored) : 'nullable', 'array'],
                $demanded ? ['min:1'] : [],
                ['max:'.self::MAX_DOCUMENTS_PER_SLOT],
            );
            $rules['sponsor.'.$doc['field'].'.*'] = self::documentRule();
        }

        return $rules;
    }

    /** Section 5: each dependent is a name, a date of birth, a relationship, and the same uploads the settings ask of their type. */
    private static function dependentRules(?CipApplication $existing = null, bool $editing = false): array
    {
        $phase = self::rulesPhase($existing);
        $demand = self::demandsUploads($editing);

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
            'dependents.*.passportPhoto' => ['nullable', 'file', self::photoRule()],
        ];

        foreach (self::allDocumentFieldNames() as $field) {
            $rules['dependents.*.'.$field] = ['nullable', 'array', 'max:'.self::MAX_DOCUMENTS_PER_SLOT];
            $rules['dependents.*.'.$field.'.*'] = self::documentRule();
        }

        $rows = request()->input('dependents', []);
        if (! is_array($rows)) {
            return $rules;
        }

        foreach ($rows as $index => $row) {
            if (! is_array($row)) {
                continue;
            }

            $type = self::dependentApplicantType($row, $existing);
            $person = self::dependentOnFile($existing, $row, (int) $index);
            $gender = $row['gender'] ?? null;

            $photo = self::photoTemplate($type, $phase);
            $photoKept = self::personHolds($person, DocumentTypes::PASSPORT_PHOTO);
            if ($demand && ! $photoKept && $photo?->required) {
                $rules['dependents.'.$index.'.passportPhoto'] = ['required', 'file', self::photoRule()];
            }

            foreach (self::documentFields($type, $phase, $existing, $person) as $doc) {
                $kept = self::personHolds($person, $doc['key']);
                $demanded = $demand && ! $kept && $doc['required'] && self::documentAppliesToGender($doc, $gender);
                if (! $demanded) {
                    continue;
                }

                $rules['dependents.'.$index.'.'.$doc['field']] = self::scanFieldRules(true);
                $rules['dependents.'.$index.'.'.$doc['field'].'.*'] = self::documentRule();
            }
        }

        return $rules;
    }

    /**
     * Which checklist a dependent row on the form owes, from the same facts
     * {@see ApplicantType::for()} uses once the person exists.
     */
    private static function dependentApplicantType(array $row, ?CipApplication $application = null): string
    {
        $relationship = (string) ($row['relationship'] ?? '');
        if ($relationship === CipPerson::RELATIONSHIP_SPOUSE
            || preg_match('/spouse/i', $relationship) === 1) {
            return ApplicantType::SPOUSE;
        }

        $raw = $row['dateOfBirth'] ?? null;
        if (! $raw) {
            return ApplicantType::DEPENDENT_16_OVER;
        }

        try {
            $birth = Carbon::parse((string) $raw);
        } catch (\Throwable) {
            return ApplicantType::DEPENDENT_16_OVER;
        }

        $reference = $application?->created_at ?? now();

        return $birth->copy()->addYears(ApplicantType::cutoff())->isAfter($reference)
            ? ApplicantType::DEPENDENT_UNDER_16
            : ApplicantType::DEPENDENT_16_OVER;
    }

    private static function dependentOnFile(?CipApplication $application, array $row, int $index): ?CipPerson
    {
        if ($application === null) {
            return null;
        }

        $id = trim((string) ($row['id'] ?? ''));
        if ($id !== '') {
            $person = $application->people()->withTrashed()->where('uuid', $id)->first();
            $person?->loadMissing('documents');

            return $person;
        }

        $person = $application->people()
            ->withTrashed()
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->orderBy('id')
            ->get()
            ->values()
            ->get($index);
        $person?->loadMissing('documents');

        return $person;
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
            'investmentTypeOther.required' => request()->input('investmentType') === InvestmentType::ENTERPRISE_PROJECT
                ? 'Choose an enterprise category.'
                : 'Say which investment type this is.',
            'investmentTypeOther.in' => 'Choose Marketing, Infrastructure or Housing.',
            'cipNumber.required' => 'Enter the CIP application number from the Unit.',
            'cipNumber.prohibited' => 'A CIP number is recorded when the application is submitted to the Unit.',
            'parentCipNumber.required' => 'Enter the CIP application number of the granted file.',
            'parentCorNumber.required' => 'Enter the Certificate of Registration number.',
            'parentApplicantName.required' => 'Enter the main applicant name.',
            'addonType.required' => 'Choose the Add-On type.',
            'relationship.required' => 'Choose the relationship to the main applicant.',
            'nationality.required' => 'Choose a nationality.',
            'nationality.in' => 'Choose a country from the list.',
            'countryOfBirth.in' => 'Choose a country from the list.',
            'countryOfResidence.in' => 'Choose a country from the list.',
            'sponsor.countryOfBirth.in' => 'Choose a country from the list.',
            'sponsor.countryOfResidence.in' => 'Choose a country from the list.',
            'passportPhoto.required' => 'Upload a square passport photo.',
            'sponsor.passportPhoto.required' => 'Upload a square passport photo.',
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

            if ($phase === Phase::ADD_ON) {
                return self::createAddOn($provider, $creator, $data);
            }

            $attributes = [
                'investment_type' => $data['investmentType'],
                'investment_type_other' => InvestmentType::otherFor(
                    $data['investmentType'],
                    $data['investmentTypeOther'] ?? null,
                ),
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
         * Same for post-approval and Add-On filings: the officer who entered
         * the file holds it. A service provider contact and a private client
         * file applications and never carry them, so theirs stay unassigned
         * for an administrator to route. An administrator filing on somebody's
         * behalf is doing the same routing job, so their filing stays
         * unassigned too and they hand it to an officer.
         *
         * Outside the transaction, deliberately: claimFilingOfficer opens its
         * own and announces the status change, the same reason the
         * post-approval announcement above waits for the commit.
         */
        if (Assignments::claimFilingOfficer($application, $creator)) {
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
        $application = DB::transaction(function () use ($provider, $creator, $data) {
            $phase = Phase::PRE_APPROVAL;
            if (! empty($data['phase']) && Phase::isValid($data['phase'])) {
                $phase = $data['phase'];
            }

            $attrs = [
                'submission_key' => ($data['submissionId'] ?? '') !== '' ? $data['submissionId'] : null,
            ];
            if ($phase === Phase::ADD_ON) {
                $attrs['phase'] = Phase::ADD_ON;
            }

            $application = Applications::create($provider, $creator, $attrs, Status::DRAFT);

            /*
             * The phase is recorded now, but the post-approval ENTRY is not.
             * A post-approval draft has not entered post-approval — it is
             * being typed — so adopting the Unit's number and announcing the
             * entry both wait for the filing, where Intake::create does them.
             */
            if ($phase === Phase::POST_APPROVAL) {
                $application->forceFill(['phase' => Phase::POST_APPROVAL])->save();
            }

            if ($phase === Phase::ADD_ON) {
                $application->forceFill([
                    'phase' => Phase::ADD_ON,
                    'addon_type' => $data['addonType'] ?? null,
                ])->save();
                self::linkAddOnParent($application, $creator, $data);
            }

            self::saveDraftAnswers($application, $creator, $data);

            return $application->fresh();
        });

        /*
         * Name who started the draft on Assigned To.
         *
         * Filing already claims an officer; a leftover draft used to sit as
         * Unassigned beside a created_by the table never drew. Officers and
         * administrators who mayHold are claimed here. Outside the
         * transaction for the same reason claimFilingOfficer is: it opens its
         * own and must not nest. Notices skip DRAFT, so this does not page
         * anyone for unfinished typing.
         */
        if (Assignments::claimDraftAuthor($application, $creator)) {
            $application = $application->fresh();
        }

        return $application;
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
        return DB::transaction(function () use ($application, $actor, $data) {
            /*
             * Two autosaves in flight used to both read the same people list,
             * both mint new dependents, and leave Suha with two Ahmeds. Lock
             * the application row so concurrent drafts serialize.
             */
            $application = CipApplication::query()
                ->whereKey($application->id)
                ->lockForUpdate()
                ->firstOrFail();

            if ($application->status !== Status::DRAFT) {
                throw new \RuntimeException('This application has been filed and is no longer a draft.');
            }

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

        $phase = $application->phase ?? Phase::PRE_APPROVAL;
        if (! empty($data['phase']) && Phase::isValid($data['phase'])) {
            $phase = $data['phase'];
        }

        if ($phase === Phase::ADD_ON || ($application->phase ?? '') === Phase::ADD_ON) {
            return self::fileAddOnDraft($application, $actor, $data);
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
        return self::leaveDraftForNew($application, $actor);
    }

    /**
     * File an Add-On draft: link the parent, write the person, leave Draft.
     *
     * Uses the draft answer path rather than {@see updateAddOn}: filing is
     * completing the row, and the parent named on the form must land on it
     * the same way {@see createAddOn} would on a first-sitting Add.
     */
    private static function fileAddOnDraft(CipApplication $application, User $actor, array $data): CipApplication
    {
        $parent = self::requireAddOnParent($actor, $data, $application->id);
        $data = self::normaliseAddOnPerson($data);
        if ($mismatch = AddOn::typeMismatch(
            (string) ($data['addonType'] ?? $application->addon_type),
            $data['dateOfBirth'] ?? null,
            $data['relationship'] ?? null,
        )) {
            throw new \InvalidArgumentException($mismatch);
        }

        DB::transaction(function () use ($application, $actor, $data, $parent) {
            $application = CipApplication::query()
                ->whereKey($application->id)
                ->lockForUpdate()
                ->firstOrFail();

            if ($application->status !== Status::DRAFT) {
                throw new \RuntimeException('This application has been filed and is no longer a draft.');
            }

            $application->forceFill([
                'phase' => Phase::ADD_ON,
                'parent_application_id' => $parent->id,
                'provider_id' => $parent->provider_id,
                'addon_type' => $data['addonType'] ?? $application->addon_type,
                'investment_type' => $parent->investment_type,
                'investment_type_other' => $parent->investment_type_other,
                'sponsored' => false,
            ])->save();
            $application->setRelation('parent', $parent);
            if ($parent->provider) {
                $application->setRelation('provider', $parent->provider);
            }

            self::saveAddOnDraftAnswers($application, $actor, $data);
        });

        $application = $application->fresh();

        return self::leaveDraftForNew($application, $actor);
    }

    /**
     * Move a completed draft onto New Applications and route the holder.
     */
    private static function leaveDraftForNew(CipApplication $application, User $actor): CipApplication
    {
        if (Engine::canTransition($application, Status::NEW)
            && Engine::allows($actor, $application, Status::NEW)) {
            $application = Engine::apply($application, Status::NEW, $actor, []);
        } else {
            $from = $application->status;
            $application->forceFill(['status' => Status::NEW])->save();
            Engine::record($application, CipEvent::ACTION_STATUS_CHANGED, $actor, [], $from, Status::NEW);
            Notices::announce($application, Status::NEW, $actor);
        }

        if (Assignments::claimFilingOfficer($application, $actor)) {
            $application = $application->fresh();
        } else {
            // An admin named on the draft for authorship must not stay the
            // holder of a New Applications row — same routing as a direct file.
            Assignments::releaseRoutingAuthor($application, $actor);
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

        if (Assignments::claimFilingOfficer($application, $creator)) {
            $application = $application->fresh();
        } else {
            Assignments::releaseRoutingAuthor($application, $creator);
            $application = $application->fresh();
        }

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
        if (($application->phase ?? '') === Phase::ADD_ON) {
            self::saveAddOnDraftAnswers($application, $actor, $data);

            return;
        }

        $investment = $data['investmentType'] ?? null;
        $application->forceFill([
            'investment_type' => $investment ?: null,
            'investment_type_other' => InvestmentType::otherFor(
                $investment,
                $data['investmentTypeOther'] ?? null,
            ),
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
        Tree::resyncNames($application);

        foreach ($application->people as $person) {
            DocumentSlots::open($person);
            $person->setRelation('application', $application);
        }

        self::fileUploads($application, $data, $actor, $dependentUuids);
    }

    public static function update(CipApplication $application, User $actor, array $data): CipApplication
    {
        if (($application->phase ?? '') === Phase::ADD_ON) {
            return self::updateAddOn($application, $actor, $data);
        }

        return DB::transaction(function () use ($application, $actor, $data) {
            $application = CipApplication::query()
                ->whereKey($application->id)
                ->lockForUpdate()
                ->firstOrFail();

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
                'investment_type_other' => InvestmentType::otherFor(
                    $data['investmentType'],
                    $data['investmentTypeOther'] ?? null,
                ),
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

            /*
             * A post-approval edit can add a person who was not on the file
             * at filing — a dependent born later, a spouse the letter named.
             * {@see PostApproval::prepare} is the same door create uses: the
             * PAD tree, the PAD checklist, and a status of Not started. Safe
             * to call again when nobody new arrived.
             */
            if (($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL) {
                $application = PostApproval::prepare($application, $actor);
            } else {
                foreach ($application->people as $person) {
                    DocumentSlots::open($person);
                }
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

        /*
         * A draft is a filing that has not happened yet.
         *
         * The wizard autosaves onto a DRAFT row and then PATCHes it on every
         * save, so typing the applicant's own name into a new application
         * arrives here as an "edit" to the identity already on the row. Asking
         * an administrator for that is asking permission to fill in the form:
         * it refused the provider side and the officers alike, and nobody but
         * an administrator could file at all.
         *
         * Identity becomes an administrator's to change once the filing exists
         * — which is the moment the Unit could be checking it against a
         * passport — and that is where this guard still stands. The same
         * carve-out, for the same reason, as {@see syncCipNumber}.
         */
        if ($application->status === Status::DRAFT) {
            return;
        }

        $application->loadMissing('people');

        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        self::rejectIdentityChange($main, $data);

        $sponsor = $application->people->firstWhere('role', CipPerson::ROLE_SPONSOR);
        if ($sponsor && (bool) ($data['sponsored'] ?? false)) {
            self::rejectIdentityChange($sponsor, $data['sponsor'] ?? []);
        }

        foreach ($data['dependents'] ?? [] as $row) {
            if (! is_array($row) || empty($row['id'])) {
                continue;
            }

            $person = $application->people->firstWhere('uuid', $row['id']);
            self::rejectIdentityChange($person, $row);
        }
    }

    /**
     * Refuse a correction to somebody already on the file.
     *
     * A row with no person is a new one (a dependant added on Edit, a
     * sponsor the form just turned on) and is not this question.
     *
     * @param  array<string, mixed>  $data
     */
    private static function rejectIdentityChange(?CipPerson $person, array $data): void
    {
        if ($person === null) {
            return;
        }

        foreach (PersonEdits::FIELDS as $field) {
            if (! array_key_exists($field, $data)) {
                continue;
            }

            if (PersonEdits::differs($person, $field, $data[$field])) {
                abort(422, 'Ask an administrator to change '.$person->fullName().'’s details.');
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
     * The dependants after an edit, matched by uuid, then by name.
     *
     * Uuid is preferred: the form remembers it after the first save. When a
     * concurrent autosave or a stale tab omits it, the same first+last name
     * (and date of birth when both sides have one) reuses the live row so a
     * second Ahmed is not minted beside the first.
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

            if ($person === null) {
                $person = self::matchDependentByIdentity(
                    $application->people
                        ->where('role', CipPerson::ROLE_DEPENDENT)
                        ->reject(fn (CipPerson $p) => in_array($p->id, $kept, true)),
                    $row,
                );
            }

            if ($person) {
                self::applyPerson($person, $row);
                // A draft row may have no relationship chosen yet; keep the
                // one it has rather than writing a null over it.
                if (! empty($row['relationship'])) {
                    $person->forceFill(['relationship' => $row['relationship']])->save();
                }
            } else {
                $person = self::writePerson($application, CipPerson::ROLE_DEPENDENT, $row);
                $application->setRelation(
                    'people',
                    $application->people->push($person),
                );
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

        /*
         * A stale tab can still post every duplicate uuid it loaded. Those
         * all land in $kept above; collapse the extras so one Ahmed remains.
         */
        return self::collapseDuplicateDependents($application, $ordered);
    }

    /**
     * Soft-delete live dependents that are the same person as an earlier row.
     *
     * @param  list<CipPerson>  $ordered
     * @return list<CipPerson>
     */
    private static function collapseDuplicateDependents(CipApplication $application, array $ordered): array
    {
        $canonical = [];
        $unique = [];

        foreach ($ordered as $person) {
            $duplicateOf = null;
            foreach ($canonical as $kept) {
                if (self::dependentsAreSameIdentity($kept, $person)) {
                    $duplicateOf = $kept;
                    break;
                }
            }

            if ($duplicateOf !== null) {
                if ($person->id !== $duplicateOf->id && ! $person->trashed()) {
                    $person->delete();
                }

                continue;
            }

            $canonical[] = $person;
            $unique[] = $person;
        }

        $application->unsetRelation('people');
        $application->load('people');

        $application->people
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->each(function (CipPerson $person) use ($canonical) {
                foreach ($canonical as $kept) {
                    if ($person->id !== $kept->id && self::dependentsAreSameIdentity($kept, $person)) {
                        $person->delete();

                        return;
                    }
                }
            });

        return $unique;
    }

    /**
     * True when two dependent rows are the same individual.
     *
     * Same first and last name. Dates of birth must agree when both are set;
     * a missing DOB on either side still counts as a match (the race that
     * duplicated Suha's children left DOBs empty).
     */
    private static function dependentsAreSameIdentity(CipPerson $a, CipPerson $b): bool
    {
        $aFirst = CipPerson::upperName($a->first_name) ?? '';
        $bFirst = CipPerson::upperName($b->first_name) ?? '';
        $aLast = CipPerson::upperName($a->last_name) ?? '';
        $bLast = CipPerson::upperName($b->last_name) ?? '';

        if ($aFirst === '' && $aLast === '') {
            return false;
        }
        if ($aFirst !== $bFirst || $aLast !== $bLast) {
            return false;
        }

        $aDob = $a->date_of_birth?->format('Y-m-d');
        $bDob = $b->date_of_birth?->format('Y-m-d');
        if ($aDob === null || $bDob === null) {
            return true;
        }

        return $aDob === $bDob;
    }

    /**
     * Find a live dependent the form row is clearly the same person as.
     *
     * Empty names do not match: two blank draft rows must stay two people.
     * When either side has no date of birth, name alone is enough — Suha's
     * children were saved without DOBs and still duplicated by name alone.
     *
     * @param  \Illuminate\Support\Collection<int, CipPerson>  $candidates
     * @param  array<string, mixed>  $row
     */
    private static function matchDependentByIdentity($candidates, array $row): ?CipPerson
    {
        $first = CipPerson::upperName(trim((string) ($row['firstName'] ?? ''))) ?? '';
        $last = CipPerson::upperName(trim((string) ($row['lastName'] ?? ''))) ?? '';
        if ($first === '' && $last === '') {
            return null;
        }

        $dob = isset($row['dateOfBirth']) && $row['dateOfBirth'] !== ''
            ? (string) $row['dateOfBirth']
            : null;

        return $candidates
            ->sortBy('id')
            ->first(function (CipPerson $person) use ($first, $last, $dob) {
                if ((CipPerson::upperName($person->first_name) ?? '') !== $first) {
                    return false;
                }
                if ((CipPerson::upperName($person->last_name) ?? '') !== $last) {
                    return false;
                }

                $existingDob = $person->date_of_birth?->format('Y-m-d');
                if ($dob === null || $existingDob === null) {
                    return true;
                }

                return $existingDob === $dob;
            });
    }

    /**
     * One-shot: soft-delete live duplicate dependents on every application.
     *
     * Keeps the oldest row for each identity. Safe to run repeatedly.
     *
     * @return int how many duplicate people were soft-deleted
     */
    public static function dedupeAllDependents(): int
    {
        $removed = 0;

        CipApplication::query()->orderBy('id')->each(function (CipApplication $application) use (&$removed) {
            $application->load('people');
            $canonical = [];

            foreach ($application->people
                ->where('role', CipPerson::ROLE_DEPENDENT)
                ->sortBy('id')
                ->values() as $person) {
                $duplicateOf = null;
                foreach ($canonical as $kept) {
                    if (self::dependentsAreSameIdentity($kept, $person)) {
                        $duplicateOf = $kept;
                        break;
                    }
                }

                if ($duplicateOf !== null) {
                    $person->delete();
                    $removed++;

                    continue;
                }

                $canonical[] = $person;
            }

            if ($canonical !== []) {
                Dependents::renumber($application);
            }
        });

        return $removed;
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

        if (array_key_exists('relationship', $data) && $data['relationship'] !== null && $data['relationship'] !== '') {
            $attributes['relationship'] = $data['relationship'];
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
        } elseif (! empty($data['relationship'])) {
            $attributes['relationship'] = $data['relationship'];
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

        foreach (self::documentFields(ApplicantType::for($person), $phase, $person->application, $person) as $doc) {
            $type = $doc['key'];
            $uploads = $data[$doc['field']] ?? [];
            $givenName = AddOnRequirements::isAdditional($type)
                ? trim((string) ($data[$doc['field'].'Name'] ?? ''))
                : '';
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
                    ? DocumentSlots::fill($person, $type, $upload, $creator, $givenName !== '' ? $givenName : null)
                    : DocumentSlots::attach($person, $type, $upload, $creator, $filed + 1);

                $filed++;
            }
        }
    }

    public static function filePhoto(CipPerson $person, mixed $upload, User $creator, bool $replace = false): void
    {
        if (! $upload instanceof UploadedFile) {
            return;
        }

        /*
         * A photo already filed stays filed, unless replacing it is the point.
         *
         * The same rule fileDocuments has kept all along, and the photo
         * needed it once a draft began keeping its scans: the wizard posts
         * the whole form on every autosave, so the second save re-sent a
         * photo the first had filed and DocumentSlots::fill threw — a 500 on
         * a keystroke.
         *
         * But the Documents list offers Upload new version on a filled photo
         * slot precisely to change the face, and that upload arrived here
         * wearing the autosave's clothes. Returning early answered it 200 OK
         * and changed nothing, so the new photo was accepted, filed nowhere,
         * and every row went on drawing the old likeness. $replace is that
         * door telling the difference.
         */
        $slot = CipDocument::query()
            ->where('person_id', $person->id)
            ->where('type', DocumentTypes::PASSPORT_PHOTO)
            ->first();

        if (! $replace
            && $slot?->file_id
            && ($slot->status ?? DocumentStatus::PENDING_UPLOAD) !== DocumentStatus::UPDATE_REQUIRED) {
            return;
        }

        // The slot first: Vault::store consumes the temp file, so the bytes
        // for the avatar have to be read before the file is moved.
        $binary = (string) file_get_contents($upload->getRealPath());
        $hadFile = (bool) $slot?->file_id;
        DocumentSlots::fill($person, DocumentTypes::PASSPORT_PHOTO, $upload, $creator, null, $replace);

        /*
         * A replacement goes through Versions::addStored, which already
         * synced the likeness from the new vault bytes. Writing it again
         * here would only burn a second copy. First filing still creates
         * the library file without addStored, so the face is written here.
         */
        if ($hadFile) {
            return;
        }

        PassportPhoto::applyToPerson($person, $binary);
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

    public static function isAddOnRequest(?CipApplication $existing = null): bool
    {
        if ($existing && ($existing->phase ?? '') === Phase::ADD_ON) {
            return true;
        }

        return self::filingPhase() === Phase::ADD_ON;
    }

    /**
     * One spouse or dependent, filed against a granted parent.
     *
     * Investment and the provider are inherited: this is not a new citizenship
     * file, it is a person added to one the Unit has already granted.
     */
    private static function createAddOn(CipProvider $provider, User $creator, array $data): CipApplication
    {
        $parent = self::requireAddOnParent($creator, $data);
        $data = self::normaliseAddOnPerson($data);
        if ($mismatch = AddOn::typeMismatch(
            (string) ($data['addonType'] ?? ''),
            $data['dateOfBirth'] ?? null,
            $data['relationship'] ?? null,
        )) {
            throw new \InvalidArgumentException($mismatch);
        }

        $application = Applications::create($provider, $creator, [
            'phase' => Phase::ADD_ON,
            'investment_type' => $parent->investment_type,
            'investment_type_other' => $parent->investment_type_other,
            'sponsored' => false,
            'submission_key' => ($data['submissionId'] ?? '') !== '' ? $data['submissionId'] : null,
        ]);

        $application->forceFill([
            'phase' => Phase::ADD_ON,
            'parent_application_id' => $parent->id,
            'provider_id' => $parent->provider_id,
            'addon_type' => $data['addonType'],
        ])->save();
        if ($parent->provider) {
            $application->setRelation('provider', $parent->provider);
        }

        self::writePerson($application, CipPerson::ROLE_MAIN_APPLICANT, $data);

        $application->load('people');
        Tree::provision($application, $creator);

        foreach ($application->people as $person) {
            $person->setRelation('application', $application);
            DocumentSlots::open($person);
        }

        self::fileUploads($application, $data, $creator, []);

        return $application->fresh();
    }

    private static function updateAddOn(CipApplication $application, User $actor, array $data): CipApplication
    {
        return DB::transaction(function () use ($application, $actor, $data) {
            $locked = $application->isLocked();
            if (! $locked) {
                Confirmation::guard($application);
            }
            $data = self::normaliseAddOnPerson($data);
            if ($mismatch = AddOn::typeMismatch(
                (string) ($data['addonType'] ?? $application->addon_type),
                $data['dateOfBirth'] ?? null,
                $data['relationship'] ?? null,
            )) {
                throw new \InvalidArgumentException($mismatch);
            }
            self::guardIdentityEdits($application, $actor, $data);

            /*
             * Filing a draft lands here, not in createAddOn. Parent CIP / COR
             * / main-applicant name are validated on the way in; without this
             * link the filed row kept a null parent and those fields looked
             * empty when the application was opened again.
             */
            if (trim((string) ($data['parentCipNumber'] ?? '')) !== '') {
                self::linkAddOnParent($application, $actor, $data);
            }

            $fill = [];
            if (! empty($data['addonType']) && AddOn::isValidType($data['addonType'])) {
                $fill['addon_type'] = $data['addonType'];
            }
            if ($application->parent && ! $application->investment_type) {
                $fill['investment_type'] = $application->parent->investment_type;
                $fill['investment_type_other'] = $application->parent->investment_type_other;
            }
            if ($fill !== []) {
                $application->forceFill($fill)->save();
            }

            $application->load('people');

            $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
            $main
                ? self::applyPerson($main, $data)
                : self::writePerson($application, CipPerson::ROLE_MAIN_APPLICANT, $data);

            $application->load('people');
            Tree::provision($application, $actor);
            Tree::resyncNames($application);

            foreach ($application->people as $person) {
                $person->setRelation('application', $application);
                DocumentSlots::open($person);
            }

            if (! $locked) {
                self::fileUploads($application, $data, $actor, []);
            }

            return $application->fresh();
        });
    }

    private static function saveAddOnDraftAnswers(CipApplication $application, User $actor, array $data): void
    {
        $data = self::normaliseAddOnPerson($data);
        self::linkAddOnParent($application, $actor, $data);

        $fill = [
            'sponsored' => false,
            'addon_type' => $data['addonType'] ?? $application->addon_type,
        ];

        if ($application->parent && ! $application->investment_type) {
            $fill['investment_type'] = $application->parent->investment_type;
            $fill['investment_type_other'] = $application->parent->investment_type_other;
        }

        $application->forceFill($fill)->save();
        $application->load('people');

        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $main
            ? self::applyPerson($main, $data)
            : self::writePerson($application, CipPerson::ROLE_MAIN_APPLICANT, $data);

        $application->load('people');
        Tree::provision($application, $actor);

        foreach ($application->people as $person) {
            $person->setRelation('application', $application);
            DocumentSlots::open($person);
        }

        self::fileUploads($application, $data, $actor, []);
    }

    private static function linkAddOnParent(CipApplication $application, User $actor, array $data): void
    {
        $cip = trim((string) ($data['parentCipNumber'] ?? ''));
        if ($cip === '') {
            return;
        }

        $cor = trim((string) ($data['parentCorNumber'] ?? ''));
        $result = AddOn::lookup($actor, $cip, $cor);
        $parent = null;
        if ($result['ok'] ?? false) {
            $parent = AddOn::findParent($actor, $cip, $cor);
        } elseif ($cor === '') {
            // Draft may name the parent by CIP before COR is typed, when the
            // parent file itself has no COR staged yet.
            $match = AddOn::findByCipNumber($actor, $cip);
            if ($match && AddOn::isEligibleParent($match) && ! filled($match->cor_number)) {
                $parent = $match;
            }
        }

        if ($parent === null) {
            return;
        }

        // Capture the certificate number onto the parent when the portal
        // never recorded one, so later Add-Ons and reporting agree.
        if (! filled($parent->cor_number) && $cor !== '') {
            $parent->forceFill(['cor_number' => $cor])->save();
        }

        $previousProviderId = $application->provider_id;

        $application->forceFill([
            'parent_application_id' => $parent->id,
            'provider_id' => $parent->provider_id,
        ])->save();
        $application->setRelation('parent', $parent);
        if ($parent->provider) {
            $application->setRelation('provider', $parent->provider);
        }

        /*
         * Inherit the parent's firm for real: provider_id alone leaves the
         * client Dropbox under whoever the draft first opened as. Move the
         * folder when the firm changes so Supporting Documents and the rest
         * land under the right Citizenship Applications drawer.
         */
        if ($parent->provider
            && (int) $previousProviderId !== (int) $parent->provider_id) {
            Providers::ensureFolder($parent->provider);
            $parent->provider->refresh();
            $application->loadMissing(['client.folder', 'people']);
            Tree::client($application, $actor);
            ProviderTransfer::reparentClientFolder($application, $parent->provider);
        }
    }

    private static function requireAddOnParent(User $creator, array $data, ?int $ignoreAddOnId = null): CipApplication
    {
        $parent = AddOn::findParent(
            $creator,
            (string) ($data['parentCipNumber'] ?? ''),
            (string) ($data['parentCorNumber'] ?? ''),
        );

        if ($parent === null) {
            throw new \InvalidArgumentException('The parent application could not be found.');
        }

        if ($why = AddOn::nameMismatch($parent, $data['parentApplicantName'] ?? null)) {
            throw new \InvalidArgumentException($why);
        }

        if (AddOn::hasOpenAddOn($parent, $ignoreAddOnId)) {
            throw new \InvalidArgumentException(
                'An Add-On application is already in progress for this file. Finish or close it before starting another.',
            );
        }

        return $parent;
    }

    /** Spouse type always carries the spouse relationship, even if the form omitted it. */
    private static function normaliseAddOnPerson(array $data): array
    {
        if (($data['addonType'] ?? '') === AddOn::TYPE_SPOUSE) {
            $data['relationship'] = CipPerson::RELATIONSHIP_SPOUSE;
        }

        return $data;
    }

    /** @return array<string, mixed> */
    private static function addOnRules(bool $editing, ?CipApplication $existing = null): array
    {
        $type = (string) ($existing?->addon_type ?: request()->input('addonType', ''));
        $relationships = AddOn::isValidType($type)
            ? AddOn::relationshipsFor($type)
            : array_merge([CipPerson::RELATIONSHIP_SPOUSE], AddOn::DEPENDENT_RELATIONSHIPS);

        $parentRules = $editing
            ? [
                'parentCipNumber' => ['nullable', 'string', 'max:'.Submission::MAX_LENGTH],
                'parentCorNumber' => ['nullable', 'string', 'max:64'],
                'parentApplicantName' => ['nullable', 'string', 'max:191'],
                'addonType' => ['nullable', 'string', Rule::in(AddOn::TYPES)],
            ]
            : [
                'providerId' => ['nullable', 'string'],
                'phase' => ['nullable', 'string', Rule::in(Phase::ALL)],
                'submissionId' => ['nullable', 'string', 'max:64'],
                'draftId' => ['nullable', 'string', 'max:64'],
                'parentCipNumber' => ['required', 'string', 'max:'.Submission::MAX_LENGTH],
                'parentCorNumber' => ['nullable', 'string', 'max:64'],
                'parentApplicantName' => ['required', 'string', 'max:191'],
                'addonType' => ['required', 'string', Rule::in(AddOn::TYPES)],
            ];

        $rules = array_merge($parentRules, [
            'firstName' => ['required', 'string', 'max:191'],
            'lastName' => ['required', 'string', 'max:191'],
            'dateOfBirth' => ['required', 'date', 'before:today'],
            'nationality' => ['required', 'string', Rule::in(Countries::all())],
            'countryOfResidence' => ['required', 'string', Rule::in(Countries::all())],
            'passportNumber' => ['required', 'string', 'max:64'],
            'relationship' => ['required', 'string', Rule::in($relationships)],
            'gender' => ['nullable', Rule::in(['Male', 'Female'])],
            'countryOfBirth' => ['nullable', 'string', Rule::in(Countries::all())],
            'occupation' => ['nullable', 'string', 'max:191'],
        ], self::addOnDocumentRules($existing, $editing));

        return $rules;
    }

    /** @return array<string, mixed> */
    private static function addOnDraftRules(): array
    {
        $rules = [
            'providerId' => ['nullable', 'string'],
            'phase' => ['nullable', 'string', Rule::in(Phase::ALL)],
            'submissionId' => ['nullable', 'string', 'max:64'],
            'parentCipNumber' => ['nullable', 'string', 'max:'.Submission::MAX_LENGTH],
            'parentCorNumber' => ['nullable', 'string', 'max:64'],
            'parentApplicantName' => ['nullable', 'string', 'max:191'],
            'addonType' => ['nullable', 'string', Rule::in(AddOn::TYPES)],
            'relationship' => ['nullable', 'string', 'max:48'],
            'dependents' => ['nullable', 'array', 'max:0'],
        ];

        $rules = array_merge($rules, self::optionalPersonRules(''));
        $rules['nationality'] = ['nullable', 'string', Rule::in(Countries::all())];
        $rules['passportPhoto'] = ['nullable', 'file', self::photoRule()];

        foreach (self::allDocumentFieldNames() as $field) {
            $rules[$field] = ['nullable', 'array', 'max:'.self::MAX_DOCUMENTS_PER_SLOT];
            $rules[$field.'.*'] = self::documentRule();
        }

        return $rules;
    }

    /** @return array<string, mixed> */
    private static function addOnDocumentRules(?CipApplication $existing, bool $editing): array
    {
        $type = (string) ($existing?->addon_type ?: request()->input('addonType', AddOn::TYPE_SPOUSE));
        if (! AddOn::isValidType($type)) {
            $type = AddOn::TYPE_SPOUSE;
        }

        $phase = Phase::ADD_ON;
        $gender = request()->input('gender');
        $demand = self::demandsUploads($editing);
        $photo = self::photoTemplate($type, $phase);
        $photoKept = self::draftHolds($existing, DocumentTypes::PASSPORT_PHOTO);
        $rules = [
            'passportPhoto' => [
                $demand && ! $photoKept && $photo && $photo->required ? 'required' : 'nullable',
                'file', self::photoRule(),
            ],
        ];

        foreach (self::documentFields($type, $phase, $existing) as $doc) {
            $kept = self::draftHolds($existing, $doc['key']);
            $demanded = $demand && ! $kept && $doc['required'] && self::documentAppliesToGender($doc, $gender);
            $rules[$doc['field']] = self::scanFieldRules($demanded);
            $rules[$doc['field'].'.*'] = self::documentRule();
            if (AddOnRequirements::isAdditional($doc['key'])) {
                $rules[$doc['field'].'Name'] = ['nullable', 'string', 'max:120'];
            }
        }

        return $rules;
    }
}
