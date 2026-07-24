<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\User;
use Illuminate\Auth\Events\Login;
use Illuminate\Auth\Events\Logout;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The everyday events that keep the Activities panel from sitting empty:
 * sign-ins, sign-outs, and mailbox connect/disconnect.
 */
class ActivityLoggingTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_signing_in_records_a_login_activity(): void
    {
        $user = $this->user();

        event(new Login('web', $user, false));

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $user->id,
            'activity_type' => 'security.login',
            'module' => 'security',
            'description' => $user->name.' signed in',
        ]);
    }

    public function test_signing_out_records_a_logout_activity(): void
    {
        $user = $this->user();

        event(new Logout('web', $user));

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $user->id,
            'activity_type' => 'security.logout',
            'description' => $user->name.' signed out',
        ]);
    }

    public function test_login_activity_is_visible_through_the_activity_feed(): void
    {
        $user = $this->user();

        event(new Login('web', $user, false));

        $items = $this->actingAs($user)
            ->getJson('/portal/activity')
            ->assertOk()
            ->json('items');

        $this->assertNotEmpty($items);
        $this->assertSame('security.login', $items[0]['type']);
        $this->assertSame($user->name.' signed in', $items[0]['description']);
    }

    public function test_mailbox_sign_out_lands_in_the_audit_trail(): void
    {
        $user = $this->user();

        ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'google',
            'provider_id' => 'g-'.$user->id,
            'email' => 'user@example.com',
            'name' => 'Test User',
            'token' => 'refresh-token',
            'scopes' => ['https://www.googleapis.com/auth/gmail.modify'],
            'sync_email' => true,
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/sign-out')
            ->assertOk();

        $this->assertDatabaseHas('activity_logs', [
            'actor_id' => $user->id,
            'activity_type' => 'email.disconnected',
            'module' => 'email',
        ]);
    }
}
