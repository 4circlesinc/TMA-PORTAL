<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\StaySignedIn;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The "Stay signed in?" prompt must never become a room with no door.
 *
 * It is the one screen every sign-in passes through, and the gate in front of
 * it sends every other URL back here until it is answered. So a submission that
 * fails to carry an answer used to cost the whole session: the person landed
 * back on this screen, nothing on the page said why, and every attempt to reach
 * the portal returned them to it. From the outside that is indistinguishable
 * from "signing in doesn't work" — which is exactly how it was reported.
 *
 * The answer now travels in a hidden field rather than on the pressed button,
 * so there is no submitter to lose; these cover the ways out regardless.
 */
class StaySignedInPromptTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_each_answer_is_carried_in_the_form_itself(): void
    {
        $page = $this->actingAs($this->user())
            ->withSession([StaySignedIn::SESSION_KEY => true])
            ->get('/auth/stay-signed-in');

        $page->assertOk()
            // Not `name="stay"` on a button: the value must not depend on the
            // browser reporting which control was pressed.
            ->assertSee('<input type="hidden" name="stay" value="yes">', false)
            ->assertSee('<input type="hidden" name="stay" value="no">', false);
    }

    public function test_answering_yes_releases_the_gate(): void
    {
        $user = $this->user();

        $this->actingAs($user)
            ->withSession([StaySignedIn::SESSION_KEY => true])
            ->post('/auth/stay-signed-in', ['stay' => 'yes'])
            ->assertRedirect('/')
            ->assertSessionMissing(StaySignedIn::SESSION_KEY)
            ->assertCookie(StaySignedIn::COOKIE, 'yes');
    }

    public function test_answering_no_releases_it_too(): void
    {
        $this->actingAs($this->user())
            ->withSession([StaySignedIn::SESSION_KEY => true])
            ->post('/auth/stay-signed-in', ['stay' => 'no'])
            ->assertRedirect('/')
            ->assertSessionMissing(StaySignedIn::SESSION_KEY);
    }

    public function test_a_submission_with_no_answer_says_so_rather_than_looping_in_silence(): void
    {
        $this->actingAs($this->user())
            ->withSession([StaySignedIn::SESSION_KEY => true])
            ->post('/auth/stay-signed-in', [])
            ->assertSessionHasErrors('stay');

        // And the screen renders that reason, so the person is never looking at
        // a button that appears to do nothing.
        $this->actingAs($this->user())
            ->withSession([StaySignedIn::SESSION_KEY => true])
            ->followingRedirects()
            ->post('/auth/stay-signed-in', [])
            ->assertSee('Stay signed in?')
            ->assertSee('tma-auth__alert--error', false);
    }

    public function test_a_browser_that_already_answered_is_not_pinned_to_the_prompt(): void
    {
        // The flag says "ask", the cookie says "already answered". That can only
        // happen if something went wrong — and it must resolve in favour of the
        // person getting on with their day, not against them.
        $this->actingAs($this->user())
            ->withSession([StaySignedIn::SESSION_KEY => true])
            ->withCookie(StaySignedIn::COOKIE, 'yes')
            ->get('/')
            ->assertOk();
    }

    public function test_a_browser_that_has_not_answered_is_still_asked(): void
    {
        $this->actingAs($this->user())
            ->withSession([StaySignedIn::SESSION_KEY => true])
            ->get('/')
            ->assertRedirect(route('stay-signed-in.show'));
    }
}
