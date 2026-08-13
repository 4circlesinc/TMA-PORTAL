<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\CompanyStaffAssignment;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * Service providers (companies) follow the same rule clients always have:
 * administrators see the whole directory, everyone else sees only the
 * providers they hold a live staff assignment on — in the listing, and on
 * the detail endpoints, where a provider outside the slice answers 404, not
 * 403.
 */
class CompanyScopeTest extends TestCase
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

    private function assign(User $user, Company $company): void
    {
        CompanyStaffAssignment::create([
            'company_id' => $company->id,
            'user_id' => $user->id,
            'role' => 'general',
            'permission_level' => 'manager',
            'applies_to_clients' => CompanyStaffAssignment::SCOPE_COMPANY_ONLY,
            'status' => CompanyStaffAssignment::STATUS_ACTIVE,
        ]);
    }

    public function test_staff_see_only_their_assigned_providers(): void
    {
        Cache::flush();
        $galaxy = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);
        Company::create(['uid' => 'bluemina', 'name' => 'Bluemina']);

        $employee = $this->user(Role::EMPLOYEE);
        $this->assign($employee, $galaxy);

        $names = collect($this->actingAs($employee)->getJson('/portal/companies')
            ->assertOk()->json('companies'))->pluck('name');

        $this->assertSame(['Galaxy'], $names->all());

        // Officers are scoped the same way — the account type widens CIP
        // verbs, not the directory.
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $this->assertSame([], $this->actingAs($officer)->getJson('/portal/companies')
            ->assertOk()->json('companies'));
    }

    public function test_admins_see_the_whole_directory(): void
    {
        Cache::flush();
        Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);
        Company::create(['uid' => 'bluemina', 'name' => 'Bluemina']);

        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)->getJson('/portal/companies')
            ->assertOk()->assertJsonCount(2, 'companies');
    }

    public function test_an_unassigned_provider_does_not_exist_404_not_403(): void
    {
        Cache::flush();
        $bluemina = Company::create(['uid' => 'bluemina', 'name' => 'Bluemina']);
        $employee = $this->user(Role::EMPLOYEE);

        $this->actingAs($employee)->getJson('/portal/companies/'.$bluemina->uid)->assertNotFound();
        $this->actingAs($employee)->patchJson('/portal/companies/'.$bluemina->uid, ['name' => 'X'])->assertNotFound();
        $this->actingAs($employee)->deleteJson('/portal/companies/'.$bluemina->uid)->assertNotFound();

        // Assigned, the same provider opens.
        $this->assign($employee, $bluemina);
        $this->actingAs($employee)->getJson('/portal/companies/'.$bluemina->uid)->assertOk();
    }

    public function test_creating_a_provider_assigns_the_creator(): void
    {
        Cache::flush();
        $employee = $this->user(Role::EMPLOYEE);

        $this->actingAs($employee)
            ->postJson('/portal/companies', ['name' => 'Fresh Provider'])
            ->assertCreated();

        $names = collect($this->actingAs($employee)->getJson('/portal/companies')
            ->assertOk()->json('companies'))->pluck('name');

        $this->assertContains('Fresh Provider', $names->all());
    }
}
