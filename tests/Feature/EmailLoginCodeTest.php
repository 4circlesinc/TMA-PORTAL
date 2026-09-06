<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\AuthEvent;
use App\Models\User;
use App\Support\StaySignedIn;
use App\Support\TrustedDevices;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class EmailLoginCodeTest extends TestCase
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

    private function priorLogin(User $user, string $ip = '10.0.0.9'): void
    {
        AuthEvent::create([
            'user_id' => $user->id,
            'event' => 'login',
            'ip' => $ip,
            'user_agent' => 'OldBrowser',
            'created_at' => now()->subDay(),
        ]);
    }

    public function test_the_first_sign_in_does_not_ask_for_an_email_code(): void
    {
        $user = $this->user();

        $this->withCookie(StaySignedIn::COOKIE, 'yes')
            ->post('/auth/login', [
                'email' => $user->email,
                'password' => 'password',
            ])
            ->assertRedirect('/');
    }

    public function test_a_returning_sign_in_from_an_untrusted_device_sends_an_email_code(): void
    {
        $user = $this->user();
        $this->priorLogin($user);

        Mail::fake();

        $this->withCookie(StaySignedIn::COOKIE, 'yes')
            ->post('/auth/login', [
                'email' => $user->email,
                'password' => 'password',
            ])
            ->assertRedirect(route('login-code.show'));

        Mail::assertSent(Postcard::class, function (Postcard $mail) {
            return ($mail->payload['code'] ?? null) !== null
                && strlen((string) $mail->payload['code']) === 6;
        });
    }

    public function test_the_emailed_code_completes_sign_in(): void
    {
        $user = $this->user();
        $this->priorLogin($user);

        Mail::fake();

        $this->withCookie(StaySignedIn::COOKIE, 'yes')
            ->post('/auth/login', [
                'email' => $user->email,
                'password' => 'password',
            ])
            ->assertRedirect(route('login-code.show'));

        $code = null;
        Mail::assertSent(Postcard::class, function (Postcard $mail) use (&$code) {
            $code = $mail->payload['code'] ?? null;

            return is_string($code);
        });

        $this->withCookie(StaySignedIn::COOKIE, 'yes')
            ->post(route('login-code.store'), ['code' => $code])
            ->assertRedirect('/');

        $this->assertAuthenticatedAs($user->fresh());
        $this->assertNotNull($user->fresh()->last_authenticated_at);
    }

    public function test_a_wrong_code_is_rejected(): void
    {
        $user = $this->user();
        $this->priorLogin($user);

        Mail::fake();

        $this->withCookie(StaySignedIn::COOKIE, 'yes')
            ->post('/auth/login', [
                'email' => $user->email,
                'password' => 'password',
            ]);

        $this->post(route('login-code.store'), ['code' => '000000'])
            ->assertSessionHasErrors('code');

        $this->assertGuest();
    }

    public function test_a_trusted_device_skips_the_email_code(): void
    {
        $user = $this->user();
        $this->priorLogin($user);

        $token = str_repeat('a', 64);
        $user->trustedDevices()->create([
            'token_hash' => hash('sha256', $token),
            'device' => 'PHPUnit',
            'ip' => '127.0.0.1',
            'last_used_at' => now(),
            'expires_at' => now()->addDays(7),
        ]);

        Mail::fake();

        $this->withCookie(StaySignedIn::COOKIE, 'yes')
            ->withCookie(TrustedDevices::COOKIE, $token)
            ->post('/auth/login', [
                'email' => $user->email,
                'password' => 'password',
            ])
            ->assertRedirect('/');

        Mail::assertNothingSent();
    }

    public function test_an_authenticator_account_is_sent_to_the_app_challenge(): void
    {
        $user = $this->user();
        $this->priorLogin($user);
        $user->forceFill([
            'two_factor_secret' => encrypt('testsecret'),
            'two_factor_confirmed_at' => now(),
        ])->save();

        Mail::fake();

        $this->withCookie(StaySignedIn::COOKIE, 'yes')
            ->post('/auth/login', [
                'email' => $user->email,
                'password' => 'password',
            ])
            ->assertRedirect(route('two-factor.login'));

        Mail::assertNothingSent();
    }
}
