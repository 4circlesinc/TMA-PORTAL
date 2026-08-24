<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\BackgroundCheck;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Milestones;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * §19 — accepted for processing: record the date, move to Background check.
 *
 * The delay clock (§20) measures from this date, so the dedicated verb exists
 * to make sure `accepted_at` is never left empty by a bare status change.
 */
class CipBackgroundCheckTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email = 'ada@example.com', string $name = 'Ada Admin'): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    private function pending(User $staff): CipApplication
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $application = Applications::create($provider, $staff);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        $application->forceFill([
            'status' => Status::PENDING_REVIEW,
            'cip_number' => '10T1G12661P',
            'submitted_at' => '2026-08-01',
            'locked_at' => now(),
        ])->save();

        return $application->refresh();
    }

    public function test_recording_the_accepted_date_moves_the_file_to_background_check(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);

        $body = $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::BACKGROUND_CHECK, $body['status']);
        $this->assertSame('Background Check', $body['statusLabel']);
        $this->assertSame('2026-08-18', $body['acceptedAt']);

        $show = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application');
        $accepted = collect($show['milestones'])->firstWhere('key', Milestones::ACCEPTED);
        $this->assertTrue($accepted['reached']);
        $this->assertSame('2026-08-18', $accepted['date']);

        $fresh = $application->fresh();
        $this->assertSame(Status::BACKGROUND_CHECK, $fresh->status);
        $this->assertSame('2026-08-18', $fresh->accepted_at->toDateString());

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_ACCEPTED_FOR_PROCESSING,
            'actor_id' => $staff->id,
        ]);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_STATUS_CHANGED,
            'from_status' => Status::PENDING_REVIEW,
            'to_status' => Status::BACKGROUND_CHECK,
        ]);
    }

    public function test_the_accepted_date_is_required(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors('acceptedAt');

        $this->assertSame(Status::PENDING_REVIEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->accepted_at);
    }

    public function test_a_compliance_officer_may_record_acceptance(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($admin);
        $colin = $this->user(Role::COMPLIANCE_OFFICER, 'colin@example.com', 'Colin Compliance');
        Assignments::assign($application->fresh(), $colin, $admin, CipAccess::COMPLIANCE_OFFICER);

        $this->actingAs($colin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::BACKGROUND_CHECK);
    }

    public function test_an_officer_may_record_acceptance(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($admin);
        $rita = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Officer');
        Assignments::assign($application->fresh(), $rita, $admin, CipAccess::REVIEWING_OFFICER);

        $this->actingAs($rita)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::BACKGROUND_CHECK);
    }

    public function test_the_status_endpoint_is_not_a_way_around_recording_the_date(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::BACKGROUND_CHECK,
            ])
            ->assertStatus(422);

        $this->assertSame(Status::PENDING_REVIEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->accepted_at);
    }

    public function test_a_file_the_unit_does_not_yet_hold_cannot_be_accepted(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);
        $application->forceFill(['status' => Status::NEW])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertStatus(422);

        $this->assertSame(Status::NEW, $application->fresh()->status);
        $this->assertNull($application->fresh()->accepted_at);
        $this->assertSame(0, CipEvent::where('action', CipEvent::ACTION_ACCEPTED_FOR_PROCESSING)->count());
    }

    public function test_recording_again_updates_the_date_without_a_second_move(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);

        BackgroundCheck::record($application, $staff, now()->startOfDay()->setDate(2026, 8, 10));

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.acceptedAt', '2026-08-18')
            ->assertJsonPath('application.status', Status::BACKGROUND_CHECK);

        $this->assertSame(1, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_STATUS_CHANGED)
            ->where('to_status', Status::BACKGROUND_CHECK)
            ->count());
        $this->assertSame(2, CipEvent::query()
            ->where('application_id', $application->id)
            ->where('action', CipEvent::ACTION_ACCEPTED_FOR_PROCESSING)
            ->count());
    }

    public function test_acceptance_can_land_from_non_compliant(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->pending($staff);
        $application->forceFill(['status' => Status::NON_COMPLIANT])->save();

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/acceptance', [
                'acceptedAt' => '2026-08-18',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::BACKGROUND_CHECK);
    }
}
