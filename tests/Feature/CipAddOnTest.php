<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipApplicationAssignment;
use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\AddOn;
use App\Support\Cip\AddOnRequirements;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentEngine;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Intake;
use App\Support\Cip\Notices;
use App\Support\Cip\Package;
use App\Support\Cip\Phase;
use App\Support\Cip\Review;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class CipAddOnTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Storage::fake('local');
    }

    public function test_the_add_on_form_names_the_types_and_the_lane(): void
    {
        $staff = $this->staff();

        $body = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/form?phase='.Phase::ADD_ON)
            ->assertOk()
            ->json();

        $this->assertSame(Phase::ADD_ON, $body['phase']);
        $this->assertSame(
            ['spouse', 'dependent_under_16', 'dependent_16_over'],
            array_column($body['addonTypes'], 'value'),
        );
        $this->assertSame(
            ['spouse', 'son', 'daughter', 'other_qualified_dependent'],
            array_column($body['addonRelationships'], 'value'),
        );
    }

    public function test_parent_lookup_resolves_a_granted_file_by_cip_and_cor(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $body = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/add-on/parent?cipNumber='.$parent->cip_number.'&corNumber='.$parent->cor_number)
            ->assertOk()
            ->json();

        $this->assertTrue($body['ok']);
        $this->assertSame($parent->uuid, $body['parent']['id']);
        $this->assertSame('CHEN WEI', $body['parent']['applicantName']);
        $this->assertNull($body['openAddOn']);
    }

    public function test_parent_lookup_refuses_an_unknown_cip_number(): void
    {
        $staff = $this->staff();

        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/add-on/parent?cipNumber=NO-SUCH&corNumber=COR-1')
            ->assertUnprocessable()
            ->assertJsonPath('errors.cipNumber.0', 'CIP application number not found.');
    }

    public function test_parent_lookup_refuses_a_cor_mismatch(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/add-on/parent?cipNumber='.$parent->cip_number.'&corNumber=WRONG')
            ->assertUnprocessable()
            ->assertJsonPath('errors.corNumber.0', 'COR number does not match this CIP application.');
    }

    public function test_parent_lookup_refuses_a_file_that_was_not_granted(): void
    {
        $staff = $this->staff();
        $provider = $this->provider($staff);
        $open = Applications::create($provider, $staff, ['investment_type' => 'real_estate']);
        $this->mainApplicant($open, 'Chen', 'Wei');
        $open->forceFill([
            'status' => Status::NEW,
            'cip_number' => '10T1GADD02P',
            'cor_number' => 'COR-OPEN',
        ])->save();

        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/add-on/parent?cipNumber=10T1GADD02P&corNumber=COR-OPEN')
            ->assertUnprocessable()
            ->assertJsonPath('message', 'The parent application must be granted.');
    }

    public function test_parent_lookup_refuses_a_main_applicant_name_mismatch(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/add-on/parent?cipNumber='.$parent->cip_number.'&corNumber='.$parent->cor_number.'&applicantName=Wrong+Name')
            ->assertUnprocessable()
            ->assertJsonPath('errors.applicantName.0', 'Main applicant name does not match this CIP application.');
    }

    public function test_filing_requires_the_main_applicant_name_and_relationship(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $this->file($staff, $this->addOnPayload($parent, [
            'parentApplicantName' => '',
        ]))->assertUnprocessable();

        $this->file($staff, $this->addOnPayload($parent, [
            'parentApplicantName' => 'Someone Else',
        ]))->assertUnprocessable();

        $this->file($staff, $this->addOnPayload($parent, [
            'relationship' => '',
        ]))->assertUnprocessable();
    }

    public function test_an_agent_can_file_a_spouse_add_on_against_a_granted_parent(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $body = $this->file($staff, $this->addOnPayload($parent, [
            'addonType' => AddOn::TYPE_SPOUSE,
            'firstName' => 'Mei',
            'lastName' => 'Wei',
            'dateOfBirth' => '1988-06-01',
            'relationship' => CipPerson::RELATIONSHIP_SPOUSE,
        ]))
            ->assertCreated()
            ->json('application');

        $this->assertSame(Phase::ADD_ON, $body['phase']);
        $this->assertSame(Status::NEW, $body['status']);
        $this->assertSame(AddOn::TYPE_SPOUSE, $body['addonType']);
        $this->assertSame($parent->uuid, $body['parent']['id']);
        $this->assertSame('MEI WEI', $body['applicant']['name']);
        $this->assertSame(ApplicantType::SPOUSE, $body['applicant']['applicantType']);
        $this->assertSame(CipPerson::RELATIONSHIP_SPOUSE, $body['applicant']['relationship']);
        $this->assertSame('China', $body['applicant']['nationality']);
        $this->assertSame($parent->investment_type, $body['investmentTypeValue']);
        $this->assertFalse($body['sponsored']);

        $row = CipApplication::query()->where('uuid', $body['id'])->first();
        $this->assertSame($parent->id, $row->parent_application_id);
        $this->assertSame($parent->provider_id, $row->provider_id);
        $this->assertSame(1, $row->people()->count());

        $yy = now()->format('y');
        $this->assertSame("GAL-AO-{$yy}-00001", $body['number']);
        $this->assertSame("GAL-AO-{$yy}-00001", $body['internalNumber']);
        $this->assertSame("GAL{$yy}-00001", $parent->internal_number);
    }

    public function test_an_authorized_agent_add_on_waits_at_new_until_assigned(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);
        $contact = $this->providerContact($parent->provider);

        $body = $this->file($contact, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->firstOrFail();

        $this->assertSame(Status::NEW, $application->status);
        $this->assertNull($application->assigned_officer_id);
        $this->assertSame(0, CipApplicationAssignment::query()
            ->where('application_id', $application->id)
            ->count());
    }

    public function test_assigning_an_add_on_starts_review_and_emails_the_officer_the_named_fields(): void
    {
        Mail::fake();

        $staff = $this->staff();
        $officer = $this->officer();
        $parent = $this->grantedParent($staff);
        $contact = $this->providerContact($parent->provider);

        $body = $this->file($contact, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->firstOrFail();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/assignments', [
                'userId' => $officer->id,
            ])
            ->assertCreated();

        $fresh = $application->fresh();
        $this->assertSame(Status::REVIEW_APPLICATION, $fresh->status);
        $this->assertSame($officer->id, $fresh->assigned_officer_id);

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($application, $parent) {
            if (! $mail->hasTo('rita-addon@example.com')) {
                return false;
            }

            $details = collect($mail->payload['details'])->mapWithKeys(fn ($row) => [$row[0] => $row[1]]);
            $url = $mail->payload['button']['url'] ?? '';

            return $details['Add-On Reference Number'] === $application->displayNumber()
                && $details['CIP Application Number'] === $parent->cip_number
                && $details['Main Applicant Name'] === 'CHEN WEI'
                && $details['Add-On Applicant Name'] === 'MEI WEI'
                && $details['Direct Portal Link'] === $url
                && str_starts_with($url, rtrim(config('app.url'), '/').'/citizenship-applications/')
                && $mail->subjectLine === 'AA - REVIEW APPLICATION - '.$application->displayNumber()
                    .' - MEI WEI - '.now()->format('d.m.Y');
        });
    }

    public function test_add_on_notification_subjects_match_the_brief(): void
    {
        $this->travelTo('2026-08-12 12:00:00');

        $kim = $this->account(Role::ADMINISTRATOR, 'Kim Morgan', 'kim-addon@example.com');
        $facts = [
            'number' => 'GAL-AO-26-00001',
            'applicant' => 'Jane Smith',
            'familySize' => 1,
            'addOn' => true,
        ];

        $this->assertSame(
            'KM - NEW APPLICATION - GAL-AO-26-00001 - JANE SMITH - 12.08.2026',
            Notices::line($facts, Status::NEW, $kim),
        );

        $this->travelTo('2026-08-13 12:00:00');
        $this->assertSame(
            'KM - REVIEW APPLICATION - GAL-AO-26-00001 - JANE SMITH - 13.08.2026',
            Notices::line($facts, Status::REVIEW_APPLICATION, $kim),
        );

        $this->travelTo('2026-08-15 12:00:00');
        $this->assertSame(
            'KM - ASSESSMENT FEEDBACK - GAL-AO-26-00001 - JANE SMITH - 15.08.2026',
            Notices::line($facts, Status::ASSESSMENT_FEEDBACK, $kim),
        );

        $this->travelTo('2026-08-18 12:00:00');
        $this->assertSame(
            'KM - READY TO SUBMIT - GAL-AO-26-00001 - JANE SMITH - 18.08.2026',
            Notices::line($facts, Status::READY_TO_SUBMIT, $kim),
        );

        $this->travelTo('2026-08-20 12:00:00');
        $this->assertSame(
            'KM - APPROVED - GAL-AO-26-00001 - JANE SMITH - 20.08.2026',
            Notices::line($facts, Status::GRANTED, $kim),
        );
        $this->assertStringNotContainsString('(F', Notices::line($facts, Status::GRANTED, $kim));
        $this->assertStringNotContainsString('GRANTED', Notices::line($facts, Status::GRANTED, $kim));
    }

    public function test_approving_an_add_on_uses_approved_in_the_subject_and_notifies_the_agent(): void
    {
        Mail::fake();
        $this->travelTo('2026-08-20 12:00:00');

        $staff = $this->staff();
        $parent = $this->grantedParent($staff);
        $contact = $this->providerContact($parent->provider);

        $body = $this->file($contact, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->firstOrFail();
        Tree::provision($application, $staff);
        $application->forceFill([
            'status' => Status::PENDING_REVIEW,
            'submitted_at' => '2026-08-18',
            'locked_at' => now(),
        ])->save();

        $this->postCipDecision($staff, $application->uuid, [
            'decision' => Status::GRANTED,
            'decidedAt' => '2026-08-20',
        ])->assertOk();

        $expected = 'AA - APPROVED - '.$application->displayNumber().' - MEI WEI - 20.08.2026';

        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gal-addon@example.com')
            && $mail->subjectLine === $expected);
        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('ada-addon@example.com')
            && $mail->subjectLine === $expected);
    }

    public function test_a_dependent_add_on_stores_son_and_the_older_bracket(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $body = $this->file($staff, $this->addOnPayload($parent, [
            'addonType' => AddOn::TYPE_DEPENDENT_16_OVER,
            'firstName' => 'Li',
            'lastName' => 'Wei',
            'dateOfBirth' => '2000-01-15',
            'relationship' => AddOn::RELATIONSHIP_SON,
            'gender' => 'Male',
        ]))
            ->assertCreated()
            ->json('application');

        $this->assertSame(AddOn::TYPE_DEPENDENT_16_OVER, $body['addonType']);
        $this->assertSame(ApplicantType::DEPENDENT_16_OVER, $body['applicant']['applicantType']);
        $this->assertSame('16 and over', $body['applicant']['ageBracketLabel']);
        $this->assertSame(AddOn::RELATIONSHIP_SON, $body['applicant']['relationship']);
        $this->assertSame('Son', $body['applicant']['label']);
    }

    public function test_only_one_add_on_may_be_in_progress_for_a_parent(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $this->file($staff, $this->addOnPayload($parent))->assertCreated();

        $this->file($staff, $this->addOnPayload($parent, [
            'firstName' => 'Other',
            'lastName' => 'Person',
            'passportNumber' => 'X9999999',
        ]))
            ->assertUnprocessable()
            ->assertJsonFragment(['message' => 'An Add-On application is already in progress for this file. Finish or close it before starting another.']);
    }

    public function test_a_second_add_on_is_allowed_once_the_first_is_granted(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $first = $this->file($staff, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        CipApplication::query()->where('uuid', $first['id'])->update(['status' => Status::GRANTED]);

        $second = $this->file($staff, $this->addOnPayload($parent, [
            'addonType' => AddOn::TYPE_DEPENDENT_UNDER_16,
            'firstName' => 'Bao',
            'lastName' => 'Wei',
            'dateOfBirth' => now()->subYears(8)->toDateString(),
            'relationship' => AddOn::RELATIONSHIP_DAUGHTER,
            'gender' => 'Female',
            'passportNumber' => 'X8888888',
        ]))
            ->assertCreated()
            ->json('application');

        $yy = now()->format('y');
        $this->assertSame("GAL-AO-{$yy}-00001", $first['number']);
        $this->assertSame("GAL-AO-{$yy}-00002", $second['number']);
        $this->assertSame("GAL{$yy}-00001", $parent->internal_number);
        $this->assertSame("GAL{$yy}-00001", $parent->fresh()->internal_number);
    }

    public function test_an_add_on_draft_is_numbered_on_the_first_keystroke(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $draft = Intake::createDraft($parent->provider, $staff, [
            'phase' => Phase::ADD_ON,
            'parentCipNumber' => $parent->cip_number,
            'parentCorNumber' => $parent->cor_number,
            'addonType' => AddOn::TYPE_SPOUSE,
            'firstName' => 'Mei',
            'lastName' => 'Wei',
        ]);

        $yy = now()->format('y');
        $this->assertSame(Phase::ADD_ON, $draft->phase);
        $this->assertSame(Status::DRAFT, $draft->status);
        $this->assertSame("GAL-AO-{$yy}-00001", $draft->internal_number);
        $this->assertSame("GAL-AO-{$yy}-00001", $draft->displayNumber());
    }

    public function test_an_add_on_refuses_a_type_that_does_not_match_the_date_of_birth(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $this->file($staff, $this->addOnPayload($parent, [
            'addonType' => AddOn::TYPE_DEPENDENT_UNDER_16,
            'dateOfBirth' => '1990-01-01',
            'relationship' => AddOn::RELATIONSHIP_SON,
        ]))->assertUnprocessable();
    }

    public function test_the_applications_table_filters_add_ons_onto_their_own_tab(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);
        $this->file($staff, $this->addOnPayload($parent))->assertCreated();

        $all = $this->actingAs($staff)->getJson('/portal/cip/applications')->assertOk()->json();
        $this->assertSame(2, $all['phaseCounts']['all']);
        $this->assertSame(1, $all['phaseCounts']['add_on']);
        $this->assertGreaterThanOrEqual(1, $all['phaseCounts']['post_approval'] + $all['phaseCounts']['pre_approval']);

        $addon = $this->actingAs($staff)
            ->getJson('/portal/cip/applications?phase='.Phase::ADD_ON)
            ->assertOk()
            ->json();

        $this->assertCount(1, $addon['applications']);
        $this->assertSame(Phase::ADD_ON, $addon['applications'][0]['phase']);
        $this->assertSame('MEI WEI', $addon['applications'][0]['applicantName']);
        $this->assertSame(AddOn::TYPE_SPOUSE, $addon['applications'][0]['addonType']);
        $this->assertSame($parent->uuid, $addon['applications'][0]['parent']['id']);
        $this->assertSame('GAL-AO-'.now()->format('y').'-00001', $addon['applications'][0]['number']);
        $this->assertSame('Spouse', $addon['applications'][0]['relationshipLabel']);
        $this->assertSame('10T1GADD01P', $addon['applications'][0]['parent']['cipNumber']);
        $this->assertSame('COR-1001', $addon['applications'][0]['parent']['corNumber']);
        $this->assertSame('CHEN WEI', $addon['applications'][0]['parent']['applicantName']);
    }

    public function test_the_add_on_table_can_be_searched_by_the_five_named_options(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);
        $this->file($staff, $this->addOnPayload($parent))->assertCreated();

        $find = fn (string $q, ?string $searchBy = null) => $this->actingAs($staff)
            ->getJson('/portal/cip/applications?phase='.Phase::ADD_ON.'&q='.urlencode($q).(
                $searchBy ? '&searchBy='.urlencode($searchBy) : ''
            ))
            ->assertOk()
            ->json('total');

        $this->assertSame(1, $find('GAL-AO-'.now()->format('y').'-00001'));
        $this->assertSame(1, $find('10T1GADD01P'));
        $this->assertSame(1, $find('COR-1001'));
        $this->assertSame(1, $find('Chen'));
        $this->assertSame(1, $find('Mei'));
        $this->assertSame(0, $find('Nobody at all'));
        $this->assertSame(0, $find('Galaxy'), 'provider name is not an Add-On search option');

        $this->assertSame(1, $find('10T1GADD01P', 'cip_number'));
        $this->assertSame(0, $find('Mei', 'cip_number'));
        $this->assertSame(1, $find('Mei', 'addon_applicant'));
        $this->assertSame(0, $find('Chen', 'addon_applicant'));
        $this->assertSame(1, $find('Chen', 'main_applicant'));
        $this->assertSame(0, $find('Mei', 'main_applicant'));
        $this->assertSame(1, $find('COR-1001', 'cor_number'));
        $this->assertSame(1, $find('GAL-AO', 'addon_number'));
    }

    public function test_the_dashboard_includes_an_add_on_lane(): void
    {
        $staff = $this->staff();

        $body = $this->actingAs($staff)->getJson('/portal/cip/dashboard')->assertOk()->json();

        $this->assertSame('Add-On Applications', $body['phases'][Phase::ADD_ON]['label']);
        $this->assertSame([
            'New Add-On Applications', 'Review Applications', 'Assessment Feedback',
            'Updates Required', 'Ready to Submit', 'Pending Review', 'Non-compliant',
            'Approved', 'Denied',
        ], array_column($body['phases'][Phase::ADD_ON]['buckets'], 'label'));
    }

    public function test_creating_an_add_on_opens_the_four_brief_folders(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $body = $this->file($staff, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->firstOrFail();
        $root = Folder::find($application->folder_id);
        $this->assertNotNull($root);

        $this->assertEqualsCanonicalizing(Tree::ADD_ON_DRAWERS, Folder::query()
            ->where('parent_id', $root->id)
            ->pluck('name')
            ->all());

        $person = $application->people()->first();
        $applicant = Folder::query()
            ->where('parent_id', $root->id)
            ->where('name', Tree::ADD_ON_APPLICANT)
            ->first();
        $this->assertNotNull($applicant);
        $this->assertSame($applicant->id, $person->folder_id);

        $additional = Folder::query()
            ->where('parent_id', $root->id)
            ->where('name', Tree::ADDITIONAL)
            ->first();
        $this->assertEqualsCanonicalizing(Tree::ADDITIONAL_DRAWERS, Folder::query()
            ->where('parent_id', $additional->id)
            ->pluck('name')
            ->all());

        $this->assertSame($additional->uuid, $body['additionalDocumentsFolder']);
        $this->assertSame(
            Folder::query()->where('parent_id', $root->id)->where('name', Tree::SUPPORTING)->value('uuid'),
            $body['supportingDocumentsFolder'],
        );
        $this->assertSame(
            Folder::query()->where('parent_id', $root->id)->where('name', Tree::ASSESSMENT_FEEDBACK)->value('uuid'),
            $body['assessmentFeedbackFolder'],
        );

        Tree::provision($application->fresh(['people']), $staff);
        $this->assertEqualsCanonicalizing(Tree::ADD_ON_DRAWERS, Folder::query()
            ->where('parent_id', $root->id)
            ->pluck('name')
            ->all());
    }

    public function test_add_on_identity_stays_in_the_applicant_folder_and_pack_scans_go_to_supporting(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $body = $this->file($staff, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->with('people')->firstOrFail();
        $person = $application->people->first();
        $supporting = Tree::supportingFolder($application);

        $photo = CipDocument::query()
            ->where('person_id', $person->id)
            ->where('type', DocumentTypes::PASSPORT_PHOTO)
            ->first();
        $this->assertNotNull($photo?->file_id);
        $this->assertSame($person->folder_id, FileItem::find($photo->file_id)->folder_id);

        $pack = CipDocument::query()
            ->where('person_id', $person->id)
            ->whereNotNull('file_id')
            ->where('type', '!=', DocumentTypes::PASSPORT_PHOTO)
            ->first();
        if ($pack) {
            $this->assertNotNull($supporting);
            $this->assertSame($supporting->id, FileItem::find($pack->file_id)->folder_id);
        }
    }

    public function test_the_add_on_form_lists_documents_for_the_selected_type(): void
    {
        $staff = $this->staff();

        $body = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/form?phase='.Phase::ADD_ON)
            ->assertOk()
            ->json('requirements');

        $keys = fn (string $type) => collect($body[$type])->pluck('key')->all();
        $listed = fn (string $type) => array_values(array_filter(
            AddOnRequirements::keys($type),
            fn (string $key) => $key !== DocumentTypes::PASSPORT_PHOTO,
        ));

        $this->assertEqualsCanonicalizing($listed(ApplicantType::SPOUSE), $keys('spouse'));
        $this->assertContains('police_certificate', $keys('spouse'));
        $this->assertContains('curriculum_vitae', $keys('spouse'));
        $this->assertContains(AddOnRequirements::G1, $keys('spouse'));

        $this->assertEqualsCanonicalizing($listed(ApplicantType::DEPENDENT_UNDER_16), $keys('dependent_under_16'));
        $this->assertNotContains('police_certificate', $keys('dependent_under_16'));
        $this->assertNotContains('curriculum_vitae', $keys('dependent_under_16'));
        $this->assertNotContains('professional_academic_certificates', $keys('dependent_under_16'));
        $this->assertContains(AddOnRequirements::G1, $keys('dependent_under_16'));

        $this->assertEqualsCanonicalizing($listed(ApplicantType::DEPENDENT_16_OVER), $keys('dependent_16_over'));
        $this->assertContains('police_certificate', $keys('dependent_16_over'));
        $this->assertContains('curriculum_vitae', $keys('dependent_16_over'));
        $this->assertContains('professional_academic_certificates', $keys('dependent_16_over'));

        $this->assertSame([], $keys('principal'));
        $this->assertSame([], $keys('sponsor'));
    }

    public function test_document_requirements_settings_expose_the_add_on_lane(): void
    {
        $admin = $this->staff();

        $types = collect($this->actingAs($admin)
            ->getJson('/portal/cip/requirements')
            ->assertOk()
            ->json('types'));

        $spouse = collect($types->firstWhere('value', ApplicantType::SPOUSE)['requirements']);
        $sl1 = $spouse->firstWhere('key', 'sl1_form');
        $this->assertTrue($sl1['atAddOn']);
        $this->assertTrue($sl1['atPreApproval']);

        $g1 = $spouse->firstWhere('key', AddOnRequirements::G1);
        $this->assertNotNull($g1);
        $this->assertTrue($g1['atAddOn']);
        $this->assertFalse($g1['atPreApproval']);
        $this->assertFalse($g1['required']);
        $this->assertSame(Tree::ADDITIONAL, $g1['folder']);
        $this->assertSame('G1 - Additional Document Name', $g1['label']);

        $principal = collect($types->firstWhere('value', ApplicantType::PRINCIPAL_APPLICANT)['requirements']);
        $this->assertFalse($principal->firstWhere('key', 'sl1_form')['atAddOn']);

        $under16 = collect($types->firstWhere('value', ApplicantType::DEPENDENT_UNDER_16)['requirements']);
        $this->assertNull($under16->firstWhere('key', 'police_certificate'));
    }

    public function test_an_additional_document_lands_in_additional_documents_named_g1(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $body = $this->file($staff, $this->addOnPayload($parent, [
            'additionalDocumentG1' => [UploadedFile::fake()->create('extra.pdf', 40, 'application/pdf')],
        ]))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->with('people')->firstOrFail();
        $person = $application->people->first();
        $slot = CipDocument::query()
            ->where('person_id', $person->id)
            ->where('type', AddOnRequirements::G1)
            ->first();

        $this->assertNotNull($slot?->file_id);
        $file = FileItem::find($slot->file_id);
        $this->assertSame(Tree::additionalFolder($application)?->id, $file->folder_id);
        $this->assertSame('G1 - extra.pdf', $file->name);
        $this->assertSame('G1 - extra', $slot->label);
        $this->assertFalse($slot->required);
    }

    public function test_an_additional_document_takes_the_name_the_filer_gave_it(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $body = $this->file($staff, $this->addOnPayload($parent, [
            'additionalDocumentG1' => [UploadedFile::fake()->create('scan.pdf', 40, 'application/pdf')],
            'additionalDocumentG1Name' => 'Marriage Certificate',
        ]))
            ->assertCreated()
            ->json('application');

        $g1 = collect($body['applicant']['documents'])->firstWhere('type', AddOnRequirements::G1);
        $this->assertSame('G1 - Marriage Certificate', $g1['label']);
        $this->assertSame('G1 - Marriage Certificate.pdf', $g1['fileName']);
        $this->assertTrue($g1['additional']);
        $this->assertTrue($g1['onStatusTable']);
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $g1['packStatus']);
        $this->assertSame('Application review', $g1['packStatusLabel']);
        $this->assertSame($g1['status'], $g1['packStatus']);
    }

    public function test_each_add_on_document_keeps_its_own_review_status(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $docs = collect($this->file($staff, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application.applicant.documents'));

        $photo = $docs->firstWhere('type', DocumentTypes::PASSPORT_PHOTO);
        $this->assertFalse($photo['onStatusTable']);

        $bio = $docs->firstWhere('type', DocumentTypes::PASSPORT_BIO_PAGE);
        $this->assertTrue($bio['onStatusTable']);
        $this->assertTrue($bio['uploaded']);
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $bio['status']);
        $this->assertSame('Application review', $bio['statusLabel']);
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $bio['packStatus']);
        $this->assertSame('Application review', $bio['packStatusLabel']);
        $this->assertSame('pending', $bio['packStatusTone']);

        $nationalId = $docs->firstWhere('type', 'national_id_card');
        $this->assertTrue($nationalId['onStatusTable']);
        $this->assertFalse($nationalId['uploaded']);
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $nationalId['status']);
        $this->assertSame('Pending upload', $nationalId['statusLabel']);
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $nationalId['packStatus']);
        $this->assertSame('Pending upload', $nationalId['packStatusLabel']);
        $this->assertSame('neutral', $nationalId['packStatusTone']);

        $g1 = $docs->firstWhere('type', AddOnRequirements::G1);
        $this->assertTrue($g1['additional']);
        $this->assertFalse($g1['onStatusTable']);
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $g1['packStatus']);
    }

    public function test_judging_one_add_on_document_leaves_the_others_where_they_are(): void
    {
        Mail::fake();

        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $created = $this->file($staff, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $filed = collect($created['applicant']['documents'])
            ->filter(fn (array $d) => $d['uploaded'] && $d['onStatusTable'])
            ->values();

        $this->assertGreaterThanOrEqual(2, $filed->count());

        $first = $filed[0];
        $second = $filed[1];
        $untouched = $filed->slice(2);

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$first['id'].'/approve')
            ->assertOk()
            ->assertJsonPath('document.status', DocumentStatus::READY_FOR_SUBMISSION);

        $this->actingAs($staff)
            ->postJson('/portal/cip/documents/'.$second['id'].'/request-changes', [
                'comment' => 'The scan is cut off at the bottom.',
            ])
            ->assertOk()
            ->assertJsonPath('document.status', DocumentStatus::UPDATE_REQUIRED);

        $shown = collect($this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$created['id'])
            ->assertOk()
            ->json('application.applicant.documents'));

        $approved = $shown->firstWhere('id', $first['id']);
        $returned = $shown->firstWhere('id', $second['id']);

        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $approved['status']);
        $this->assertSame('Ready for submission', $approved['statusLabel']);
        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $approved['packStatus']);
        $this->assertSame('Ready for submission', $approved['packStatusLabel']);

        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $returned['status']);
        $this->assertSame('Update required', $returned['statusLabel']);
        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $returned['packStatus']);
        $this->assertSame('Update required', $returned['packStatusLabel']);

        foreach ($untouched as $other) {
            $row = $shown->firstWhere('id', $other['id']);
            $this->assertSame(
                DocumentStatus::APPLICATION_REVIEW,
                $row['status'],
                $other['type'].' should still be in application review',
            );
            $this->assertSame($row['status'], $row['packStatus']);
        }
    }

    public function test_judging_every_required_add_on_document_reaches_ready_to_submit(): void
    {
        Mail::fake();

        $staff = $this->staff();
        $parent = $this->grantedParent($staff);
        $contact = $this->providerContact($parent->provider);

        $body = $this->file($contact, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->firstOrFail();
        $officer = $this->officer();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/assignments', [
                'userId' => $officer->id,
            ])
            ->assertCreated();

        $this->assertSame(Status::REVIEW_APPLICATION, $application->fresh()->status);

        $this->markRequiredAddOnDocumentsReady($application, $staff);

        Review::settle($application->fresh(), $staff);

        $this->assertSame(Status::READY_TO_SUBMIT, $application->fresh()->status);

        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gal-addon@example.com')
            && str_contains((string) ($mail->subjectLine ?? ''), 'READY TO SUBMIT'));
    }

    public function test_one_refused_add_on_document_reaches_updates_required_and_notifies_the_agent(): void
    {
        Mail::fake();

        $staff = $this->staff();
        $parent = $this->grantedParent($staff);
        $contact = $this->providerContact($parent->provider);

        $body = $this->file($contact, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->firstOrFail();
        $officer = $this->officer();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/assignments', [
                'userId' => $officer->id,
            ])
            ->assertCreated();

        $slot = CipDocument::query()
            ->where('application_id', $application->id)
            ->where('required', true)
            ->whereNotNull('file_id')
            ->where('type', '!=', DocumentTypes::PASSPORT_PHOTO)
            ->firstOrFail();

        $this->actingAs($officer)
            ->postJson('/portal/cip/documents/'.$slot->uuid.'/request-changes', [
                'comment' => 'Please rescan the bottom edge.',
            ])
            ->assertOk();

        $this->assertSame(Status::UPDATE_REQUIRED, $application->fresh()->status);
        $this->assertFalse($application->fresh()->isLocked());

        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gal-addon@example.com')
            && str_contains((string) ($mail->subjectLine ?? ''), 'UPDATE REQUIRED'));
    }

    public function test_confirming_and_recording_an_add_on_submission_locks_and_reaches_pending_review(): void
    {
        Mail::fake();

        $staff = $this->staff();
        $parent = $this->grantedParent($staff);
        $contact = $this->providerContact($parent->provider);

        $body = $this->file($contact, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->with('people')->firstOrFail();
        Tree::provision($application, $staff);

        $officer = $this->officer();
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/assignments', [
                'userId' => $officer->id,
            ])
            ->assertCreated();

        $this->markRequiredAddOnDocumentsReady($application, $staff);
        Review::settle($application->fresh(), $staff);
        $this->assertSame(Status::READY_TO_SUBMIT, $application->fresh()->status);

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')
            ->assertOk()
            ->assertJsonPath('application.locked', true);

        $application = $application->fresh();
        Package::forget();
        $this->assertTrue($application->isLocked());
        $this->assertSame(Status::READY_TO_SUBMIT, $application->status);
        $this->assertNotNull(CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_PACKAGE_CONFIRMED)
            ->first());

        $supporting = Tree::supportingFolder($application);
        $feedback = Tree::assessmentFeedbackFolder($application);
        $additional = Tree::additionalFolder($application);
        $this->assertNotNull($supporting);
        $this->assertTrue(Package::locksFolder($supporting));
        $this->assertFalse(Package::locksFolder($feedback));
        $this->assertFalse(Package::locksFolder($additional));

        $shown = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/submission', [
                'submittedAt' => '2026-09-14',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::PENDING_REVIEW, $shown['status']);
        $this->assertSame('2026-09-14', $shown['submittedAt']);
        $this->assertSame('Ada Admin', $shown['submittedBy']);
        $this->assertSame(AddOn::TYPE_SPOUSE, $shown['addonType']);
        $this->assertSame($application->internal_number, $shown['number']);
        $this->assertTrue(empty($shown['cipNumber']));

        $fresh = $application->fresh();
        $this->assertSame(Status::PENDING_REVIEW, $fresh->status);
        $this->assertSame('2026-09-14', $fresh->submitted_at?->toDateString());
        $this->assertSame('Ada Admin', $fresh->submitted_by);
        $this->assertSame(AddOn::TYPE_SPOUSE, $fresh->addon_type);
        $this->assertTrue($fresh->isLocked());

        $event = CipEvent::query()
            ->where('application_id', $fresh->id)
            ->where('action', CipEvent::ACTION_STATUS_CHANGED)
            ->where('to_status', Status::PENDING_REVIEW)
            ->latest('id')
            ->first();
        $this->assertNotNull($event);
        $meta = is_array($event->meta) ? $event->meta : [];
        $this->assertSame('2026-09-14', $meta['submittedAt'] ?? null);
        $this->assertSame('Ada Admin', $meta['submittedBy'] ?? null);
        $this->assertSame(AddOn::TYPE_SPOUSE, $meta['addonType'] ?? null);
    }

    public function test_an_add_on_cannot_be_recorded_as_submitted_before_confirm(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $body = $this->file($staff, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->firstOrFail();
        $this->markRequiredAddOnDocumentsReady($application, $staff);
        $application->forceFill(['status' => Status::READY_TO_SUBMIT])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/submission', [
                'submittedAt' => '2026-09-14',
            ])
            ->assertStatus(422);
    }

    public function test_an_add_on_query_moves_to_non_compliant_and_notifies_the_agent(): void
    {
        Mail::fake();

        $staff = $this->staff();
        $parent = $this->grantedParent($staff);
        $contact = $this->providerContact($parent->provider);

        $body = $this->file($contact, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->firstOrFail();
        Tree::provision($application, $staff);
        $application->forceFill([
            'status' => Status::PENDING_REVIEW,
            'submitted_at' => '2026-09-14',
            'submitted_by' => 'Ada Admin',
            'locked_at' => now(),
        ])->save();
        Package::forget();

        $shown = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/query', [
                'queryReceivedAt' => '2026-09-15',
                'message' => 'Please upload the missing police certificate.',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::NON_COMPLIANT, $shown['status']);
        $this->assertSame('2026-09-15', $shown['queryReceivedAt']);

        $fresh = $application->fresh();
        $this->assertSame(Status::NON_COMPLIANT, $fresh->status);
        $this->assertSame('2026-09-15', $fresh->query_received_at?->toDateString());
        $this->assertTrue($fresh->isLocked());

        $additional = Tree::additionalFolder($fresh);
        $this->assertNotNull($additional);
        $this->assertFalse(Package::locksFolder($additional));

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $fresh->id,
            'action' => CipEvent::ACTION_QUERY_RECEIVED,
            'actor_id' => $staff->id,
        ]);

        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('gal-addon@example.com')
            && str_contains((string) ($mail->subjectLine ?? ''), 'NON-COMPLIANT')
            && str_contains((string) ($mail->payload['lead'] ?? ''), 'Additional Documents'));
    }

    public function test_an_add_on_can_be_approved_from_pending_review(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $body = $this->file($staff, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->firstOrFail();
        Tree::provision($application, $staff);
        $application->forceFill([
            'status' => Status::PENDING_REVIEW,
            'submitted_at' => '2026-09-14',
            'locked_at' => now(),
        ])->save();

        $this->assertFalse(\App\Support\Cip\Engine::canTransition($application->fresh(), Status::BACKGROUND_CHECK));
        $this->assertTrue(\App\Support\Cip\Engine::canTransition($application->fresh(), Status::GRANTED));
        $this->assertTrue(\App\Support\Cip\Engine::canTransition($application->fresh(), Status::DENIED));

        $shown = $this->postCipDecision($staff, $application->uuid, [
            'decision' => Status::GRANTED,
            'decidedAt' => '2026-09-16',
            'note' => 'Spouse Add-On approved.',
        ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::GRANTED, $shown['status']);
        $this->assertSame(Status::GRANTED, $shown['decision']);
        $this->assertSame('2026-09-16', $shown['decidedAt']);
        $this->assertSame($application->internal_number, $shown['number']);
        $this->assertFalse(\App\Support\Cip\Engine::canTransition($application->fresh(), Status::POST_APPROVAL));

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_DECISION_RECORDED,
            'actor_id' => $staff->id,
        ]);
        $event = CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_DECISION_RECORDED)
            ->latest('id')
            ->first();
        $meta = is_array($event?->meta) ? $event->meta : [];
        $this->assertSame(Status::GRANTED, $meta['decision'] ?? null);
        $this->assertSame('2026-09-16', $meta['decidedAt'] ?? null);
        $this->assertSame('Spouse Add-On approved.', $meta['note'] ?? null);
    }

    public function test_an_add_on_can_be_denied_from_non_compliant_and_keeps_decision_history(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $body = $this->file($staff, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->firstOrFail();
        Tree::provision($application, $staff);
        $application->forceFill([
            'status' => Status::NON_COMPLIANT,
            'query_received_at' => '2026-09-15',
            'submitted_at' => '2026-09-14',
            'locked_at' => now(),
        ])->save();

        $this->postCipDecision($staff, $application->uuid, [
            'decision' => Status::DENIED,
            'decidedAt' => '2026-09-17',
            'note' => 'Incomplete response.',
        ])->assertOk();

        $this->assertSame(Status::DENIED, $application->fresh()->status);

        $this->postCipDecision($staff, $application->uuid, [
            'decision' => Status::DENIED,
            'decidedAt' => '2026-09-18',
            'note' => 'Date corrected.',
            'decisionLetter' => null,
        ])->assertOk();

        $this->assertSame('2026-09-18', $application->fresh()->decided_at?->toDateString());
        $this->assertSame(2, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_DECISION_RECORDED)
            ->count());
    }

    public function test_an_add_on_cannot_be_decided_before_pending_review(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $body = $this->file($staff, $this->addOnPayload($parent))
            ->assertCreated()
            ->json('application');

        $application = CipApplication::query()->where('uuid', $body['id'])->firstOrFail();
        Tree::provision($application, $staff);
        $application->forceFill(['status' => Status::READY_TO_SUBMIT])->save();

        $this->postCipDecision($staff, $application->uuid, [
            'decision' => Status::GRANTED,
            'decidedAt' => '2026-09-16',
        ])->assertStatus(422);
    }

    public function test_a_drop_into_additional_documents_fills_the_next_g_slot(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $body = $this->file($staff, $this->addOnPayload($parent))->assertCreated()->json('application');
        $application = CipApplication::query()->where('uuid', $body['id'])->with('people')->firstOrFail();
        $additional = Tree::additionalFolder($application);
        $this->assertNotNull($additional);

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $additional->id,
            'name' => 'Bank Statement.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1000,
            'disk' => config('filesystems.files_disk', 'local'),
            'storage_path' => 'cip/addon-g1.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
        ]);

        $this->assertTrue(DocumentSlots::adoptOrphan($file->fresh(), $staff));

        $slot = CipDocument::query()
            ->where('person_id', $application->people->first()->id)
            ->where('type', AddOnRequirements::G1)
            ->first();

        $this->assertSame($file->id, $slot?->file_id);
        $this->assertSame('G1 - Bank Statement', $slot->label);
        $this->assertSame('G1 - Bank Statement.pdf', $file->fresh()->name);
    }

    public function test_an_administrator_can_turn_the_add_on_lane_off(): void
    {
        $admin = $this->staff();
        $row = CipDocumentRequirement::query()
            ->where('applicant_type', ApplicantType::SPOUSE)
            ->where('key', 'sl1_form')
            ->firstOrFail();

        $this->actingAs($admin)
            ->patchJson('/portal/cip/requirements/'.$row->uuid, [
                'atAddOn' => false,
            ])
            ->assertOk()
            ->assertJsonPath('requirement.atAddOn', false)
            ->assertJsonPath('requirement.atPreApproval', true);

        $keys = collect($this->actingAs($admin)
            ->getJson('/portal/cip/applications/form?phase='.Phase::ADD_ON)
            ->assertOk()
            ->json('requirements.spouse'))
            ->pluck('key')
            ->all();

        $this->assertNotContains('sl1_form', $keys);
        $this->assertContains('sl2b_form', $keys);
    }

    private function markRequiredAddOnDocumentsReady(CipApplication $application, User $actor): void
    {
        CipDocument::query()
            ->where('application_id', $application->id)
            ->where('required', true)
            ->whereNotNull('file_id')
            ->get()
            ->each(function (CipDocument $slot) use ($actor) {
                if ($slot->status === DocumentStatus::READY_FOR_SUBMISSION) {
                    return;
                }

                DocumentEngine::set($slot, DocumentStatus::READY_FOR_SUBMISSION, $actor, [
                    'reason' => 'test',
                ]);
            });
    }

    public function test_the_add_on_worklist_carries_the_applicants_passport_photo(): void
    {
        $staff = $this->staff();
        $parent = $this->grantedParent($staff);

        $this->file($staff, $this->addOnPayload($parent))->assertCreated();

        $row = collect($this->actingAs($staff)
            ->getJson('/portal/cip/applications?phase='.Phase::ADD_ON)
            ->assertOk()
            ->json('applications'))
            ->firstWhere('applicantName', 'MEI WEI');

        $this->assertNotNull($row);
        $this->assertNotEmpty(
            $row['photo'] ?? null,
            'Add-On rows must carry the applicant passport photo for the avatar column.',
        );

        // Even when the hub client never got a copy, the person's portrait still shows.
        $application = CipApplication::query()->where('uuid', $row['id'])->firstOrFail();
        $application->client?->forceFill(['photo_url' => null])->save();
        $main = $application->people()->where('role', CipPerson::ROLE_MAIN_APPLICANT)->firstOrFail();
        $main->forceFill([
            'photo_url' => 'https://cdn.example/mei.jpg',
            'photo_path' => 'cip/photos/mei.bin',
        ])->save();

        $again = collect($this->actingAs($staff)
            ->getJson('/portal/cip/applications?phase='.Phase::ADD_ON)
            ->assertOk()
            ->json('applications'))
            ->firstWhere('id', $row['id']);

        $this->assertSame('https://cdn.example/mei.jpg', $again['photo'] ?? null);
    }

    private function staff(): User
    {
        return $this->account(Role::ADMINISTRATOR, 'Ada Admin', 'ada-addon@example.com');
    }

    private function officer(): User
    {
        return $this->account(Role::REVIEWING_OFFICER, 'Rita Reviewer', 'rita-addon@example.com');
    }

    private function providerContact(CipProvider $provider): User
    {
        $contact = $this->account(Role::CLIENT, 'Gal Contact', 'gal-addon@example.com');

        CompanyMember::create([
            'company_id' => $provider->company_id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        return $contact;
    }

    private function account(string $type, string $name, string $email): User
    {
        $user = User::create([
            'name' => $name,
            'email' => $email,
            'password' => bcrypt('password12345'),
        ]);
        $user->forceFill([
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    private function provider(User $owner): CipProvider
    {
        $company = Company::create([
            'uid' => 'galaxy-addon',
            'name' => 'Galaxy',
        ]);

        return CipProvider::create([
            'name' => 'Galaxy',
            'code' => 'GAL',
            'company_id' => $company->id,
        ]);
    }

    private function grantedParent(User $staff): CipApplication
    {
        $provider = $this->provider($staff);
        $application = Applications::create($provider, $staff, [
            'investment_type' => 'real_estate',
            'sponsored' => false,
        ]);
        $this->mainApplicant($application, 'Chen', 'Wei');
        $application->forceFill([
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
            'phase' => Phase::POST_APPROVAL,
            'post_approval_at' => now(),
            'cip_number' => '10T1GADD01P',
            'cor_number' => 'COR-1001',
        ])->save();

        return $application->fresh(['people', 'provider']);
    }

    private function mainApplicant(CipApplication $application, string $first, string $last): CipPerson
    {
        return CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => $first,
            'last_name' => $last,
            'gender' => 'Male',
            'date_of_birth' => '1980-01-01',
            'country_of_birth' => 'China',
            'country_of_residence' => 'China',
            'passport_number' => 'P1111111',
        ]);
    }

    /** @param  array<string, mixed>  $overrides */
    private function addOnPayload(CipApplication $parent, array $overrides = []): array
    {
        $type = $overrides['addonType'] ?? AddOn::TYPE_SPOUSE;
        $gender = $overrides['gender'] ?? 'Female';
        $merged = array_merge([
            'phase' => Phase::ADD_ON,
            'parentCipNumber' => $parent->cip_number,
            'parentCorNumber' => $parent->cor_number,
            'parentApplicantName' => 'Chen Wei',
            'addonType' => $type,
            'firstName' => 'Mei',
            'lastName' => 'Wei',
            'dateOfBirth' => '1988-06-01',
            'nationality' => 'China',
            'countryOfResidence' => 'China',
            'passportNumber' => 'X1234567',
            'relationship' => CipPerson::RELATIONSHIP_SPOUSE,
            'gender' => $gender,
            'passportPhoto' => $this->photo(),
        ], $this->cipRequiredDocumentFiles($type, Phase::ADD_ON, $gender, $parent->investment_type), $overrides);

        return $merged;
    }

    private function file(User $actor, array $payload)
    {
        return $this->actingAs($actor)
            ->post('/portal/cip/applications', $payload, ['Accept' => 'application/json']);
    }

    private function photo(int $width = 600, ?int $height = null): UploadedFile
    {
        $img = imagecreatetruecolor($width, $height ?? $width);
        imagefill($img, 0, 0, imagecolorallocate($img, 200, 210, 220));
        $path = tempnam(sys_get_temp_dir(), 'cip').'.jpg';
        imagejpeg($img, $path, 90);

        return new UploadedFile($path, 'photo.jpg', 'image/jpeg', null, true);
    }
}
