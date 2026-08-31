<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\Engine;
use App\Support\Cip\PersonStatus;
use App\Support\Cip\Phase;
use App\Support\Cip\PostApproval;
use App\Support\Cip\Status;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CipStatusOverrideTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $accountType): User
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
        ]);
        $user->forceFill([
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ])->save();

        return $user;
    }

    private function application(User $creator): CipApplication
    {
        $provider = CipProvider::firstOrCreate(['code' => 'GAL'], ['name' => 'Galaxy']);
        $application = Applications::create($provider, $creator);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);

        return $application;
    }

    public function test_an_administrator_can_pull_approved_back_to_assessment_feedback(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->application($admin);
        $application->forceFill([
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
            'decided_at' => '2026-08-10',
            'phase' => Phase::POST_APPROVAL,
        ])->save();

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::ASSESSMENT_FEEDBACK,
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::ASSESSMENT_FEEDBACK)
            ->assertJsonPath('application.phase', Phase::PRE_APPROVAL);

        $fresh = $application->fresh();
        $this->assertSame(Status::ASSESSMENT_FEEDBACK, $fresh->status);
        $this->assertNull($fresh->decision);
        $this->assertSame(Phase::PRE_APPROVAL, $fresh->phase);

        $event = CipEvent::query()->where('action', 'status_changed')->latest('id')->first();
        $this->assertTrue($event->meta['override'] ?? false);
        $this->assertSame(Status::GRANTED, $event->from_status);
        $this->assertSame(Status::ASSESSMENT_FEEDBACK, $event->to_status);
    }

    public function test_an_officer_cannot_pull_a_status_backwards(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $application = $this->application($admin);
        $application->forceFill(['status' => Status::GRANTED])->save();
        Assignments::assign($application->fresh(), $officer, $admin);

        $this->actingAs($officer)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::ASSESSMENT_FEEDBACK,
            ])
            ->assertForbidden();

        $this->assertSame(Status::GRANTED, $application->fresh()->status);

        $this->expectException(AuthorizationException::class);
        Engine::set($application->fresh(), Status::ASSESSMENT_FEEDBACK, $officer);
    }

    public function test_an_officer_may_still_move_forward_along_the_map(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $application = $this->application($admin);
        Assignments::assign($application->fresh(), $officer, $admin);

        $this->actingAs($officer)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::REVIEW_APPLICATION,
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::REVIEW_APPLICATION);
    }

    public function test_an_officer_cannot_jump_off_the_lifecycle_map(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $application = $this->application($admin);
        Assignments::assign($application->fresh(), $officer, $admin);
        $this->assertSame(Status::REVIEW_APPLICATION, $application->fresh()->status);

        $this->actingAs($officer)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', [
                'status' => Status::UPDATE_REQUIRED,
            ])
            ->assertForbidden();

        $this->assertSame(Status::REVIEW_APPLICATION, $application->fresh()->status);
    }

    public function test_an_officer_cannot_pull_person_status_backwards(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $application = $this->application($admin);
        $application->forceFill([
            'status' => Status::GRANTED,
            'decision' => CipApplication::DECISION_GRANTED,
        ])->save();
        Assignments::assign($application->fresh(), $officer, $admin);
        PostApproval::enter($application->fresh(), $admin);

        $person = $application->fresh('people')->people->first();
        $person->forceFill(['post_approval_status' => PersonStatus::PROCESSING])->save();

        $this->actingAs($officer)
            ->postJson('/portal/cip/people/'.$person->uuid.'/status', [
                'status' => PersonStatus::NOT_STARTED,
            ])
            ->assertForbidden();

        $this->assertSame(PersonStatus::PROCESSING, $person->fresh()->post_approval_status);

        $this->actingAs($officer)
            ->postJson('/portal/cip/people/'.$person->uuid.'/status', [
                'status' => PersonStatus::COMPLETED,
            ])
            ->assertOk()
            ->assertJsonPath('application.applicant.status', PersonStatus::COMPLETED);

        $this->actingAs($admin)
            ->postJson('/portal/cip/people/'.$person->uuid.'/status', [
                'status' => PersonStatus::NOT_STARTED,
            ])
            ->assertOk()
            ->assertJsonPath('application.applicant.status', PersonStatus::NOT_STARTED);
    }
}
