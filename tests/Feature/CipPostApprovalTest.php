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
use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Confirmation;
use App\Support\Cip\Copies;
use App\Support\Cip\CorRequirements;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Engine;
use App\Support\Cip\Intake;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\NicRequirements;
use App\Support\Cip\Pack;
use App\Support\Cip\Package;
use App\Support\Cip\PassportRequirements;
use App\Support\Cip\Phase;
use App\Support\Cip\PostApproval;
use App\Support\Cip\Requirements;
use App\Support\Cip\Review;
use App\Support\Cip\Stages;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use App\Support\Files\FolderTree;
use Database\Seeders\CipDocumentRequirementSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class CipPostApprovalTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Storage::fake(config('filesystems.files_disk', 'local'));
        CipDocumentRequirement::query()->forceDelete();
        Requirements::flush();
    }

    private function staff(string $type = Role::ADMINISTRATOR): User
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        // Administrators start with provider-email copies off (Cip\Copies); these have them on.
        if ($type === Role::ADMINISTRATOR) {
            $user->forceFill(['preferences' => [Copies::PREFERENCE => true]])->save();
        }

        return $user;
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

        $packs = Folder::query()->where('parent_id', $personFolder->id)->pluck('name')->all();
        $this->assertContains(CorRequirements::FOLDER, $packs);
        $this->assertContains(NicRequirements::FOLDER, $packs);
        $this->assertContains(PassportRequirements::FOLDER, $packs);
    }

    public function test_opening_a_post_approval_file_fills_in_missing_nic_and_passport_folders(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $this->mainApplicant($application);
        $application->forceFill([
            'phase' => Phase::POST_APPROVAL,
            'post_approval_at' => now(),
            'status' => Status::POST_APPROVAL,
        ])->save();

        PostApproval::prepare($application->fresh(['people']), $staff);

        $personFolder = Folder::query()
            ->where('parent_id', $application->fresh()->post_approval_folder_id)
            ->where('name', 'Main Applicant')
            ->first();
        $this->assertNotNull($personFolder);

        Folder::query()->where('parent_id', $personFolder->id)->forceDelete();
        $this->assertSame([], Folder::query()->where('parent_id', $personFolder->id)->pluck('name')->all());

        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk();

        $packs = Folder::query()->where('parent_id', $personFolder->id)->pluck('name')->all();
        $this->assertContains(NicRequirements::FOLDER, $packs);
        $this->assertContains(PassportRequirements::FOLDER, $packs);
        $this->assertContains(CorRequirements::FOLDER, $packs);
    }

    public function test_a_library_upload_in_the_post_approval_nic_folder_fills_the_slot(): void
    {
        $staff = $this->staff();
        [$application, $person] = $this->intoApplyForNic($staff);
        $personFolder = Tree::postApprovalPersonFolder($person->fresh(['application']), null, $staff);
        $nicFolder = Folder::query()
            ->where('parent_id', $personFolder->id)
            ->where('name', NicRequirements::FOLDER)
            ->first();
        $this->assertNotNull($nicFolder);

        $slot = $person->documents()->where('type', NicRequirements::R3_FORM)->first();
        $this->assertNotNull($slot);
        $this->assertNull($slot->file_id);

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $nicFolder->id,
            'name' => $person->fullName().' - '.$slot->label.'.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1000,
            'disk' => config('filesystems.files_disk', 'local'),
            'storage_path' => 'cip/test-r3.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
        ]);

        $this->assertTrue(DocumentSlots::adoptOrphan($file->fresh(), $staff));
        $this->assertSame($file->id, $slot->fresh()->file_id);
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

    public function test_post_approval_passport_photo_upload_lands_in_the_passport_folder(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $this->mainApplicant($application);

        $this->template(DocumentTypes::PASSPORT_PHOTO, 'Passport photo', [
            'at_pre_approval' => true,
            'at_post_approval' => true,
            'carry_forward' => true,
            'folder' => null,
        ]);

        $application->forceFill([
            'phase' => Phase::POST_APPROVAL,
            'post_approval_at' => now(),
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
        ])->save();

        PostApproval::prepare($application->fresh(['people']), $staff);

        $upload = UploadedFile::fake()->image('photo.jpg', 400, 400);
        $slot = DocumentSlots::fill(
            $person->fresh(['application']),
            DocumentTypes::PASSPORT_PHOTO,
            $upload,
            $staff,
        );

        $drawer = Folder::find($slot->file->folder_id);
        $this->assertSame(PassportRequirements::FOLDER, $drawer?->name);
        $this->assertSame($person->fresh()->post_approval_folder_id, $drawer?->parent_id);
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
                'femaleOnly' => true,
            ])
            ->assertOk()
            ->assertJsonPath('requirement.atPreApproval', false)
            ->assertJsonPath('requirement.atPostApproval', true)
            ->assertJsonPath('requirement.femaleOnly', true);
    }

    /**
     * The Settings catalogue is one catalogue: what the wizard asks a person
     * for and what that person's checklist opens are the same list.
     *
     * A female-only row is the case that could disagree. The checklist has
     * always judged it against the person; the wizard drew its fields from a
     * call that was never handed one, so a template asked only of women would
     * have been offered to a man — a document his own slot would never open,
     * and an upload with nowhere to be filed.
     */
    public function test_a_female_only_requirement_is_asked_of_the_same_people_on_both_screens(): void
    {
        $staff = $this->staff();
        $this->template('female_cor', 'Female COR doc', [
            'key' => 'female_cor',
            'required' => false,
            'female_only' => true,
            'at_pre_approval' => false,
            'at_post_approval' => true,
        ]);

        $application = $this->application($staff);
        $application->forceFill([
            'phase' => Phase::POST_APPROVAL,
            'status' => Status::POST_APPROVAL,
            'post_approval_at' => now(),
        ])->save();

        $man = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Asem',
            'last_name' => 'Haddad',
            'gender' => 'Male',
            'date_of_birth' => now()->subYears(40),
        ]);
        $woman = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Rana',
            'last_name' => 'Haddad',
            'gender' => 'Female',
            'date_of_birth' => now()->subYears(38),
        ]);

        // The wizard's list, per person.
        $asked = fn (CipPerson $person) => Intake::documentFields(
            ApplicantType::for($person),
            Phase::POST_APPROVAL,
            $application,
            $person,
        )->pluck('key')->all();

        $this->assertNotContains('female_cor', $asked($man));
        $this->assertContains('female_cor', $asked($woman));

        // The checklist each of them actually owes.
        Requirements::materialiseApplication($application->fresh());

        $this->assertFalse(
            $man->documents()->where('type', 'female_cor')->exists(),
            'A man is not asked for it, so no slot opens for him.',
        );
        $this->assertTrue(
            $woman->documents()->where('type', 'female_cor')->exists(),
            'A woman is asked for it, and her checklist says so.',
        );
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
        $this->assertNotContains(NicRequirements::R3_FORM, $mainKeys);
        $this->assertNotContains(PassportRequirements::EPP_FORM, $mainKeys);
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

    /**
     * A file at Approved is still collecting its COR documents.
     *
     * The lane's decision comes first, so a file spends this whole step
     * wearing Approved rather than Post-Approval. The checklist used to
     * drive only the second label: at Approved a paper sent back changed
     * nothing, and every paper accepted changed nothing either, which is the
     * one move the brief says happens by itself.
     */
    public function test_an_approved_file_follows_its_documents(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $person, $oath] = $this->corFile($staff);

        \App\Support\Cip\Decision::record(
            $application->fresh(),
            $staff,
            Status::POST_APPROVED,
            null,
            '',
            $this->cipDecisionLetterPdf(),
        );
        $this->assertSame(Status::POST_APPROVED, $application->fresh()->status);

        $approvals = fn () => Mail::queued(
            Postcard::class,
            fn (Postcard $mail) => str_contains((string) $mail->subjectLine, ' APPROVED '),
        )->count();
        $decided = $approvals();
        $this->assertGreaterThan(0, $decided);

        // One document sent back: Updates Required, and the firm is told.
        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            CorRequirements::OATH_OF_ALLEGIANCE,
            UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf'),
            $staff,
        );
        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$oath->uuid.'/request-changes', [
                'comment' => 'The notary stamp is not legible.',
            ])
            ->assertOk();

        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);

        // Replaced: back to Approved, the label it was collecting under, and
        // not announced as a second decision.
        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            CorRequirements::OATH_OF_ALLEGIANCE,
            UploadedFile::fake()->create('oath-2.pdf', 40, 'application/pdf'),
            $staff,
        );

        $fresh = $application->fresh();
        $this->assertSame(Status::POST_APPROVED, $fresh->status);
        $this->assertSame(Status::POST_APPROVED, $fresh->decision);
        $this->assertSame($decided, $approvals());

        // Every document accepted: Apply for COR, by itself.
        $this->fileRequiredCor($application->fresh(), $staff);
        $this->approveRequiredCor($application->fresh(), $staff);

        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => str_contains((string) $mail->subjectLine, 'APPLY FOR COR'));

        // And one reopened afterwards takes it back to Approved, not to a
        // file that looks undecided.
        $this->actingAs($staff)
            ->patchJson('/portal/files/files/'.$oath->fresh()->file->uuid.'/review', [
                'status' => DocumentStatus::APPLICATION_REVIEW,
            ])
            ->assertOk();

        $this->assertSame(Status::POST_APPROVED, $application->fresh()->status);
        $this->assertSame($decided, $approvals());
    }

    /**
     * The decision can arrive after the papers.
     *
     * A file whose COR documents are all accepted while it is still
     * undecided goes to Apply for COR by itself; recording the lane's
     * approval then stands it on Approved, with nothing left to judge that
     * would ever walk it on again. So the checklist is read as the decision
     * lands, and it does not sit at Approved over a finished pack.
     */
    public function test_recording_the_approval_on_a_finished_pack_goes_straight_to_apply_for_cor(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application] = $this->corFile($staff);

        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);

        $decided = \App\Support\Cip\Decision::record(
            $application->fresh(),
            $staff,
            Status::POST_APPROVED,
            null,
            '',
            $this->cipDecisionLetterPdf(),
        );

        $this->assertSame(Status::APPLY_FOR_COR, $decided->status);
        $this->assertSame(Status::POST_APPROVED, $decided->decision);
        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);

        // Pressed again, a lost response and a second click: the same
        // outcome, so the day may move and nothing else is recorded or sent.
        $decisions = fn () => CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_STATUS_CHANGED)
            ->where('to_status', Status::POST_APPROVED)
            ->count();
        $before = $decisions();
        Mail::fake();

        $again = \App\Support\Cip\Decision::record(
            $application->fresh(),
            $staff,
            Status::POST_APPROVED,
            Carbon::parse('2026-09-30'),
        );

        $this->assertSame(Status::APPLY_FOR_COR, $again->status);
        $this->assertSame('2026-09-30', $again->decided_at->toDateString());
        $this->assertSame($before, $decisions());
        Mail::assertNothingQueued();
    }

    /**
     * Apply for COR says every document is Ready for submission, for an
     * administrator as for anyone.
     *
     * The dated steps after it already refuse an unfinished pack whoever
     * asks. An override straight to Apply for COR was the one way left to
     * stand a file on that claim while it was untrue.
     */
    public function test_apply_for_cor_cannot_be_reached_by_override_while_documents_are_outstanding(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application] = $this->corFile($staff);

        $this->assertNotContains(Status::APPLY_FOR_COR, Engine::availableTransitions($application->fresh(), $staff));
        $this->assertNotContains(Status::APPLY_FOR_COR, Engine::availableOverrides($application->fresh(), $staff));

        $refused = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::APPLY_FOR_COR,
                'note' => 'The provider says the papers are on their way.',
            ])
            ->assertStatus(422);
        $message = $refused->json('message');

        $this->assertStringContainsString('Ready for submission', $message);
        // Which ones, for the dialog: the Oath is one of the COR papers owed.
        $this->assertContains('Oath of Allegiance', array_column($refused->json('blockers'), 'label'));
        $this->assertSame(Status::POST_APPROVAL, $application->fresh()->status);

        // Pulling a file BACK is untouched: that is what an override is for.
        $this->assertContains(Status::POST_APPROVAL, Engine::availableOverrides(
            $application->fresh()->forceFill(['status' => Status::APPLY_FOR_COR]),
            $staff,
        ));
    }

    /**
     * A file cannot go on standing at Apply for COR once a document it owes
     * is no longer accepted, until the package has been confirmed.
     */
    public function test_an_unconfirmed_apply_for_cor_returns_to_collecting_when_a_document_is_withdrawn(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application, $person, $oath] = $this->corFile($staff);

        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);

        // The accepted oath is taken out of its slot again.
        $oath->fresh()->forceFill([
            'status' => DocumentStatus::PENDING_UPLOAD,
            'file_id' => null,
        ])->save();

        Review::settle($application->fresh(), $staff);

        $this->assertSame(Status::POST_APPROVAL, $application->fresh()->status);
        $this->assertFalse(Review::packageReady($application->fresh()));
    }

    /**
     * "All documents READY FOR SUBMISSION" counts the optional ones somebody
     * actually filed.
     *
     * The brief's COR list is three required documents and three Real Estate
     * ones marked (opt). An optional slot nobody filled is not a document
     * anybody is waiting on, and must not hold the package. One that WAS
     * filed is a piece of paper going to the Unit, so the file is not ready
     * while a reviewer still has it open.
     */
    public function test_an_uploaded_optional_document_holds_apply_for_cor_until_it_is_read(): void
    {
        Mail::fake();
        $staff = $this->staff();
        [$application] = $this->corFile($staff);
        // Real Estate, because that is what the brief's optional COR trio
        // belongs to.
        $application->forceFill(['investment_type' => InvestmentType::REAL_ESTATE])->save();
        Requirements::flush();
        Requirements::materialiseApplication($application->fresh(['people']));

        $person = $application->fresh(['people'])->people->first();
        $optional = $person->documents()
            ->where('required', false)
            ->whereNotNull('requirement_id')
            ->first();
        $this->assertNotNull($optional, 'The Real Estate COR list carries optional documents.');

        // Every required document cleared; the optional one left untouched.
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        $this->assertSame(
            Status::APPLY_FOR_COR,
            $application->fresh()->status,
            'An optional document nobody filed is not one the package waits for.',
        );

        // Now somebody files that optional document. It is going to the Unit,
        // so it has to be read before the package is ready again.
        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            $optional->type,
            UploadedFile::fake()->create($optional->type.'.pdf', 40, 'application/pdf'),
            $staff,
        );

        $this->assertSame(
            DocumentStatus::APPLICATION_REVIEW,
            $optional->fresh()->status,
            'A filed document waits on a reviewer, optional or not.',
        );
        $this->assertSame(
            Status::POST_APPROVAL,
            $application->fresh()->status,
            'A filed document nobody has read yet takes the file off Apply for COR.',
        );

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$optional->uuid.'/approve')
            ->assertOk();

        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);
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

        // The admin holds the override, so confirm is offered to them too.
        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->assertJsonPath('application.status', Status::APPLY_FOR_COR)
            ->assertJsonPath('application.canConfirm', true)
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
        $this->assertFalse(Package::locksFolder($post));

        $corDrawer = Folder::query()
            ->where('name', CorRequirements::FOLDER)
            ->whereIn('id', array_merge([(int) $post->id], FolderTree::descendantIds($post)))
            ->first();
        $this->assertNotNull($corDrawer);
        $this->assertTrue(Package::locksFolder($corDrawer));
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

    public function test_a_submission_stage_refuses_while_required_documents_are_not_ready(): void
    {
        Mail::fake();

        $staff = $this->staff();
        [$application] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        Confirmation::confirm($application->fresh(), $this->contactOn($application, $staff));

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::COR_SUBMITTED, 'date' => '2026-08-20',
            ])->assertOk();
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::COR_RECEIVED, 'date' => '2026-08-21',
            ])->assertOk();

        $application = $application->fresh();
        $this->assertSame(Status::COR_RECEIVED, $application->status);
        Engine::apply($application, Status::APPLY_FOR_NIC, $staff);
        $application = $application->fresh();

        // The NIC checklist materialised on arrival and stands pending, so
        // the file may NOT move on: required documents come first, and the
        // refusal lists them for the dialog that shows which.
        $refused = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::NIC_SUBMITTED, 'date' => '2026-08-22',
            ])
            ->assertStatus(422);

        $waiting = $refused->json('blockers');
        $this->assertNotEmpty($waiting);
        $this->assertContains('Completed R3 Form', array_column($waiting, 'label'));
        $this->assertSame(['pending_upload'], array_values(array_unique(array_column($waiting, 'status'))));

        $this->assertSame(Status::APPLY_FOR_NIC, $application->fresh()->status);
        $this->assertNull($application->fresh()->nic_submitted_at);

        // Uploaded and marked ready, the same stage records cleanly.
        $this->fileRequiredCor($application->fresh(['people']), $staff);
        $this->approveRequiredCor($application->fresh(), $staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::NIC_SUBMITTED, 'date' => '2026-08-22',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::PENDING_NIC);
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

        // The subject names a receipt for what arrived, as section 22's
        // examples do: COR RECEIVED, not the status the file moves on to.
        $hops = [
            [Stages::COR_RECEIVED, Status::COR_RECEIVED, ' - COR RECEIVED - ', 'corReceivedAt'],
            [Stages::NIC_SUBMITTED, Status::PENDING_NIC, ' - PENDING NIC - ', 'nicSubmittedAt'],
            [Stages::NIC_RECEIVED, Status::NIC_RECEIVED, ' - NIC RECEIVED - ', 'nicReceivedAt'],
            [Stages::PASSPORT_SUBMITTED, Status::PENDING_PASSPORT, ' - PENDING PASSPORT - ', 'passportSubmittedAt'],
            [Stages::PASSPORT_RECEIVED, Status::PASSPORT_RECEIVED, ' - PASSPORT RECEIVED - ', 'passportReceivedAt'],
            [Stages::PASSPORT_DELIVERED, Status::PASSPORT_DELIVERED, ' - PASSPORT DELIVERED - ', 'passportDeliveredAt'],
        ];

        foreach ($hops as [$stage, $status, $subject, $dateKey]) {
            Mail::fake();

            // A *_submitted stage hands the current pack to the Unit and
            // refuses while its required documents are not ready — file and
            // approve the pack the file is now collecting before sending it.
            if (in_array($stage, [Stages::NIC_SUBMITTED, Stages::PASSPORT_SUBMITTED], true)) {
                $this->fileRequiredCor($application->fresh(['people']), $staff);
                $this->approveRequiredCor($application->fresh(), $staff);
            }

            $body = $this->actingAs($staff)
                ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                    'stage' => $stage,
                    'date' => '2026-08-21',
                ])
                ->assertOk()
                ->json('application');

            $this->assertSame($status, $body['status'], $stage.' did not land on '.$status);
            $this->assertSame('2026-08-21', $body[$dateKey]);

            // A receipt lands on its own status. The next pack starts when
            // the file is moved on, which is not another date.
            if ($status === Status::COR_RECEIVED) {
                Engine::apply($application->fresh(), Status::APPLY_FOR_NIC, $staff);
            } elseif ($status === Status::NIC_RECEIVED) {
                Engine::apply($application->fresh(), Status::APPLY_FOR_PASSPORT, $staff);
            }
            $this->assertSame(CipApplication::DECISION_GRANTED, $application->fresh()->decision);

            Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($subject) {
                return str_contains((string) $mail->subjectLine, $subject);
            });
        }

        $closed = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::PASSPORT_DELIVERED, $closed['status']);
        $this->assertSame('Passport Delivered', $closed['statusLabel']);
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
                'filed', 'locked', 'submitted', 'query_received', 'accepted', 'dd_query_received', 'decision',
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

        $filed = collect(
            $this->actingAs($staff)
                ->getJson('/portal/cip/applications/'.$application->uuid)
                ->assertOk()
                ->json('application.applicant.documents')
        )->firstWhere('id', $oath->uuid);
        $this->assertNotEmpty($filed['downloadUrl']);
        $this->assertStringContainsString('/download', $filed['downloadUrl']);
        $this->assertSame($oath->file->uuid, $filed['fileId']);
    }

    /**
     * A document asked for in BOTH lanes can be filed on the COR checklist.
     *
     * The translator's credentials and the apostille are pre-approval
     * requirements the firm also ticks for post-approval. On a file whose
     * original package was confirmed long ago, their lines sat on the COR
     * checklist as Pending upload and could never be filed: the empty slot
     * was judged by the original package's lock, though the paper it is
     * waiting for belongs to the COR package and is stored in the
     * post-approval tree. It is the COR package's lock that freezes it.
     */
    public function test_a_requirement_asked_in_both_lanes_can_be_filed_on_the_cor_checklist(): void
    {
        $staff = $this->staff();
        // The shipped COR list first, then the two the firm ticked itself in
        // Settings (seeding afterwards would put them back to the default).
        $this->seedCor();
        $this->template('translator_credentials', "Certified Copy of Translator's Credentials", [
            'required' => false,
            'at_post_approval' => true,
        ]);
        $this->template('credentials_apostille', 'Apostille for Attorney-at-Law & Notary Credentials', [
            'required' => false,
            'at_post_approval' => true,
        ]);
        Requirements::flush();

        $application = $this->granted($staff);
        PostApproval::enter($application->fresh(['people']), $staff);
        $application = $application->fresh(['people.documents']);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $person->setRelation('application', $application);
        // The original package was confirmed before the file ever got here.
        $application->forceFill(['locked_at' => now()->subMonth()])->save();

        $translator = $person->documents()->where('type', 'translator_credentials')->first();
        $apostille = $person->documents()->where('type', 'credentials_apostille')->first();
        $this->assertNotNull($translator, 'A requirement ticked for post-approval is on the COR checklist.');
        $this->assertNotNull($apostille);
        $this->assertFalse(Package::locksDocument($translator->fresh()), 'The empty COR line is not frozen by the original package.');

        $rows = collect($this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application.applicant.documents'));

        $this->assertTrue($rows->firstWhere('id', $translator->uuid)['canUpload']);
        $this->assertTrue($rows->firstWhere('id', $apostille->uuid)['canUpload']);

        $this->actingAs($staff)
            ->post('/portal/cip/documents/'.$translator->uuid.'/file', [
                'file' => UploadedFile::fake()->create('translator.pdf', 40, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('document.uploaded', true)
            ->assertJsonPath('document.status', DocumentStatus::APPLICATION_REVIEW);

        // Filed in the post-approval tree, not into the frozen original one.
        $file = $translator->fresh()->file;
        $this->assertNotNull($file);
        $this->assertNotSame($person->fresh()->folder_id, $file->folder_id);
        $this->assertFalse(Package::locksFile($file), 'The filed paper is not in the frozen original tree.');

        // So a reviewer can read it and accept it, like any COR paper.
        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$translator->uuid.'/approve')
            ->assertOk();
        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $translator->fresh()->status);

        // And frozen with the COR package, like every other COR line.
        $application->fresh()->forceFill(['cor_locked_at' => now()])->save();
        Package::forget();

        $this->assertTrue(Package::locksDocument($apostille->fresh()));
        $this->assertFalse(collect($this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->json('application.applicant.documents'))->firstWhere('id', $apostille->uuid)['canUpload']);

        $this->actingAs($staff)
            ->post('/portal/cip/documents/'.$apostille->uuid.'/file', [
                'file' => UploadedFile::fake()->create('apostille.pdf', 40, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('message', Confirmation::COR_LOCKED_MESSAGE);

        $this->assertFalse($apostille->fresh()->isFilled(), 'Nothing was filed after the COR lock.');
    }

    /**
     * The same requirement on a file still in pre-approval is the original
     * package's, and freezes with it as it always did.
     */
    public function test_a_requirement_asked_in_both_lanes_still_freezes_with_the_original_package_before_post_approval(): void
    {
        $staff = $this->staff();
        $this->template('translator_credentials', "Certified Copy of Translator's Credentials", [
            'required' => false,
            'at_post_approval' => true,
        ]);
        $application = $this->application($staff);
        $person = $this->mainApplicant($application);
        Tree::provision($application->fresh(['people']), $staff);
        Requirements::materialise($person->fresh(['application']));

        $slot = $person->documents()->where('type', 'translator_credentials')->first();
        $this->assertNotNull($slot);
        $this->assertFalse(Package::locksDocument($slot->fresh()));

        $application->forceFill(['locked_at' => now()])->save();
        Package::forget();

        $this->assertTrue(Package::locksDocument($slot->fresh()));
        $this->actingAs($staff)
            ->post('/portal/cip/documents/'.$slot->uuid.'/file', [
                'file' => UploadedFile::fake()->create('translator.pdf', 40, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('message', Confirmation::LOCKED_MESSAGE);
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

    public function test_nic_slots_wait_until_the_cor_is_received(): void
    {
        $staff = $this->staff();
        [$application, $person] = $this->corFile($staff);

        $keys = $person->documents()->pluck('type')->all();
        $this->assertNotContains(NicRequirements::R3_FORM, $keys);
        $this->assertNotContains(NicRequirements::AUTHORIZATION_LETTER, $keys);

        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        Confirmation::confirm($application->fresh(), $this->contactOn($application, $staff));
        Stages::record($application->fresh(), $staff, Stages::COR_SUBMITTED, Carbon::parse('2026-08-20'));

        $stillPending = $person->fresh()->documents()->pluck('type')->all();
        $this->assertNotContains(NicRequirements::R3_FORM, $stillPending);

        Stages::record($application->fresh(), $staff, Stages::COR_RECEIVED, Carbon::parse('2026-08-21'));

        $application = $application->fresh(['people.documents.requirement']);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $keys = $person->documents()->pluck('type')->all();

        $this->assertSame(Status::COR_RECEIVED, $application->status);
        $this->assertTrue(Pack::hasReachedNic($application));
        $this->assertContains(NicRequirements::R3_FORM, $keys);
        $this->assertContains(NicRequirements::CERTIFIED_PASSPORT_BIO_PAGE, $keys);
        $this->assertNotContains(DocumentTypes::PASSPORT_BIO_PAGE, $keys);
        $this->assertContains(DocumentTypes::BIRTH_CERTIFICATE, $keys);
        $this->assertContains(NicRequirements::NAME_CHANGE_DOCUMENT, $keys);
        $this->assertContains('marriage_certificate', $keys);
        $this->assertContains(NicRequirements::DIVORCE_DECREE, $keys);
        $this->assertContains(NicRequirements::AUTHORIZATION_LETTER, $keys);
        $this->assertContains(CorRequirements::OATH_OF_ALLEGIANCE, $keys);
        $this->assertNotContains(PassportRequirements::EPP_FORM, $keys);

        $this->assertFalse($person->documents()->where('type', NicRequirements::NAME_CHANGE_DOCUMENT)->value('required'));
        $this->assertFalse($person->documents()->where('type', 'marriage_certificate')->value('required'));
        $this->assertFalse($person->documents()->where('type', NicRequirements::DIVORCE_DECREE)->value('required'));

        $r3 = $person->documents()->where('type', NicRequirements::R3_FORM)->first();
        $this->assertSame(NicRequirements::FOLDER, $r3->requirement->folder);
        $this->assertTrue($r3->required);
        $this->assertFalse(Package::locksDocument($r3));
    }

    public function test_nic_checklist_follows_age_and_gender(): void
    {
        $staff = $this->staff();
        $this->seedCor();
        $application = $this->granted($staff);
        $this->family($application);
        $application = $application->fresh(['people']);
        $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)
            ->forceFill(['gender' => 'Male'])->save();
        $application->people->first(fn (CipPerson $person) => $person->relationship === 'spouse')
            ->forceFill(['gender' => 'Female'])->save();
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_SPONSOR,
            'first_name' => 'Karim',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(62),
            'gender' => 'Male',
        ]);

        PostApproval::enter($application->fresh(['people']), $staff);
        $application->forceFill([
            'status' => Status::APPLY_FOR_NIC,
            'cor_locked_at' => now(),
            'cor_received_at' => now(),
        ])->save();
        Requirements::flush();
        Requirements::materialiseApplication($application->fresh(['people']));

        $application = $application->fresh(['people.documents']);
        $people = $application->people;
        $people->each(fn (CipPerson $person) => $person->setRelation('application', $application));

        $main = $people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $spouse = $people->first(fn (CipPerson $person) => $person->relationship === 'spouse');
        $child = $people->first(fn (CipPerson $person) => ApplicantType::for($person) === ApplicantType::DEPENDENT_UNDER_16);
        $adultDep = $people->first(fn (CipPerson $person) => ApplicantType::for($person) === ApplicantType::DEPENDENT_16_OVER);
        $sponsor = $people->firstWhere('role', CipPerson::ROLE_SPONSOR);

        $this->assertContains(NicRequirements::R3_FORM, $main->documents()->pluck('type')->all());
        $this->assertNotContains(NicRequirements::DEATH_CERTIFICATE, $main->documents()->pluck('type')->all());

        $this->assertContains(NicRequirements::R3_FORM, $spouse->documents()->pluck('type')->all());
        $this->assertContains(NicRequirements::DEATH_CERTIFICATE, $spouse->documents()->pluck('type')->all());
        $this->assertFalse($spouse->documents()->where('type', NicRequirements::DEATH_CERTIFICATE)->value('required'));
        $this->assertTrue($spouse->documents()->where('type', 'marriage_certificate')->value('required'));

        $this->assertNotContains(NicRequirements::R3_FORM, $child->documents()->pluck('type')->all());
        $this->assertContains(NicRequirements::R3_FORM, $adultDep->documents()->pluck('type')->all());
        $this->assertNotContains(NicRequirements::R3_FORM, $sponsor->documents()->pluck('type')->all());
    }

    public function test_nic_uploads_are_allowed_after_the_cor_package_is_locked(): void
    {
        $staff = $this->staff();
        [$application, $person] = $this->intoApplyForNic($staff);

        $oath = $person->documents()->where('type', CorRequirements::OATH_OF_ALLEGIANCE)->first();
        $r3 = $person->documents()->where('type', NicRequirements::R3_FORM)->first();
        $this->assertTrue(Package::locksDocument($oath));
        $this->assertFalse(Package::locksDocument($r3));

        $docs = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application.applicant.documents');

        $this->assertFalse(collect($docs)->firstWhere('type', CorRequirements::OATH_OF_ALLEGIANCE)['canUpload']);
        $this->assertTrue(collect($docs)->firstWhere('type', NicRequirements::R3_FORM)['canUpload']);

        $this->actingAs($staff)
            ->post('/portal/cip/documents/'.$r3->uuid.'/file', [
                'file' => UploadedFile::fake()->create('r3.pdf', 40, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('document.uploaded', true)
            ->assertJsonPath('document.status', DocumentStatus::APPLICATION_REVIEW);

        $this->assertTrue($r3->fresh()->isFilled());
        $this->assertSame(NicRequirements::FOLDER, Folder::find($r3->fresh()->file->folder_id)?->name);
    }

    public function test_intake_birth_certificates_stay_out_of_the_nic_drawer(): void
    {
        $this->seedCor();
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $this->mainApplicant($application);
        Tree::provision($application->fresh(['people']), $staff);
        $person = $person->fresh();
        Requirements::materialise($person->fresh(['application']));

        $birth = DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            DocumentTypes::BIRTH_CERTIFICATE,
            UploadedFile::fake()->create('birth.pdf', 40, 'application/pdf'),
            $staff,
        );

        $this->assertSame($person->folder_id, $birth->file->folder_id);
        $this->assertNotSame(NicRequirements::FOLDER, Folder::find($birth->file->folder_id)?->name);
    }

    public function test_a_carried_birth_certificate_stays_locked_on_apply_for_nic(): void
    {
        $this->seedCor();
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $this->mainApplicant($application);
        Tree::provision($application->fresh(['people']), $staff);
        $person = $person->fresh();
        Requirements::materialise($person->fresh(['application']));
        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            DocumentTypes::BIRTH_CERTIFICATE,
            UploadedFile::fake()->create('birth.pdf', 40, 'application/pdf'),
            $staff,
        );
        $application->forceFill(['locked_at' => now()])->save();
        Package::forget();

        $application->forceFill([
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => now(),
        ])->save();
        PostApproval::enter($application->fresh(['people']), $staff);
        $application->forceFill([
            'status' => Status::APPLY_FOR_NIC,
            'cor_locked_at' => now(),
            'cor_received_at' => now(),
        ])->save();
        Requirements::flush();
        Requirements::materialiseApplication($application->fresh(['people']));
        Package::forget();

        $birth = $person->fresh(['documents.file', 'documents.requirement', 'documents.application'])
            ->documents()
            ->where('type', DocumentTypes::BIRTH_CERTIFICATE)
            ->first();

        $this->assertNotNull($birth?->file_id);
        $this->assertTrue(Package::locksDocument($birth));
        $this->assertSame($person->folder_id, $birth->file->folder_id);

        $docs = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application.applicant.documents');

        $this->assertFalse(collect($docs)->firstWhere('type', DocumentTypes::BIRTH_CERTIFICATE)['canUpload']);
        $this->assertTrue(collect($docs)->firstWhere('type', NicRequirements::R3_FORM)['canUpload']);
    }

    public function test_refusing_an_nic_document_moves_the_file_to_updates_required(): void
    {
        $staff = $this->staff();
        [$application, $person] = $this->intoApplyForNic($staff);

        $r3 = $person->documents()->where('type', NicRequirements::R3_FORM)->first();
        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            NicRequirements::R3_FORM,
            UploadedFile::fake()->create('r3.pdf', 40, 'application/pdf'),
            $staff,
        );

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$r3->uuid.'/request-changes', [
                'comment' => 'The witness stamp is missing.',
            ])
            ->assertOk()
            ->assertJsonPath('document.status', DocumentStatus::UPDATE_REQUIRED);

        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);
        $this->assertSame(CipApplication::DECISION_GRANTED, $application->fresh()->decision);
        $this->assertSame(Phase::POST_APPROVAL, $application->fresh()->phase);

        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            NicRequirements::R3_FORM,
            UploadedFile::fake()->create('r3-v2.pdf', 42, 'application/pdf'),
            $staff,
        );

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$r3->uuid.'/approve')
            ->assertOk();

        $this->assertSame(Status::APPLY_FOR_NIC, $application->fresh()->status);
    }

    public function test_recording_the_nic_submission_moves_to_pending_nic(): void
    {
        Mail::fake();

        $staff = $this->staff();
        [$application] = $this->intoApplyForNic($staff);

        $ready = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertSame(Stages::NIC_SUBMITTED, $ready['stageAction']['key']);
        $this->assertSame('Record NIC submission', $ready['stageAction']['label']);

        // Sending the pack requires the pack: every required NIC document
        // stands ready before the stage will record.
        $this->fileRequiredCor($application->fresh(['people']), $staff);
        $this->approveRequiredCor($application->fresh(), $staff);

        $recorded = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::NIC_SUBMITTED,
                'date' => '2026-08-22',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::PENDING_NIC, $recorded['status']);
        $this->assertSame('Pending NIC', $recorded['statusLabel']);
        $this->assertSame('2026-08-22', $recorded['nicSubmittedAt']);
        $this->assertSame(Stages::NIC_RECEIVED, $recorded['stageAction']['key']);
        $this->assertSame(CipApplication::DECISION_GRANTED, $application->fresh()->decision);
        $this->assertSame(Phase::POST_APPROVAL, $application->fresh()->phase);

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_NIC_SUBMITTED,
            'actor_id' => $staff->id,
        ]);

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return str_contains((string) $mail->subjectLine, 'PENDING NIC');
        });
    }

    public function test_a_bare_status_change_cannot_skip_the_nic_submission_date(): void
    {
        $staff = $this->staff();
        [$application] = $this->intoApplyForNic($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::PENDING_NIC,
            ])
            ->assertStatus(422);

        $this->assertSame(Status::APPLY_FOR_NIC, $application->fresh()->status);
        $this->assertNull($application->fresh()->nic_submitted_at);
    }

    public function test_passport_slots_wait_until_the_nic_is_received(): void
    {
        $staff = $this->staff();
        [$application, $person] = $this->intoApplyForNic($staff);

        $keys = $person->documents()->pluck('type')->all();
        $this->assertNotContains(PassportRequirements::EPP_FORM, $keys);
        $this->assertNotContains(PassportRequirements::ORIGINAL_BIRTH_CERTIFICATE, $keys);
        $this->assertNotContains(PassportRequirements::PHYSICAL_PASSPORT_PHOTOS, $keys);

        $this->fileRequiredCor($application->fresh(['people']), $staff);
        $this->approveRequiredCor($application->fresh(), $staff);
        Stages::record($application->fresh(), $staff, Stages::NIC_SUBMITTED, Carbon::parse('2026-08-22'));

        $stillPending = $person->fresh()->documents()->pluck('type')->all();
        $this->assertSame(Status::PENDING_NIC, $application->fresh()->status);
        $this->assertFalse(Pack::hasReachedPassport($application->fresh()));
        $this->assertNotContains(PassportRequirements::EPP_FORM, $stillPending);

        Stages::record($application->fresh(), $staff, Stages::NIC_RECEIVED, Carbon::parse('2026-08-23'));

        $application = $application->fresh(['people.documents.requirement']);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $keys = $person->documents()->pluck('type')->all();

        $this->assertSame(Status::NIC_RECEIVED, $application->status);
        $this->assertTrue(Pack::hasReachedPassport($application));
        $this->assertContains(PassportRequirements::EPP_FORM, $keys);
        $this->assertContains(PassportRequirements::ORIGINAL_BIRTH_CERTIFICATE, $keys);
        $this->assertContains(PassportRequirements::CERTIFIED_PASSPORT_BIO_PAGE, $keys);
        $this->assertContains(PassportRequirements::ORIGINAL_TRANSLATIONS, $keys);
        $this->assertContains(PassportRequirements::PHYSICAL_PASSPORT_PHOTOS, $keys);
        $this->assertContains(NicRequirements::R3_FORM, $keys);
        $this->assertContains(NicRequirements::CERTIFIED_PASSPORT_BIO_PAGE, $keys);
        $this->assertContains(DocumentTypes::BIRTH_CERTIFICATE, $keys);
        $this->assertNotContains(DocumentTypes::PASSPORT_BIO_PAGE, $keys);

        $epp = $person->documents()->where('type', PassportRequirements::EPP_FORM)->first();
        $this->assertSame(PassportRequirements::FOLDER, $epp->requirement->folder);
        $this->assertTrue($epp->required);
        $this->assertFalse(Package::locksDocument($epp));

        $this->assertFalse(
            $person->documents()->where('type', PassportRequirements::ORIGINAL_TRANSLATIONS)->value('required')
        );
        $this->assertTrue(
            $person->documents()->where('type', PassportRequirements::PHYSICAL_PASSPORT_PHOTOS)->value('required')
        );
    }

    public function test_passport_checklist_follows_age_and_gender(): void
    {
        $staff = $this->staff();
        $this->seedCor();
        $application = $this->granted($staff);
        $this->family($application);
        $application = $application->fresh(['people']);
        $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)
            ->forceFill(['gender' => 'Male'])->save();
        $application->people->first(fn (CipPerson $person) => $person->relationship === 'spouse')
            ->forceFill(['gender' => 'Female'])->save();
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_SPONSOR,
            'first_name' => 'Karim',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(62),
            'gender' => 'Male',
        ]);

        PostApproval::enter($application->fresh(['people']), $staff);
        $application->forceFill([
            'status' => Status::APPLY_FOR_PASSPORT,
            'cor_locked_at' => now(),
            'cor_received_at' => now(),
            'nic_received_at' => now(),
        ])->save();
        Requirements::flush();
        Requirements::materialiseApplication($application->fresh(['people']));

        $application = $application->fresh(['people.documents']);
        $people = $application->people;
        $people->each(fn (CipPerson $person) => $person->setRelation('application', $application));

        $main = $people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $spouse = $people->first(fn (CipPerson $person) => $person->relationship === 'spouse');
        $child = $people->first(fn (CipPerson $person) => ApplicantType::for($person) === ApplicantType::DEPENDENT_UNDER_16);
        $adultDep = $people->first(fn (CipPerson $person) => ApplicantType::for($person) === ApplicantType::DEPENDENT_16_OVER);
        $sponsor = $people->firstWhere('role', CipPerson::ROLE_SPONSOR);

        $this->assertContains(PassportRequirements::EPP_FORM, $main->documents()->pluck('type')->all());
        $this->assertNotContains(PassportRequirements::ORIGINAL_MARRIAGE_CERTIFICATE, $main->documents()->pluck('type')->all());
        $this->assertNotContains(PassportRequirements::ORIGINAL_DIVORCE_CERTIFICATE, $main->documents()->pluck('type')->all());

        $this->assertContains(PassportRequirements::EPP_FORM, $spouse->documents()->pluck('type')->all());
        $this->assertContains(PassportRequirements::ORIGINAL_MARRIAGE_CERTIFICATE, $spouse->documents()->pluck('type')->all());
        $this->assertContains(PassportRequirements::ORIGINAL_DIVORCE_CERTIFICATE, $spouse->documents()->pluck('type')->all());
        $this->assertTrue($spouse->documents()->where('type', PassportRequirements::ORIGINAL_MARRIAGE_CERTIFICATE)->value('required'));
        $this->assertFalse($spouse->documents()->where('type', PassportRequirements::ORIGINAL_DIVORCE_CERTIFICATE)->value('required'));

        $this->assertContains(PassportRequirements::EPP_FORM, $child->documents()->pluck('type')->all());
        $this->assertContains(PassportRequirements::PHYSICAL_PASSPORT_PHOTOS, $child->documents()->pluck('type')->all());
        $this->assertNotContains(PassportRequirements::ORIGINAL_MARRIAGE_CERTIFICATE, $child->documents()->pluck('type')->all());
        $this->assertNotContains(PassportRequirements::ORIGINAL_DIVORCE_CERTIFICATE, $child->documents()->pluck('type')->all());

        $this->assertContains(PassportRequirements::EPP_FORM, $adultDep->documents()->pluck('type')->all());
        $this->assertNotContains(PassportRequirements::EPP_FORM, $sponsor->documents()->pluck('type')->all());
    }

    public function test_passport_uploads_are_allowed_after_the_cor_package_is_locked(): void
    {
        $staff = $this->staff();
        [$application, $person] = $this->intoApplyForPassport($staff);

        $oath = $person->documents()->where('type', CorRequirements::OATH_OF_ALLEGIANCE)->first();
        $epp = $person->documents()->where('type', PassportRequirements::EPP_FORM)->first();
        $this->assertTrue(Package::locksDocument($oath));
        $this->assertFalse(Package::locksDocument($epp));

        $docs = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application.applicant.documents');

        $this->assertFalse(collect($docs)->firstWhere('type', CorRequirements::OATH_OF_ALLEGIANCE)['canUpload']);
        $this->assertTrue(collect($docs)->firstWhere('type', PassportRequirements::EPP_FORM)['canUpload']);

        $this->actingAs($staff)
            ->post('/portal/cip/documents/'.$epp->uuid.'/file', [
                'file' => UploadedFile::fake()->create('epp.pdf', 40, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('document.uploaded', true)
            ->assertJsonPath('document.status', DocumentStatus::APPLICATION_REVIEW);

        $this->assertTrue($epp->fresh()->isFilled());
        $this->assertSame(PassportRequirements::FOLDER, Folder::find($epp->fresh()->file->folder_id)?->name);
    }

    public function test_refusing_a_passport_document_moves_the_file_to_updates_required(): void
    {
        $staff = $this->staff();
        [$application, $person] = $this->intoApplyForPassport($staff);

        $epp = $person->documents()->where('type', PassportRequirements::EPP_FORM)->first();
        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            PassportRequirements::EPP_FORM,
            UploadedFile::fake()->create('epp.pdf', 40, 'application/pdf'),
            $staff,
        );

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$epp->uuid.'/request-changes', [
                'comment' => 'Section 13 is not stamped.',
            ])
            ->assertOk()
            ->assertJsonPath('document.status', DocumentStatus::UPDATE_REQUIRED);

        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);
        $this->assertSame(CipApplication::DECISION_GRANTED, $application->fresh()->decision);
        $this->assertSame(Phase::POST_APPROVAL, $application->fresh()->phase);

        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            PassportRequirements::EPP_FORM,
            UploadedFile::fake()->create('epp-v2.pdf', 42, 'application/pdf'),
            $staff,
        );

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$epp->uuid.'/approve')
            ->assertOk();

        $this->assertSame(Status::APPLY_FOR_PASSPORT, $application->fresh()->status);
    }

    public function test_recording_the_passport_application_moves_to_pending_passport(): void
    {
        Mail::fake();

        $staff = $this->staff();
        [$application] = $this->intoApplyForPassport($staff);

        $ready = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertSame(Stages::PASSPORT_SUBMITTED, $ready['stageAction']['key']);
        $this->assertSame('Record passport application', $ready['stageAction']['label']);

        // The same rule as NIC: the passport pack has to be ready to go.
        $this->fileRequiredCor($application->fresh(['people']), $staff);
        $this->approveRequiredCor($application->fresh(), $staff);

        $recorded = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::PASSPORT_SUBMITTED,
                'date' => '2026-08-24',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::PENDING_PASSPORT, $recorded['status']);
        $this->assertSame('Pending Passport', $recorded['statusLabel']);
        $this->assertSame('plum', $recorded['statusTone']);
        $this->assertSame('2026-08-24', $recorded['passportSubmittedAt']);
        $this->assertSame(Stages::PASSPORT_RECEIVED, $recorded['stageAction']['key']);
        $this->assertSame(CipApplication::DECISION_GRANTED, $application->fresh()->decision);
        $this->assertSame(Phase::POST_APPROVAL, $application->fresh()->phase);

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_PASSPORT_SUBMITTED,
            'actor_id' => $staff->id,
        ]);

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return str_contains((string) $mail->subjectLine, 'PENDING PASSPORT');
        });
    }

    public function test_a_bare_status_change_cannot_skip_the_passport_application_date(): void
    {
        $staff = $this->staff();
        [$application] = $this->intoApplyForPassport($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::PENDING_PASSPORT,
            ])
            ->assertStatus(422);

        $this->assertSame(Status::APPLY_FOR_PASSPORT, $application->fresh()->status);
        $this->assertNull($application->fresh()->passport_submitted_at);
    }

    public function test_passport_uploads_are_still_allowed_while_pending_passport(): void
    {
        $staff = $this->staff();
        [$application, $person] = $this->intoPendingPassport($staff);

        // An optional paper nobody has filed yet: the required ones went in
        // with the pack before the passport application was recorded.
        $epp = $person->documents()->where('type', PassportRequirements::ORIGINAL_TRANSLATIONS)->first();
        $this->assertFalse(Package::locksDocument($epp));

        $this->actingAs($staff)
            ->post('/portal/cip/documents/'.$epp->uuid.'/file', [
                'file' => UploadedFile::fake()->create('epp.pdf', 40, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('document.uploaded', true);

        $this->assertSame(Status::PENDING_PASSPORT, $application->fresh()->status);
        $this->assertSame(PassportRequirements::FOLDER, Folder::find($epp->fresh()->file->folder_id)?->name);
    }

    public function test_recording_the_passport_received_moves_to_ready_for_delivery(): void
    {
        Mail::fake();

        $staff = $this->staff();
        [$application] = $this->intoPendingPassport($staff);

        $ready = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertSame(Stages::PASSPORT_RECEIVED, $ready['stageAction']['key']);
        $this->assertSame('Record passport received', $ready['stageAction']['label']);

        $recorded = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::PASSPORT_RECEIVED,
                'date' => '2026-08-25',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::PASSPORT_RECEIVED, $recorded['status']);
        $this->assertSame('Passport Received', $recorded['statusLabel']);
        $this->assertSame('mint', $recorded['statusTone']);
        $this->assertSame('2026-08-25', $recorded['passportReceivedAt']);
        $this->assertSame(Stages::PASSPORT_DELIVERED, $recorded['stageAction']['key']);
        $this->assertSame(CipApplication::DECISION_GRANTED, $application->fresh()->decision);

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return str_contains((string) $mail->subjectLine, ' - PASSPORT RECEIVED - ');
        });
    }

    public function test_a_bare_status_change_cannot_skip_the_passport_received_date(): void
    {
        $staff = $this->staff();
        [$application] = $this->intoPendingPassport($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::PASSPORT_RECEIVED,
            ])
            ->assertStatus(422);

        $this->assertSame(Status::PENDING_PASSPORT, $application->fresh()->status);
        $this->assertNull($application->fresh()->passport_received_at);
    }

    public function test_recording_the_passport_delivered_closes_the_file(): void
    {
        Mail::fake();

        $staff = $this->staff();
        [$application] = $this->intoReadyForDelivery($staff);

        $ready = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertSame(Stages::PASSPORT_DELIVERED, $ready['stageAction']['key']);
        $this->assertSame('Record passport delivered', $ready['stageAction']['label']);

        $recorded = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::PASSPORT_DELIVERED,
                'date' => '2026-08-26',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::PASSPORT_DELIVERED, $recorded['status']);
        $this->assertSame('Passport Delivered', $recorded['statusLabel']);
        $this->assertSame('ink', $recorded['statusTone']);
        $this->assertSame('2026-08-26', $recorded['passportDeliveredAt']);
        $this->assertNull($recorded['stageAction']);
        $this->assertSame([], $recorded['availableTransitions']);
        $this->assertTrue($application->fresh()->isClosed());
        $this->assertSame(CipApplication::DECISION_GRANTED, $application->fresh()->decision);
        $this->assertSame(Phase::POST_APPROVAL, $application->fresh()->phase);

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_PASSPORT_DELIVERED,
            'actor_id' => $staff->id,
        ]);

        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return str_contains((string) $mail->subjectLine, 'PASSPORT DELIVERED');
        });
    }

    public function test_a_bare_status_change_cannot_skip_the_passport_delivered_date(): void
    {
        $staff = $this->staff();
        [$application] = $this->intoReadyForDelivery($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::PASSPORT_DELIVERED,
            ])
            ->assertStatus(422);

        $this->assertSame(Status::PASSPORT_RECEIVED, $application->fresh()->status);
        $this->assertNull($application->fresh()->passport_delivered_at);
        $this->assertFalse($application->fresh()->isClosed());
    }

    public function test_a_closed_file_refuses_further_uploads(): void
    {
        $staff = $this->staff();
        [$application, $person] = $this->intoClosed($staff);

        $epp = $person->documents()->where('type', PassportRequirements::ORIGINAL_TRANSLATIONS)->first();
        $this->assertTrue(Package::locksDocument($epp));

        $docs = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application.applicant.documents');

        $this->assertFalse(collect($docs)->firstWhere('type', PassportRequirements::ORIGINAL_TRANSLATIONS)['canUpload']);

        $this->actingAs($staff)
            ->post('/portal/cip/documents/'.$epp->uuid.'/file', [
                'file' => UploadedFile::fake()->create('epp.pdf', 40, 'application/pdf'),
            ], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('message', Confirmation::CLOSED_MESSAGE);

        $this->assertFalse($epp->fresh()->isFilled());
        $this->assertSame(Status::PASSPORT_DELIVERED, $application->fresh()->status);
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

    public function test_a_file_filed_into_post_approval_gets_one_set_of_person_folders(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $application->forceFill(['phase' => Phase::POST_APPROVAL])->save();
        $this->mainApplicant($application);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'first_name' => 'Kid', 'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(8),
        ]);

        PostApproval::prepare($application->fresh()->load('people'), $staff);

        $fresh = $application->fresh();
        $root = Folder::find($fresh->folder_id);
        $postRoot = Folder::find($fresh->post_approval_folder_id);

        $loose = Folder::where('parent_id', $root->id)->pluck('name')->all();
        $inside = Folder::where('parent_id', $postRoot->id)->pluck('name')->all();

        /*
         * The people belong to the post-approval drawer, and ONLY there. They
         * used to be created in both places, so every person on the file was
         * listed twice in the client folder with one of each pair permanently empty.
         */
        $this->assertContains('Main Applicant', $inside);
        $this->assertNotContains('Main Applicant', $loose);
        $this->assertNotContains('Dependent 1', $loose);

        // The shared drawer is still out here: it is not post-approval paper.
        $this->assertContains(Tree::ADDITIONAL, $loose);
        $this->assertContains(Tree::POST_APPROVAL, $loose);
    }

    /**
     * Soft-deleted duplicate dependents must not leave an empty Dependent N folder.
     */
    public function test_orphan_dependent_folders_are_pruned_after_a_person_is_removed(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $application->forceFill(['phase' => Phase::POST_APPROVAL])->save();
        $this->mainApplicant($application);
        $live = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'first_name' => 'Ahmed',
            'last_name' => 'Ishan',
            'date_of_birth' => now()->subYears(10),
        ]);

        PostApproval::prepare($application->fresh()->load('people'), $staff);

        $postRoot = Folder::find($application->fresh()->post_approval_folder_id);
        $orphan = Folder::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Dependent 8',
            'folder_type' => Folder::TYPE_USER,
            'parent_id' => $postRoot->id,
            'client_id' => $postRoot->client_id,
            'owner_id' => $postRoot->owner_id,
            'created_by' => $staff->id,
        ]);
        $ghost = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'first_name' => 'Ahmed',
            'last_name' => 'Ishan',
            'post_approval_folder_id' => $orphan->id,
        ]);
        $ghost->delete();

        $this->assertSame(2, Folder::where('parent_id', $postRoot->id)->where('name', 'like', 'Dependent%')->count());

        Tree::resyncNames($application->fresh()->load('people'));

        $names = Folder::where('parent_id', $postRoot->id)->pluck('name')->all();
        $this->assertContains('Dependent 1', $names);
        $this->assertNotContains('Dependent 8', $names);
        $this->assertTrue($orphan->fresh()->trashed());
        $this->assertNull($ghost->fresh()->post_approval_folder_id);
        $this->assertNotNull($live->fresh()->post_approval_folder_id);
    }

    public function test_a_file_that_reached_post_approval_keeps_its_pre_approval_folders(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $this->mainApplicant($application);

        // Filed and submitted the ordinary way first.
        Tree::provision($application->fresh()->load('people'), $staff);
        $application->forceFill([
            'phase' => Phase::POST_APPROVAL,
            'submitted_at' => now()->subMonth(),
        ])->save();

        PostApproval::prepare($application->fresh()->load('people'), $staff);

        $root = Folder::find($application->fresh()->folder_id);
        $loose = Folder::where('parent_id', $root->id)->pluck('name')->all();

        // Those folders hold the package that went to the Unit. Reaching
        // post-approval does not make them go away.
        $this->assertContains('Main Applicant', $loose);
    }

    public function test_the_whole_firm_may_correct_people_on_a_post_approval_file(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $this->mainApplicant($application);
        $application->forceFill(['phase' => Phase::POST_APPROVAL])->save();

        $employee = User::create([
            'name' => 'Emma Employee', 'email' => 'emma@example.com',
            'password' => bcrypt('password12345'),
        ]);
        $employee->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => Role::EMPLOYEE,
        ])->save();

        /*
         * An Employee holds no cip.create, so filing is not theirs. Correcting
         * a name on a file the firm is already working through is, and it
         * should not wait for whoever happens to hold that capability.
         */
        $this->assertFalse(CipAccess::canCreate($employee));
        $this->assertTrue(CipAccess::canEditPostApprovalPeople($employee));
        $this->assertTrue(CipAccess::canEditApplication($employee, $application));
    }

    public function test_the_provider_side_may_not_edit_a_post_approval_file(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $application->forceFill(['phase' => Phase::POST_APPROVAL])->save();

        $contact = User::create([
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'password' => bcrypt('password12345'),
        ]);
        $contact->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => Role::CLIENT,
        ])->save();

        // Not an omission: they filed the application, the firm carries it
        // from the decision on, and a field changing under them is exactly
        // what this prevents.
        $this->assertFalse(CipAccess::canEditPostApprovalPeople($contact));
        $this->assertFalse(CipAccess::canEditApplication($contact, $application));
    }

    /**
     * Brief sections 7 and 9: a receipt is recorded once, from the Pending
     * status it ends. Updates Required at the NIC stage has an edge back to
     * Apply for NIC for the checklist to walk, and the date verb followed it:
     * the bar offered "Record COR received" again, and pressing it rewrote
     * the real date and announced the COR a second time.
     */
    public function test_updates_required_at_the_nic_stage_is_not_offered_the_cor_received_date_again(): void
    {
        $staff = $this->staff();
        [$application, $person] = $this->intoApplyForNic($staff);

        $r3 = $person->documents()->where('type', NicRequirements::R3_FORM)->first();
        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            NicRequirements::R3_FORM,
            UploadedFile::fake()->create('r3.pdf', 40, 'application/pdf'),
            $staff,
        );
        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$r3->uuid.'/request-changes', ['comment' => 'The witness stamp is missing.'])
            ->assertOk();
        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);

        $record = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertNull($record['stageAction'], 'No date is on offer while a paper is sent back.');
        $this->assertSame(Status::PENDING_NIC, $record['stageHold']['to']);
        $this->assertSame('Every document must be Ready for submission first.', $record['stageHold']['note']);
        $this->assertNull(Stages::payload($application->fresh(), $staff));

        // Nor is Post-Approval a next step from here: the COR is long done.
        $this->assertNotContains(Status::POST_APPROVAL, Engine::availableTransitions($application->fresh(), $staff));
        $this->assertNotContains(
            Status::POST_APPROVAL,
            array_column($record['availableTransitions'], 'value'),
        );
        // And the way back to Apply for NIC is shut while the paper is out.
        $this->assertNotContains(Status::APPLY_FOR_NIC, Engine::availableTransitions($application->fresh(), $staff));

        Mail::fake();

        // By hand it would only bounce: refused, with a reason or without,
        // and the refusal names the paper.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', ['status' => Status::APPLY_FOR_NIC])
            ->assertStatus(422)
            ->assertJsonPath('blockers.0.label', $r3->label);
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::APPLY_FOR_NIC, 'note' => 'Moving it on anyway.',
            ])
            ->assertStatus(422);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::COR_RECEIVED, 'date' => '2026-09-01',
            ])
            ->assertStatus(422);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', ['status' => Status::POST_APPROVAL])
            ->assertStatus(422);

        $fresh = $application->fresh();
        $this->assertSame('2026-08-21', $fresh->cor_received_at->toDateString());
        $this->assertSame(Status::UPDATE_REQUIRED, $fresh->status);
        Mail::assertNothingQueued();

        // The checklist still brings it back by itself, and says so under
        // the status it returns to: the COR did not arrive a second time.
        DocumentSlots::fill(
            $person->fresh(['application', 'documents']),
            NicRequirements::R3_FORM,
            UploadedFile::fake()->create('r3-v2.pdf', 42, 'application/pdf'),
            $staff,
        );
        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$r3->uuid.'/approve')
            ->assertOk();

        $this->assertSame(Status::APPLY_FOR_NIC, $application->fresh()->status);
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => str_contains((string) $mail->subjectLine, ' - APPLY FOR NIC - '));
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => str_contains((string) $mail->subjectLine, 'COR RECEIVED'));
    }

    public function test_updates_required_at_the_passport_stage_is_not_offered_the_nic_received_date_again(): void
    {
        $staff = $this->staff();
        [$application] = $this->intoApplyForPassport($staff);

        // Put by hand, with a reason, the way an officer would.
        Engine::set($application->fresh(), Status::UPDATE_REQUIRED, $staff, ['note' => 'Photos are missing.']);

        $fresh = $application->fresh();
        $this->assertSame(Status::UPDATE_REQUIRED, $fresh->status);
        $this->assertNull(Stages::payload($fresh, $staff));
        $this->assertSame(Status::PENDING_PASSPORT, Stages::hold($fresh, $staff)['to'] ?? null);
        $this->assertNotContains(Status::POST_APPROVAL, Engine::availableTransitions($fresh, $staff));

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::NIC_RECEIVED, 'date' => '2026-09-02',
            ])
            ->assertStatus(422);

        $this->assertSame('2026-08-23', $application->fresh()->nic_received_at->toDateString());

        /*
         * Nothing was sent back, so no document verb is coming to walk the
         * file home. Apply for Passport is offered as an ordinary step, asks
         * for no date, and is told as a return, not as the NIC arriving.
         */
        $this->assertContains(Status::APPLY_FOR_PASSPORT, Engine::availableTransitions($fresh, $staff));
        $this->assertNotContains(Status::APPLY_FOR_NIC, Engine::availableTransitions($fresh, $staff));

        Mail::fake();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', ['status' => Status::APPLY_FOR_PASSPORT])
            ->assertOk()
            ->assertJsonPath('application.status', Status::APPLY_FOR_PASSPORT)
            ->assertJsonPath('application.nicReceivedAt', '2026-08-23');

        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => str_contains((string) $mail->subjectLine, ' - APPLY FOR PASSPORT - '));
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => str_contains((string) $mail->subjectLine, 'NIC RECEIVED'));
    }

    /**
     * The sentence about documents is said only while it is true. A file put
     * on Updates Required by hand with every paper accepted is waiting on no
     * document, and its way back is there to press.
     */
    public function test_a_file_waiting_on_no_document_is_not_told_it_is(): void
    {
        $staff = $this->staff();
        [$application] = $this->intoApplyForNic($staff);
        $this->fileRequiredCor($application->fresh(['people']), $staff);
        $this->approveRequiredCor($application->fresh(), $staff);

        // An ordinary press, the row the menu offers at Apply for NIC.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', ['status' => Status::UPDATE_REQUIRED])
            ->assertOk()
            ->assertJsonPath('application.status', Status::UPDATE_REQUIRED)
            ->assertJsonPath('application.stageAction', null)
            ->assertJsonPath('application.stageHold', null);

        $fresh = $application->fresh();
        $this->assertNull(Stages::hold($fresh, $staff));
        $this->assertContains(Status::APPLY_FOR_NIC, Engine::availableTransitions($fresh, $staff));

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', ['status' => Status::APPLY_FOR_NIC])
            ->assertOk()
            ->assertJsonPath('application.status', Status::APPLY_FOR_NIC)
            ->assertJsonPath('application.corReceivedAt', '2026-08-21')
            ->assertJsonPath('application.stageAction.key', Stages::NIC_SUBMITTED);

        // Outside the lane there is never anything to say.
        $pre = $this->application($staff);
        $this->assertNull(Stages::hold($pre->fresh(), $staff));
    }

    /**
     * A person's own NIC step waits on their own papers, and their menu says
     * so; somebody who owes nothing in the pack is told nothing.
     */
    public function test_a_person_is_told_when_their_own_documents_hold_their_step(): void
    {
        $staff = $this->staff();
        [$application] = $this->intoApplyForNic($staff);

        $applicant = fn () => $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application.applicant');

        $owing = $applicant();
        $this->assertSame('Every document must be Ready for submission first.', $owing['statusHold']);
        $this->assertNotContains(Status::PENDING_NIC, array_column($owing['availableStatuses'], 'value'));

        $this->fileRequiredCor($application->fresh(['people']), $staff);
        $this->approveRequiredCor($application->fresh(), $staff);

        $ready = $applicant();
        $this->assertNull($ready['statusHold']);
        $this->assertContains(Status::PENDING_NIC, array_column($ready['availableStatuses'], 'value'));
    }

    /**
     * Each step is recorded from the one status it follows. The date verb
     * names the status it lands on, so a status menu can offer that row.
     */
    public function test_each_dated_step_is_offered_only_from_the_status_it_follows(): void
    {
        $staff = $this->staff();
        [$application] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);

        // Apply for COR, unconfirmed: nothing to record, and the menu says why.
        $fresh = $application->fresh();
        $this->assertSame(Status::APPLY_FOR_COR, $fresh->status);
        $this->assertNull(Stages::payload($fresh, $staff));
        $this->assertSame(
            ['to' => Status::PENDING_COR, 'note' => 'Confirm submission first.'],
            Stages::hold($fresh, $staff),
        );
        $officer = $this->staff(Role::REVIEWING_OFFICER);
        $this->assertSame(
            'Waiting for the service provider to confirm submission.',
            Stages::hold($fresh, $officer)['note'] ?? null,
        );

        Confirmation::confirm($fresh, $this->contactOn($application, $staff));

        $walk = [
            [Stages::COR_SUBMITTED, Status::PENDING_COR],
            [Stages::COR_RECEIVED, Status::COR_RECEIVED],
            [Stages::NIC_SUBMITTED, Status::PENDING_NIC],
            [Stages::NIC_RECEIVED, Status::NIC_RECEIVED],
            [Stages::PASSPORT_SUBMITTED, Status::PENDING_PASSPORT],
            [Stages::PASSPORT_RECEIVED, Status::PASSPORT_RECEIVED],
            [Stages::PASSPORT_DELIVERED, Status::PASSPORT_DELIVERED],
        ];

        foreach ($walk as [$key, $to]) {
            if (in_array($key, [Stages::NIC_SUBMITTED, Stages::PASSPORT_SUBMITTED], true)) {
                $this->fileRequiredCor($application->fresh(['people']), $staff);
                $this->approveRequiredCor($application->fresh(), $staff);
            }

            $record = $this->actingAs($staff)
                ->getJson('/portal/cip/applications/'.$application->uuid)
                ->assertOk()
                ->json('application');

            $this->assertSame($key, $record['stageAction']['key'] ?? null);
            $this->assertSame($to, $record['stageAction']['to'] ?? null);
            $this->assertNull($record['stageHold'], 'A step that can be taken is waiting on nothing.');

            // Every other step is refused from here, in either direction.
            foreach ($walk as [$other]) {
                if ($other === $key) {
                    continue;
                }

                $before = $application->fresh()->status;

                try {
                    Stages::record($application->fresh(), $staff, $other, Carbon::parse('2026-09-09'));
                    $recorded = true;
                } catch (\InvalidArgumentException) {
                    $recorded = false;
                }

                // The step that led here may be pressed again to correct its
                // day; that is the one exception, and nothing moves at all.
                $this->assertSame(
                    $before === collect($walk)->firstWhere(0, $other)[1],
                    $recorded,
                    $other.' answered wrongly while the file stood at '.$before,
                );
                $this->assertSame($before, $application->fresh()->status, $other.' moved the file from '.$before);
            }

            Stages::record($application->fresh(), $staff, $key, Carbon::parse('2026-08-21'));
            $this->assertSame($to, $application->fresh()->status);

            if ($to === Status::COR_RECEIVED) {
                Engine::apply($application->fresh(), Status::APPLY_FOR_NIC, $staff);
            } elseif ($to === Status::NIC_RECEIVED) {
                Engine::apply($application->fresh(), Status::APPLY_FOR_PASSPORT, $staff);
            }
        }
    }

    /**
     * Brief section 12 closes a file on the day its passport is delivered. A
     * file the lane denied has no passport; it closes from the status menu
     * and no delivery date is written on the way.
     */
    public function test_a_denied_file_closes_from_the_status_menu_without_a_passport_date(): void
    {
        $staff = $this->staff();
        [$application] = $this->corFile($staff);

        \App\Support\Cip\Decision::record(
            $application->fresh(),
            $staff,
            Status::POST_DENIED,
            Carbon::parse('2026-08-19'),
            'Refused.',
            $this->cipDecisionLetterPdf(),
        );
        $this->assertSame(Status::POST_DENIED, $application->fresh()->status);

        // The delivery date is not a way to close it.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::PASSPORT_DELIVERED, 'date' => '2026-08-30',
            ])
            ->assertStatus(422);
        $this->assertSame(Status::POST_DENIED, $application->fresh()->status);

        $timeline = collect($this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application.milestones'));
        $delivered = $timeline->firstWhere('key', 'passport_delivered');
        if ($delivered !== null) {
            $this->assertFalse($delivered['canRecord'], 'The timeline does not offer the delivery date either.');
        }

        Mail::fake();

        // Listed as an override, so it is taken like one: not without a reason.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', ['status' => Status::CLOSED])
            ->assertStatus(422);
        $this->assertSame(Status::POST_DENIED, $application->fresh()->status);

        // And not by somebody who may not move the file at all.
        $this->actingAs($this->contactOn($application, $staff))
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::CLOSED, 'note' => 'Please close this.',
            ])
            ->assertForbidden();
        $this->assertSame(Status::POST_DENIED, $application->fresh()->status);
        Mail::assertNothingQueued();

        $closed = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::CLOSED,
                'note' => 'Refusal accepted by the applicant.',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::CLOSED, $closed['status']);
        $this->assertNull($closed['passportDeliveredAt']);
        $this->assertNull($application->fresh()->passport_delivered_at);
        $this->assertSame(Status::POST_DENIED, $application->fresh()->decision);

        // Told as a file closed, not as a passport delivered.
        Mail::assertQueued(Postcard::class, function (Postcard $mail) {
            return str_contains((string) $mail->subjectLine, ' - FILE CLOSED - ')
                && ! str_contains((string) json_encode($mail->payload), 'passport has been delivered');
        });

        // And once closed, a press on the delivery date still writes nothing.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::PASSPORT_DELIVERED, 'date' => '2026-08-31',
            ])
            ->assertStatus(422);
        $this->assertNull($application->fresh()->passport_delivered_at);
    }

    /**
     * The closed-without-a-passport refusal reads the file as it stands. A
     * denial that was undone leaves its mark in the decision column, and a
     * file that then worked the whole lane still closes on its delivery.
     * A file that is not denied still cannot be closed without that date.
     */
    public function test_a_file_once_denied_still_closes_on_its_passport_delivery(): void
    {
        $staff = $this->staff();
        [$application] = $this->intoReadyForDelivery($staff);
        $application->forceFill(['decision' => Status::POST_DENIED])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::PASSPORT_DELIVERED, 'note' => 'Closing it.',
            ])
            ->assertStatus(422);
        $this->assertSame(Status::PASSPORT_RECEIVED, $application->fresh()->status);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::PASSPORT_DELIVERED, 'date' => '2026-08-27',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::PASSPORT_DELIVERED)
            ->assertJsonPath('application.passportDeliveredAt', '2026-08-27');

        // Its day can still be corrected the way every step's can.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::PASSPORT_DELIVERED, 'date' => '2026-08-28',
            ])
            ->assertOk()
            ->assertJsonPath('application.passportDeliveredAt', '2026-08-28');
    }

    /**
     * Pressing a step the file already stands on rewrites its day and moves
     * nothing, so the engine's permission check was never reached: anybody
     * who could open the file could change a date the firm recorded.
     */
    public function test_a_service_provider_cannot_rewrite_a_recorded_date(): void
    {
        $staff = $this->staff();
        [$application] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        Confirmation::confirm($application->fresh(), $this->contactOn($application, $staff));
        Stages::record($application->fresh(), $staff, Stages::COR_SUBMITTED, Carbon::parse('2026-08-20'));
        Stages::record($application->fresh(), $staff, Stages::COR_RECEIVED, Carbon::parse('2026-08-21'));
        $application = $application->fresh();
        $contact = $this->contactOn($application, $staff);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::COR_RECEIVED, 'date' => '2026-01-01', 'corNumber' => 'FORGED',
            ])
            ->assertForbidden();

        $fresh = $application->fresh();
        $this->assertSame('2026-08-21', $fresh->cor_received_at->toDateString());
        $this->assertNotSame('FORGED', $fresh->cor_number);

        // The firm still corrects its own date this way.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/stage', [
                'stage' => Stages::COR_RECEIVED, 'date' => '2026-08-22',
            ])
            ->assertOk();
        $this->assertSame('2026-08-22', $application->fresh()->cor_received_at->toDateString());
        $this->assertSame(Status::COR_RECEIVED, $application->fresh()->status);
    }

    /**
     * Brief section 5 asks the provider to confirm submission as the file
     * reaches Apply for COR. A file that returns there with its package
     * already confirmed is not asked a second time.
     */
    public function test_a_confirmed_package_is_not_asked_to_confirm_again(): void
    {
        Mail::fake();

        $staff = $this->staff();
        [$application] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);

        // The checklist moves the file as the system, so there are no
        // officer initials in front of the status here.
        $ask = fn (Postcard $mail) => str_contains((string) $mail->subjectLine, 'APPLY FOR COR - ')
            && str_contains((string) json_encode($mail->payload), 'Confirm submission');
        Mail::assertQueued(Postcard::class, $ask);

        $contact = $this->contactOn($application, $staff);
        Confirmation::confirm($application->fresh(), $contact);

        Mail::fake();
        $asked = fn () => \Illuminate\Support\Facades\DB::table('portal_notifications')
            ->where('type', 'cip.apply-for-cor')->count();
        $before = $asked();

        Engine::set($application->fresh(), Status::UPDATE_REQUIRED, $staff, ['note' => 'Checking the Oath.']);
        Review::settle($application->fresh(), $staff);

        $this->assertSame(Status::APPLY_FOR_COR, $application->fresh()->status);
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => str_contains((string) $mail->subjectLine, 'APPLY FOR COR - '));
        Mail::assertNotQueued(Postcard::class, $ask);

        // The bell is an ordinary change of status too, with no confirm link.
        $this->assertSame($before, $asked(), 'No second bell asks for a confirmation already given.');
        $bell = \Illuminate\Support\Facades\DB::table('portal_notifications')
            ->where('user_id', $contact->id)->where('type', 'cip.status')->latest('id')->first();
        $this->assertNotNull($bell);
        $this->assertStringNotContainsString('confirm=1', (string) $bell->action_url);
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

    /** @return array{0: CipApplication, 1: CipPerson} */
    private function intoApplyForNic(User $staff): array
    {
        [$application, $person] = $this->corFile($staff);
        $this->fileRequiredCor($application, $staff);
        $this->approveRequiredCor($application, $staff);
        Confirmation::confirm($application->fresh(), $this->contactOn($application, $staff));
        Stages::record($application->fresh(), $staff, Stages::COR_SUBMITTED, Carbon::parse('2026-08-20'));
        Stages::record($application->fresh(), $staff, Stages::COR_RECEIVED, Carbon::parse('2026-08-21'));
        Engine::apply($application->fresh(), Status::APPLY_FOR_NIC, $staff);

        $application = $application->fresh(['people.documents.requirement']);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $person->setRelation('application', $application);

        return [$application, $person];
    }

    /** @return array{0: CipApplication, 1: CipPerson} */
    private function intoApplyForPassport(User $staff): array
    {
        [$application, $person] = $this->intoApplyForNic($staff);
        // Sending the NIC pack requires the pack, here as in the portal.
        $this->fileRequiredCor($application->fresh(['people']), $staff);
        $this->approveRequiredCor($application->fresh(), $staff);
        Stages::record($application->fresh(), $staff, Stages::NIC_SUBMITTED, Carbon::parse('2026-08-22'));
        Stages::record($application->fresh(), $staff, Stages::NIC_RECEIVED, Carbon::parse('2026-08-23'));
        Engine::apply($application->fresh(), Status::APPLY_FOR_PASSPORT, $staff);

        $application = $application->fresh(['people.documents.requirement']);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $person->setRelation('application', $application);

        return [$application, $person];
    }

    /** @return array{0: CipApplication, 1: CipPerson} */
    private function intoPendingPassport(User $staff): array
    {
        [$application, $person] = $this->intoApplyForPassport($staff);
        // And the passport pack before the passport application.
        $this->fileRequiredCor($application->fresh(['people']), $staff);
        $this->approveRequiredCor($application->fresh(), $staff);
        Stages::record($application->fresh(), $staff, Stages::PASSPORT_SUBMITTED, Carbon::parse('2026-08-24'));

        $application = $application->fresh(['people.documents.requirement']);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $person->setRelation('application', $application);

        return [$application, $person];
    }

    /** @return array{0: CipApplication, 1: CipPerson} */
    private function intoReadyForDelivery(User $staff): array
    {
        [$application, $person] = $this->intoPendingPassport($staff);
        Stages::record($application->fresh(), $staff, Stages::PASSPORT_RECEIVED, Carbon::parse('2026-08-25'));

        $application = $application->fresh(['people.documents.requirement']);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $person->setRelation('application', $application);

        return [$application, $person];
    }

    /** @return array{0: CipApplication, 1: CipPerson} */
    private function intoClosed(User $staff): array
    {
        [$application, $person] = $this->intoReadyForDelivery($staff);
        Stages::record($application->fresh(), $staff, Stages::PASSPORT_DELIVERED, Carbon::parse('2026-08-26'));

        $application = $application->fresh(['people.documents.requirement']);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $person->setRelation('application', $application);

        return [$application, $person];
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
