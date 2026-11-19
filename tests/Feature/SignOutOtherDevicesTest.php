<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * "Log out of all devices" ends every other session, keeps this one, and asks
 * for the password first so a borrowed or stolen session cannot use it to
 * throw the real owner out.
 */
class SignOutOtherDevicesTest extends TestCase
{
    use RefreshDatabase;

    private function person(array $attributes = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $attributes));
    }

    private function sessionFor(User $user, string $id): void
    {
        DB::table('sessions')->insert([
            'id' => $id,
            'user_id' => $user->id,
            'ip_address' => '203.0.113.5',
            'user_agent' => 'Test',
            'payload' => '',
            'last_activity' => now()->getTimestamp(),
        ]);
    }

    public function test_it_ends_every_other_session_of_this_account_only(): void
    {
        $user = $this->person();
        $someoneElse = $this->person();
        $this->sessionFor($user, 'laptop');
        $this->sessionFor($user, 'phone');
        $this->sessionFor($someoneElse, 'their-laptop');

        $this->actingAs($user)
            ->postJson('/security-settings/logout-others', ['password' => 'password'])
            ->assertOk()
            ->assertJson(['status' => 'ok']);

        $this->assertDatabaseMissing('sessions', ['id' => 'laptop']);
        $this->assertDatabaseMissing('sessions', ['id' => 'phone']);
        $this->assertDatabaseHas('sessions', ['id' => 'their-laptop']);
        $this->assertAuthenticatedAs($user);
    }

    public function test_a_wrong_password_ends_nothing(): void
    {
        $user = $this->person();
        $this->sessionFor($user, 'laptop');

        $this->actingAs($user)
            ->postJson('/security-settings/logout-others', ['password' => 'not-the-password'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('password');

        $this->assertDatabaseHas('sessions', ['id' => 'laptop']);
    }

    /**
     * Someone who signed up with Google or Microsoft has no password of their
     * own to type. "The password is incorrect" would be a dead end; tell them
     * what to do instead.
     */
    public function test_an_account_without_its_own_password_is_told_to_create_one(): void
    {
        $user = $this->person(['password_auto' => true]);
        $this->sessionFor($user, 'laptop');

        $response = $this->actingAs($user)
            ->postJson('/security-settings/logout-others', ['password' => 'password'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('password');

        $this->assertStringContainsString('Create a password', $response->json('errors.password.0'));
        $this->assertDatabaseHas('sessions', ['id' => 'laptop']);
    }

    public function test_password_guesses_are_rate_limited(): void
    {
        $user = $this->person();

        for ($i = 0; $i < 6; $i++) {
            $this->actingAs($user)
                ->postJson('/security-settings/logout-others', ['password' => 'guess-'.$i])
                ->assertStatus(422);
        }

        $this->actingAs($user)
            ->postJson('/security-settings/logout-others', ['password' => 'guess-7'])
            ->assertStatus(429);
    }
}
