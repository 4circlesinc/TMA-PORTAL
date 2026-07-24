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

    public function test_employee_can_list_users_read_only(): void
    {
        $employee = $this->staff('Employee');
        $this->staff('Administrator');

        $this->actingAs($employee)
            ->getJson('/admin/users')
            ->assertOk()
            ->assertJsonPath('canManage', false)
            ->assertJsonCount(2, 'users');
    }

    public function test_client_cannot_list_users(): void
    {
        $client = $this->staff('Client');

        $this->actingAs($client)
            ->getJson('/admin/users')
            ->assertForbidden();
    }
}
