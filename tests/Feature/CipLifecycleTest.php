<?php

namespace Tests\Feature;

use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\Milestones;
use App\Support\Cip\Status;
use App\Support\Cip\Timeline;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * One family, every product door, New Applications through the decision letter.
 *
 * Chen, Li and Mei Wei are the three people already on the live file. This
 * walks a copy of that family through the verbs staff actually press: assign,
 * approve the checklist, confirm, record submission, record acceptance, then
 * record the Unit's letter. The Overview timeline and the Activity history
 * have to name the outcome and the date at the end, or the walk did not land.
 */
class CipLifecycleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Mail::fake();
    }

    private function user(string $type, string $email, string $name): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    public function test_chen_wei_walks_from_new_applications_to_the_decision_letter(): void
    {
        $ada = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        $gil = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');

        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $ada->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $gil->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $ada->id,
        ]);

        $application = Applications::create($provider, $ada);
        $this->assertSame(Status::NEW, $application->status);

        $chen = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        $li = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_SPONSOR,
            'first_name' => 'Li', 'last_name' => 'Wei',
        ]);
        $mei = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'first_name' => 'Mei', 'last_name' => 'Wei',
            'dependent_ordinal' => 1,
        ]);

        $slots = [];
        foreach ([$chen, $li, $mei] as $person) {
            $slot = CipDocument::create([
                'application_id' => $application->id,
                'person_id' => $person->id,
                'type' => 'passport_bio_page',
                'label' => 'Passport bio page',
                'required' => true,
            ]);
            $slot->forceFill(['status' => DocumentStatus::APPLICATION_REVIEW])->save();
            $slots[] = $slot;
        }

        $this->actingAs($ada)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/assignments', [
                'userId' => $rita->id,
            ])
            ->assertCreated();
        $this->assertSame(Status::REVIEW_APPLICATION, $application->fresh()->status);

        $this->actingAs($rita)
            ->postJson('/portal/cip/documents/'.$slots[0]->uuid.'/approve')
            ->assertOk()
            ->assertJsonPath('application.status', Status::REVIEW_APPLICATION);

        $this->actingAs($rita)
            ->postJson('/portal/cip/documents/'.$slots[1]->uuid.'/approve')
            ->assertOk()
            ->assertJsonPath('application.status', Status::REVIEW_APPLICATION);

        $this->actingAs($rita)
            ->postJson('/portal/cip/documents/'.$slots[2]->uuid.'/approve')
            ->assertOk()
            ->assertJsonPath('application.status', Status::READY_TO_SUBMIT);

        $this->assertEquals(
            [Status::REVIEW_APPLICATION, Status::ASSESSMENT_FEEDBACK, Status::READY_TO_SUBMIT],
            CipEvent::query()
                ->where('application_id', $application->id)
                ->where('action', CipEvent::ACTION_STATUS_CHANGED)
                ->orderBy('id')
                ->pluck('to_status')
                ->all(),
        );

        $this->actingAs($gil)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/confirm')
            ->assertOk()
            ->assertJsonPath('application.locked', true)
            ->assertJsonPath('application.status', Status::READY_TO_SUBMIT);

        $this->actingAs($ada)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/submission', [
                'cipNumber' => '10T1G12661P',
                'submittedAt' => '2026-02-01',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::PENDING_REVIEW)
            ->assertJsonPath('application.number', '10T1G12661P');

        $this->actingAs($ada)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-02-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::BACKGROUND_CHECK);

        $body = $this->postCipDecision($ada, $application->uuid, [
                'decision' => Status::GRANTED,
                'decidedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::GRANTED, $body['status']);
        $this->assertSame('Approved', $body['statusLabel']);
        $this->assertSame('2026-08-18', $body['decidedAt']);

        $show = $this->actingAs($ada)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');

        $this->assertSame('Chen Wei', $show['applicant']['name']);
        $this->assertSame('Li Wei', $show['sponsor']['name']);
        $this->assertSame('Mei Wei', $show['dependents'][0]['name']);
        $this->assertSame(3, $show['familySize']);

        $decision = collect($show['milestones'])->firstWhere('key', Milestones::DECISION);
        $this->assertTrue($decision['reached']);
        $this->assertSame('Approved', $decision['label']);
        $this->assertSame('2026-08-18', $decision['date']);

        $this->assertContains(
            'Ada Admin recorded the decision: Approved on 2026-08-18',
            array_column(Timeline::for($application->fresh(), $ada), 'what'),
        );
        $this->assertContains(
            'Ada Admin recorded acceptance for processing on 2026-02-18',
            array_column(Timeline::for($application->fresh(), $ada), 'what'),
        );
    }
}
