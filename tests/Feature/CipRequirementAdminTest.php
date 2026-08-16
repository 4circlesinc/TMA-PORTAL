<?php

namespace Tests\Feature;

use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipPerson;
use App\Models\CipProvider;
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

    private function application(User $staff, string $code = 'GAL'): \App\Models\CipApplication
    {
        $company = Company::create(['uid' => Str::lower($code), 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => $code, 'company_id' => $company->id]);

        return Applications::create($provider, $staff);
    }

    private function applicant(\App\Models\CipApplication $application): CipPerson
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
