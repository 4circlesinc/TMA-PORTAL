<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * 'Employee' is a parked account type: the portal's working roles are the
 * brief's five (Administrator, Reviewing Officer, Compliance Officer, and
 * the external Client side). An approved account still typed Employee is
 * held on /auth/role-pending until an administrator assigns a real role —
 * and every other type passes untouched.
 */
class RolePendingTest extends TestCase
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

    public function test_an_approved_employee_is_parked_on_the_role_pending_screen(): void
    {
        $employee = $this->user(Role::EMPLOYEE);

        $this->actingAs($employee)->get('/')->assertRedirect('/auth/role-pending');
        $this->actingAs($employee)->get('/calendar')->assertRedirect('/auth/role-pending');

        $this->actingAs($employee)->get('/auth/role-pending')
            ->assertOk()
            ->assertSee('The portal is under development')
            ->assertSee('waiting on a role');
    }

    public function test_every_working_role_passes_the_gate(): void
    {
        foreach ([Role::ADMINISTRATOR, Role::REVIEWING_OFFICER, Role::COMPLIANCE_OFFICER, Role::CLIENT] as $type) {
            $this->actingAs($this->user($type))->get('/')->assertOk();
        }
    }

    public function test_assigning_a_role_releases_the_account(): void
    {
        $employee = $this->user(Role::EMPLOYEE);
        $this->actingAs($employee)->get('/')->assertRedirect('/auth/role-pending');

        $employee->forceFill(['account_type' => Role::REVIEWING_OFFICER])->save();

        $this->actingAs($employee->fresh())->get('/')->assertOk();
    }

    public function test_approval_still_comes_first(): void
    {
        // An unapproved employee sees the approval screen, not the role one —
        // the two waits stack in the order they resolve.
        $pending = User::factory()->create([
            'status' => 'pending',
            'account_type' => Role::EMPLOYEE,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
        ]);

        $this->actingAs($pending)->get('/')->assertRedirect('/auth/pending');
    }
}
