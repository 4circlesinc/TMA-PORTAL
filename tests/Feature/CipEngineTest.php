<?php

namespace Tests\Feature;

use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Engine;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The transition engine: only mapped edges move, only allowed actors move
 * them, every move writes the append-only audit row in the same transaction,
 * and nothing leaves a terminal status.
 */
class CipEngineTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $accountType): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
        ]);
    }

    public function test_a_valid_transition_moves_the_status_and_writes_the_audit_row(): void
    {
        $creator = $this->user(Role::EMPLOYEE);
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $creator);
        $admin = $this->user(Role::ADMINISTRATOR);

        Engine::apply($application, Status::REVIEW_APPLICATION, $admin);

        $this->assertSame(Status::REVIEW_APPLICATION, $application->fresh()->status);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => 'status_changed',
            'from_status' => Status::NEW,
            'to_status' => Status::REVIEW_APPLICATION,
            'actor_id' => $admin->id,
        ]);
    }

    public function test_unmapped_edges_are_refused(): void
    {
        $creator = $this->user(Role::EMPLOYEE);
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $creator);

        $this->expectException(\InvalidArgumentException::class);
        Engine::apply($application, Status::GRANTED, $this->user(Role::ADMINISTRATOR));
    }

    public function test_granted_may_move_to_post_approval(): void
    {
        $creator = $this->user(Role::EMPLOYEE);
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $creator);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);
        $application->forceFill(['status' => Status::GRANTED])->save();
        $admin = $this->user(Role::ADMINISTRATOR);

        Engine::apply($application, Status::POST_APPROVAL, $admin);

        $this->assertSame(Status::POST_APPROVAL, $application->fresh()->status);
        $this->assertSame(Phase::POST_APPROVAL, $application->fresh()->phase);
    }

    public function test_post_approval_updates_required_keeps_the_grant(): void
    {
        $creator = $this->user(Role::EMPLOYEE);
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $creator);
        $application->forceFill([
            'status' => Status::POST_APPROVAL,
            'phase' => Phase::POST_APPROVAL,
            'decision' => 'granted',
            'decided_at' => now(),
        ])->save();
        $admin = $this->user(Role::ADMINISTRATOR);

        Engine::apply($application, Status::UPDATE_REQUIRED, $admin);

        $fresh = $application->fresh();
        $this->assertSame(Status::UPDATE_REQUIRED, $fresh->status);
        $this->assertSame(Phase::POST_APPROVAL, $fresh->phase);
        $this->assertSame('granted', $fresh->decision);
    }

    public function test_pending_cor_keeps_the_grant(): void
    {
        $creator = $this->user(Role::EMPLOYEE);
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $creator);
        $application->forceFill([
            'status' => Status::APPLY_FOR_COR,
            'phase' => Phase::POST_APPROVAL,
            'decision' => 'granted',
            'decided_at' => now(),
        ])->save();
        $admin = $this->user(Role::ADMINISTRATOR);

        Engine::apply($application, Status::PENDING_COR, $admin);

        $fresh = $application->fresh();
        $this->assertSame(Status::PENDING_COR, $fresh->status);
        $this->assertSame(Phase::POST_APPROVAL, $fresh->phase);
        $this->assertSame('granted', $fresh->decision);
    }

    public function test_granted_cannot_move_to_an_unmapped_status(): void
    {
        $creator = $this->user(Role::EMPLOYEE);
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $creator);
        $application->forceFill(['status' => Status::GRANTED])->save();

        $this->expectException(\InvalidArgumentException::class);
        Engine::apply($application, Status::NON_COMPLIANT, $this->user(Role::ADMINISTRATOR));
    }

    public function test_an_unrelated_account_cannot_submit_someone_elses_draft(): void
    {
        $creator = $this->user(Role::CLIENT);
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $creator);
        $application->forceFill(['status' => Status::DRAFT])->save();

        $stranger = $this->user(Role::CLIENT);

        $this->expectException(AuthorizationException::class);
        Engine::apply($application, Status::NEW, $stranger);
    }

    public function test_officer_grants_gate_the_reviewer_edges(): void
    {
        $creator = $this->user(Role::EMPLOYEE);
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $creator);

        $admin = $this->user(Role::ADMINISTRATOR);
        Engine::apply($application, Status::REVIEW_APPLICATION, $admin);

        // A plain employee may not issue assessment feedback…
        $plain = $this->user(Role::EMPLOYEE);
        try {
            Engine::apply($application->fresh(), Status::ASSESSMENT_FEEDBACK, $plain);
            $this->fail('A plain employee drove a reviewer edge.');
        } catch (AuthorizationException) {
            // expected
        }

        // …but a Reviewing Officer account may — officer-ness is the
        // account type, assigned from the Users page.
        $officer = $this->user(Role::REVIEWING_OFFICER);

        Engine::apply($application->fresh(), Status::ASSESSMENT_FEEDBACK, $officer);
        $this->assertSame(Status::ASSESSMENT_FEEDBACK, $application->fresh()->status);
    }

    public function test_the_system_may_drive_any_mapped_edge(): void
    {
        $creator = $this->user(Role::EMPLOYEE);
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $creator);
        $application->forceFill(['status' => Status::BACKGROUND_CHECK])->save();

        // The DELAYED flip is a scheduled job — actor null is the system.
        Engine::apply($application->fresh(), Status::DELAYED, null);

        $this->assertSame(Status::DELAYED, $application->fresh()->status);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'to_status' => Status::DELAYED,
            'actor_id' => null,
        ]);
    }

    public function test_set_writes_a_status_the_lifecycle_has_no_edge_for(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $admin);

        $this->assertSame(Status::NEW, $application->status);
        $this->assertFalse(Engine::canTransition($application, Status::BACKGROUND_CHECK));

        Engine::set($application, Status::BACKGROUND_CHECK, $admin, [
            'note' => 'The Unit asked for another scan.',
        ]);

        $this->assertSame(Status::BACKGROUND_CHECK, $application->fresh()->status);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => 'status_changed',
            'from_status' => Status::NEW,
            'to_status' => Status::BACKGROUND_CHECK,
        ]);
    }

    public function test_set_refuses_an_administrator_who_gives_no_reason(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $admin);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Give a reason for changing the status.');
        Engine::set($application, Status::BACKGROUND_CHECK, $admin);
    }
}
