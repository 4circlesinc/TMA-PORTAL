<?php

namespace Tests\Feature;

use App\Models\CipProvider;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Engine;
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

        Engine::apply($application, Status::NEW, $creator);

        $this->assertSame(Status::NEW, $application->fresh()->status);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => 'status_changed',
            'from_status' => Status::DRAFT,
            'to_status' => Status::NEW,
            'actor_id' => $creator->id,
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

    public function test_terminal_statuses_are_final(): void
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

        $stranger = $this->user(Role::CLIENT);

        $this->expectException(AuthorizationException::class);
        Engine::apply($application, Status::NEW, $stranger);
    }

    public function test_officer_grants_gate_the_reviewer_edges(): void
    {
        $creator = $this->user(Role::EMPLOYEE);
        $galaxy = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($galaxy, $creator);
        Engine::apply($application, Status::NEW, $creator);

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
}
