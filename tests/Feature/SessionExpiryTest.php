<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SessionExpiryTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_a_session_older_than_seven_days_is_signed_out(): void
    {
        $user = $this->user();
        $user->forceFill(['last_authenticated_at' => now()->subDays(8)])->save();

        $this->actingAs($user)
            ->get('/clients')
            ->assertRedirect(route('login'))
            ->assertSessionHas('status', 'session-expired');

        $this->assertGuest();
    }

    public function test_a_json_request_gets_a_401_when_the_session_has_expired(): void
    {
        $user = $this->user();
        $user->forceFill(['last_authenticated_at' => now()->subDays(8)])->save();

        $this->actingAs($user)
            ->getJson('/me')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'session-expired');
    }

    public function test_a_fresh_stamp_is_left_alone(): void
    {
        $user = $this->user();
        $user->forceFill(['last_authenticated_at' => now()->subDays(2)])->save();

        $this->actingAs($user)->getJson('/me')->assertOk();
    }

    public function test_accounts_without_a_stamp_are_not_kicked_out(): void
    {
        $this->actingAs($this->user())->getJson('/me')->assertOk();
    }
}
