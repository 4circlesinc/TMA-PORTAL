<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\CipAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The native CIP module ships dark behind FEATURE_CIP, exactly like CBI: 404
 * — never 403 — while the flag is off (administrators included) and for every
 * non-holder while it is on. Officer-ness is a per-user grant on top of the
 * Employee account type, readable only through CipAccess.
 */
class CipAccessTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $accountType): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_everything_404s_when_the_flag_is_off(): void
    {
        config(['services.cip.enabled' => false]);
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)->getJson('/admin/cip/management')->assertNotFound();
        $this->actingAs($admin)->postJson('/admin/cip/providers', ['name' => 'Galaxy', 'code' => 'GAL'])->assertNotFound();

        // The capability itself is dark for admins too — the flag check sits
        // before the admin short-circuit.
        $this->assertFalse(Role::can($admin, 'cip.view'));
        $this->assertFalse(CipAccess::can($admin, 'cip.review'));
    }

    public function test_non_admins_get_404_not_403_with_the_flag_on(): void
    {
        config(['services.cip.enabled' => true]);

        foreach ([Role::EMPLOYEE, Role::CLIENT] as $type) {
            $user = $this->user($type);
            $this->actingAs($user)->getJson('/admin/cip/management')->assertNotFound();
            $this->actingAs($user)->postJson('/admin/cip/providers', ['name' => 'Galaxy', 'code' => 'GAL'])->assertNotFound();
            $this->actingAs($user)->postJson('/admin/cip/officers', ['userId' => $user->id, 'role' => CipAccess::REVIEWING_OFFICER])->assertNotFound();
        }
    }

    public function test_an_admin_manages_providers(): void
    {
        config(['services.cip.enabled' => true]);
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)->getJson('/admin/cip/management')
            ->assertOk()
            ->assertJsonStructure(['canEdit', 'providers', 'officers', 'staff', 'roles']);

        $this->actingAs($admin)
            ->postJson('/admin/cip/providers', [
                'name' => 'Galaxy', 'code' => 'gal',
                'contactName' => 'Kevin M', 'contactEmail' => 'kevin@galaxy.example',
            ])
            ->assertCreated()
            ->assertJsonPath('providers.0.code', 'GAL');

        // Codes are unique whatever the case they were typed in.
        $this->actingAs($admin)
            ->postJson('/admin/cip/providers', ['name' => 'Galaxy Two', 'code' => 'GAL'])
            ->assertStatus(422);
    }

    public function test_officer_grants_widen_an_employee_and_revoke_narrows_them(): void
    {
        config(['services.cip.enabled' => true]);
        $admin = $this->user(Role::ADMINISTRATOR);
        $employee = $this->user(Role::EMPLOYEE);

        $this->assertFalse(CipAccess::can($employee, 'cip.review'));

        $this->actingAs($admin)
            ->postJson('/admin/cip/officers', ['userId' => $employee->id, 'role' => CipAccess::REVIEWING_OFFICER])
            ->assertCreated();

        CipAccess::forget();
        $this->assertTrue(CipAccess::isOfficer($employee, CipAccess::REVIEWING_OFFICER));
        $this->assertTrue(CipAccess::can($employee, 'cip.review'));
        // A reviewing officer is not a compliance officer.
        $this->assertFalse(CipAccess::can($employee, 'cip.decide'));

        $this->actingAs($admin)
            ->deleteJson('/admin/cip/officers', ['userId' => $employee->id, 'role' => CipAccess::REVIEWING_OFFICER])
            ->assertOk();

        CipAccess::forget();
        $this->assertFalse(CipAccess::isOfficer($employee));
        $this->assertFalse(CipAccess::can($employee, 'cip.review'));
    }

    public function test_suspension_ends_live_cip_assignments_but_keeps_the_officer_grant(): void
    {
        config(['services.cip.enabled' => true]);
        $admin = $this->user(Role::ADMINISTRATOR);
        $officer = $this->user(Role::EMPLOYEE);
        CipAccess::grant($officer, CipAccess::REVIEWING_OFFICER);

        $galaxy = \App\Models\CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = \App\Support\Cip\Applications::create($galaxy, $admin);
        $assignment = $application->assignments()->create([
            'user_id' => $officer->id,
            'role' => CipAccess::REVIEWING_OFFICER,
            'status' => \App\Models\CipApplicationAssignment::STATUS_ACTIVE,
            'assigned_by' => $admin->id,
        ]);

        $summary = \App\Support\Access\AccessSync::userSuspended($officer, $admin);

        $this->assertSame(1, $summary['cipAssignments']);
        $this->assertSame(
            \App\Models\CipApplicationAssignment::STATUS_ENDED,
            $assignment->fresh()->status,
        );
        // The grant survives like company membership: the person is still an
        // officer, they just cannot act while suspended.
        CipAccess::forget();
        $this->assertTrue(CipAccess::isOfficer($officer, CipAccess::REVIEWING_OFFICER));
    }

    public function test_clients_cannot_hold_officer_roles(): void
    {
        config(['services.cip.enabled' => true]);
        $admin = $this->user(Role::ADMINISTRATOR);
        $client = $this->user(Role::CLIENT);

        $this->actingAs($admin)
            ->postJson('/admin/cip/officers', ['userId' => $client->id, 'role' => CipAccess::COMPLIANCE_OFFICER])
            ->assertStatus(422);
    }
}
