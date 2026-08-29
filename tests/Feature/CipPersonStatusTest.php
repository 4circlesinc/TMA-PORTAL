<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\User;
use App\Support\Cip\Applications;
use App\Support\Cip\PersonStatus;
use App\Support\Cip\Phase;
use App\Support\Cip\PostApproval;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CipPersonStatusTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function staff(): User
    {
        $u = User::create(['name' => 'Ada Admin', 'email' => 'ada@example.com', 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'status' => 'approved',
            'account_type' => 'Administrator',
        ])->save();

        return $u;
    }

    private function postApprovalApplication(User $staff): CipApplication
    {
        $company = \App\Models\Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);

        $application = Applications::create($provider, $staff, [
            'investment_type' => 'real_estate',
            'sponsored' => false,
        ]);

        $client = Client::create([
            'uid' => 'chen-wei',
            'name' => 'Chen Wei',
            'email' => 'chen@example.com',
            'created_by' => $staff->id,
            'data' => [],
        ]);
        $application->forceFill([
            'client_id' => $client->id,
            'phase' => Phase::PRE_APPROVAL,
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
        ])->save();

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);

        PostApproval::enter($application->fresh(), $staff);

        return $application->fresh(['people']);
    }

    private function postApprovalFamilyApplication(User $staff): CipApplication
    {
        $company = \App\Models\Company::create(['uid' => 'galaxy2', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL2', 'company_id' => $company->id]);

        $application = Applications::create($provider, $staff, [
            'investment_type' => 'real_estate',
            'sponsored' => false,
        ]);

        $client = Client::create([
            'uid' => 'wei-family',
            'name' => 'Chen Wei',
            'email' => 'family@example.com',
            'created_by' => $staff->id,
            'data' => [],
        ]);
        $application->forceFill([
            'client_id' => $client->id,
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
        ])->save();

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
            'first_name' => 'Jian',
            'last_name' => 'Wei',
            'date_of_birth' => '2012-08-30',
        ]);

        PostApproval::enter($application->fresh(), $staff);

        return $application->fresh(['people']);
    }

    public function test_post_approval_person_status_can_be_changed(): void
    {
        $staff = $this->staff();
        $application = $this->postApprovalApplication($staff);
        $person = $application->people->first();

        $this->assertSame(PersonStatus::NOT_STARTED, $person->post_approval_status);

        $body = $this->actingAs($staff)
            ->postJson('/portal/cip/people/'.$person->uuid.'/status', [
                'status' => PersonStatus::DOCUMENTS_PENDING,
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(PersonStatus::DOCUMENTS_PENDING, $body['applicant']['status']);
        $this->assertSame('Documents pending', $body['applicant']['statusLabel']);

        $this->assertDatabaseHas('cip_people', [
            'id' => $person->id,
            'post_approval_status' => PersonStatus::DOCUMENTS_PENDING,
        ]);

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => 'person_status_changed',
            'from_status' => PersonStatus::NOT_STARTED,
            'to_status' => PersonStatus::DOCUMENTS_PENDING,
        ]);
    }

    public function test_person_status_cannot_be_changed_before_post_approval(): void
    {
        $staff = $this->staff();
        $company = \App\Models\Company::create(['uid' => 'galaxy2', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $application = Applications::create($provider, $staff, ['investment_type' => 'real_estate']);
        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);

        $this->actingAs($staff)
            ->postJson('/portal/cip/people/'.$person->uuid.'/status', [
                'status' => PersonStatus::DOCUMENTS_PENDING,
            ])
            ->assertStatus(422);
    }

    public function test_family_members_in_listing_carry_person_status(): void
    {
        $staff = $this->staff();
        $application = $this->postApprovalApplication($staff);
        $person = $application->people->first();
        $person->forceFill(['post_approval_status' => PersonStatus::PROCESSING])->save();

        $row = $this->actingAs($staff)
            ->getJson('/portal/cip/applications?phase=post_approval')
            ->assertOk()
            ->json('applications.0');

        $this->assertSame(PersonStatus::PROCESSING, $row['familyMembers'][0]['status']);
        $this->assertSame('Processing', $row['familyMembers'][0]['statusLabel']);
    }

    public function test_post_approval_dependents_include_document_checklist_from_settings(): void
    {
        $staff = $this->staff();
        $application = $this->postApprovalFamilyApplication($staff);
        $dependent = $application->people->firstWhere('role', CipPerson::ROLE_DEPENDENT);
        $this->assertNotNull($dependent);

        $body = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $match = collect($body['dependents'])->firstWhere('id', $dependent->uuid);
        $this->assertNotNull($match);
        $this->assertNotEmpty($match['documents']);
        $this->assertArrayHasKey('statusLabel', $match['documents'][0]);
    }
}
