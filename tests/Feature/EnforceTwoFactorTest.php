<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\SecurityPolicies;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * The "require multi-factor authentication" sign-in policy.
 *
 * The gate guards the whole portal group, so it sees every XHR as well as
 * every page load — and it originally answered both with a redirect. `fetch()`
 * follows a 302 silently and hands the caller a 200 carrying an HTML page, so
 * turning the policy on broke every JSON endpoint in the portal at once, each
 * one surfacing as "SyntaxError: The string did not match the expected
 * pattern" from `res.json()`. Nothing covered it. These do.
 */
class EnforceTwoFactorTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
    }

    private function user(bool $withTwoFactor = false): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'two_factor_confirmed_at' => $withTwoFactor ? now() : null,
        ]);
    }

    private function requireMfa(bool $on): void
    {
        SecurityPolicies::put('sign-in', array_merge(
            SecurityPolicies::get('sign-in'),
            ['requireMfa' => $on, 'requireAuthenticatorApp' => $on],
        ));

        Cache::forget('portal-settings.sign-in');
    }

    public function test_the_policy_is_off_by_default(): void
    {
        // It gates the entire portal, so it must never arrive switched on.
        $this->assertFalse(SecurityPolicies::authenticatorRequired());
        $this->assertFalse(SecurityPolicies::DEFAULTS['sign-in']['requireAuthenticatorApp']);
        $this->assertFalse(SecurityPolicies::DEFAULTS['sign-in']['requireMfa']);
        $this->assertSame([], SecurityPolicies::DEFAULTS['sign-in']['requireAuthenticatorForAccountTypes']);
        $this->assertSame([], SecurityPolicies::authenticatorRequiredAccountTypes());
        $this->assertSame(7, SecurityPolicies::DEFAULTS['sign-in']['sessionDays']);
    }

    public function test_an_env_flag_does_not_turn_the_authenticator_gate_on(): void
    {
        putenv('PORTAL_REQUIRE_MFA=true');

        $this->assertFalse(SecurityPolicies::authenticatorRequired());

        putenv('PORTAL_REQUIRE_MFA');
    }

    public function test_stored_authenticator_requirement_can_be_turned_off(): void
    {
        $this->requireMfa(true);
        $this->assertTrue(SecurityPolicies::authenticatorRequired());

        SecurityPolicies::disableRequiredAuthenticator();
        Cache::forget('portal-settings.sign-in');

        $this->assertFalse(SecurityPolicies::authenticatorRequired());
        $this->actingAs($this->user())->getJson('/admin/users')->assertOk();
    }

    public function test_a_json_request_gets_json_not_an_html_redirect(): void
    {
        $this->requireMfa(true);

        $response = $this->actingAs($this->user())->getJson('/admin/users');

        // The whole bug in one assertion: a 302 here means fetch() follows it,
        // gets HTML, and res.json() throws a SyntaxError far from the cause.
        $response->assertForbidden()
            ->assertJsonPath('code', 'mfa-required');

        $this->assertJson($response->getContent());
    }

    public function test_a_page_request_is_sent_to_the_set_up_screen(): void
    {
        $this->requireMfa(true);

        $this->actingAs($this->user())
            ->get('/clients')
            ->assertRedirect(route('required-authenticator.show'));
    }

    /**
     * Account settings used to be exempt so it could render itself. It is a
     * portal page like any other, and leaving it open meant everything its
     * shell offers stayed reachable while the gate was up.
     */
    public function test_the_settings_home_is_gated_too(): void
    {
        $this->requireMfa(true);

        $this->actingAs($this->user())
            ->get('/account-settings')
            ->assertRedirect(route('required-authenticator.show'));
    }

    /**
     * These three sit outside the portal route group, so the gate never saw
     * them: typing the URL walked straight past a requirement the rest of the
     * portal enforced.
     */
    public function test_the_pages_outside_the_portal_group_are_gated(): void
    {
        $this->requireMfa(true);
        $user = $this->user();

        foreach (['/design/mail', '/dev/cbi', '/onboarding'] as $url) {
            $this->actingAs($user)
                ->get($url)
                ->assertRedirect(route('required-authenticator.show'));
        }
    }

    public function test_the_set_up_screen_renders_for_someone_who_needs_it(): void
    {
        $this->requireMfa(true);

        $this->actingAs($this->user())
            ->get(route('required-authenticator.show'))
            ->assertOk()
            ->assertSee('Set up two-factor authentication');
    }

    /**
     * The screen must not trap anyone who has no business on it, or an account
     * that has just finished setting up would be stuck looking at it.
     */
    public function test_the_set_up_screen_turns_away_anyone_who_does_not_need_it(): void
    {
        $this->requireMfa(false);

        $this->actingAs($this->user())
            ->get(route('required-authenticator.show'))
            ->assertRedirect('/');

        $this->requireMfa(true);

        $this->actingAs($this->user(withTwoFactor: true))
            ->get(route('required-authenticator.show'))
            ->assertRedirect('/');
    }

    public function test_the_json_answer_points_at_the_set_up_screen(): void
    {
        $this->requireMfa(true);

        $this->actingAs($this->user())
            ->getJson('/admin/users')
            ->assertForbidden()
            ->assertJsonPath('redirect', route('required-authenticator.show'));
    }

    /**
     * The administrator's per-person switch (the Users drawer) must gate the
     * portal exactly as the firm-wide policy does, with the policy off.
     */
    public function test_a_person_marked_required_by_an_admin_is_gated(): void
    {
        $this->requireMfa(false);

        $person = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::REVIEWING_OFFICER,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'require_two_factor' => true,
        ]);

        $this->actingAs($person)
            ->get('/clients')
            ->assertRedirect(route('required-authenticator.show'));

        $this->actingAs($person)
            ->get(route('required-authenticator.show'))
            ->assertOk();
    }

    /**
     * Finishing on this screen has to actually let them in, or the gate is a
     * dead end. Confirming the code is Fortify's; what matters here is that
     * the screen wires it up and stops gating afterwards.
     */
    public function test_setting_the_authenticator_up_opens_the_portal(): void
    {
        $this->requireMfa(true);
        $user = $this->user();

        $secret = app(\Laravel\Fortify\Actions\EnableTwoFactorAuthentication::class);
        $secret($user);
        $user->refresh();

        $code = (new \PragmaRX\Google2FA\Google2FA)->getCurrentOtp(decrypt($user->two_factor_secret));

        $this->actingAs($user)
            ->withSession(['auth.password_confirmed_at' => time()])
            ->post(route('required-authenticator.store'), [
                'app' => 'microsoft',
                'code' => $code,
            ])
            ->assertRedirect('/');

        $this->assertNotNull($user->fresh()->two_factor_confirmed_at);
        $this->actingAs($user->fresh())->getJson('/admin/users')->assertOk();
    }

    public function test_the_shell_can_still_hydrate_itself(): void
    {
        $this->requireMfa(true);

        // /me paints the reader's name, avatar and capabilities on the very
        // page they are being sent to. Blocking it strands them on a
        // half-drawn screen with no way to finish setting 2FA up.
        $this->actingAs($this->user())->getJson('/me')->assertOk();
    }

    public function test_a_user_with_two_factor_confirmed_is_unaffected(): void
    {
        $this->requireMfa(true);

        $this->actingAs($this->user(withTwoFactor: true))
            ->getJson('/admin/users')
            ->assertOk();
    }

    public function test_nothing_is_gated_while_the_policy_is_off(): void
    {
        $this->requireMfa(false);

        $this->actingAs($this->user())->getJson('/admin/users')->assertOk();
    }

    public function test_require_authenticator_app_gates_the_portal_the_same_way(): void
    {
        SecurityPolicies::put('sign-in', array_merge(
            SecurityPolicies::get('sign-in'),
            ['requireAuthenticatorApp' => true, 'requireMfa' => false],
        ));
        Cache::forget('portal-settings.sign-in');

        $this->actingAs($this->user())
            ->getJson('/admin/users')
            ->assertForbidden()
            ->assertJsonPath('code', 'mfa-required');
    }

    public function test_an_administrator_can_require_the_authenticator_from_sign_in_policy(): void
    {
        $this->actingAs($this->user())
            ->putJson('/admin/security-policies/sign-in', [
                'minLength' => 10,
                'numbersRequired' => 0,
                'specialRequired' => 0,
                'requireMfa' => false,
                'requireMicrosoftConnect' => false,
                'requireGoogleConnect' => false,
                'requireAuthenticatorApp' => true,
                'sessionDays' => 7,
            ])
            ->assertOk();

        Cache::forget('portal-settings.sign-in');

        $this->assertTrue(SecurityPolicies::authenticatorRequired());
        $this->assertTrue(SecurityPolicies::get('sign-in')['requireMfa']);
        $this->assertTrue(SecurityPolicies::get('sign-in')['requireAuthenticatorApp']);
        $this->assertSame(
            SecurityPolicies::AUTHENTICATOR_ACCOUNT_TYPES,
            SecurityPolicies::authenticatorRequiredAccountTypes()
        );
        $this->assertSame(7, SecurityPolicies::sessionDays());
    }

    public function test_sign_in_policy_can_require_the_authenticator_for_one_account_type(): void
    {
        $admin = $this->user();
        $officer = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::REVIEWING_OFFICER,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
        $providerAdmin = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::SERVICE_PROVIDER_ADMIN,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $this->actingAs($admin)
            ->putJson('/admin/security-policies/sign-in', [
                'minLength' => 10,
                'numbersRequired' => 0,
                'specialRequired' => 0,
                'requireMfa' => false,
                'requireMicrosoftConnect' => false,
                'requireGoogleConnect' => false,
                'requireAuthenticatorApp' => false,
                'requireAuthenticatorForAccountTypes' => [Role::SERVICE_PROVIDER_ADMIN],
                'sessionDays' => 7,
            ])
            ->assertOk();

        Cache::forget('portal-settings.sign-in');

        $this->assertFalse(SecurityPolicies::get('sign-in')['requireAuthenticatorApp']);
        $this->assertSame(
            [Role::SERVICE_PROVIDER_ADMIN],
            SecurityPolicies::authenticatorRequiredAccountTypes()
        );
        $this->assertFalse(SecurityPolicies::authenticatorRequired($officer));
        $this->assertTrue(SecurityPolicies::authenticatorRequired($providerAdmin));
        $this->assertTrue($providerAdmin->mustUseAuthenticator());
        $this->assertFalse($officer->mustUseAuthenticator());

        $this->actingAs($providerAdmin)
            ->getJson('/portal/companies')
            ->assertForbidden()
            ->assertJsonPath('code', 'mfa-required');

        $this->actingAs($officer)->getJson('/portal/companies')->assertOk();
    }

    public function test_account_type_policy_and_per_person_requirement_both_enforce(): void
    {
        $spWithoutPersonFlag = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::SERVICE_PROVIDER_ADMIN,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'require_two_factor' => false,
        ]);
        $spWithPersonFlag = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::SERVICE_PROVIDER_ADMIN,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'require_two_factor' => true,
        ]);

        // Only the person flag so far.
        $this->assertTrue($spWithPersonFlag->mustUseAuthenticator());
        $this->assertFalse($spWithoutPersonFlag->mustUseAuthenticator());

        SecurityPolicies::put('sign-in', SecurityPolicies::syncAuthenticatorRequirement([
            'minLength' => 10,
            'numbersRequired' => 0,
            'specialRequired' => 0,
            'requireMfa' => false,
            'requireMicrosoftConnect' => false,
            'requireGoogleConnect' => false,
            'requireAuthenticatorApp' => false,
            'requireAuthenticatorForAccountTypes' => [Role::SERVICE_PROVIDER_ADMIN],
            'sessionDays' => 7,
        ]));
        Cache::forget('portal-settings.sign-in');

        // Both Service Provider admins are required once the account type is on.
        $this->assertTrue($spWithPersonFlag->fresh()->mustUseAuthenticator());
        $this->assertTrue($spWithoutPersonFlag->fresh()->mustUseAuthenticator());
    }
}
