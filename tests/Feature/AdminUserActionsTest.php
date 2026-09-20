<?php

namespace Tests\Feature;

use App\Models\AuthEvent;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Notification;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\CipAccess;
use App\Support\SecurityPolicies;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class AdminUserActionsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Cache::flush();
    }

    private function admin(array $attrs = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $attrs));
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

    private function provider(string $name = 'Galaxy', string $code = 'GAL'): Company
    {
        $company = Company::create(['uid' => strtolower($code).'-firm', 'name' => $name]);
        CipProvider::create(['name' => $name, 'code' => $code, 'company_id' => $company->id]);

        return $company;
    }

    public function test_activity_includes_created_and_sign_in_history(): void
    {
        $admin = $this->admin();
        $person = $this->user(Role::CLIENT);
        AuthEvent::create([
            'user_id' => $person->id, 'event' => 'login',
            'ip' => '127.0.0.1', 'user_agent' => 'Test', 'created_at' => now()->subHour(),
        ]);
        AuthEvent::create([
            'user_id' => $person->id, 'event' => 'logout',
            'ip' => '127.0.0.1', 'user_agent' => 'Test', 'created_at' => now(),
        ]);

        $login = $this->actingAs($admin)
            ->getJson("/admin/users/{$person->id}/activity?type=login")
            ->assertOk()
            ->assertJsonPath('events.0.event', 'logout')
            ->assertJsonPath('events.1.event', 'login');

        $this->assertNotNull($login->json('joinedIso'));
        $this->assertNotNull($login->json('lastLoginIso'));
        $this->assertNotNull($login->json('lastLogoutIso'));
    }

    /**
     * The Activity tab is an audit trail, so it has to show what the person did
     * in the portal (activity_logs) alongside what happened to their account
     * (auth_events). Reading only auth_events made the tab look empty for
     * anyone whose work was files and clients rather than sign-ins.
     */
    public function test_app_activity_merges_the_audit_trail_with_account_events(): void
    {
        $admin = $this->admin();
        $person = $this->user(Role::CLIENT);

        AuthEvent::create([
            'user_id' => $person->id, 'event' => 'account_updated',
            'ip' => '127.0.0.1', 'user_agent' => 'Test', 'created_at' => now()->subHours(2),
        ]);
        ActivityLogger::log([
            'actor' => $person,
            'type' => 'file.uploaded',
            'description' => 'Uploaded passport.pdf',
        ]);

        $res = $this->actingAs($admin)
            ->getJson("/admin/users/{$person->id}/activity?type=app")
            ->assertOk();

        $events = collect($res->json('events'));

        // Newest first, so the upload leads and the older account edit follows.
        $this->assertSame('file.uploaded', $events[0]['event']);
        $this->assertSame('Uploaded passport.pdf', $events[0]['label']);
        $this->assertSame('account_updated', $events[1]['event']);
    }

    /**
     * The auth listener writes a sign-in to auth_events AND activity_logs. The
     * app trail must drop the second copy, or the tab fills with logins and
     * buries the application activity it exists to show.
     */
    public function test_app_activity_does_not_repeat_sign_ins(): void
    {
        $admin = $this->admin();
        $person = $this->user(Role::CLIENT, ['name' => 'Sam Staff']);

        ActivityLogger::log([
            'actor' => $person,
            'type' => 'security.login',
            'description' => 'Sam Staff signed in',
        ]);
        ActivityLogger::log([
            'actor' => $person,
            'type' => 'file.uploaded',
            'description' => 'Uploaded passport.pdf',
        ]);

        $events = collect($this->actingAs($admin)
            ->getJson("/admin/users/{$person->id}/activity?type=app")
            ->assertOk()
            ->json('events'));

        $this->assertCount(1, $events);
        $this->assertSame('file.uploaded', $events[0]['event']);
    }

    /**
     * Requiring an authenticator writes to both tables in one request. The tab
     * must show the sentence naming the administrator, not that sentence AND
     * the bare "Authenticator required by admin" label beneath it.
     */
    public function test_app_activity_prefers_the_named_sentence_over_its_twin(): void
    {
        $admin = $this->admin(['name' => 'Ada Admin']);
        $person = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Sam Staff']);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$person->id}/require-two-factor", ['required' => true])
            ->assertOk();

        $events = collect($this->actingAs($admin)
            ->getJson("/admin/users/{$person->id}/activity?type=app")
            ->assertOk()
            ->json('events'));

        $this->assertCount(1, $events->where('event', 'account.two_factor_required'));
        $this->assertCount(0, $events->where('event', 'two_factor_required'));
        $this->assertSame(
            'Ada Admin required an authenticator app for Sam Staff',
            $events->firstWhere('event', 'account.two_factor_required')['label']
        );
    }

    public function test_sign_in_history_excludes_application_activity(): void
    {
        $admin = $this->admin();
        $person = $this->user(Role::CLIENT);

        ActivityLogger::log([
            'actor' => $person,
            'type' => 'file.uploaded',
            'description' => 'Uploaded passport.pdf',
        ]);
        AuthEvent::create([
            'user_id' => $person->id, 'event' => 'login_failed',
            'ip' => '127.0.0.1', 'user_agent' => 'Test', 'created_at' => now(),
        ]);

        $res = $this->actingAs($admin)
            ->getJson("/admin/users/{$person->id}/activity?type=login")
            ->assertOk();

        $events = collect($res->json('events'));
        $this->assertCount(1, $events);
        $this->assertSame('login_failed', $events[0]['event']);
        $this->assertSame(1, $res->json('failedLast30Days'));
    }

    /**
     * Clearing a second factor is a security decision by a named person; it
     * must leave a trail naming them, and the account holder must hear about
     * it, because a silent reset is indistinguishable from a compromise.
     */
    public function test_resetting_an_authenticator_is_audited_and_notified(): void
    {
        $admin = $this->admin(['name' => 'Ada Admin']);
        $person = $this->user(Role::REVIEWING_OFFICER, [
            'name' => 'Sam Staff',
            'two_factor_secret' => encrypt('secret'),
            'two_factor_confirmed_at' => now(),
        ]);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$person->id}/reset-two-factor")
            ->assertOk();

        $this->assertNull($person->fresh()->two_factor_secret);

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $admin->id,
            'activity_type' => 'account.two_factor_reset',
            'subject_id' => $person->id,
        ]);
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $person->id,
            'type' => 'security.two_factor_changed',
        ]);
    }

    public function test_an_administrator_can_require_an_authenticator_on_one_account(): void
    {
        $admin = $this->admin();
        $person = $this->user(Role::REVIEWING_OFFICER);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$person->id}/require-two-factor", ['required' => true])
            ->assertOk()
            ->assertJsonPath('requireTwoFactor', true);

        $this->assertTrue($person->fresh()->require_two_factor);
        $this->assertTrue($person->fresh()->mustUseAuthenticator());
        $this->assertSame(1, Notification::where('user_id', $person->id)
            ->where('type', 'account.two_factor_required')->count());
        $this->assertTrue(AuthEvent::where('user_id', $person->id)
            ->where('event', 'two_factor_required')->exists());

        $this->actingAs($person->fresh())
            ->getJson('/portal/companies')
            ->assertForbidden()
            ->assertJsonPath('code', 'mfa-required');
    }

    public function test_clearing_the_requirement_lets_them_use_the_portal_again(): void
    {
        $admin = $this->admin();
        $person = $this->user(Role::REVIEWING_OFFICER, ['require_two_factor' => true]);

        $this->actingAs($person)
            ->getJson('/portal/companies')
            ->assertForbidden()
            ->assertJsonPath('code', 'mfa-required');

        $this->actingAs($admin)
            ->postJson("/admin/users/{$person->id}/require-two-factor", ['required' => false])
            ->assertOk();

        $this->assertFalse($person->fresh()->require_two_factor);
        $this->actingAs($person->fresh())->getJson('/portal/companies')->assertOk();
    }

    public function test_service_providers_are_listed_for_the_users_page_picker(): void
    {
        $admin = $this->admin();
        $this->provider();
        Company::create(['uid' => 'not-a-provider', 'name' => 'Just a company']);

        $this->actingAs($admin)
            ->getJson('/admin/users/service-providers')
            ->assertOk()
            ->assertJsonCount(1, 'providers')
            ->assertJsonPath('providers.0.name', 'Galaxy')
            ->assertJsonPath('providers.0.cipCode', 'GAL');
    }

    public function test_a_pending_account_can_be_approved_as_a_service_provider_contact(): void
    {
        $admin = $this->admin();
        $company = $this->provider();
        $newbie = User::factory()->create([
            'status' => 'pending',
            'account_type' => Role::CLIENT,
            'name' => 'Gil Contact',
        ]);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$newbie->id}/assign-service-provider", ['company' => $company->uid])
            ->assertOk();

        $newbie->refresh();
        $this->assertSame('approved', $newbie->status);
        $this->assertSame(Role::CLIENT, $newbie->account_type);
        $this->assertTrue(CipAccess::isProviderContact($newbie));
        $this->assertTrue(CompanyMember::query()->active()
            ->where('user_id', $newbie->id)
            ->where('company_id', $company->id)
            ->exists());

        $users = collect($this->actingAs($admin)->getJson('/admin/users')->json('users'))->keyBy('id');
        $this->assertSame('Service Provider Contact', $users[$newbie->id]['accountTypeLabel']);
        $this->assertSame('Galaxy', $users[$newbie->id]['serviceProviders'][0]['name']);
    }

    public function test_a_pending_account_can_be_approved_as_a_service_provider_admin(): void
    {
        $admin = $this->admin();
        $company = $this->provider();
        $newbie = User::factory()->create([
            'status' => 'pending',
            'account_type' => Role::CLIENT,
            'name' => 'Gil Admin',
        ]);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$newbie->id}/assign-service-provider", [
                'company' => $company->uid,
                'admin' => true,
            ])
            ->assertOk();

        $newbie->refresh();
        $this->assertSame('approved', $newbie->status);
        $this->assertSame(Role::SERVICE_PROVIDER_ADMIN, $newbie->account_type);
        $this->assertTrue(CipAccess::isProviderContact($newbie));

        $users = collect($this->actingAs($admin)->getJson('/admin/users')->json('users'))->keyBy('id');
        $this->assertSame(Role::SERVICE_PROVIDER_ADMIN, $users[$newbie->id]['accountTypeLabel']);
    }

    public function test_an_approved_client_can_be_assigned_to_a_service_provider(): void
    {
        $admin = $this->admin();
        $company = $this->provider();
        $person = $this->user(Role::CLIENT);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$person->id}/assign-service-provider", ['company' => $company->uid])
            ->assertOk();

        $this->assertTrue(CipAccess::isProviderContact($person->fresh()));
    }

    public function test_changing_a_staff_account_to_a_service_provider_keeps_another_admin(): void
    {
        $admin = $this->admin();
        $this->admin(['email' => 'other-admin@example.test']);
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $company = $this->provider();

        $this->actingAs($admin)
            ->postJson("/admin/users/{$officer->id}/assign-service-provider", ['company' => $company->uid])
            ->assertOk();

        $officer->refresh();
        $this->assertSame(Role::CLIENT, $officer->account_type);
        $this->assertTrue(CipAccess::isProviderContact($officer));
    }

    public function test_you_cannot_assign_your_own_account_to_a_service_provider(): void
    {
        $admin = $this->admin();
        $this->admin(['email' => 'other-admin@example.test']);
        $company = $this->provider();

        $this->actingAs($admin)
            ->postJson("/admin/users/{$admin->id}/assign-service-provider", ['company' => $company->uid])
            ->assertStatus(422);
    }

    public function test_a_per_user_authenticator_requirement_hides_set_later(): void
    {
        $person = $this->user(Role::REVIEWING_OFFICER, [
            'onboarding_completed_at' => null,
            'require_two_factor' => true,
            'preferences' => [
                'accountsSetupComplete' => true,
                'accountSetupStep' => 'two-factor',
            ],
        ]);

        $this->assertFalse(SecurityPolicies::authenticatorRequired());
        $this->assertTrue($person->mustUseAuthenticator());

        $this->actingAs($person)
            ->get(route('account-setup.show', ['step' => 'two-factor']))
            ->assertOk()
            ->assertSee('Required')
            ->assertDontSee('Set later');

        $this->actingAs($person)
            ->post(route('account-setup.skip', ['step' => 'two-factor']))
            ->assertRedirect(route('account-setup.show', ['step' => 'two-factor']));
    }
}
