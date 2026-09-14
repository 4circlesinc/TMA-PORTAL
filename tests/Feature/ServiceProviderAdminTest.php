<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipProvider;
use App\Models\Client;
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

    public function test_inviting_a_new_address_sends_an_invitation_not_the_added_letter(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, [
            'email' => 'gil@galaxy.example',
            'first_name' => 'Gil',
        ]);
        $this->attach($company, $spAdmin, $tma);
        Mail::fake();

        $this->actingAs($spAdmin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Dana Reed',
            'email' => 'dana@galaxy.example',
        ])->assertCreated()
            ->assertJsonPath('member.role', 'member');

        Mail::assertSent(Postcard::class, 1);
        Mail::assertSent(Postcard::class, function (Postcard $mail) {
            return $mail->hasTo('dana@galaxy.example')
                && str_contains(strtolower($mail->subjectLine), 'invited');
        });
        Mail::assertNotSent(Postcard::class, function (Postcard $mail) {
            return str_contains($mail->subjectLine, 'You have been added')
                || str_contains($mail->subjectLine, 'You now have access');
        });
    }

    public function test_adding_an_existing_account_sends_the_contact_added_letter(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, [
            'email' => 'gil@galaxy.example',
            'first_name' => 'Gil',
        ]);
        $this->attach($company, $spAdmin, $tma);
        $contact = $this->user(Role::CLIENT, [
            'email' => 'dana@galaxy.example',
            'name' => 'Dana Reed',
            'first_name' => 'Dana',
        ]);
        Mail::fake();

        $this->actingAs($spAdmin)->postJson("/portal/companies/{$company->uid}/members", [
            'name' => 'Dana Reed',
            'email' => $contact->email,
        ])->assertCreated()
            ->assertJsonPath('member.role', 'member')
            ->assertJsonPath('invitation', null);

        Mail::assertSent(Postcard::class, 1);
        Mail::assertSent(Postcard::class, function (Postcard $mail) {
            return $mail->hasTo('dana@galaxy.example')
                && str_contains($mail->subjectLine, 'You have been added')
                && str_contains($mail->subjectLine, 'service provider contact');
        });
        Mail::assertNotSent(Postcard::class, function (Postcard $mail) {
            return str_contains($mail->subjectLine, 'You now have access')
                || str_contains($mail->subjectLine, 'Service Provider admin')
                || str_contains(strtolower($mail->subjectLine), 'switched');
        });

        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $contact->id,
            'type' => 'company.member_added',
        ]);
        $this->assertTrue(
            CompanyMember::query()
                ->where('company_id', $company->id)
                ->where('user_id', $contact->id)
                ->current()
                ->exists()
        );
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
            ->assertJsonPath('isAdmin', false)
            ->assertJsonPath('serviceProvider.id', $company->uid)
            ->assertJsonPath('serviceProvider.name', 'Galaxy');
    }

    public function test_they_reach_cip_when_their_firm_has_no_provider_row(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        $company = Company::create([
            'uid' => 'plain-firm',
            'name' => 'Plain Firm',
            'status' => 'active',
        ]);
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@plain.example']);
        $this->attach($company, $spAdmin, $tma);

        $this->assertTrue(CipAccess::canReach($spAdmin));
        $this->assertTrue(CipAccess::isProviderContact($spAdmin));

        $this->actingAs($spAdmin)->getJson("/portal/companies/{$company->uid}")
            ->assertOk()
            ->assertJsonPath('company.name', 'Plain Firm');
    }

    public function test_the_shell_bakes_their_firm_into_the_nav(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $this->attach($company, $spAdmin, $tma);

        $this->actingAs($spAdmin)->get('/citizenship-applications')
            ->assertOk()
            ->assertSee('window.TMABootProviderCompany=', false)
            ->assertSee('"id":"gal-firm"', false)
            ->assertSee('"name":"Galaxy"', false);
    }

    public function test_they_can_add_and_edit_a_contact_at_their_firm(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $this->attach($company, $spAdmin, $tma);

        $created = $this->actingAs($spAdmin)->postJson('/portal/clients', [
            'uid' => 'dana-reed',
            'name' => 'Dana Reed',
            'companyId' => $company->uid,
            'profile' => [
                'firstName' => 'Dana',
                'lastName' => 'Reed',
                'emails' => [['type' => 'work', 'value' => 'dana@galaxy.example']],
            ],
        ])->assertOk();

        $this->assertSame($company->uid, $created->json('client.companyId'));
        $uid = $created->json('client.id');

        $this->actingAs($spAdmin)->patchJson("/portal/clients/{$uid}", [
            'name' => 'Dana R. Reed',
            'companyId' => $company->uid,
            'profile' => [
                'firstName' => 'Dana',
                'lastName' => 'R. Reed',
            ],
        ])->assertOk()
            ->assertJsonPath('client.name', 'Dana R. Reed');
    }

    public function test_they_cannot_add_a_contact_at_another_firm(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$galaxy] = $this->providerFirm();
        [$bluemina] = $this->providerFirm('Bluemina', 'BLU');
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $this->attach($galaxy, $spAdmin, $tma);

        $this->actingAs($spAdmin)->postJson('/portal/clients', [
            'uid' => 'eve-blue',
            'name' => 'Eve Blue',
            'companyId' => $bluemina->uid,
            'profile' => ['firstName' => 'Eve', 'lastName' => 'Blue'],
        ])->assertForbidden();
    }

    public function test_they_can_rename_their_firm_but_not_its_code(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $this->attach($company, $spAdmin, $tma);

        $this->actingAs($spAdmin)->patchJson("/portal/companies/{$company->uid}", [
            'name' => 'Galaxy Partners',
            'cipCode' => 'HACK',
        ])->assertOk()
            ->assertJsonPath('company.name', 'Galaxy Partners');

        $this->assertSame('GAL', $company->fresh()->cipProvider->code);
    }

    public function test_they_can_edit_member_details_but_not_roles(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $this->attach($company, $spAdmin, $tma);
        $contact = $this->user(Role::CLIENT, ['email' => 'dana@galaxy.example', 'name' => 'Dana Reed']);
        $member = $this->attach($company, $contact, $tma);

        $this->actingAs($spAdmin)
            ->patchJson("/portal/companies/{$company->uid}/members/{$member->uuid}", [
                'name' => 'Dana R.',
            ])
            ->assertOk()
            ->assertJsonPath('member.name', 'Dana R.');

        $this->actingAs($spAdmin)
            ->patchJson("/portal/companies/{$company->uid}/members/{$member->uuid}", [
                'role' => 'primary',
            ])
            ->assertForbidden();
    }

    public function test_deleting_a_contact_parks_their_login_in_the_recycle_bin(): void
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        [$company] = $this->providerFirm();
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, ['email' => 'gil@galaxy.example']);
        $this->attach($company, $spAdmin, $tma);

        $person = $this->user(Role::CLIENT, [
            'email' => 'dana@galaxy.example',
            'name' => 'Dana Reed',
        ]);
        $this->attach($company, $person, $tma);
        $client = Client::create([
            'uid' => 'dana-reed',
            'name' => 'Dana Reed',
            'email' => $person->email,
            'company_id' => $company->id,
            'user_id' => $person->id,
            'data' => [],
        ]);

        $this->actingAs($spAdmin)->deleteJson("/portal/clients/{$client->uid}")->assertOk();

        $this->assertSoftDeleted('clients', ['id' => $client->id]);
        $this->assertSoftDeleted('users', ['id' => $person->id]);

        $this->actingAs($spAdmin)->getJson('/portal/admin/recycle-bin')->assertForbidden();
        $this->actingAs($tma)->getJson('/portal/admin/recycle-bin')->assertOk();
    }
}
