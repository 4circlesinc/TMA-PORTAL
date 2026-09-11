<?php

namespace Tests\Feature;

use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\CipAccess;
use App\Support\Companies\CompanyAccess;
use App\Support\Companies\CompanyMembers;
use App\Support\Companies\CompanyRoles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Service Provider admin is an external account type: same CIP reach as a
 * contact of the firm, plus the right to invite and remove people there.
 */
class ServiceProviderAdminTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, array $attrs = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $attrs));
    }

    /** @return array{0: Company, 1: CipProvider} */
    private function providerFirm(string $name = 'Galaxy', string $code = 'GAL'): array
    {
        $company = Company::create([
            'uid' => strtolower($code).'-firm',
            'name' => $name,
            'status' => 'active',
        ]);
        $provider = CipProvider::create([
            'name' => $name,
            'code' => $code,
            'company_id' => $company->id,
        ]);

        return [$company, $provider];
    }

    private function attach(Company $company, User $user, User $by): CompanyMember
    {
        return CompanyMembers::add($company, [
            'email' => $user->email,
            'name' => $user->name,
            'role' => CompanyRoles::MEMBER,
        ], $by);
    }

    /* ── typing ─────────────────────────────────────────────────────── */

    public function test_a_service_provider_admin_is_external_not_staff(): void
    {
        $admin = $this->user(Role::SERVICE_PROVIDER_ADMIN);

        $this->assertTrue(Role::isClient($admin));
        $this->assertTrue(Role::isServiceProviderAdmin($admin));
        $this->assertFalse(Role::isStaff($admin));
        $this->assertFalse(Role::isAdmin($admin));

        foreach (Role::capabilityNames() as $capability) {
            $this->assertFalse(Role::can($admin, $capability), $capability.' must stay closed');
        }
    }

    public function test_the_users_page_labels_the_type_and_does_not_offer_it_in_the_dropdown(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $this->attach($company, $spAdmin, $tma);

        $payload = $this->actingAs($tma)->getJson('/admin/users')->assertOk();

        $this->assertSame(
            [Role::REVIEWING_OFFICER, Role::ADMINISTRATOR],
            $payload->json('accountTypes')
        );

        $users = collect($payload->json('users'))->keyBy('id');
        $this->assertSame(Role::SERVICE_PROVIDER_ADMIN, $users[$spAdmin->id]['accountType']);
        $this->assertSame(Role::SERVICE_PROVIDER_ADMIN, $users[$spAdmin->id]['accountTypeLabel']);
        $this->assertSame('Galaxy', $users[$spAdmin->id]['serviceProviders'][0]['name']);
    }

    public function test_the_users_page_can_promote_a_contact_to_admin(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $person = $this->user(Role::CLIENT, [
            'email' => 'pat@galaxy.example',
            'first_name' => 'Pat',
            'last_name' => 'Reed',
        ]);
        $this->attach($company, $person, $tma);

        $this->actingAs($tma)
            ->patchJson("/admin/users/{$person->id}", [
                'first_name' => 'Pat',
                'last_name' => 'Reed',
                'email' => $person->email,
                'account_type' => Role::SERVICE_PROVIDER_ADMIN,
            ])
            ->assertOk();

        $this->assertSame(Role::SERVICE_PROVIDER_ADMIN, $person->fresh()->account_type);
        $this->assertTrue(CompanyAccess::isProviderAdminOf($person->fresh(), $company));
    }

    public function test_the_users_page_cannot_set_admin_without_a_firm(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        $person = $this->user(Role::CLIENT, [
            'first_name' => 'Pat',
            'last_name' => 'Reed',
        ]);

        $this->actingAs($tma)
            ->patchJson("/admin/users/{$person->id}", [
                'first_name' => 'Pat',
                'last_name' => 'Reed',
                'email' => $person->email,
                'account_type' => Role::SERVICE_PROVIDER_ADMIN,
            ])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Assign them to a service provider first.');
    }

    public function test_the_users_page_can_demote_an_admin_to_a_contact(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $person = $this->user(Role::SERVICE_PROVIDER_ADMIN, [
            'email' => 'gil@galaxy.example',
            'first_name' => 'Gil',
            'last_name' => 'Admin',
        ]);
        $this->attach($company, $person, $tma);

        $this->actingAs($tma)
            ->patchJson("/admin/users/{$person->id}", [
                'first_name' => 'Gil',
                'last_name' => 'Admin',
                'email' => $person->email,
                'account_type' => Role::CLIENT,
            ])
            ->assertOk();

        $this->assertSame(Role::CLIENT, $person->fresh()->account_type);
        $this->assertFalse(Role::isServiceProviderAdmin($person->fresh()));
        $this->assertTrue(CipAccess::isProviderContact($person->fresh()));
    }

    public function test_assigning_as_admin_sets_the_account_type(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $person = $this->user(Role::CLIENT, ['email' => 'pat@galaxy.example']);

        $this->actingAs($tma)
            ->postJson("/admin/users/{$person->id}/assign-service-provider", [
                'company' => $company->uid,
                'admin' => true,
            ])
            ->assertOk();

        $person->refresh();
        $this->assertSame(Role::SERVICE_PROVIDER_ADMIN, $person->account_type);
        $this->assertTrue(CipAccess::isProviderContact($person));
        $this->assertTrue(CompanyAccess::isProviderAdminOf($person, $company));
    }

    public function test_assigning_without_the_flag_stays_a_contact(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $person = $this->user(Role::CLIENT);

        $this->actingAs($tma)
            ->postJson("/admin/users/{$person->id}/assign-service-provider", [
                'company' => $company->uid,
            ])
            ->assertOk();

        $this->assertSame(Role::CLIENT, $person->fresh()->account_type);
        $this->assertFalse(Role::isServiceProviderAdmin($person->fresh()));
    }

    /* ── invitations at their own firm ──────────────────────────────── */

    public function test_they_can_invite_and_remove_people_at_their_firm(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $this->attach($company, $spAdmin, $tma);

        $created = $this->actingAs($spAdmin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Dana Reed',
            'email' => 'dana@galaxy.example',
            'role' => 'finance',
        ])->assertCreated();

        $this->assertSame('member', $created->json('member.role'));
        $this->assertTrue($created->json('member.inviteSent'));
        $this->assertSame('Client', Invitation::first()->role);

        $uuid = $created->json('member.id');

        $this->actingAs($spAdmin)
            ->deleteJson("/portal/companies/{$company->uid}/members/{$uuid}")
            ->assertOk();

        $this->assertSame(0, CompanyMember::query()->where('uuid', $uuid)->count());
        $this->assertSame('cancelled', Invitation::first()->status);
    }

    public function test_they_cannot_remove_themselves(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $member = $this->attach($company, $spAdmin, $tma);

        $this->actingAs($spAdmin)
            ->deleteJson("/portal/companies/{$company->uid}/members/{$member->uuid}")
            ->assertStatus(422)
            ->assertJsonPath('message', 'You cannot remove your own access.');
    }

    public function test_they_cannot_invite_staff_or_change_roles(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $member = $this->attach($company, $spAdmin, $tma);
        $officer = $this->user(Role::REVIEWING_OFFICER, ['email' => 'cro@tma.example']);

        $this->actingAs($spAdmin)->postJson("/portal/companies/{$company->uid}/members", [
            'email' => $officer->email,
            'role' => 'member',
        ])->assertStatus(422)
            ->assertJsonPath('message', 'That address belongs to a staff account.');

        $this->actingAs($spAdmin)
            ->patchJson("/portal/companies/{$company->uid}/members/{$member->uuid}", [
                'role' => 'primary',
            ])
            ->assertForbidden();
    }

    public function test_a_regular_contact_cannot_manage_members(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $contact = $this->user(Role::CLIENT, ['email' => 'pat@galaxy.example']);
        $this->attach($company, $contact, $tma);

        $this->actingAs($contact)->getJson("/portal/companies/{$company->uid}/members")
            ->assertForbidden();

        $this->actingAs($contact)->postJson("/portal/companies/{$company->uid}/members", [
            'email' => 'dana@galaxy.example',
            'role' => 'member',
        ])->assertForbidden();
    }

    public function test_they_cannot_manage_another_firms_access(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$galaxy] = $this->providerFirm();
        [$bluemina] = $this->providerFirm('Bluemina', 'BLU');
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $this->attach($galaxy, $spAdmin, $tma);

        $this->actingAs($spAdmin)->getJson("/portal/companies/{$bluemina->uid}")
            ->assertNotFound();

        $this->actingAs($spAdmin)->postJson("/portal/companies/{$bluemina->uid}/members", [
            'email' => 'eve@bluemina.example',
            'role' => 'member',
        ])->assertForbidden();
    }

    public function test_they_see_only_their_firm_in_the_directory(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$galaxy] = $this->providerFirm();
        $this->providerFirm('Bluemina', 'BLU');
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $this->attach($galaxy, $spAdmin, $tma);

        $names = collect($this->actingAs($spAdmin)->getJson('/portal/companies')
            ->assertOk()->json('companies'))->pluck('name');

        $this->assertSame(['Galaxy'], $names->all());

        $this->actingAs($spAdmin)->getJson("/portal/companies/{$galaxy->uid}")
            ->assertOk()
            ->assertJsonPath('company.name', 'Galaxy');
    }

    public function test_identity_reports_the_type(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $this->attach($company, $spAdmin, $tma);

        $this->actingAs($spAdmin)->getJson('/me')
            ->assertOk()
            ->assertJsonPath('accountType', Role::SERVICE_PROVIDER_ADMIN)
            ->assertJsonPath('isServiceProviderAdmin', true)
            ->assertJsonPath('isProviderContact', true)
            ->assertJsonPath('isStaff', false)
            ->assertJsonPath('isAdmin', false);
    }
}
