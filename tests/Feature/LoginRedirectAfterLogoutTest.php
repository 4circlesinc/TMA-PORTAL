<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\StaySignedIn;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Signing out from Settings used to park that page as url.intended, so the
 * next sign-in opened Account settings instead of the dashboard.
 */
class LoginRedirectAfterLogoutTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_the_logout_login_screen_drops_a_settings_return_url(): void
    {
        $this->withSession(['url.intended' => url('/account-settings')])
            ->get('/auth/login?from=logout&return=/account-settings')
            ->assertOk()
            ->assertSessionMissing('url.intended');
    }

    public function test_signing_in_after_logout_opens_the_dashboard(): void
    {
        $user = $this->user();

        $this->withCookie(StaySignedIn::COOKIE, 'yes')
            ->withSession(['url.intended' => url('/account-settings')])
            ->get('/auth/login?from=logout');

        $this->withCookie(StaySignedIn::COOKIE, 'yes')
            ->post('/auth/login', [
                'email' => $user->email,
                'password' => 'password',
            ])
            ->assertRedirect('/');
    }

    public function test_a_deep_link_return_still_opens_that_page(): void
    {
        $user = $this->user();

        $this->withCookie(StaySignedIn::COOKIE, 'yes')
            ->get('/auth/login?return=/email')
            ->assertOk()
            ->assertSessionHas('url.intended', '/email');

        $this->withCookie(StaySignedIn::COOKIE, 'yes')
            ->post('/auth/login', [
                'email' => $user->email,
                'password' => 'password',
            ])
            ->assertRedirect('/email');
    }
}
