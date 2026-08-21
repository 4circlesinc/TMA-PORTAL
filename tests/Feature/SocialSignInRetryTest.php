<?php

namespace Tests\Feature;

use App\Models\AuthEvent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * The silent second lap after a lost OAuth state.
 *
 * The state token lives in the session, so anything that separates a browser
 * from its session between the redirect and the callback loses it — Edge on
 * Windows handing a work sign-in to a different profile is the one people
 * actually hit. What they saw was the sign-in screen again, which looks
 * identical to the one they started on, so the obvious read is "it didn't
 * work" rather than "go round once more" — the one thing that would have
 * worked. So the portal goes round for them, exactly once.
 *
 * Once, because an unbounded retry is a redirect loop. The bound has to hold
 * for a browser keeping no cookies at all, since that is itself a reason
 * sign-in can never complete.
 */
class SocialSignInRetryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['services.microsoft.client_id' => 'test-client']);
        config(['services.microsoft.client_secret' => 'test-secret']);
        config(['services.microsoft.redirect' => 'http://localhost/auth/social/microsoft/callback']);
    }

    /** A callback whose state matches nothing in the session. */
    private function callbackWithLostState(): TestResponse
    {
        return $this->get('/auth/social/microsoft/callback?code=abc&state='.str_repeat('a', 40));
    }

    public function test_a_lost_state_goes_round_again_instead_of_back_to_the_sign_in_screen(): void
    {
        $this->callbackWithLostState()
            ->assertRedirect(route('social.redirect', ['provider' => 'microsoft', 'retry' => 1]));

        // Nothing is claimed to have failed yet — it hasn't.
        $this->assertSame(0, AuthEvent::where('event', 'social_failed')->count());
    }

    /**
     * The lap that goes round again must not make the person pick their
     * account a second time: they already did, and the provider still has the
     * session it just established.
     */
    public function test_the_retry_lap_does_not_ask_for_the_account_again(): void
    {
        $plain = $this->get('/auth/social/microsoft/redirect');
        $retry = $this->get('/auth/social/microsoft/redirect?retry=1');

        $this->assertStringContainsString('prompt=select_account', $plain->headers->get('Location'));
        $this->assertStringNotContainsString('prompt=', $retry->headers->get('Location'));
    }

    /**
     * Second failure in a row: stop. This asserts the cache-backed guard
     * rather than the cookie one, because the cookie is exactly what may be
     * missing in the case the retry exists for.
     */
    public function test_a_second_lost_state_stops_and_says_so(): void
    {
        $this->callbackWithLostState()->assertRedirect(route('social.redirect', ['provider' => 'microsoft', 'retry' => 1]));

        $this->callbackWithLostState()
            ->assertRedirect(route('login'))
            ->assertSessionHas('social_error', 'Your Microsoft sign-in session expired. Please start again.');
    }

    public function test_a_refusal_that_stops_is_recorded_with_its_reason(): void
    {
        $this->callbackWithLostState();
        $this->callbackWithLostState();

        $this->assertSame('microsoft: state_mismatch', AuthEvent::where('event', 'social_failed')->value('detail'));
    }

    /**
     * A tenant refusal is not retried — going round again cannot change the
     * answer — and it lands in the record naming the code support needs.
     */
    public function test_a_tenant_refusal_is_recorded_by_its_aadsts_code(): void
    {
        $this->get('/auth/social/microsoft/callback?'.http_build_query([
            'error' => 'access_denied',
            'error_description' => 'AADSTS50105: The user is not assigned to a role for the application.',
        ]))->assertRedirect(route('login'));

        $this->assertSame('microsoft: AADSTS50105', AuthEvent::where('event', 'social_failed')->value('detail'));
    }
}
