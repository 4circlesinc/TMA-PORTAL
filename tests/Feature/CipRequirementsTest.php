<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Requirements;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The checklist templates (§12) and what happens when they change under an
 * application that is already being worked on.
 *
 * The interesting cases are all about time passing: a template written after
 * the checklist was opened, a requirement withdrawn after somebody answered
 * it, a dependant who has a birthday. Every one of them has to leave the
 * uploaded files exactly where they are.
 */
class CipRequirementsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);

        // The table arrives seeded with a default checklist the firm is
        // expected to edit. This suite is about the machinery, not about that
        // list, and asserting against it would fail the first time anybody
        // reworded a default — so each test states the templates it means.
        CipDocumentRequirement::query()->forceDelete();
    }

    private function user(string $type = Role::REVIEWING_OFFICER): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
        ]);
    }

    private function application(): CipApplication
    {
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        return Applications::create($provider, $this->user());
    }

    private function person(CipApplication $application, string $role, array $extra = []): CipPerson
    {
        return CipPerson::create(array_merge([
            'application_id' => $application->id,
            'role' => $role,
            'first_name' => 'Asem',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(40),
        ], $extra));
    }

    /**
     * A template row, written with forceFill so the test states the whole
     * record rather than depending on what the model chose to make fillable.
     */
    private function template(string $applicantType, string $key, string $label, array $extra = []): CipDocumentRequirement
    {
        $template = new CipDocumentRequirement;

        $template->forceFill(array_merge([
            'uuid' => (string) Str::uuid(),
            'applicant_type' => $applicantType,
            'key' => $key,
            'label' => $label,
            'required' => true,
            'sort_order' => 0,
            'active' => true,
        ], $extra))->save();

        return $template;
    }

    /** Answer a slot with a real file, the way an upload would. */
    private function fill(CipDocument $slot): CipDocument
    {
        $staff = $this->user(Role::ADMINISTRATOR);

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'name' => $slot->label.'.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 2048,
            'disk' => 'local',
            'storage_path' => 'vault/'.Str::random(12).'.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
        ]);

        $slot->forceFill([
            'file_id' => $file->id,
            'uploaded_by' => $staff->id,
            'uploaded_at' => now(),
        ])->save();

        return $slot;
    }

    /** @return array<int, string> */
    private function labels(CipPerson $person): array
    {
        return Requirements::materialise($person->fresh())->pluck('label')->all();
    }

    /** @return array<int, string> the updated_at of every slot, as written */
    private function stamps(): array
    {
        return CipDocument::query()->orderBy('id')
            ->pluck('updated_at', 'id')
            ->map(fn ($at) => (string) $at)
            ->all();
    }

    public function test_materialising_twice_opens_the_same_checklist_once(): void
    {
        $application = $this->application();
        $person = $this->person($application, CipPerson::ROLE_MAIN_APPLICANT);

        $this->template('principal_applicant', 'passport_bio_page', 'Passport bio page', ['sort_order' => 1]);
        $this->template('principal_applicant', 'birth_certificate', 'Birth certificate', ['sort_order' => 2]);

        $first = Requirements::materialise($person);
        $this->assertSame(['Passport bio page', 'Birth certificate'], $first->pluck('label')->all());

        $before = $this->stamps();
        $this->travel(5)->minutes();

        $second = Requirements::materialise($person->fresh());

        $this->assertSame($first->pluck('id')->all(), $second->pluck('id')->all());
        $this->assertSame(2, CipDocument::count(), 'a second run must not open a second set of slots');

        // Nothing was re-saved either. A slot touches its application, and the
        // sync cursor reads that timestamp, so idle churn here would tell every
        // catching-up device that every open application had moved.
        $this->assertSame($before, $this->stamps());
    }

    public function test_a_template_added_later_reaches_an_application_already_in_flight(): void
    {
        $application = $this->application();
        $person = $this->person($application, CipPerson::ROLE_MAIN_APPLICANT);
        $this->template('principal_applicant', 'passport_bio_page', 'Passport bio page');

        Requirements::materialise($person);

        // The file is with a reviewer, who has already been round the passport.
        $application->forceFill(['status' => Status::REVIEW_APPLICATION])->save();
        $bio = CipDocument::firstWhere('type', 'passport_bio_page');
        $bio->forceFill(['status' => 'application_review'])->save();

        $this->template('principal_applicant', 'police_certificate', 'Police certificate', ['sort_order' => 5]);

        $this->assertSame(
            ['Passport bio page', 'Police certificate'],
            $this->labels($person),
            'a requirement written today has to reach the applications already open',
        );

        $this->assertSame(
            'application_review',
            $bio->fresh()->status,
            'and widening the checklist must not restart a review already under way',
        );
    }

    public function test_retiring_a_requirement_never_deletes_what_has_been_filed(): void
    {
        $application = $this->application();
        $person = $this->person($application, CipPerson::ROLE_MAIN_APPLICANT);

        $bioPage = $this->template('principal_applicant', 'passport_bio_page', 'Passport bio page', ['sort_order' => 1]);
        $police = $this->template('principal_applicant', 'police_certificate', 'Police certificate', ['sort_order' => 2]);

        Requirements::materialise($person);
        $filled = $this->fill(CipDocument::firstWhere('type', 'passport_bio_page'));

        Requirements::retire($bioPage);
        Requirements::retire($police);

        $filled->refresh();
        $this->assertNotNull($filled->file_id, 'the document somebody uploaded is still there');
        $this->assertFalse($filled->required, 'it is simply no longer demanded');

        // The unanswered one is gone outright, not soft-deleted: the unique
        // index on (person_id, type) counts trashed rows, and a tombstone would
        // block the slot re-opening if the requirement ever came back.
        $this->assertSame(0, CipDocument::withTrashed()->where('type', 'police_certificate')->count());

        Requirements::materialise($person->fresh());
        $this->assertSame(1, CipDocument::count(), 'and neither one comes back on the next run');
    }

    public function test_each_applicant_type_gets_its_own_list(): void
    {
        $application = $this->application();

        $applicant = $this->person($application, CipPerson::ROLE_MAIN_APPLICANT);
        $sponsor = $this->person($application, CipPerson::ROLE_SPONSOR);
        $spouse = $this->person($application, CipPerson::ROLE_DEPENDENT, [
            'relationship' => CipPerson::RELATIONSHIP_SPOUSE,
            'date_of_birth' => now()->subYears(34),
        ]);
        $child = $this->person($application, CipPerson::ROLE_DEPENDENT, [
            'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
            'date_of_birth' => now()->subYears(9),
        ]);
        $student = $this->person($application, CipPerson::ROLE_DEPENDENT, [
            'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
            'date_of_birth' => now()->subYears(21),
        ]);

        $this->template('principal_applicant', 'source_of_funds', 'Source of funds');
        $this->template('sponsor', 'sponsorship_letter', 'Sponsorship letter');
        $this->template('spouse', 'marriage_certificate', 'Marriage certificate');
        $this->template('dependent_under_16', 'parental_consent', 'Parental consent');
        $this->template('dependent_16_over', 'student_enrolment', 'Proof of enrolment');

        Requirements::materialiseApplication($application);

        $this->assertSame(['Source of funds'], $this->labels($applicant));
        $this->assertSame(['Sponsorship letter'], $this->labels($sponsor));
        // A spouse is a dependant by relationship, and no age bracket at all.
        $this->assertSame(['Marriage certificate'], $this->labels($spouse));
        $this->assertSame(['Parental consent'], $this->labels($child));
        $this->assertSame(['Proof of enrolment'], $this->labels($student));
    }

    public function test_rewording_a_requirement_reaches_the_unanswered_slots_only(): void
    {
        $application = $this->application();
        $person = $this->person($application, CipPerson::ROLE_MAIN_APPLICANT);

        $bioPage = $this->template('principal_applicant', 'passport_bio_page', 'Passport bio page', ['sort_order' => 1]);
        $police = $this->template('principal_applicant', 'police_certificate', 'Police certificate', ['sort_order' => 2]);

        Requirements::materialise($person);
        $this->fill(CipDocument::firstWhere('type', 'passport_bio_page'));

        $bioPage->forceFill(['label' => 'Passport data page'])->save();
        $police->forceFill(['label' => 'Police certificate of character'])->save();

        $this->assertSame(
            ['Passport bio page', 'Police certificate of character'],
            $this->labels($person),
            'a filed document keeps the words it was filed under; a question still being asked is asked in the current ones',
        );
    }

    public function test_a_person_with_no_templates_gets_an_empty_checklist(): void
    {
        $application = $this->application();
        $sponsor = $this->person($application, CipPerson::ROLE_SPONSOR);

        // Requirements exist, but for somebody else's type.
        $this->template('principal_applicant', 'source_of_funds', 'Source of funds');

        $checklist = Requirements::materialise($sponsor);

        $this->assertTrue($checklist->isEmpty(), 'owing nothing yet is an answer, not a failure');
        $this->assertSame(0, CipDocument::where('person_id', $sponsor->id)->count());
    }

    public function test_a_dependant_who_ages_out_keeps_what_they_have_already_filed(): void
    {
        $application = $this->application();
        $child = $this->person($application, CipPerson::ROLE_DEPENDENT, [
            'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
            'date_of_birth' => now()->subYears(15)->subMonths(11),
        ]);

        $this->template('dependent_under_16', 'parental_consent', 'Parental consent', ['sort_order' => 1]);
        $this->template('dependent_under_16', 'school_letter', 'School letter', ['sort_order' => 2]);
        $this->template('dependent_16_over', 'student_enrolment', 'Proof of enrolment');

        Requirements::materialise($child);
        $consent = $this->fill(CipDocument::firstWhere('type', 'parental_consent'));

        // The date of birth was mistyped on the form: they are seventeen.
        $child->forceFill(['date_of_birth' => now()->subYears(17)])->save();

        $labels = $this->labels($child);

        $this->assertContains('Proof of enrolment', $labels, 'the bracket they are now in is asked for');
        $this->assertContains('Parental consent', $labels, 'and the one they answered is not thrown away');
        $this->assertNotContains('School letter', $labels, 'while the one they never answered goes');
        $this->assertFalse($consent->fresh()->required);
    }

    public function test_restoring_a_requirement_re_opens_the_slot_it_removed(): void
    {
        $application = $this->application();
        $person = $this->person($application, CipPerson::ROLE_MAIN_APPLICANT);
        $police = $this->template('principal_applicant', 'police_certificate', 'Police certificate');

        Requirements::materialise($person);
        Requirements::retire($police);
        $this->assertSame(0, CipDocument::count());

        Requirements::restore($police);

        $slot = CipDocument::firstWhere('type', 'police_certificate');
        $this->assertNotNull($slot, 'a template put back is asked for again');
        $this->assertTrue($slot->required);
    }

    public function test_a_submitted_application_keeps_the_checklist_it_was_filed_with(): void
    {
        $application = $this->application();
        $person = $this->person($application, CipPerson::ROLE_MAIN_APPLICANT);
        $this->template('principal_applicant', 'passport_bio_page', 'Passport bio page');

        Requirements::materialise($person);
        $application->forceFill(['locked_at' => now()])->save();

        $this->template('principal_applicant', 'police_certificate', 'Police certificate');

        $this->assertSame(
            ['Passport bio page'],
            $this->labels($person),
            'what was filed is what was filed — the Unit is holding a copy of it',
        );
    }
}
