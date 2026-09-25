<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The shell serves the casual-copy friction to everyone but administrators.
 *
 * The absence of the script IS the developer bypass, so "an administrator is
 * not served it" is the assertion that keeps that route back to a normal page
 * open; if it ever regresses, inspecting the portal stops working.
 */
class LockdownEmitTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $accountType): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_a_client_is_served_the_lockdown(): void
    {
        $this->actingAs($this->user(Role::CLIENT))->get('/')
            ->assertOk()
            ->assertSee('js/ui-lockdown.js', false);
    }

    public function test_a_reviewing_officer_is_served_the_lockdown(): void
    {
        $this->actingAs($this->user(Role::REVIEWING_OFFICER))->get('/')
            ->assertOk()
            ->assertSee('js/ui-lockdown.js', false);
    }

    public function test_an_administrator_is_not(): void
    {
        $this->actingAs($this->user(Role::ADMINISTRATOR))->get('/')
            ->assertOk()
            ->assertDontSee('js/ui-lockdown.js', false);
    }

    public function test_the_sign_in_page_is_locked_for_a_signed_out_reader(): void
    {
        $this->get('/auth/login')
            ->assertOk()
            ->assertSee('/js/ui-lockdown.js', false);
    }
}
