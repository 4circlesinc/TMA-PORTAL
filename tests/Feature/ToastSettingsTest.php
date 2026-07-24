<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Notifications\ToastSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ToastSettingsTest extends TestCase
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

    public function test_me_includes_default_toast_preferences(): void
    {
        $user = $this->user();

        $this->actingAs($user)->getJson('/me')
            ->assertOk()
            ->assertJsonPath('toasts.enabled', true)
            ->assertJsonPath('toasts.position', 'bottom-right')
            ->assertJsonPath('toasts.durationSec', 10)
            ->assertJsonPath('toasts.stickyImportant', false)
            ->assertJsonPath('toasts.sound', false)
            ->assertJsonPath('toasts.previewText', true)
            ->assertJsonPath('toasts.groupSimilar', false);
    }

    public function test_preferences_round_trip_for_toast_settings(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/me/preferences', [
            'toasts' => [
                'enabled' => false,
                'position' => 'top-right',
                'durationSec' => 5,
                'stickyImportant' => true,
                'sound' => true,
                'previewText' => false,
                'groupSimilar' => true,
            ],
        ])->assertOk()
            ->assertJsonPath('toasts.enabled', false)
            ->assertJsonPath('toasts.position', 'top-right')
            ->assertJsonPath('toasts.durationSec', 5)
            ->assertJsonPath('toasts.stickyImportant', true)
            ->assertJsonPath('toasts.sound', true)
            ->assertJsonPath('toasts.previewText', false)
            ->assertJsonPath('toasts.groupSimilar', true);

        $this->actingAs($user)->getJson('/me/preferences')
            ->assertOk()
            ->assertJsonPath('toasts.position', 'top-right')
            ->assertJsonPath('toasts.durationSec', 5);

        $this->actingAs($user)->getJson('/me')
            ->assertOk()
            ->assertJsonPath('toasts.position', 'top-right');

        $user->refresh();
        $this->assertSame('top-right', ToastSettings::for($user)['position']);
    }

    public function test_invalid_toast_values_are_rejected_or_normalized(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/me/preferences', [
            'toasts' => [
                'position' => 'middle-center',
                'durationSec' => 99,
            ],
        ])->assertStatus(422);

        ToastSettings::update($user, [
            'position' => 'not-a-corner',
            'durationSec' => 99,
            'enabled' => true,
        ]);

        $normalized = ToastSettings::for($user->fresh());
        $this->assertSame('bottom-right', $normalized['position']);
        $this->assertSame(10, $normalized['durationSec']);
    }
}
