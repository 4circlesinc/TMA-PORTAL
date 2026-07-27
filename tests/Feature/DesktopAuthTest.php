<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Sign-in handoff for the macOS app.
 *
 * The whole design rests on one claim: the token that travels back over the
 * tmaportal:// scheme is useless to anything that did not start the flow.
 * macOS lets any app register a scheme, so these tests are mostly about the
 * verifier — what it must be, and how little a stolen token buys without it.
 */
class DesktopAuthTest extends TestCase
{
    use RefreshDatabase;

    private function verifier(): string
    {
        return Str::random(43);
    }

    private function challengeFor(string $verifier): string
    {
        return rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
    }

    /**
     * Become the desktop app: a clean session that never saw the browser's
     * cookies. flushSession() alone is not enough — actingAs() leaves a user
     * on the guard, which would mask exactly the failures these tests look for.
     */
    private function becomeTheApp(): void
    {
        $this->flushSession();
        $this->app['auth']->forgetGuards();
    }

    /** Drive the browser half and return the token the app would receive. */
    private function tokenFor(User $user, string $challenge): string
    {
        $this->get('/auth/desktop/start?challenge='.$challenge)
            ->assertRedirect(route('login'));

        $response = $this->actingAs($user)->get('/auth/desktop/finish');
        $response->assertOk();

        preg_match('/tmaportal:\/\/auth\?token=([A-Za-z0-9]{64})/', $response->getContent(), $m);
        $this->assertNotEmpty($m, 'finish() did not hand back a tmaportal:// token');

        return $m[1];
    }

    public function test_a_verified_handoff_signs_the_app_in(): void
    {
        $user = User::factory()->create();
        $verifier = $this->verifier();

        $token = $this->tokenFor($user, $this->challengeFor($verifier));

        $this->becomeTheApp();

        $this->get("/auth/desktop/claim?token={$token}&verifier={$verifier}")
            ->assertRedirect('/');

        $this->assertAuthenticatedAs($user);
    }

    public function test_a_token_without_the_verifier_is_worthless(): void
    {
        $user = User::factory()->create();
        $token = $this->tokenFor($user, $this->challengeFor($this->verifier()));

        $this->becomeTheApp();

        // What an app that hijacked the URL scheme would have: the token, and
        // a verifier of its own choosing.
        $this->get("/auth/desktop/claim?token={$token}&verifier=".$this->verifier())
            ->assertRedirect(route('login'));

        $this->assertGuest();
    }

    public function test_a_token_can_only_be_claimed_once(): void
    {
        $user = User::factory()->create();
        $verifier = $this->verifier();
        $token = $this->tokenFor($user, $this->challengeFor($verifier));

        $this->becomeTheApp();
        $this->get("/auth/desktop/claim?token={$token}&verifier={$verifier}");
        $this->assertAuthenticatedAs($user);

        $this->becomeTheApp();

        $this->get("/auth/desktop/claim?token={$token}&verifier={$verifier}")
            ->assertRedirect(route('login'));

        $this->assertGuest();
    }

    public function test_a_failed_claim_burns_the_token(): void
    {
        $user = User::factory()->create();
        $verifier = $this->verifier();
        $token = $this->tokenFor($user, $this->challengeFor($verifier));

        $this->becomeTheApp();

        // Wrong verifier first — an attacker guessing.
        $this->get("/auth/desktop/claim?token={$token}&verifier=".$this->verifier());

        // The real app is now too late, which is the correct trade: a burnt
        // token costs one retry, a replayable one costs the account.
        $this->becomeTheApp();
        $this->get("/auth/desktop/claim?token={$token}&verifier={$verifier}")
            ->assertRedirect(route('login'));

        $this->assertGuest();
    }

    public function test_an_unknown_token_is_rejected(): void
    {
        $this->get('/auth/desktop/claim?token='.Str::random(64).'&verifier='.$this->verifier())
            ->assertRedirect(route('login'));

        $this->assertGuest();
    }

    public function test_start_rejects_a_malformed_challenge(): void
    {
        $this->get('/auth/desktop/start?challenge=short')->assertSessionHasErrors('challenge');
        $this->get('/auth/desktop/start')->assertSessionHasErrors('challenge');
    }

    public function test_finish_without_a_started_flow_just_goes_home(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->get('/auth/desktop/finish')->assertRedirect('/');
    }

    public function test_finish_requires_a_signed_in_browser(): void
    {
        $this->get('/auth/desktop/finish')->assertRedirect(route('login'));
    }

    public function test_start_sends_a_signed_in_browser_straight_back(): void
    {
        $user = User::factory()->create();
        $verifier = $this->verifier();

        $this->actingAs($user)
            ->get('/auth/desktop/start?challenge='.$this->challengeFor($verifier))
            ->assertRedirect(route('desktop.finish'));
    }

    public function test_start_hands_off_to_the_named_provider(): void
    {
        $this->get('/auth/desktop/start?challenge='.$this->challengeFor($this->verifier()).'&provider=google')
            ->assertRedirect(route('social.redirect', ['provider' => 'google']));
    }

    public function test_the_token_expires(): void
    {
        $user = User::factory()->create();
        $verifier = $this->verifier();
        $token = $this->tokenFor($user, $this->challengeFor($verifier));

        Cache::forget("desktop-auth:{$token}"); // stand-in for the 120s TTL

        $this->becomeTheApp();
        $this->get("/auth/desktop/claim?token={$token}&verifier={$verifier}")
            ->assertRedirect(route('login'));

        $this->assertGuest();
    }
}
