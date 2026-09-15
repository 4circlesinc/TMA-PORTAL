<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\AddOn;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
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

        $this->file($staff, $this->addOnPayload($parent, [
            'addonType' => AddOn::TYPE_DEPENDENT_UNDER_16,
            'firstName' => 'Bao',
            'lastName' => 'Wei',
            'dateOfBirth' => now()->subYears(8)->toDateString(),
            'relationship' => AddOn::RELATIONSHIP_DAUGHTER,
            'gender' => 'Female',
            'passportNumber' => 'X8888888',
        ]))->assertCreated();
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
    }

    public function test_the_dashboard_includes_an_add_on_lane(): void
    {
        $staff = $this->staff();

        $body = $this->actingAs($staff)->getJson('/portal/cip/dashboard')->assertOk()->json();

        $this->assertSame('Add-On Applications', $body['phases'][Phase::ADD_ON]['label']);
        $this->assertSame(
            array_column($body['phases'][Phase::PRE_APPROVAL]['buckets'], 'label'),
            array_column($body['phases'][Phase::ADD_ON]['buckets'], 'label'),
        );
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

    private function staff(): User
    {
        $user = User::create([
            'name' => 'Ada Admin',
            'email' => 'ada-addon@example.com',
            'password' => bcrypt('password12345'),
        ]);
        $user->forceFill([
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
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
