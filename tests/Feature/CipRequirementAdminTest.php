<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentSlots;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * §11 — the firm keeps its own document standards.
 *
 * The point of the whole phase: asking an applicant for one more piece of
 * paper is an edit in the portal, not a deploy. So the tests that matter are
 * the ones about reach — does an edit arrive on a NEW application, and on one
 * already in flight — and about what an edit must never do, which is orphan a
 * document somebody has already sent.
 */
class CipRequirementAdminTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type, string $email): User
    {
        $u = User::create(['name' => 'Someone', 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $u;
    }

    private function application(User $staff, string $code = 'GAL'): CipApplication
    {
        $company = Company::create(['uid' => Str::lower($code), 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => $code, 'company_id' => $company->id]);

        return Applications::create($provider, $staff);
    }

    private function applicant(CipApplication $application): CipPerson
    {
        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        DocumentSlots::open($person);

        return $person;
    }

    public function test_a_new_requirement_reaches_an_application_already_in_flight(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');
        $person = $this->applicant($this->application($admin));

        $this->assertNotContains('Proof of marriage', $person->documents()->pluck('label')->all());

        $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Proof of marriage',
        ])->assertCreated();

        // The whole reason §11 is configurable: the firm changed their mind
        // after the application was filed, and the checklist caught up.
        $this->assertContains('Proof of marriage', $person->documents()->pluck('label')->all());
    }

    public function test_a_new_requirement_reaches_the_next_application_too(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');

        $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Proof of marriage',
        ])->assertCreated();

        $person = $this->applicant($this->application($admin, 'PRI'));

        $this->assertContains('Proof of marriage', $person->documents()->pluck('label')->all());
    }

    public function test_only_an_administrator_may_change_the_standards(): void
    {
        $officer = $this->user('Reviewing Officer', 'rita@example.com');

        // Reading is open — the checklist needs the labels to draw itself.
        $this->actingAs($officer)->getJson('/portal/cip/requirements')->assertOk();

        $this->actingAs($officer)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::SPONSOR,
            'label' => 'Anything at all',
        ])->assertForbidden();
    }

    public function test_the_key_cannot_be_changed_once_documents_are_filed_against_it(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');

        $created = $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Police certificate',
        ])->assertCreated()->json('requirement');

        $updated = $this->actingAs($admin)->patchJson('/portal/cip/requirements/'.$created['id'], [
            'label' => 'Police clearance certificate',
            'key' => 'something_else',
        ])->assertOk()->json('requirement');

        // The wording is the firm's to change; the identity every filed slot
        // is keyed on is not.
        $this->assertSame('Police clearance certificate', $updated['label']);
        $this->assertSame($created['key'], $updated['key']);
    }

    public function test_retiring_a_requirement_does_not_touch_a_document_already_sent(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');

        $created = $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Proof of address',
        ])->assertCreated()->json('requirement');

        $person = $this->applicant($this->application($admin));

        $slot = CipDocument::where('person_id', $person->id)->where('type', $created['key'])->firstOrFail();
        $file = FileItem::create([
            'uuid' => (string) Str::uuid(), 'name' => 'address.pdf', 'extension' => 'pdf',
            'mime_type' => 'application/pdf', 'size' => 10, 'disk' => 'local',
            'storage_path' => 'vault/address.pdf', 'owner_id' => $admin->id, 'uploaded_by' => $admin->id,
        ]);
        $slot->forceFill(['file_id' => $file->id])->save();

        $this->actingAs($admin)->deleteJson('/portal/cip/requirements/'.$created['id'])->assertOk();

        DocumentSlots::open($person->refresh());

        $this->assertNotNull(
            CipDocument::where('person_id', $person->id)->where('type', $created['key'])->first(),
            'a document somebody actually sent is never dropped by an edit to the template',
        );
    }

    public function test_bringing_a_retired_requirement_back_is_a_restore_not_a_duplicate(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');

        $created = $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Medical certificate',
        ])->assertCreated()->json('requirement');

        $this->actingAs($admin)->deleteJson('/portal/cip/requirements/'.$created['id'])->assertOk();

        $again = $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Medical certificate',
        ])->assertCreated()->json('requirement');

        $this->assertSame($created['key'], $again['key']);
        $this->assertSame(
            1,
            CipDocumentRequirement::withTrashed()
                ->where('applicant_type', ApplicantType::PRINCIPAL_APPLICANT)
                ->where('key', $created['key'])->count(),
            'one row, or every slot filed against the first one is orphaned beside the second',
        );
    }

    public function test_the_folder_a_requirement_names_survives_the_round_trip(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');

        $created = $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Second passport',
            'folder' => '  Passport  ',
        ])->assertCreated()->json('requirement');

        // Trimmed, and held: the name comes back exactly as the drawer will
        // be called.
        $this->assertSame('Passport', $created['folder']);

        $listed = collect($this->actingAs($admin)->getJson('/portal/cip/requirements')->json('types'))
            ->firstWhere('value', ApplicantType::PRINCIPAL_APPLICANT)['requirements'];
        $this->assertSame(
            'Passport',
            collect($listed)->firstWhere('key', $created['key'])['folder'],
            'the admin page reads the folder back from the index',
        );

        // Clearing it is answering with nothing — '' stores as null, and
        // uploads go back to the person's own folder.
        $updated = $this->actingAs($admin)->patchJson('/portal/cip/requirements/'.$created['id'], [
            'folder' => '',
        ])->assertOk()->json('requirement');

        $this->assertNull($updated['folder']);
    }

    public function test_the_description_is_written_and_can_be_rewritten(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');

        $created = $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Name change document',
            'help' => '  If applicable. Soft copy only.  ',
        ])->assertCreated()->json('requirement');

        $this->assertSame('If applicable. Soft copy only.', $created['help']);

        $updated = $this->actingAs($admin)->patchJson('/portal/cip/requirements/'.$created['id'], [
            'help' => 'Certified copy. Translate if not in English.',
        ])->assertOk()->json('requirement');

        $this->assertSame('Certified copy. Translate if not in English.', $updated['help']);

        $cleared = $this->actingAs($admin)->patchJson('/portal/cip/requirements/'.$created['id'], [
            'help' => '   ',
        ])->assertOk()->json('requirement');

        $this->assertNull($cleared['help']);
    }

    public function test_re_adding_without_a_description_keeps_the_one_already_there(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');

        $created = $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Name change document',
            'help' => 'If applicable. Soft copy only.',
        ])->assertCreated()->json('requirement');

        $this->actingAs($admin)->deleteJson('/portal/cip/requirements/'.$created['id'])->assertOk();

        $again = $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Name change document',
        ])->assertCreated()->json('requirement');

        $this->assertSame('If applicable. Soft copy only.', $again['help']);
    }

    /**
     * Opening an application settles its checklist against today's templates.
     *
     * A template can arrive without the admin endpoints ever firing — a
     * seeder, an import — and until the detail read materialised, an
     * application created while the templates were three showed three for
     * ever. The read that opens ONE file is where the checklist catches up;
     * the fifty-row sync and listing pages deliberately do not, because a
     * write on those reads would report every application on the page as
     * moved to the sync cursor.
     */
    public function test_opening_an_application_catches_its_checklist_up(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');
        $application = $this->application($admin);
        $person = $this->applicant($application);

        // Straight to the table, so nothing has reached the open applications
        // on this template's behalf.
        (new CipDocumentRequirement)->forceFill([
            'uuid' => (string) Str::uuid(),
            'applicant_type' => ApplicantType::PRINCIPAL_APPLICANT,
            'key' => 'bank_reference_letter',
            'label' => 'Bank reference letter',
            'required' => true,
            'sort_order' => 99,
            'active' => true,
        ])->save();

        $this->assertNotContains('Bank reference letter', $person->documents()->pluck('label')->all());

        $shown = $this->actingAs($admin)->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()->json('application');

        // One read, and the answer that read returns is already caught up —
        // not the stale checklist with a promise about next time.
        $this->assertContains(
            'Bank reference letter',
            collect($shown['applicant']['documents'])->pluck('label')->all(),
        );
        $this->assertContains('Bank reference letter', $person->documents()->pluck('label')->all());
    }

    public function test_the_client_profile_read_catches_the_checklist_up_too(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');
        $application = $this->application($admin);
        $person = $this->applicant($application);

        $client = Client::create([
            'uid' => 'chen-wei', 'name' => 'Chen Wei', 'data' => [], 'created_by' => $admin->id,
        ]);
        $application->forceFill(['client_id' => $client->id])->save();

        // Straight to the table, past reachOpenApplications — the same
        // arrangement the show() test makes, because the client-profile read
        // is the OTHER door a stale checklist is seen through, and a fix that
        // covered one door left the tabs the user actually reported showing
        // three documents.
        (new CipDocumentRequirement)->forceFill([
            'uuid' => (string) Str::uuid(),
            'applicant_type' => ApplicantType::PRINCIPAL_APPLICANT,
            'key' => 'bank_reference_letter',
            'label' => 'Bank reference letter',
            'required' => true,
            'sort_order' => 99,
            'active' => true,
        ])->save();

        $this->assertNotContains('Bank reference letter', $person->documents()->pluck('label')->all());

        $shown = $this->actingAs($admin)->getJson('/portal/cip/clients/chen-wei/application')
            ->assertOk()->json('application');

        $this->assertContains(
            'Bank reference letter',
            collect($shown['applicant']['documents'])->pluck('label')->all(),
        );
    }

    public function test_the_intake_form_asks_for_whatever_the_templates_ask(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');

        $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Bank reference letter',
        ])->assertCreated();

        $labels = collect($this->actingAs($admin)->getJson('/portal/cip/applications/form')
            ->assertOk()->json('requirements.principal'))
            ->pluck('label')->all();

        $this->assertContains('Bank reference letter', $labels);
    }

    public function test_ticking_a_requirement_is_what_makes_it_required(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');

        $created = $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Proof of funds',
            'required' => true,
        ])->assertCreated()->json('requirement');

        $this->assertTrue($created['required']);

        $optional = $this->actingAs($admin)->patchJson('/portal/cip/requirements/'.$created['id'], [
            'required' => false,
        ])->assertOk()->json('requirement');

        $this->assertFalse($optional['required'], 'unticked means optional');

        $required = $this->actingAs($admin)->patchJson('/portal/cip/requirements/'.$created['id'], [
            'required' => true,
        ])->assertOk()->json('requirement');

        $this->assertTrue($required['required'], 'ticked means required');
    }

    public function test_a_required_principal_requirement_gates_filing_and_the_form(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');

        $requirement = $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::PRINCIPAL_APPLICANT,
            'label' => 'Proof of funds',
            'required' => true,
        ])->assertCreated()->json('requirement');

        $field = collect($this->actingAs($admin)->getJson('/portal/cip/applications/form')
            ->assertOk()->json('requirements.principal'))
            ->firstWhere('label', 'Proof of funds');

        $this->assertTrue($field['required']);
        $this->assertTrue($field['atFiling']);

        $optional = $this->actingAs($admin)->patchJson('/portal/cip/requirements/'.$requirement['id'], [
            'required' => false,
        ])->assertOk()->json('requirement');

        $field = collect($this->actingAs($admin)->getJson('/portal/cip/applications/form')
            ->assertOk()->json('requirements.principal'))
            ->firstWhere('label', 'Proof of funds');

        $this->assertFalse($optional['required']);
        $this->assertFalse($field['atFiling']);
    }

    public function test_the_order_the_checklist_reads_in_is_the_firms(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');

        $a = $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::SPONSOR, 'label' => 'Aaa first',
        ])->json('requirement');
        $b = $this->actingAs($admin)->postJson('/portal/cip/requirements', [
            'applicantType' => ApplicantType::SPONSOR, 'label' => 'Bbb second',
        ])->json('requirement');

        $this->actingAs($admin)->postJson('/portal/cip/requirements/reorder', [
            'applicantType' => ApplicantType::SPONSOR,
            'order' => [$b['id'], $a['id']],
        ])->assertOk();

        $sponsor = collect($this->actingAs($admin)->getJson('/portal/cip/requirements')->json('types'))
            ->firstWhere('value', ApplicantType::SPONSOR);

        $labels = collect($sponsor['requirements'])->pluck('label')->all();
        $this->assertLessThan(
            array_search('Aaa first', $labels, true),
            array_search('Bbb second', $labels, true),
        );
    }

    public function test_every_applicant_type_is_offered_even_with_nothing_in_it(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');

        $types = collect($this->actingAs($admin)->getJson('/portal/cip/requirements')->json('types'))
            ->pluck('value')->all();

        // The type with no requirements is the one that most needs somewhere
        // to add the first.
        $this->assertSame(ApplicantType::ALL, $types);
    }
}
