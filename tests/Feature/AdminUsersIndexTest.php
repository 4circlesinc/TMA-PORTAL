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

    public function test_the_dropdown_offers_only_the_internal_working_roles(): void
    {
        $admin = $this->staff('Administrator');

        // External people are never typed by hand — they arrive through
        // invitations from the client or service provider pages.
        $this->actingAs($admin)
            ->getJson('/admin/users')
            ->assertOk()
            ->assertJsonPath('accountTypes', ['CRO / Reviewing officer', 'Administrator']);
    }

    public function test_the_directory_describes_accounts_by_what_they_are(): void
    {
        $admin = $this->staff('Administrator');
        $parked = $this->staff('Employee');

        // A contact invited from a service provider page.
        $provider = \App\Models\Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);
        $contact = $this->staff('Client');
        \App\Models\CompanyMember::create([
            'company_id' => $provider->id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => \App\Models\CompanyMember::STATUS_ACTIVE,
        ]);

        // A client under a provider, and one under nobody.
        $referred = $this->staff('Client');
        \App\Models\Client::create([
            'uid' => 'referred-one', 'name' => 'Referred One', 'user_id' => $referred->id,
            'referral_type' => 'company', 'referred_by_company_id' => $provider->id, 'data' => [],
        ]);
        $private = $this->staff('Client');
        \App\Models\Client::create([
            'uid' => 'private-one', 'name' => 'Private One', 'user_id' => $private->id, 'data' => [],
        ]);

        $users = collect($this->actingAs($admin)->getJson('/admin/users')->assertOk()->json('users'))
            ->keyBy('id');

        $this->assertSame('Administrator', $users[$admin->id]['accountTypeLabel']);
        $this->assertSame('Pending', $users[$parked->id]['accountTypeLabel']);
        $this->assertSame('Service Provider Contact', $users[$contact->id]['accountTypeLabel']);
        $this->assertSame('Service Provider Client', $users[$referred->id]['accountTypeLabel']);
        $this->assertSame('Private Client', $users[$private->id]['accountTypeLabel']);
    }

    public function test_non_admin_staff_cannot_list_users(): void
    {
        // This table is the account administration: every account's status and
        // sign-in history, with approve / suspend / reset / delete per row.
        // Non-admin staff used to get it read-only, which meant the Users page
        // was in their sidebar. They browse colleagues through People instead —
        // see PortalAccessTest.
        $officer = $this->staff('Reviewing Officer');
        $this->staff('Administrator');

        $this->actingAs($officer)
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
