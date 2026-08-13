<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\CipAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The native CIP module ships dark behind FEATURE_CIP, exactly like CBI —
 * every cip.* capability is denied for everyone, administrators included,
 * while the flag is off. Officer-ness is an account type: "Reviewing
 * Officer" (the brief's CRO) and "Compliance Officer" sit beside Employee in
 * the Users dropdown, keep the whole Employee baseline across the portal,
 * and hold exactly the brief's officer bullets inside the module.
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

    public function test_the_flag_darkens_every_cip_capability_for_everyone(): void
    {
        config(['services.cip.enabled' => false]);
        $admin = $this->user(Role::ADMINISTRATOR);
        $cro = $this->user(Role::REVIEWING_OFFICER);

        $this->assertFalse(Role::can($admin, 'cip.view'));
        $this->assertFalse(Role::can($admin, 'cip.configure'));
        // Even the officer account type grants nothing while the module is
        // dark — but its employee baseline keeps working.
        $this->assertFalse(CipAccess::can($cro, 'cip.review'));
        $this->assertFalse(CipAccess::isOfficer($cro));
        $this->assertTrue(Role::can($cro, 'clients.view'));
    }

    public function test_officer_types_keep_the_whole_employee_baseline(): void
    {
        config(['services.cip.enabled' => true]);

        foreach ([Role::REVIEWING_OFFICER, Role::COMPLIANCE_OFFICER] as $type) {
            $officer = $this->user($type);

            // Everything an employee holds, an officer holds — mail, files,
            // the client hub, signatures. The type narrows nothing outside CIP.
            $this->assertTrue(Role::isStaff($officer), $type.' should be staff');
            $this->assertTrue(Role::can($officer, 'clients.view'), $type.' should reach the client hub');
            $this->assertTrue(Role::can($officer, 'mail.use'), $type.' should hold mail');
            $this->assertTrue(Role::can($officer, 'signatures.create'), $type.' should author signatures');
            $this->assertTrue(Role::can($officer, 'cip.view'), $type.' should reach CIP');

            // And nothing an employee is refused becomes open.
            $this->assertFalse(Role::can($officer, 'users.view'), $type.' must not administer accounts');
            $this->assertFalse(Role::can($officer, 'cip.assign'), $type.' must not assign files');
            $this->assertFalse(Role::can($officer, 'cip.configure'), $type.' must not configure the module');
        }
    }

    public function test_the_reviewing_officer_holds_exactly_the_review_bullets(): void
    {
        config(['services.cip.enabled' => true]);
        $cro = $this->user(Role::REVIEWING_OFFICER);

        // Review applications, assess documents, issue comments, request
        // updates, approve documents for submission.
        $this->assertTrue(CipAccess::can($cro, 'cip.review'));
        $this->assertTrue(CipAccess::isOfficer($cro, CipAccess::REVIEWING_OFFICER));

        // But not the compliance side: no processing, no decisions.
        $this->assertFalse(CipAccess::can($cro, 'cip.compliance'));
        $this->assertFalse(CipAccess::can($cro, 'cip.decide'));
    }

    public function test_the_compliance_officer_holds_exactly_the_compliance_bullets(): void
    {
        config(['services.cip.enabled' => true]);
        $compliance = $this->user(Role::COMPLIANCE_OFFICER);

        // Process submissions, update statuses, record decisions.
        $this->assertTrue(CipAccess::can($compliance, 'cip.compliance'));
        $this->assertTrue(CipAccess::can($compliance, 'cip.decide'));
        $this->assertTrue(CipAccess::isOfficer($compliance, CipAccess::COMPLIANCE_OFFICER));

        // But not the reviewer's document verbs.
        $this->assertFalse(CipAccess::can($compliance, 'cip.review'));
    }

    public function test_plain_employees_and_clients_hold_no_officer_verbs(): void
    {
        config(['services.cip.enabled' => true]);

        $employee = $this->user(Role::EMPLOYEE);
        $this->assertTrue(Role::can($employee, 'cip.view'));
        $this->assertFalse(CipAccess::can($employee, 'cip.review'));
        $this->assertFalse(CipAccess::isOfficer($employee));

        $client = $this->user(Role::CLIENT);
        $this->assertFalse(Role::can($client, 'cip.view'));
        $this->assertFalse(CipAccess::isOfficer($client));
    }

    public function test_admins_assign_the_officer_types_from_the_users_page(): void
    {
        config(['services.cip.enabled' => true]);
        $admin = $this->user(Role::ADMINISTRATOR);
        $employee = $this->user(Role::EMPLOYEE);

        // The same endpoint the Users page's account-type dropdown drives.
        $this->actingAs($admin)
            ->patchJson('/admin/users/'.$employee->id, [
                'first_name' => $employee->first_name ?: 'Test',
                'last_name' => $employee->last_name ?: 'Officer',
                'email' => $employee->email,
                'account_type' => Role::REVIEWING_OFFICER,
            ])
            ->assertSuccessful();

        $this->assertSame(Role::REVIEWING_OFFICER, $employee->fresh()->account_type);
        $this->assertTrue(CipAccess::isOfficer($employee->fresh(), CipAccess::REVIEWING_OFFICER));
    }
}
