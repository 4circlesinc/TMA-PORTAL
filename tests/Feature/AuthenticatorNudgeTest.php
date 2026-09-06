<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\AuthenticatorNudge;
use App\Support\SecurityPolicies;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class AuthenticatorNudgeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
    }

    private function user(array $attrs = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => Role::REVIEWING_OFFICER,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $attrs));
    }

    public function test_me_asks_to_show_the_nudge_when_the_app_is_off(): void
    {
        $this->actingAs($this->user())
            ->getJson('/me')
            ->assertOk()
            ->assertJsonPath('authenticatorNudge.show', true)
            ->assertJsonPath('authenticatorNudge.remaining', AuthenticatorNudge::MAX_SHOWS);
    }

    public function test_recording_a_show_hides_it_until_next_week(): void
    {
        $user = $this->user();

        $this->actingAs($user)->postJson('/me/authenticator-nudge')->assertOk();

        $this->actingAs($user->fresh())
            ->getJson('/me')
            ->assertOk()
            ->assertJsonPath('authenticatorNudge.show', false)
            ->assertJsonPath('authenticatorNudge.remaining', AuthenticatorNudge::MAX_SHOWS - 1);
    }

    public function test_the_nudge_returns_after_a_week_until_the_cap(): void
    {
        $user = $this->user();

        for ($i = 0; $i < AuthenticatorNudge::MAX_SHOWS; $i++) {
            $this->assertTrue(AuthenticatorNudge::shouldShow($user->fresh()));
            AuthenticatorNudge::markShown($user->fresh());
            $this->travel(AuthenticatorNudge::INTERVAL_DAYS)->days();
        }

        $this->assertFalse(AuthenticatorNudge::shouldShow($user->fresh()));
        $this->assertSame(AuthenticatorNudge::MAX_SHOWS, AuthenticatorNudge::count($user->fresh()));
    }

    public function test_an_enrolled_authenticator_never_sees_the_nudge(): void
    {
        $user = $this->user(['two_factor_confirmed_at' => now()]);

        $this->actingAs($user)
            ->getJson('/me')
            ->assertOk()
            ->assertJsonPath('authenticatorNudge.show', false);
    }

    public function test_a_required_authenticator_does_not_nudge(): void
    {
        SecurityPolicies::put('sign-in', array_merge(
            SecurityPolicies::get('sign-in'),
            ['requireAuthenticatorApp' => true, 'requireMfa' => true],
        ));

        $this->actingAs($this->user())
            ->getJson('/me')
            ->assertOk()
            ->assertJsonPath('authenticatorNudge.show', false);
    }

    public function test_skipping_the_app_during_setup_does_not_popup_the_same_day(): void
    {
        $user = $this->user([
            'onboarding_completed_at' => null,
            'preferences' => [
                'accountsSetupComplete' => true,
                'accountSetupStep' => 'two-factor',
            ],
        ]);

        $this->actingAs($user)
            ->post(route('account-setup.store', ['step' => 'two-factor']))
            ->assertRedirect(route('account-setup.show', ['step' => 'notifications']));

        $this->assertFalse(AuthenticatorNudge::shouldShow($user->fresh()));
        $this->assertSame(1, AuthenticatorNudge::count($user->fresh()));
    }
}
