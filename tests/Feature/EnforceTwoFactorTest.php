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
        $this->assertFalse(SecurityPolicies::authenticatorRequired());
        $this->assertSame(7, SecurityPolicies::DEFAULTS['sign-in']['sessionDays']);
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

    public function test_a_page_request_still_redirects_to_set_up_two_factor(): void
    {
        $this->requireMfa(true);

        $this->actingAs($this->user())
            ->get('/clients')
            ->assertRedirect(route('security-settings'));
    }

    public function test_the_shell_can_still_hydrate_itself(): void
    {
        $this->requireMfa(true);

        // /me paints the reader's name, avatar and capabilities on the very
        // page they are being sent to. Blocking it strands them on a
        // half-drawn screen with no way to finish setting 2FA up.
        $this->actingAs($this->user())->getJson('/me')->assertOk();
    }

    public function test_the_settings_home_stays_reachable(): void
    {
        $this->requireMfa(true);

        $this->actingAs($this->user())->get('/account-settings')->assertOk();
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
        $this->assertSame(7, SecurityPolicies::sessionDays());
    }
}
