<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\AuthEvent;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Companies\CompanyMembers;
use App\Support\Companies\CompanyRoles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * An administrator can open the portal as a service provider, and come back.
 * That switch is not a sign-in: the provider is not told a new device used
 * their password, and the administrator is not walked through the provider's
 * own setup.
 */
class ImpersonationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config(['services.cip.enabled' => true]);
    }

    public function test_an_administrator_opens_the_portal_as_a_service_provider_admin(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada Admin');
        [$company] = $this->firm();
        $provider = $this->user(Role::SERVICE_PROVIDER_ADMIN, 'Gil Admin');
        $this->attach($company, $provider, $admin);

        $this->actingAs($admin)
            ->withHeader('Referer', 'http://localhost/users?tab=all')
            ->postJson("/admin/users/{$provider->id}/impersonate")
            ->assertOk()
            ->assertJsonPath('redirect', '/citizenship-applications/companies/'.$company->uid);

        $this->assertSame(0, AuthEvent::query()->where('event', 'login')->count());

        $log = ActivityLog::query()->where('activity_type', 'account.impersonated')->first();
        $this->assertNotNull($log);
        $this->assertSame($admin->id, $log->actor_id);
        $this->assertSame($provider->id, $log->subject_id);
        $this->assertSame($admin->id, $log->metadata['impersonator_id']);

        $this->carrySession();

        $this->getJson('/me')
            ->assertOk()
            ->assertJsonPath('id', $provider->id)
            ->assertJsonPath('isAdmin', false)
            ->assertJsonPath('isServiceProviderAdmin', true)
            ->assertJsonPath('impersonation.actorName', 'Ada Admin')
            ->assertJsonPath('impersonation.name', 'Gil Admin')
            ->assertJsonPath('impersonation.returnUrl', '/users?tab=all');

        $this->get('/')
            ->assertOk()
            ->assertSee('window.TMABootIsAdmin=false', false)
            ->assertSee('window.TMABootImpersonation={"actorName":"Ada Admin"', false);

        $this->postJson('/impersonation/leave')
            ->assertOk()
            ->assertJsonPath('redirect', '/users?tab=all');

        $this->carrySession();

        $this->getJson('/me')
            ->assertOk()
            ->assertJsonPath('id', $admin->id)
            ->assertJsonPath('isAdmin', true)
            ->assertJsonPath('impersonation', null);

        $this->assertNotNull(
            ActivityLog::query()->where('activity_type', 'account.impersonation_ended')->where('actor_id', $admin->id)->first()
        );
    }

    public function test_a_provider_contact_lands_on_the_applications_list(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada Admin');
        [$company] = $this->firm();
        $contact = $this->user(Role::CLIENT, 'Pat Reed');
        $this->attach($company, $contact, $admin);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$contact->id}/impersonate")
            ->assertOk()
            ->assertJsonPath('redirect', '/citizenship-applications');
    }

    public function test_opening_a_firm_uses_its_admin_ahead_of_a_contact(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada Admin');
        [$company] = $this->firm();
        $contact = $this->user(Role::CLIENT, 'Pat Reed');
        $provider = $this->user(Role::SERVICE_PROVIDER_ADMIN, 'Gil Admin');
        $this->attach($company, $contact, $admin);
        $this->attach($company, $provider, $admin);

        $this->actingAs($admin)
            ->postJson("/portal/companies/{$company->uid}/impersonate")
            ->assertOk()
            ->assertJsonPath('account.id', $provider->id)
            ->assertJsonPath('redirect', '/citizenship-applications/companies/'.$company->uid);
    }

    public function test_opening_a_firm_lands_on_that_firm_when_the_admin_has_another(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada Admin');
        [$alpha] = $this->firm('Alpha');
        [$zulu] = $this->firm('Zulu');
        $provider = $this->user(Role::SERVICE_PROVIDER_ADMIN, 'Gil Admin');
        $this->attach($alpha, $provider, $admin);
        $this->attach($zulu, $provider, $admin);

        $this->actingAs($admin)
            ->postJson("/portal/companies/{$zulu->uid}/impersonate")
            ->assertOk()
            ->assertJsonPath('redirect', '/citizenship-applications/companies/'.$zulu->uid);
    }

    public function test_a_firm_with_nobody_who_can_sign_in_is_refused(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada Admin');
        [$company] = $this->firm('Empty');

        $this->actingAs($admin)
            ->postJson("/portal/companies/{$company->uid}/impersonate")
            ->assertStatus(422)
            ->assertJsonPath('message', 'This service provider has no portal account to open.');
    }

    public function test_only_an_administrator_can_open_someone_elses_account(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'Officer');
        [$company] = $this->firm();
        $provider = $this->user(Role::SERVICE_PROVIDER_ADMIN, 'Gil Admin');
        $this->attach($company, $provider, $admin);

        $this->actingAs($officer)
            ->postJson("/admin/users/{$provider->id}/impersonate")
            ->assertForbidden();

        $this->actingAs($officer)
            ->postJson("/portal/companies/{$company->uid}/impersonate")
            ->assertForbidden();
    }

    public function test_staff_and_private_clients_cannot_be_opened(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'Officer');
        $private = $this->user(Role::CLIENT, 'Private Client');

        $this->actingAs($admin)
            ->postJson("/admin/users/{$admin->id}/impersonate")
            ->assertStatus(422)
            ->assertJsonPath('message', 'You cannot sign in as your own account.');

        $this->actingAs($admin)
            ->postJson("/admin/users/{$officer->id}/impersonate")
            ->assertStatus(422)
            ->assertJsonPath('message', 'This account is not a service provider.');

        $this->actingAs($admin)
            ->postJson("/admin/users/{$private->id}/impersonate")
            ->assertStatus(422)
            ->assertJsonPath('message', 'This account is not a service provider.');
    }

    public function test_an_account_that_cannot_sign_in_is_refused(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada Admin');
        [$company] = $this->firm();
        $pending = $this->user(Role::SERVICE_PROVIDER_ADMIN, 'Pending', ['status' => 'pending']);
        $this->attach($company, $pending, $admin);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$pending->id}/impersonate")
            ->assertStatus(422)
            ->assertJsonPath('message', 'This account cannot sign in yet.');
    }

    public function test_setup_and_an_old_sign_in_do_not_stop_the_view(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada Admin');
        [$company] = $this->firm();
        $provider = $this->user(Role::SERVICE_PROVIDER_ADMIN, 'Gil Admin', [
            'profile_completed_at' => null,
            'onboarding_completed_at' => null,
            'require_two_factor' => true,
            'last_authenticated_at' => now()->subDays(40),
        ]);
        $this->attach($company, $provider, $admin);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$provider->id}/impersonate")
            ->assertOk();

        $this->carrySession();

        $this->get('/')->assertOk();
    }

    public function test_a_suspended_account_sends_the_administrator_back(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada Admin');
        [$company] = $this->firm();
        $provider = $this->user(Role::SERVICE_PROVIDER_ADMIN, 'Gil Admin');
        $this->attach($company, $provider, $admin);

        $this->actingAs($admin)
            ->postJson("/admin/users/{$provider->id}/impersonate")
            ->assertOk();

        $provider->forceFill(['status' => 'suspended'])->save();
        $this->carrySession();

        $this->get('/')->assertRedirect('/users');

        $this->carrySession();

        $this->getJson('/me')
            ->assertOk()
            ->assertJsonPath('id', $admin->id)
            ->assertJsonPath('impersonation', null);
    }

    public function test_leaving_without_a_switched_session_is_refused(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada Admin');

        $this->actingAs($admin)
            ->postJson('/impersonation/leave')
            ->assertForbidden();
    }

    private function carrySession(): void
    {
        $data = session()->all();
        $this->app['auth']->forgetGuards();
        $this->withSession($data);
    }

    private function user(string $type, string $name, array $attrs = []): User
    {
        [$first, $last] = array_pad(explode(' ', $name, 2), 2, 'User');

        return User::factory()->create(array_merge([
            'name' => $name,
            'first_name' => $first,
            'last_name' => $last,
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $attrs));
    }

    /** @return array{0: Company, 1: CipProvider} */
    private function firm(string $name = 'Galaxy'): array
    {
        $company = Company::create([
            'uid' => strtolower($name).'-firm',
            'name' => $name,
            'status' => 'active',
        ]);
        $provider = CipProvider::create([
            'name' => $name,
            'code' => strtoupper(substr($name, 0, 3)),
            'company_id' => $company->id,
        ]);

        return [$company, $provider];
    }

    private function attach(Company $company, User $user, User $by): void
    {
        CompanyMembers::add($company, [
            'email' => $user->email,
            'name' => $user->name,
            'role' => CompanyRoles::MEMBER,
        ], $by);
    }
}
