<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyLocation;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Companies\CompanyLocations;
use App\Support\Companies\CompanyMembers;
use App\Support\Companies\CompanyRoles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A service provider has a main office and branches. Portal users sit on one
 * of those locations.
 */
class CompanyLocationsTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function person(string $type, array $attrs = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $attrs));
    }

    public function test_a_service_provider_starts_with_its_main_office(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/portal/companies', [
            'name' => 'iGraphics',
        ])->assertCreated();

        $company = Company::where('name', 'iGraphics')->first();
        $this->assertNotNull($company);

        $offices = CompanyLocation::where('company_id', $company->id)->get();
        $this->assertCount(1, $offices);
        $this->assertSame(CompanyLocation::KIND_MAIN, $offices[0]->kind);
        $this->assertSame('iGraphics Main Office', $offices[0]->name);
    }

    public function test_an_administrator_builds_the_office_tree_and_places_users(): void
    {
        $admin = $this->admin();
        $company = Company::create(['uid' => 'igraphics', 'name' => 'iGraphics']);

        $this->actingAs($admin)
            ->postJson('/portal/companies/igraphics/locations', ['name' => 'Branch: Tiget'])
            ->assertCreated()
            ->assertJsonPath('location.name', 'Tiget')
            ->assertJsonPath('location.kind', CompanyLocation::KIND_BRANCH);

        $this->actingAs($admin)
            ->postJson('/portal/companies/igraphics/locations', ['name' => 'Another Branch'])
            ->assertCreated();

        $tiget = CompanyLocation::where('company_id', $company->id)->where('name', 'Tiget')->first();
        $other = CompanyLocation::where('company_id', $company->id)->where('name', 'Another Branch')->first();
        $main = CompanyLocation::where('company_id', $company->id)->where('kind', CompanyLocation::KIND_MAIN)->first();

        $this->actingAs($admin)->postJson('/portal/companies/igraphics/members', [
            'email' => 'a@igraphics.test',
            'name' => 'User A',
            'role' => 'member',
            'invite' => false,
        ])->assertCreated();

        $this->actingAs($admin)->postJson('/portal/companies/igraphics/members', [
            'email' => 'd@igraphics.test',
            'name' => 'User D',
            'role' => 'member',
            'invite' => false,
            'locationId' => $tiget->uid,
        ])->assertCreated();

        $userG = $this->person(Role::CLIENT, ['name' => 'User G', 'email' => 'g@igraphics.test']);
        $memberG = CompanyMembers::add($company, [
            'email' => $userG->email,
            'name' => 'User G',
            'role' => CompanyRoles::MEMBER,
            'location_uid' => $other->uid,
        ], $admin, notify: false);

        $this->assertSame($main->id, CompanyMember::where('email', 'a@igraphics.test')->value('location_id'));
        $this->assertSame($tiget->id, CompanyMember::where('email', 'd@igraphics.test')->value('location_id'));
        $this->assertSame($other->id, $memberG->location_id);

        $listed = $this->actingAs($admin)->getJson('/portal/companies/igraphics/members')->assertOk();
        $names = collect($listed->json('locations'))->pluck('name')->all();
        $this->assertSame(['iGraphics Main Office', 'Another Branch', 'Tiget'], $names);

        $moved = collect($listed->json('members'))->firstWhere('email', 'd@igraphics.test');
        $this->assertSame($tiget->uid, $moved['locationId']);

        $this->actingAs($admin)
            ->patchJson('/portal/companies/igraphics/members/'.$moved['id'], [
                'locationId' => $main->uid,
            ])
            ->assertOk();

        $this->assertSame($main->id, CompanyMember::where('email', 'd@igraphics.test')->value('location_id'));
    }

    public function test_removing_a_branch_sends_its_users_to_the_main_office(): void
    {
        $admin = $this->admin();
        $company = Company::create(['uid' => 'igraphics', 'name' => 'iGraphics']);
        $branch = CompanyLocations::addBranch($company, 'Tiget', $admin);
        $main = CompanyLocation::where('company_id', $company->id)->where('kind', CompanyLocation::KIND_MAIN)->first();

        CompanyMembers::add($company, [
            'email' => 'd@igraphics.test',
            'name' => 'User D',
            'role' => CompanyRoles::MEMBER,
            'location_uid' => $branch->uid,
        ], $admin, notify: false);

        $this->actingAs($admin)
            ->deleteJson('/portal/companies/igraphics/locations/'.$main->uid)
            ->assertStatus(422);

        $this->actingAs($admin)
            ->deleteJson('/portal/companies/igraphics/locations/'.$branch->uid)
            ->assertOk();

        $this->assertNull(CompanyLocation::where('uid', $branch->uid)->first());
        $this->assertSame($main->id, CompanyMember::where('email', 'd@igraphics.test')->value('location_id'));
    }

    public function test_a_branch_name_cannot_repeat_at_the_same_provider(): void
    {
        $admin = $this->admin();
        Company::create(['uid' => 'igraphics', 'name' => 'iGraphics']);

        $this->actingAs($admin)
            ->postJson('/portal/companies/igraphics/locations', ['name' => 'Tiget'])
            ->assertCreated();

        $this->actingAs($admin)
            ->postJson('/portal/companies/igraphics/locations', ['name' => 'tiget'])
            ->assertStatus(422);
    }

    public function test_a_provider_admin_manages_branches_at_their_firm_only(): void
    {
        $admin = $this->admin();
        $own = Company::create(['uid' => 'igraphics', 'name' => 'iGraphics']);
        Company::create(['uid' => 'other-firm', 'name' => 'Other Firm']);

        $providerAdmin = $this->person(Role::SERVICE_PROVIDER_ADMIN, [
            'email' => 'ada@igraphics.test',
        ]);
        CompanyMembers::add($own, [
            'email' => $providerAdmin->email,
            'name' => 'Ada Admin',
            'role' => CompanyRoles::MEMBER,
        ], $admin, notify: false);

        $this->actingAs($providerAdmin)
            ->postJson('/portal/companies/igraphics/locations', ['name' => 'Tiget'])
            ->assertCreated();

        $this->actingAs($providerAdmin)
            ->postJson('/portal/companies/other-firm/locations', ['name' => 'Tiget'])
            ->assertForbidden();
    }

    public function test_renaming_the_provider_renames_the_default_main_office(): void
    {
        $admin = $this->admin();
        Company::create(['uid' => 'igraphics', 'name' => 'iGraphics']);

        $this->actingAs($admin)
            ->patchJson('/portal/companies/igraphics', ['name' => 'iGraphics Ltd'])
            ->assertOk();

        $this->assertSame(
            'iGraphics Ltd Main Office',
            CompanyLocation::where('kind', CompanyLocation::KIND_MAIN)->value('name'),
        );
    }

    public function test_moving_a_contact_to_another_provider_lands_them_on_that_main_office(): void
    {
        $admin = $this->admin();
        $from = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);
        $to = Company::create(['uid' => 'igraphics', 'name' => 'iGraphics']);
        $branch = CompanyLocations::addBranch($from, 'Tiget', $admin);

        $client = Client::create([
            'uid' => 'user-d',
            'name' => 'User D',
            'company_id' => $from->id,
            'company' => 'Galaxy',
            'email' => 'd@galaxy.test',
            'data' => [],
        ]);

        CompanyMembers::add($from, [
            'email' => 'd@galaxy.test',
            'name' => 'User D',
            'role' => CompanyRoles::MEMBER,
            'client_id' => $client->id,
            'location_uid' => $branch->uid,
        ], $admin, notify: false);

        $this->actingAs($admin)
            ->postJson('/portal/companies/galaxy/contacts/user-d/transfer', [
                'companyId' => 'igraphics',
            ])
            ->assertOk();

        $main = CompanyLocation::where('company_id', $to->id)->where('kind', CompanyLocation::KIND_MAIN)->first();
        $moved = CompanyMember::query()->current()->where('company_id', $to->id)->where('email', 'd@galaxy.test')->first();

        $this->assertNotNull($moved);
        $this->assertSame($main->id, $moved->location_id);
    }
}
