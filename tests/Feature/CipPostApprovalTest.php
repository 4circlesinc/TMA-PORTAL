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
use App\Models\FileVersion;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\Confirmation;
use App\Support\Cip\CorRequirements;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Engine;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Package;
use App\Support\Cip\Phase;
use App\Support\Cip\PostApproval;
use App\Support\Cip\Requirements;
use App\Support\Cip\Review;
use App\Support\Cip\Stages;
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

    public function test_a_cor_document_walks_the_four_review_statuses(): void
    {
        $staff = $this->staff();
        [$application, $person, $oath] = $this->corFile($staff);

        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $oath->status);
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $oath->displayStatus());

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$oath->uuid.'/approve')
            ->assertStatus(422);

        DocumentSlots::fill(
            $person,
            CorRequirements::OATH_OF_ALLEGIANCE,
            UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf'),
            $staff,
        );
        $oath->refresh();
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $oath->status);

        $row = collect(
            $this->actingAs($staff)
                ->getJson('/portal/cip/applications/'.$application->uuid)
                ->assertOk()
                ->json('application.applicant.documents')
        )->firstWhere('type', CorRequirements::OATH_OF_ALLEGIANCE);

        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $row['status']);
        $this->assertSame('Application review', $row['statusLabel']);
        $this->assertSame('pending', $row['statusTone']);

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$oath->uuid.'/approve')
            ->assertOk()
            ->assertJsonPath('document.status', DocumentStatus::READY_FOR_SUBMISSION)
            ->assertJsonPath('document.statusLabel', 'Ready for submission');

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$oath->uuid.'/request-changes', [
                'comment' => 'The notary stamp is not legible.',
            ])
            ->assertOk()
            ->assertJsonPath('document.status', DocumentStatus::UPDATE_REQUIRED)
            ->assertJsonPath('document.statusLabel', 'Update required');

        $fileId = $oath->fresh()->file_id;
        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            CorRequirements::OATH_OF_ALLEGIANCE,
            UploadedFile::fake()->create('oath-v2.pdf', 42, 'application/pdf'),
            $staff,
        );

        $oath->refresh();
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $oath->status);
        $this->assertSame($fileId, $oath->file_id);
        $this->assertSame(2, FileVersion::query()->where('file_id', $fileId)->count());

        $contact = $this->contactOn($application, $staff);
        $this->actingAs($contact)
            ->postJson('/portal/cip/documents/'.$oath->uuid.'/approve')
            ->assertForbidden();
    }

    public function test_cor_uploads_are_allowed_after_the_original_package_is_locked(): void
    {
        $staff = $this->staff();
        $this->template('passport_bio_page', 'Passport bio page');
        $application = $this->granted($staff);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        Tree::provision($application->fresh(['people']), $staff);
        Requirements::materialise($person->fresh(['application']));

        $original = DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            'passport_bio_page',
            UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf'),
            $staff,
        );
        $original->forceFill(['status' => DocumentStatus::READY_FOR_SUBMISSION])->save();
        $application->forceFill(['locked_at' => now()])->save();

        $this->seedCor();
        Requirements::flush();
        PostApproval::enter($application->fresh(['people']), $staff);

        $person = $person->fresh(['application', 'documents']);
        $oath = $person->documents()->where('type', CorRequirements::OATH_OF_ALLEGIANCE)->first();
        $this->assertNotNull($oath);
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $oath->status);

        $filed = DocumentSlots::fill(
            $person,
            CorRequirements::OATH_OF_ALLEGIANCE,
            UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf'),
            $staff,
        );
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $filed->status);
        $this->assertNotNull($filed->file_id);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage(Confirmation::LOCKED_MESSAGE);
        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            'passport_bio_page',
            UploadedFile::fake()->create('bio-again.pdf', 40, 'application/pdf'),
            $staff,
        );
    }

    public function test_reviewers_and_providers_can_comment_on_cor_documents(): void
    {
        $staff = $this->staff();
        [, $person, $oath] = $this->corFile($staff);
        $contact = $this->contactOn($oath->application, $staff);

        DocumentSlots::fill(
            $person,
            CorRequirements::OATH_OF_ALLEGIANCE,
            UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf'),
            $staff,
        );

        $first = $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$oath->uuid.'/comments', [
                'body' => 'The notary name is not legible.',
            ])
            ->assertCreated()
            ->json();

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$oath->uuid.'/comments', [
                'body' => 'Also check the oath date against the grant letter.',
            ])
            ->assertCreated();

        $this->actingAs($contact)
            ->postJson('/portal/cip/documents/'.$oath->uuid.'/comments', [
                'body' => 'Re-stamped copy is coming.',
                'parent' => $first['id'],
            ])
            ->assertCreated();

        $thread = $this->actingAs($contact)
            ->getJson('/portal/cip/documents/'.$oath->uuid.'/comments')
            ->assertOk()
            ->json('comments');

        $this->assertCount(2, $thread);
        $this->assertCount(1, $thread[0]['replies']);
        $this->assertSame('Re-stamped copy is coming.', $thread[0]['replies'][0]['body']);

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$oath->uuid.'/request-changes', [
                'comment' => 'Please replace the scan.',
            ])
            ->assertOk();

        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            CorRequirements::OATH_OF_ALLEGIANCE,
            UploadedFile::fake()->create('oath-v2.pdf', 44, 'application/pdf'),
            $staff,
        );

        $after = $this->actingAs($contact)
            ->getJson('/portal/cip/documents/'.$oath->uuid.'/comments')
            ->assertOk()
            ->json('comments');

        $this->assertCount(3, $after, 'the conversation lives on the slot, not the replaced scan');
        $this->assertSame($first['id'], $after[0]['id']);

        $stranger = $this->staff(Role::CLIENT);
        $this->actingAs($stranger)
            ->getJson('/portal/cip/documents/'.$oath->uuid.'/comments')
            ->assertNotFound();
        $this->actingAs($stranger)
            ->postJson('/portal/cip/documents/'.$oath->uuid.'/comments', ['body' => 'hello'])
            ->assertNotFound();
    }

    public function test_refusing_a_cor_document_moves_the_file_to_updates_required(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $person, $oath] = $this->corFile($staff);

        DocumentSlots::fill(
            $person,
            CorRequirements::OATH_OF_ALLEGIANCE,
            UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf'),
            $staff,
        );

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$oath->uuid.'/request-changes', [
                'comment' => 'The notary stamp is not legible.',
            ])
            ->assertOk();

        $fresh = $application->fresh();
        $this->assertSame(Status::UPDATE_REQUIRED, $fresh->status);
        $this->assertSame(Phase::POST_APPROVAL, $fresh->phase);
        $this->assertSame(CipApplication::DECISION_GRANTED, $fresh->decision);

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($application) {
            return str_contains((string) $mail->subjectLine, 'UPDATE REQUIRED')
                && str_contains((string) $mail->subjectLine, $application->displayNumber());
        });
    }

    public function test_approving_every_cor_document_moves_the_file_to_apply_for_cor(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application] = $this->corFile($staff);

        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);

        $fresh = $application->fresh();
        $this->assertSame(Status::APPLY_FOR_COR, $fresh->status);
        $this->assertSame(Phase::POST_APPROVAL, $fresh->phase);
        $this->assertSame(CipApplication::DECISION_GRANTED, $fresh->decision);
        $this->assertSame('Apply for COR', Status::label($fresh->status));

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($application) {
            $haystack = strtolower(json_encode($mail->payload) ?: '');

            return str_contains((string) $mail->subjectLine, 'APPLY FOR COR')
                && str_contains((string) $mail->subjectLine, $application->displayNumber())
                && str_contains($haystack, 'confirm submission');
        });
    }

    public function test_leftover_pre_approval_slots_do_not_block_apply_for_cor(): void
    {
        $staff = $this->staff();
        $this->template('police_certificate', 'Police certificate');
        $application = $this->application($staff);
        $person = $this->mainApplicant($application);
        Tree::provision($application->fresh(['people']), $staff);
        Requirements::materialise($person->fresh(['application']));

        $police = $person->documents()->where('type', 'police_certificate')->first();
        $this->assertNotNull($police);
        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            'police_certificate',
            UploadedFile::fake()->create('police.pdf', 40, 'application/pdf'),
            $staff,
        );
        $police->refresh()->forceFill(['status' => DocumentStatus::UPDATE_REQUIRED])->save();

        $application->forceFill([
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => now(),
        ])->save();

        $this->seedCor();
        Requirements::flush();
        PostApproval::enter($application->fresh(['people']), $staff);

        $this->fileRequiredCor($application->fresh(['people']), $staff);
        $this->approveRequiredCor($application, $staff);

        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);
        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $police->fresh()->status);
    }

    public function test_returning_to_post_approval_does_not_resend_the_cor_notice(): void
    {
        $staff = $this->staff();
        [$application, $person, $oath] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);

        Mail::fake();

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$oath->uuid.'/request-changes', [
                'comment' => 'Re-stamp the oath.',
            ])
            ->assertOk();

        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);

        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            CorRequirements::OATH_OF_ALLEGIANCE,
            UploadedFile::fake()->create('oath-v3.pdf', 40, 'application/pdf'),
            $staff,
        );

        $this->assertSame(Status::POST_APPROVAL, $application->fresh()->status);

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return str_contains((string) $mail->subjectLine, 'UPDATE REQUIRED');
        });
        Mail::assertNotQueued(Postcard::class, function (Postcard $mail) {
            return str_contains((string) $mail->subjectLine, 'POST APPROVAL');
        });
    }

    public function test_the_service_provider_confirms_the_cor_package(): void
    {
        $staff = $this->staff();
        [$application] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        $contact = $this->contactOn($application, $staff);

        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->assertJsonPath('application.status', Status::APPLY_FOR_COR)
            ->assertJsonPath('application.canConfirm', false)
            ->assertJsonPath('application.corLocked', false);

        $body = $this->actingAs($contact)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertTrue($body['canConfirm']);
        $this->assertFalse($body['corLocked']);
        $this->assertFalse($body['locked']);

        $confirmed = $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::APPLY_FOR_COR, $confirmed['status']);
        $this->assertTrue($confirmed['corLocked']);
        $this->assertFalse($confirmed['canConfirm']);
        $this->assertNotNull($application->fresh()->cor_locked_at);
        $this->assertNull($application->fresh()->locked_at);

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_COR_PACKAGE_CONFIRMED,
            'actor_id' => $contact->id,
        ]);
    }

    public function test_a_confirmed_cor_package_refuses_replacement_and_leaves_additional_documents_open(): void
    {
        $staff = $this->staff();
        [$application, $person] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        $contact = $this->contactOn($application, $staff);

        Confirmation::confirm($application->fresh(), $contact);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage(Confirmation::COR_LOCKED_MESSAGE);
        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            CorRequirements::OATH_OF_ALLEGIANCE,
            UploadedFile::fake()->create('oath-again.pdf', 40, 'application/pdf'),
            $staff,
        );
    }

    public function test_additional_documents_stay_writable_after_the_cor_package_is_confirmed(): void
    {
        $staff = $this->staff();
        [$application] = $this->corFile($staff);
        Tree::provision($application->fresh(['people']), $staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        Confirmation::confirm($application->fresh(), $this->contactOn($application, $staff));

        $root = Folder::findOrFail($application->fresh()->folder_id);
        $additional = Folder::query()
            ->where('parent_id', $root->id)
            ->where('name', Tree::ADDITIONAL)
            ->first();
        $post = Folder::find($application->fresh()->post_approval_folder_id);

        $this->assertNotNull($additional);
        $this->assertNotNull($post);
        $this->assertFalse(Package::locksFolder($additional));
        $this->assertTrue(Package::locksFolder($post));
    }

    public function test_recording_the_cor_submission_moves_to_pending_cor(): void
    {
        Mail::fake();

        $staff = $this->staff();
        [$application] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        Confirmation::confirm($application->fresh(), $this->contactOn($application, $staff));

        $ready = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertSame(Stages::COR_SUBMITTED, $ready['stageAction']['key']);
        $this->assertSame('Record COR submission', $ready['stageAction']['label']);

        $recorded = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::COR_SUBMITTED,
                'date' => '2026-08-20',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::PENDING_COR, $recorded['status']);
        $this->assertSame('Pending COR', $recorded['statusLabel']);
        $this->assertSame('slate', $recorded['statusTone']);
        $this->assertSame('2026-08-20', $recorded['corSubmittedAt']);
        $this->assertSame(Stages::COR_RECEIVED, $recorded['stageAction']['key']);
        $this->assertSame(CipApplication::DECISION_GRANTED, $application->fresh()->decision);
        $this->assertSame(Phase::POST_APPROVAL, $application->fresh()->phase);

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_COR_SUBMITTED,
            'actor_id' => $staff->id,
        ]);

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return str_contains((string) $mail->subjectLine, 'PENDING COR');
        });
    }

    public function test_the_cor_submission_cannot_be_recorded_before_confirm(): void
    {
        $staff = $this->staff();
        [$application] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);

        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->assertJsonPath('application.stageAction', null);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::COR_SUBMITTED,
                'date' => '2026-08-20',
            ])
            ->assertStatus(422)
            ->assertJsonPath('message', 'The service provider must confirm submission before the COR package can be sent.');

        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);
        $this->assertNull($application->fresh()->cor_submitted_at);
    }

    public function test_a_provider_cannot_record_a_post_approval_date(): void
    {
        $staff = $this->staff();
        [$application] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        $contact = $this->contactOn($application, $staff);
        Confirmation::confirm($application->fresh(), $contact);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::COR_SUBMITTED,
                'date' => '2026-08-20',
            ])
            ->assertForbidden();

        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);
    }

    public function test_a_bare_status_change_cannot_skip_the_cor_submission_date(): void
    {
        $staff = $this->staff();
        [$application] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        Confirmation::confirm($application->fresh(), $this->contactOn($application, $staff));

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::PENDING_COR,
            ])
            ->assertStatus(422);

        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);
        $this->assertNull($application->fresh()->cor_submitted_at);
    }

    public function test_the_remaining_post_approval_dates_walk_the_file_to_closed(): void
    {
        $staff = $this->staff();
        [$application] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        Confirmation::confirm($application->fresh(), $this->contactOn($application, $staff));

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::COR_SUBMITTED,
                'date' => '2026-08-20',
            ])
            ->assertOk();

        $hops = [
            [Stages::COR_RECEIVED, Status::APPLY_FOR_NIC, 'APPLY FOR NIC', 'corReceivedAt'],
            [Stages::NIC_SUBMITTED, Status::PENDING_NIC, 'PENDING NIC', 'nicSubmittedAt'],
            [Stages::NIC_RECEIVED, Status::APPLY_FOR_PASSPORT, 'APPLY FOR PASSPORT', 'nicReceivedAt'],
            [Stages::PASSPORT_SUBMITTED, Status::PENDING_PASSPORT, 'PENDING PASSPORT', 'passportSubmittedAt'],
            [Stages::PASSPORT_RECEIVED, Status::READY_FOR_DELIVERY, 'READY FOR DELIVERY', 'passportReceivedAt'],
            [Stages::PASSPORT_DELIVERED, Status::CLOSED, 'FILE CLOSED', 'passportDeliveredAt'],
        ];

        foreach ($hops as [$stage, $status, $subject, $dateKey]) {
            Mail::fake();

            $body = $this->actingAs($staff)
                ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                    'stage' => $stage,
                    'date' => '2026-08-21',
                ])
                ->assertOk()
                ->json('application');

            $this->assertSame($status, $body['status'], $stage.' did not land on '.$status);
            $this->assertSame('2026-08-21', $body[$dateKey]);
            $this->assertSame(CipApplication::DECISION_GRANTED, $application->fresh()->decision);

            Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($subject) {
                return str_contains((string) $mail->subjectLine, $subject);
            });
        }

        $closed = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::CLOSED, $closed['status']);
        $this->assertSame('Closed', $closed['statusLabel']);
        $this->assertNull($closed['stageAction']);
        $this->assertSame(Phase::POST_APPROVAL, $application->fresh()->phase);
    }

    public function test_post_approval_milestones_sit_after_the_decision(): void
    {
        $staff = $this->staff();
        [$application] = $this->corFile($staff);

        $keys = array_column(
            $this->actingAs($staff)
                ->getJson('/portal/cip/applications/'.$application->uuid)
                ->assertOk()
                ->json('application.milestones'),
            'key',
        );

        $this->assertSame(
            [
                'filed', 'locked', 'submitted', 'query_received', 'accepted', 'decision',
                'cor_submitted', 'cor_received', 'nic_submitted', 'nic_received',
                'passport_submitted', 'passport_received', 'passport_delivered',
            ],
            $keys,
        );
    }

    public function test_post_approval_empty_cor_slots_can_be_uploaded_from_the_checklist(): void
    {
        $staff = $this->staff();
        [$application, , $oath] = $this->corFile($staff);

        $docs = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application.applicant.documents');

        $oathRow = collect($docs)->firstWhere('id', $oath->uuid);
        $this->assertNotNull($oathRow);
        $this->assertTrue($oathRow['canUpload']);
        $this->assertFalse($oathRow['uploaded']);
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $oathRow['status']);

        $this->actingAs($staff)
            ->post('/portal/cip/documents/'.$oath->uuid.'/file', [
                'file' => UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('document.uploaded', true)
            ->assertJsonPath('document.status', DocumentStatus::APPLICATION_REVIEW);

        $oath->refresh();
        $this->assertTrue($oath->isFilled());
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $oath->status);
    }

    public function test_a_provider_can_upload_a_cor_document_after_the_original_package_is_locked(): void
    {
        $staff = $this->staff();
        [$application, , $oath] = $this->corFile($staff);
        $application->forceFill(['locked_at' => now()])->save();
        $contact = $this->contactOn($application, $staff);

        $this->actingAs($contact)
            ->post('/portal/cip/documents/'.$oath->uuid.'/file', [
                'file' => UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('document.uploaded', true);

        $this->assertTrue($oath->fresh()->isFilled());
    }

    public function test_a_confirmed_cor_package_refuses_checklist_uploads(): void
    {
        $staff = $this->staff();
        [$application, , $oath] = $this->corFile($staff);
        $application->forceFill(['cor_locked_at' => now()])->save();
        $oath->unsetRelation('application');

        $docs = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application.applicant.documents');

        $this->assertFalse(collect($docs)->firstWhere('id', $oath->uuid)['canUpload']);

        $this->actingAs($staff)
            ->post('/portal/cip/documents/'.$oath->uuid.'/file', [
                'file' => UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertStatus(422);

        $this->assertFalse($oath->fresh()->isFilled());
    }

    public function test_a_stranger_cannot_upload_into_a_cor_slot(): void
    {
        $staff = $this->staff();
        [$application, , $oath] = $this->corFile($staff);
        $stranger = $this->staff(Role::CLIENT);

        $this->actingAs($stranger)
            ->post('/portal/cip/documents/'.$oath->uuid.'/file', [
                'file' => UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertNotFound();
    }

    public function test_apply_for_cor_is_not_offered_before_post_approval(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $this->mainApplicant($application);
        $application->forceFill(['status' => Status::UPDATE_REQUIRED])->save();

        $this->assertNotContains(
            Status::APPLY_FOR_COR,
            Engine::availableTransitions($application->fresh(), $staff),
        );
        $this->assertNotContains(
            Status::APPLY_FOR_COR,
            Engine::availableOverrides($application->fresh(), $staff),
        );
        $this->assertFalse(Engine::canTransition($application->fresh(), Status::APPLY_FOR_COR));
        $this->assertFalse(Engine::canTransition($application->fresh(), Status::POST_APPROVAL));
    }

    private function seedCor(): void
    {
        (new CipDocumentRequirementSeeder)->syncPostApproval();
    }

    private function fileRequiredCor(CipApplication $application, User $actor): void
    {
        $application->load(['people']);
        $slots = Review::constrainToCurrentChecklist(
            CipDocument::query()->where('application_id', $application->id)->where('required', true),
            Phase::POST_APPROVAL,
            $application,
        )->get();

        foreach ($slots as $slot) {
            if ($slot->file_id) {
                continue;
            }

            $person = $application->people->firstWhere('id', $slot->person_id);
            $person->setRelation('application', $application);
            $upload = $slot->type === DocumentTypes::PASSPORT_PHOTO
                ? UploadedFile::fake()->image('photo.jpg', 400, 400)
                : UploadedFile::fake()->create($slot->type.'.pdf', 40, 'application/pdf');
            DocumentSlots::fill($person->fresh(['application', 'documents']), $slot->type, $upload, $actor);
        }
    }

    private function approveRequiredCor(CipApplication $application, User $staff): void
    {
        $slots = Review::constrainToCurrentChecklist(
            CipDocument::query()->where('application_id', $application->id)->where('required', true),
            Phase::POST_APPROVAL,
            $application,
        )->get();

        foreach ($slots as $slot) {
            if ($slot->fresh()->status === DocumentStatus::READY_FOR_SUBMISSION) {
                continue;
            }

            $this->actingAs($staff)
                ->postJson('/portal/cip/documents/'.$slot->uuid.'/approve')
                ->assertOk();
        }
    }

    /** @return array{0: CipApplication, 1: CipPerson, 2: CipDocument} */
    private function corFile(User $staff): array
    {
        $this->seedCor();
        $application = $this->granted($staff);
        PostApproval::enter($application->fresh(['people']), $staff);
        $application = $application->fresh(['people.documents']);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $person->setRelation('application', $application);
        $oath = $person->documents->firstWhere('type', CorRequirements::OATH_OF_ALLEGIANCE);

        return [$application, $person, $oath];
    }

    private function contactOn(CipApplication $application, User $staff): User
    {
        $contact = $this->staff(Role::CLIENT);
        CompanyMember::create([
            'company_id' => $application->provider->company_id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $staff->id,
        ]);

        return $contact;
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
