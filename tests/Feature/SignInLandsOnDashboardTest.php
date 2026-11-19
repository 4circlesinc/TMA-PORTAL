<?php

namespace Tests\Feature;

use App\Models\AuthEvent;
use App\Models\User;
use App\Support\EmailLoginCode;
use App\Support\StaySignedIn;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as OAuthUser;
use Mockery;
use Tests\TestCase;

/**
 * Signing in always opens the dashboard, never the page the person was on.
 *
 * A session that ends while a page is open sends the browser to the sign-in
 * screen with ?return=<that page>, and a signed-out visit to a portal page
 * parks it as url.intended. Both used to be honoured, so signing back in
 * reopened Account settings (or wherever) instead of the dashboard.
 *
 * Two parked destinations are steps of a flow, not "the page you were on",
 * and still continue: the app sign-in hand-off, and an invitation the person
 * signed in to accept.
 */
class SignInLandsOnDashboardTest extends TestCase
{
    use RefreshDatabase;

    private const PAGE = '/account-settings';

    private function person(array $attributes = []): User
    {
        return User::factory()->create(array_merge([
            'email' => 'person@example.test',
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $attributes));
    }

    /** This browser already answered "Stay signed in?", so no prompt in between. */
    private function answeredBrowser(): static
    {
        return $this->withCookie(StaySignedIn::COOKIE, 'yes');
    }

    private function submitPassword(User $user)
    {
        return $this->post('/auth/login', ['email' => $user->email, 'password' => 'password']);
    }

    public function test_a_password_sign_in_opens_the_dashboard_not_the_parked_page(): void
    {
        $user = $this->person();

        $this->answeredBrowser()->withSession(['url.intended' => url(self::PAGE)]);

        $this->submitPassword($user)->assertRedirect('/');
    }

    public function test_a_page_opened_while_signed_out_is_not_reopened_after_sign_in(): void
    {
        $user = $this->person();

        $this->get(self::PAGE)->assertRedirect(route('login'));

        $this->answeredBrowser();
        $this->submitPassword($user)->assertRedirect('/');
    }

    public function test_a_return_address_on_the_sign_in_page_is_ignored(): void
    {
        $user = $this->person();

        $this->answeredBrowser()->get('/auth/login?return=/email')
            ->assertOk()
            ->assertSessionMissing('url.intended');

        $this->submitPassword($user)->assertRedirect('/');
    }

    public function test_answering_stay_signed_in_opens_the_dashboard(): void
    {
        $user = $this->person();

        $this->withSession(['url.intended' => url(self::PAGE)]);
        $this->submitPassword($user)->assertRedirect(route('stay-signed-in.show'));

        $this->post('/auth/stay-signed-in', ['stay' => 'yes'])->assertRedirect('/');
    }

    public function test_finishing_an_email_code_opens_the_dashboard(): void
    {
        Mail::fake();
        $user = $this->person();
        AuthEvent::query()->forceCreate([
            'user_id' => $user->id,
            'event' => 'login',
            'ip' => '203.0.113.9',
            'created_at' => now()->subDays(3),
        ]);

        $this->answeredBrowser()->withSession(['url.intended' => url(self::PAGE)]);
        $this->submitPassword($user)->assertRedirect(route('login-code.show'));

        // Park a code we know in place of the emailed one.
        $this->withSession([
            EmailLoginCode::HASH_KEY => Hash::make('123456'),
            EmailLoginCode::EXPIRES_KEY => now()->addMinutes(5)->getTimestamp(),
        ]);

        $this->post('/auth/login-code', ['code' => '123456'])->assertRedirect('/');
    }

    public function test_finishing_an_authenticator_challenge_opens_the_dashboard(): void
    {
        $user = $this->person([
            'two_factor_secret' => encrypt('JBSWY3DPEHPK3PXP'),
            'two_factor_recovery_codes' => encrypt(json_encode(['recovery-code-one'])),
            'two_factor_confirmed_at' => now(),
        ]);

        $this->answeredBrowser()->withSession(['url.intended' => url(self::PAGE)]);
        $this->submitPassword($user)->assertRedirect(route('two-factor.login'));

        $this->post('/auth/two-factor-challenge', ['recovery_code' => 'recovery-code-one'])
            ->assertRedirect('/');
    }

    public function test_a_google_or_microsoft_sign_in_opens_the_dashboard(): void
    {
        $user = $this->person();
        $oauth = (new OAuthUser)->setRaw(['email_verified' => true])->map([
            'id' => 'ms-person-1',
            'name' => 'Person',
            'email' => $user->email,
            'avatar' => null,
        ]);
        $oauth->token = null;
        $oauth->refreshToken = null;
        $oauth->accessTokenResponseBody = ['scope' => ''];
        $driver = Mockery::mock();
        $driver->shouldReceive('user')->andReturn($oauth);
        Socialite::shouldReceive('driver')->with('microsoft')->andReturn($driver);

        $this->answeredBrowser()->withSession(['url.intended' => url(self::PAGE)])
            ->get('/auth/social/microsoft/callback?code=c&state=s')
            ->assertRedirect('/');

        $this->assertAuthenticatedAs($user);
    }

    public function test_signing_in_to_accept_an_invitation_returns_to_it(): void
    {
        $user = $this->person();

        $this->post('/invite/abc123/signin')->assertRedirect(route('login'));

        $this->answeredBrowser();
        $this->submitPassword($user)->assertRedirect('/invite/abc123');
    }

    public function test_an_app_sign_in_still_reaches_the_hand_off(): void
    {
        $user = $this->person();

        $this->get('/auth/desktop/start?challenge='.str_repeat('a', 43))->assertRedirect(route('login'));

        $this->answeredBrowser();
        $this->submitPassword($user)->assertRedirect(route('desktop.finish'));
    }

    public function test_a_parked_address_on_another_site_is_never_followed(): void
    {
        $user = $this->person();

        $this->answeredBrowser()->withSession(['url.intended' => 'https://elsewhere.example/invite/abc123']);

        $this->submitPassword($user)->assertRedirect('/');
    }
}
