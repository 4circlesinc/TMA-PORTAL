<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\Phase;
use App\Support\Cip\PostApproval;
use App\Support\Cip\Requirements;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class CipPostApprovalTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        CipDocumentRequirement::query()->forceDelete();
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
        $company = Company::create([
            'uid' => strtolower($code).'-firm',
            'name' => $code.' Provider',
        ]);

        return CipProvider::create([
            'name' => $code.' Provider',
            'code' => $code,
            'company_id' => $company->id,
        ]);
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
}
