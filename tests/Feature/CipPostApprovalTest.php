<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\CorRequirements;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Phase;
use App\Support\Cip\PostApproval;
use App\Support\Cip\Requirements;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use Database\Seeders\CipDocumentRequirementSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class CipPostApprovalTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        CipDocumentRequirement::query()->forceDelete();
        Requirements::flush();
    }

    private function staff(string $type = Role::ADMINISTRATOR): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function provider(string $code = 'GAL'): CipProvider
    {
        $company = Company::query()->firstOrCreate(
            ['uid' => strtolower($code).'-firm'],
            ['name' => $code.' Provider'],
        );

        return CipProvider::query()->firstOrCreate(
            ['code' => $code],
            ['name' => $code.' Provider', 'company_id' => $company->id],
        );
    }

    private function template(string $key, string $label, array $extra = []): CipDocumentRequirement
    {
        $template = new CipDocumentRequirement;
        $template->forceFill(array_merge([
            'applicant_type' => ApplicantType::PRINCIPAL_APPLICANT,
            'key' => $key,
            'label' => $label,
            'required' => true,
            'active' => true,
            'sort_order' => 1,
            'at_pre_approval' => true,
            'at_post_approval' => false,
            'carry_forward' => false,
        ], $extra))->save();

        return $template;
    }

    private function application(User $creator): CipApplication
    {
        return Applications::create($this->provider(), $creator);
    }

    private function mainApplicant(CipApplication $application): CipPerson
    {
        return CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Asem',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(40),
        ]);
    }

    public function test_post_approval_prepare_provisions_folder_tree(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $this->mainApplicant($application);

        $application->forceFill([
            'phase' => Phase::POST_APPROVAL,
            'post_approval_at' => now(),
        ])->save();

        PostApproval::prepare($application->fresh(['people']), $staff);

        $application->refresh();
        $this->assertNotNull($application->post_approval_folder_id);

        $postRoot = Folder::find($application->post_approval_folder_id);
        $this->assertSame(Tree::POST_APPROVAL, $postRoot->name);

        $personFolder = Folder::query()
            ->where('parent_id', $postRoot->id)
            ->where('name', 'Main Applicant')
            ->first();
        $this->assertNotNull($personFolder);
    }

    public function test_for_phase_filters_requirements(): void
    {
        $this->template('pre_only', 'Pre only', ['at_pre_approval' => true, 'at_post_approval' => false]);
        $this->template('post_only', 'Post only', ['at_pre_approval' => false, 'at_post_approval' => true]);
        $this->template('carried', 'Carried doc', [
            'at_pre_approval' => true,
            'at_post_approval' => false,
            'carry_forward' => true,
        ]);

        $pre = Requirements::forPhase(ApplicantType::PRINCIPAL_APPLICANT, Phase::PRE_APPROVAL)->pluck('key')->all();
        $post = Requirements::forPhase(ApplicantType::PRINCIPAL_APPLICANT, Phase::POST_APPROVAL)->pluck('key')->all();

        $this->assertSame(['pre_only', 'carried'], $pre);
        $this->assertSame(['post_only', 'carried'], $post);
    }

    public function test_enter_post_approval_keeps_carried_forward_file_reference(): void
    {
        $staff = $this->staff(Role::ADMINISTRATOR);
        $application = $this->application($staff);
        $person = $this->mainApplicant($application);

        $pre = $this->template('passport_bio_page', 'Passport bio page', ['carry_forward' => true]);
        $this->template('investment_proof', 'Investment proof', [
            'key' => 'investment_proof',
            'at_pre_approval' => false,
            'at_post_approval' => true,
        ]);

        Tree::provision($application->fresh(['people']), $staff);
        Requirements::materialise($person->fresh(['application']));

        $upload = UploadedFile::fake()->create('bio.pdf', 100, 'application/pdf');
        $slot = DocumentSlots::fill($person->fresh(['application', 'documents']), 'passport_bio_page', $upload, $staff);
        $fileId = $slot->file_id;

        $application->forceFill([
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => now(),
        ])->save();

        PostApproval::enter($application->fresh(['people']), $staff);

        $application->refresh();
        $this->assertSame(Phase::POST_APPROVAL, $application->phase);
        $this->assertNotNull($application->post_approval_folder_id);

        $carried = CipDocument::query()
            ->where('person_id', $person->id)
            ->where('type', 'passport_bio_page')
            ->first();
        $this->assertSame($fileId, $carried->file_id);

        $this->assertTrue(
            CipDocument::query()
                ->where('person_id', $person->id)
                ->where('type', 'investment_proof')
                ->exists()
        );
    }

    public function test_post_only_upload_lands_in_post_approval_person_folder(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $this->mainApplicant($application);

        $this->template('investment_proof', 'Investment proof', [
            'at_pre_approval' => false,
            'at_post_approval' => true,
        ]);

        $application->forceFill([
            'phase' => Phase::POST_APPROVAL,
            'post_approval_at' => now(),
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
        ])->save();

        PostApproval::prepare($application->fresh(['people']), $staff);

        $postPersonFolder = Tree::postApprovalPersonFolder($person->fresh(['application']), null, $staff);

        $upload = UploadedFile::fake()->create('proof.pdf', 100, 'application/pdf');
        $slot = DocumentSlots::fill($person->fresh(['application']), 'investment_proof', $upload, $staff);

        $this->assertSame($postPersonFolder->id, $slot->file->folder_id);
    }

    public function test_enter_post_approval_endpoint_requires_grant(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $this->mainApplicant($application);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/post-approval')
            ->assertStatus(422);
    }

    public function test_enter_post_approval_endpoint_moves_a_granted_application(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $this->mainApplicant($application);

        $application->forceFill([
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => now(),
        ])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/post-approval')
            ->assertOk()
            ->assertJsonPath('application.phase', Phase::POST_APPROVAL)
            ->assertJsonPath('application.status', Status::POST_APPROVAL)
            ->assertJsonPath('application.statusLabel', 'Post-Approval');

        $this->assertSame(Phase::POST_APPROVAL, $application->fresh()->phase);
        $this->assertSame(Status::POST_APPROVAL, $application->fresh()->status);
        $this->assertNotNull($application->fresh()->post_approval_folder_id);
    }

    public function test_admin_can_update_requirement_workflow_flags(): void
    {
        $admin = $this->staff(Role::ADMINISTRATOR);
        $requirement = $this->template('police_cert', 'Police certificate');

        $this->actingAs($admin)
            ->patchJson('/portal/cip/requirements/'.$requirement->uuid, [
                'atPreApproval' => false,
                'atPostApproval' => true,
                'carryForward' => false,
            ])
            ->assertOk()
            ->assertJsonPath('requirement.atPreApproval', false)
            ->assertJsonPath('requirement.atPostApproval', true);
    }

    public function test_form_endpoint_filters_requirements_by_phase(): void
    {
        $staff = $this->staff();
        $this->template('pre_only', 'Pre only');
        $this->template('post_only', 'Post only', [
            'key' => 'post_only',
            'at_pre_approval' => false,
            'at_post_approval' => true,
        ]);

        $pre = $this->actingAs($staff)->getJson('/portal/cip/applications/form')->assertOk()->json('requirements.principal');
        $post = $this->actingAs($staff)->getJson('/portal/cip/applications/form?phase=post_approval')->assertOk()->json('requirements.principal');

        $this->assertSame(['Pre only'], collect($pre)->pluck('label')->all());
        $this->assertSame(['Post only'], collect($post)->pluck('label')->all());
    }

    public function test_enter_post_approval_sends_the_cor_notice(): void
    {
        Mail::fake();
        $this->seedCor();

        $staff = $this->staff();
        $application = $this->granted($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/post-approval')
            ->assertOk();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($application) {
            $haystack = strtolower(json_encode($mail->payload) ?: '');

            return str_contains((string) $mail->subjectLine, 'POST APPROVAL')
                && str_contains((string) $mail->subjectLine, $application->displayNumber())
                && str_contains($haystack, 'certificate of registration');
        });

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_POST_APPROVAL_ENTERED,
            'actor_id' => $staff->id,
        ]);
    }

    public function test_a_reviewing_officer_can_enter_post_approval(): void
    {
        $this->seedCor();
        $admin = $this->staff();
        $officer = $this->staff(Role::REVIEWING_OFFICER);
        $application = $this->granted($admin);
        Assignments::assign($application->fresh(), $officer, $admin);

        $this->actingAs($officer)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/post-approval')
            ->assertOk()
            ->assertJsonPath('application.status', Status::POST_APPROVAL);
    }

    public function test_a_service_provider_cannot_enter_post_approval(): void
    {
        $admin = $this->staff();
        $application = $this->granted($admin);
        $contact = $this->staff(Role::CLIENT);

        CompanyMember::create([
            'company_id' => $application->provider->company_id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/post-approval')
            ->assertStatus(403);

        $this->assertSame(Status::GRANTED, $application->fresh()->status);
        $this->assertSame(Phase::PRE_APPROVAL, $application->fresh()->phase);
    }

    public function test_a_denied_application_cannot_enter_post_approval(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $this->mainApplicant($application);
        $application->forceFill([
            'status' => Status::DENIED,
            'decision' => CipApplication::DECISION_DENIED,
            'decided_at' => now(),
        ])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/post-approval')
            ->assertStatus(422);
    }

    public function test_cor_checklist_follows_age_investment_type_and_settings(): void
    {
        $this->seedCor();

        $staff = $this->staff();
        $realEstate = $this->granted($staff, [
            'investment_type' => InvestmentType::REAL_ESTATE,
        ]);
        $this->family($realEstate);
        $realEstate = $realEstate->fresh(['people']);

        PostApproval::enter($realEstate, $staff);

        $realEstate = $realEstate->fresh(['people.documents.requirement']);
        $people = $realEstate->people;
        $people->each(fn (CipPerson $person) => $person->setRelation('application', $realEstate));

        $main = $people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $child = $people->first(fn (CipPerson $person) => ApplicantType::for($person) === ApplicantType::DEPENDENT_UNDER_16);
        $adultDep = $people->first(fn (CipPerson $person) => ApplicantType::for($person) === ApplicantType::DEPENDENT_16_OVER);

        $this->assertNotNull($child);
        $this->assertNotNull($adultDep);

        $mainKeys = $main->documents()->pluck('type')->all();
        $this->assertContains(CorRequirements::OATH_OF_ALLEGIANCE, $mainKeys);
        $this->assertContains(CorRequirements::PROOF_OF_PAYMENT, $mainKeys);
        $this->assertContains(DocumentTypes::PASSPORT_PHOTO, $mainKeys);
        $this->assertContains(CorRequirements::LETTER_OF_CONFIRMATION, $mainKeys);
        $this->assertContains(CorRequirements::SALES_PURCHASE_AGREEMENT, $mainKeys);
        $this->assertContains(CorRequirements::ESCROW_AGREEMENT, $mainKeys);

        $this->assertFalse($main->documents()->where('type', CorRequirements::LETTER_OF_CONFIRMATION)->value('required'));
        $this->assertTrue($main->documents()->where('type', CorRequirements::OATH_OF_ALLEGIANCE)->value('required'));

        $childKeys = $child->documents()->pluck('type')->all();
        $this->assertNotContains(CorRequirements::OATH_OF_ALLEGIANCE, $childKeys);
        $this->assertContains(DocumentTypes::PASSPORT_PHOTO, $childKeys);

        $adultKeys = $adultDep->documents()->pluck('type')->all();
        $this->assertContains(CorRequirements::OATH_OF_ALLEGIANCE, $adultKeys);

        $oath = $main->documents()->where('type', CorRequirements::OATH_OF_ALLEGIANCE)->first();
        $this->assertSame(CorRequirements::FOLDER, $oath->requirement->folder);

        $donation = $this->granted($staff, [
            'investment_type' => InvestmentType::NATIONAL_ECONOMIC_FUND,
        ]);
        PostApproval::enter($donation->fresh(['people']), $staff);
        $donationMain = $donation->fresh('people')->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $donationKeys = $donationMain->documents()->pluck('type')->all();
        $this->assertNotContains(CorRequirements::LETTER_OF_CONFIRMATION, $donationKeys);
        $this->assertContains(CorRequirements::OATH_OF_ALLEGIANCE, $donationKeys);
        $this->assertContains(CorRequirements::PROOF_OF_PAYMENT, $donationKeys);
    }

    public function test_settings_real_estate_only_flag_is_stored(): void
    {
        $admin = $this->staff(Role::ADMINISTRATOR);
        $requirement = $this->template('letter_of_confirmation', 'Letter of Confirmation', [
            'at_pre_approval' => false,
            'at_post_approval' => true,
        ]);

        $this->actingAs($admin)
            ->patchJson('/portal/cip/requirements/'.$requirement->uuid, [
                'realEstateOnly' => true,
            ])
            ->assertOk()
            ->assertJsonPath('requirement.realEstateOnly', true);
    }

    private function seedCor(): void
    {
        (new CipDocumentRequirementSeeder)->syncPostApproval();
    }

    private function granted(User $staff, array $extra = []): CipApplication
    {
        $application = $this->application($staff);
        $this->mainApplicant($application);
        $application->forceFill(array_merge([
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => now(),
        ], $extra))->save();

        return $application->fresh(['people']);
    }

    private function family(CipApplication $application): void
    {
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'relationship' => 'spouse',
            'first_name' => 'Amira',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(38),
        ]);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'relationship' => 'child',
            'first_name' => 'Noor',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(10),
        ]);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'relationship' => 'child',
            'first_name' => 'Yusef',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(18),
        ]);
    }
}
