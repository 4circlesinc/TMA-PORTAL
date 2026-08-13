<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\CompanyStaffAssignment;
use App\Models\User;
use App\Support\Access\AccessSync;
use App\Support\Access\Role;
use App\Support\Cip\CipAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The native CIP module ships dark behind FEATURE_CIP, exactly like CBI —
 * every cip.* capability is denied for everyone, administrators included,
 * while the flag is off. Officer-ness is not a fourth account type and not a
 * separate grant store: it is a live staff assignment on a service provider
 * (a company record) carrying an officer role, read through CipAccess.
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

    /** Assign a staff member to a service provider with an officer role. */
    private function makeOfficer(User $user, string $role, ?Company $provider = null): CompanyStaffAssignment
    {
        $provider ??= Company::create(['uid' => 'provider-'.uniqid(), 'name' => 'Galaxy']);

        $assignment = CompanyStaffAssignment::create([
            'company_id' => $provider->id,
            'user_id' => $user->id,
            'role' => $role,
            'permission_level' => 'view_only',
            'applies_to_clients' => 'company_only',
            'status' => CompanyStaffAssignment::STATUS_ACTIVE,
        ]);

        CipAccess::forget();

        return $assignment;
    }

    public function test_the_flag_darkens_every_cip_capability_for_everyone(): void
    {
        config(['services.cip.enabled' => false]);
        $admin = $this->user(Role::ADMINISTRATOR);
        $officer = $this->user(Role::EMPLOYEE);
        $this->makeOfficer($officer, CipAccess::REVIEWING_OFFICER);

        $this->assertFalse(Role::can($admin, 'cip.view'));
        $this->assertFalse(Role::can($admin, 'cip.configure'));
        $this->assertFalse(CipAccess::can($admin, 'cip.review'));
        // Even a live officer assignment grants nothing while the module is dark.
        $this->assertFalse(CipAccess::isOfficer($officer));
        $this->assertFalse(CipAccess::can($officer, 'cip.review'));
    }

    public function test_an_officer_assignment_widens_an_employee(): void
    {
        config(['services.cip.enabled' => true]);
        $employee = $this->user(Role::EMPLOYEE);

        $this->assertFalse(CipAccess::can($employee, 'cip.review'));

        $assignment = $this->makeOfficer($employee, CipAccess::REVIEWING_OFFICER);

        $this->assertTrue(CipAccess::isOfficer($employee, CipAccess::REVIEWING_OFFICER));
        $this->assertTrue(CipAccess::can($employee, 'cip.review'));
        // A reviewing officer is not a compliance officer.
        $this->assertFalse(CipAccess::can($employee, 'cip.decide'));

        // Ending the assignment ends the officer-ness — no grant survives it.
        $assignment->forceFill(['status' => CompanyStaffAssignment::STATUS_ENDED, 'ended_at' => now()])->save();
        CipAccess::forget();

        $this->assertFalse(CipAccess::isOfficer($employee));
        $this->assertFalse(CipAccess::can($employee, 'cip.review'));
    }

    public function test_a_compliance_assignment_carries_the_decision_capabilities(): void
    {
        config(['services.cip.enabled' => true]);
        $employee = $this->user(Role::EMPLOYEE);
        $this->makeOfficer($employee, CipAccess::COMPLIANCE_OFFICER);

        $this->assertTrue(CipAccess::can($employee, 'cip.compliance'));
        $this->assertTrue(CipAccess::can($employee, 'cip.decide'));
        $this->assertFalse(CipAccess::can($employee, 'cip.review'));
    }

    public function test_officer_roles_are_valid_assignment_roles_end_to_end(): void
    {
        config(['services.cip.enabled' => true]);
        $admin = $this->user(Role::ADMINISTRATOR);
        $employee = $this->user(Role::EMPLOYEE);
        $provider = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);

        // The same endpoint the provider page's Assigned staff dialog calls.
        $this->actingAs($admin)
            ->postJson('/portal/companies/'.$provider->uid.'/staff', [
                'userId' => $employee->id,
                'role' => CipAccess::REVIEWING_OFFICER,
                'level' => 'view_only',
                'appliesToClients' => 'company_only',
            ])
            ->assertSuccessful();

        CipAccess::forget();
        $this->assertTrue(CipAccess::isOfficer($employee, CipAccess::REVIEWING_OFFICER));
    }

    public function test_suspension_settles_officer_assignments(): void
    {
        config(['services.cip.enabled' => true]);
        $admin = $this->user(Role::ADMINISTRATOR);
        $officer = $this->user(Role::EMPLOYEE);
        $this->makeOfficer($officer, CipAccess::REVIEWING_OFFICER);

        $this->assertTrue(CipAccess::isOfficer($officer));

        AccessSync::userSuspended($officer, $admin);
        CipAccess::forget();

        // The provider assignment ended with the account, and officer-ness
        // ended with the assignment — one mechanism, no second store.
        $this->assertFalse(CipAccess::isOfficer($officer));
    }

    public function test_clients_are_never_officers(): void
    {
        config(['services.cip.enabled' => true]);
        $client = $this->user(Role::CLIENT);
        $this->makeOfficer($client, CipAccess::REVIEWING_OFFICER);

        // Even if a stray assignment row exists, a client account holds no
        // officer capability.
        $this->assertFalse(CipAccess::isOfficer($client));
        $this->assertFalse(CipAccess::can($client, 'cip.review'));
    }
}
