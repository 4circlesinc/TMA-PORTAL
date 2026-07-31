<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminUsersIndexTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $type = 'Administrator'): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_admin_can_list_users(): void
    {
        $admin = $this->staff('Administrator');
        $this->staff('Employee');

        $this->actingAs($admin)
            ->getJson('/admin/users')
            ->assertOk()
            ->assertJsonPath('canManage', true)
            ->assertJsonCount(2, 'users');
    }

    public function test_employee_cannot_list_users(): void
    {
        // This table is the account administration: every account's status and
        // sign-in history, with approve / suspend / reset / delete per row.
        // Employees used to get it read-only, which meant the Users page was
        // in their sidebar. They browse colleagues through People instead —
        // see PortalAccessTest.
        $employee = $this->staff('Employee');
        $this->staff('Administrator');

        $this->actingAs($employee)
            ->getJson('/admin/users')
            ->assertForbidden();
    }

    public function test_client_cannot_list_users(): void
    {
        $client = $this->staff('Client');

        $this->actingAs($client)
            ->getJson('/admin/users')
            ->assertForbidden();
    }
}
