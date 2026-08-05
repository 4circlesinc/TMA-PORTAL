<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Connecting a provider has to come back to the screen it was started from —
 * including when it fails.
 *
 * "Connect Google" on the onboarding screen used to land the user in Account
 * settings whenever Google had no client id in that environment, because the
 * return target was only recorded after the configuration check.
 */
class SocialConnectReturnTest extends TestCase
{
    use RefreshDatabase;

    private function onboardingUser(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            // Mid-onboarding: this is the screen with the Connect buttons.
            'onboarding_completed_at' => null,
        ]);
    }

    public function test_an_unconfigured_provider_returns_to_onboarding_with_the_reason(): void
    {
        config(['services.google.client_id' => null, 'services.google.client_secret' => null]);

        $this->actingAs($this->onboardingUser())
            ->get('/auth/social/google/redirect?return=getting-started')
            ->assertRedirect(route('getting-started'))
            ->assertSessionHas('social_error', 'Google sign-in is not configured yet.');
    }

    public function test_the_onboarding_screen_renders_that_reason(): void
    {
        config(['services.google.client_id' => null]);

        // Following the redirect proves the user ends up looking at the
        // onboarding screen with the explanation on it — not at settings.
        $this->actingAs($this->onboardingUser())
            ->followingRedirects()
            ->get('/auth/social/google/redirect?return=getting-started')
            ->assertOk()
            ->assertSee('Google sign-in is not configured yet.')
            // The connect step is on screen — either the one-consent Microsoft
            // rows (Microsoft sync configured) or the legacy provider buttons.
            ->assertSee('Connect');
    }

    public function test_a_configured_provider_goes_to_the_account_picker_not_the_portal(): void
    {
        config([
            'services.google.client_id' => 'test-client-id.apps.googleusercontent.com',
            'services.google.client_secret' => 'test-secret',
            'services.google.redirect' => 'http://localhost/auth/social/google/callback',
        ]);

        $response = $this->actingAs($this->onboardingUser())
            ->get('/auth/social/google/redirect?return=getting-started');

        $response->assertRedirect();
        $target = $response->headers->get('Location');

        $this->assertStringContainsString('accounts.google.com', $target);
        // The whole point: the user gets to choose which Google account.
        $this->assertStringContainsString('prompt=', $target);
        $this->assertStringNotContainsString('/account-settings', $target);
    }

    public function test_an_unconfigured_provider_still_returns_to_onboarding_for_microsoft(): void
    {
        config(['services.microsoft.client_id' => null]);

        $this->actingAs($this->onboardingUser())
            ->get('/auth/social/microsoft/redirect?return=getting-started')
            ->assertRedirect(route('getting-started'))
            ->assertSessionHas('social_error', 'Microsoft sign-in is not configured yet.');
    }

    public function test_a_failure_with_no_return_target_still_falls_back_to_security_settings(): void
    {
        config(['services.google.client_id' => null]);

        $this->actingAs($this->onboardingUser())
            ->get('/auth/social/google/redirect')
            ->assertRedirect(route('security-settings'));
    }
}
