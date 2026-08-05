<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\ActivityLog;
use App\Models\AuthEvent;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as OAuthUser;
use Mockery;
use Tests\TestCase;

/**
 * Signing up with Google or Microsoft is still signing up.
 *
 * It used to write a bare `auth_events` row and stop there, never dispatching
 * Registered — so a social signup produced no administrator alert, no audit
 * entry and no email to the person, while the identical password signup did all
 * three. It sat in the pending list with nobody told it was there.
 */
class SocialSignUpApprovalTest extends TestCase
{
    use RefreshDatabase;

    private function fakeProviderUser(string $email): void
    {
        // The controller type-hints Socialite's concrete Two\User, so build a
        // real one rather than a mock of the contract.
        $oauth = (new OAuthUser)->setRaw(['email_verified' => true])->map([
            'id' => 'ms-new-1',
            'name' => 'Selina Kyle',
            'email' => $email,
            'avatar' => null,
        ]);
        $oauth->token = null;
        $oauth->refreshToken = null;
        $oauth->accessTokenResponseBody = ['scope' => ''];

        $driver = Mockery::mock();
        $driver->shouldReceive('user')->andReturn($oauth);
        Socialite::shouldReceive('driver')->with('microsoft')->andReturn($driver);
    }

    private function admin(): User
    {
        return User::factory()->create([
            'status' => 'approved', 'account_type' => 'Administrator',
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_a_social_sign_up_alerts_admins_audits_and_emails_the_person(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $this->fakeProviderUser('selina@firm.test');

        $this->get('/auth/social/microsoft/callback');

        $newbie = User::where('email', 'selina@firm.test')->firstOrFail();
        $this->assertSame(User::STATUS_PENDING, $newbie->status);

        $this->assertSame(1, Notification::where('user_id', $admin->id)
            ->where('type', 'account.pending')->count());
        $this->assertSame(1, ActivityLog::where('activity_type', 'account.registered')->count());

        Mail::assertSent(Postcard::class, fn (Postcard $m) => $m->hasTo($newbie->email)
            && $m->subjectLine === 'We\'ve received your request for access');
    }

    /** The auth_events row is written once, by the listener — not twice. */
    public function test_the_registration_is_recorded_exactly_once(): void
    {
        Mail::fake();
        $this->admin();
        $this->fakeProviderUser('selina@firm.test');

        $this->get('/auth/social/microsoft/callback');

        $newbie = User::where('email', 'selina@firm.test')->firstOrFail();
        $this->assertSame(1, AuthEvent::where('user_id', $newbie->id)
            ->where('event', 'registered')->count());
    }

    /**
     * A provider account whose email is already verified must not also be sent
     * the "confirm your email address" mail — only the pending-approval notice.
     */
    public function test_it_does_not_ask_a_verified_provider_account_to_confirm_its_email(): void
    {
        Mail::fake();
        $this->admin();
        $this->fakeProviderUser('selina@firm.test');

        $this->get('/auth/social/microsoft/callback');

        Mail::assertNotSent(Postcard::class, fn (Postcard $m) => $m->subjectLine === 'Confirm your email address');
    }
}
