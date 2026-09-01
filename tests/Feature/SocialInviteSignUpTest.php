<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Invitation;
use App\Models\User;
use App\Mail\Postcard;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as OAuthUser;
use Mockery;
use Tests\TestCase;

/**
 * An invited person may sign up with Google or Microsoft — any account
 * wearing the invited address — and the invitation is fulfilled exactly as
 * the password form fulfils it: account created, link consumed, signed in.
 */
class SocialInviteSignUpTest extends TestCase
{
    use RefreshDatabase;

    private function staff(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function inviteToken(string $email): string
    {
        Mail::fake();
        $staff = $this->staff();
        $client = Client::create([
            'uid' => 'acme-co', 'name' => 'Acme Co', 'email' => $email,
            'initial' => 'A', 'initial_color' => 'blue', 'data' => [],
        ]);

        $this->actingAs($staff)->postJson("/portal/clients/{$client->uid}/invite")->assertOk();

        $token = null;
        Mail::assertSent(Postcard::class, function (Postcard $mail) use (&$token) {
            if (preg_match('#/invite/([A-Za-z0-9]+)#', $mail->payload['button']['url'] ?? '', $m)) {
                $token = $m[1];
            }

            return true;
        });

        auth()->logout();

        return $token;
    }

    private function fakeGoogleUser(string $email, string $name = 'Travis Thomas'): void
    {
        $oauth = (new OAuthUser)->setRaw(['email_verified' => true])->map([
            'id' => 'g-1', 'name' => $name, 'email' => $email, 'avatar' => null,
        ]);
        $oauth->token = null;
        $oauth->refreshToken = null;
        $oauth->accessTokenResponseBody = ['scope' => ''];

        $driver = Mockery::mock();
        $driver->shouldReceive('user')->andReturn($oauth);
        Socialite::shouldReceive('driver')->with('google')->andReturn($driver);
    }

    public function test_a_google_sign_up_through_an_invite_fulfils_the_invitation(): void
    {
        config(['services.google.client_id' => 'client-id']);
        $token = $this->inviteToken('owner@acme.test');
        $this->fakeGoogleUser('owner@acme.test');

        // The invite page offers the provider buttons.
        $this->get("/invite/{$token}")->assertOk()->assertSee('Sign up with Google');

        // The button's round trip: redirect stashes the token…
        $this->get("/auth/social/google/redirect?invite={$token}");
        // …and the callback fulfils the invitation.
        $this->get('/auth/social/google/callback');

        $user = User::where('email', 'owner@acme.test')->firstOrFail();
        $this->assertSame('Travis', $user->first_name);
        $this->assertNotNull($user->email_verified_at);
        $this->assertAuthenticatedAs($user);
        $this->assertSame(Invitation::STATUS_ACCEPTED, Invitation::first()->fresh()->status);
    }

    public function test_a_wrong_google_session_cannot_hijack_the_invite_into_another_account(): void
    {
        config(['services.google.client_id' => 'client-id']);
        $token = $this->inviteToken('owner@acme.test');

        // Somebody else's account, already linked to this Google identity —
        // the provider's chooser handing it back must not sign them in.
        $other = User::factory()->create([
            'status' => 'approved', 'account_type' => 'Client', 'email' => 'vtfslu@gmail.com',
            'email_verified_at' => now(), 'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
        ]);
        $other->connectedAccounts()->create([
            'provider' => 'google', 'provider_id' => 'g-1', 'email' => $other->email, 'name' => $other->name,
        ]);
        $this->fakeGoogleUser('vtfslu@gmail.com');

        $this->get("/auth/social/google/redirect?invite={$token}");
        $response = $this->get('/auth/social/google/callback');

        $response->assertRedirect("/invite/{$token}?notice=social-mismatch");
        $this->assertGuest();
        $this->assertNotSame(\App\Models\Invitation::STATUS_ACCEPTED, \App\Models\Invitation::first()->status);
    }

    public function test_an_existing_linked_account_with_the_invited_email_fulfils_and_lands_home(): void
    {
        config(['services.google.client_id' => 'client-id']);
        $token = $this->inviteToken('owner@acme.test');

        $owner = User::factory()->create([
            'status' => 'approved', 'account_type' => 'Client', 'email' => 'owner@acme.test',
            'email_verified_at' => now(), 'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
        ]);
        $owner->connectedAccounts()->create([
            'provider' => 'google', 'provider_id' => 'g-1', 'email' => $owner->email, 'name' => $owner->name,
        ]);
        $this->fakeGoogleUser('owner@acme.test');

        $this->get("/auth/social/google/redirect?invite={$token}");
        $response = $this->get('/auth/social/google/callback');

        $response->assertRedirect('/');
        $this->assertAuthenticatedAs($owner);
        $this->assertSame(Invitation::STATUS_ACCEPTED, Invitation::first()->fresh()->status);
    }

    public function test_the_wrong_account_bounces_back_to_the_invite(): void
    {
        config(['services.google.client_id' => 'client-id']);
        $token = $this->inviteToken('owner@acme.test');
        $this->fakeGoogleUser('somebody-else@gmail.com');

        $this->get("/auth/social/google/redirect?invite={$token}");
        $response = $this->get('/auth/social/google/callback');

        $response->assertRedirect("/invite/{$token}?notice=social-mismatch");
        $this->assertNull(User::where('email', 'somebody-else@gmail.com')->first());
        $this->assertGuest();
    }
}
