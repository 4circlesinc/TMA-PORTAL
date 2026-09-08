<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * What the shell knows before /me answers.
 *
 * PortalShell inlines a few facts into the served HTML so the first paint does
 * not have to guess. This pins the one that was being guessed wrong: whether
 * the reader is an administrator.
 *
 * The Workflows comment tabs ask at mount, and /me answers over the network.
 * An administrator whose identity had not arrived yet was treated as an
 * ordinary reader, so the Feedback page asked the server for threads that
 * involve THEM — and an administrator who is on none of the firm's threads
 * got an empty page while their notification badge was still lit.
 */
class PortalShellBootTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type): User
    {
        $user = User::create([
            'name' => 'Ada Admin',
            'email' => 'ada'.$type.'@example.com',
            'password' => bcrypt('password12345'),
        ]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    public function test_the_shell_tells_the_page_an_administrator_is_one(): void
    {
        $this->actingAs($this->user(Role::ADMINISTRATOR))
            ->get('/workflows/feedback')
            ->assertOk()
            ->assertSee('window.TMABootIsAdmin=true', escape: false);
    }

    public function test_the_shell_does_not_claim_an_officer_is_an_administrator(): void
    {
        // The flag decides whether the firm-wide Everything tab is offered on
        // first paint, so a false positive would show a tab the server then
        // refuses — a button that quietly does something else.
        $this->actingAs($this->user(Role::REVIEWING_OFFICER))
            ->get('/workflows/feedback')
            ->assertOk()
            ->assertSee('window.TMABootIsAdmin=false', escape: false);
    }
}
