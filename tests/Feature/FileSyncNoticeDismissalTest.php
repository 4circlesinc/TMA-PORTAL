<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Closing the File Library's "…synced 2 hours ago" line closes it for good.
 *
 * It lived only in the browser before, which meant "close" meant "close until
 * you next open the portal somewhere else". Storing it on the account is the
 * difference between dismissing a notice and dismissing it every day.
 */
class FileSyncNoticeDismissalTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_the_notice_starts_undismissed(): void
    {
        $this->actingAs($this->user())->getJson('/me/preferences')
            ->assertOk()
            ->assertJsonPath('fileSyncNoticeDismissed', false);
    }

    public function test_dismissing_it_persists_to_the_account(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/me/preferences', ['fileSyncNoticeDismissed' => true])
            ->assertOk();

        // Read back through the API a fresh browser would use — this is the
        // whole point: a new device must already know it was dismissed.
        $this->actingAs($user)->getJson('/me/preferences')
            ->assertOk()
            ->assertJsonPath('fileSyncNoticeDismissed', true);

        $this->assertTrue((bool) ($user->fresh()->preferences['fileSyncNoticeDismissed'] ?? false));
    }

    public function test_it_can_be_brought_back(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/me/preferences', ['fileSyncNoticeDismissed' => true])->assertOk();
        $this->actingAs($user)->putJson('/me/preferences', ['fileSyncNoticeDismissed' => false])->assertOk();

        $this->actingAs($user)->getJson('/me/preferences')
            ->assertJsonPath('fileSyncNoticeDismissed', false);
    }

    public function test_one_persons_dismissal_is_not_everybody_elses(): void
    {
        $olive = $this->user();
        $ben = $this->user();

        $this->actingAs($olive)->putJson('/me/preferences', ['fileSyncNoticeDismissed' => true])->assertOk();

        $this->actingAs($ben)->getJson('/me/preferences')
            ->assertJsonPath('fileSyncNoticeDismissed', false);
    }

    public function test_a_non_boolean_is_rejected(): void
    {
        $this->actingAs($this->user())
            ->putJson('/me/preferences', ['fileSyncNoticeDismissed' => 'sometimes'])
            ->assertStatus(422);
    }
}
