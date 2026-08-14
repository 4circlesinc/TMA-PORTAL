<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Theme, Privacy and Plugins panels of /account-settings — the personal
 * settings that used to live only in localStorage and so reset on every new
 * browser.
 */
class PersonalPreferencesTest extends TestCase
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

    public function test_defaults_are_returned_for_a_user_who_never_customized(): void
    {
        $this->actingAs($this->user())->getJson('/me/preferences')
            ->assertOk()
            // Light, not 'system' — the portal ignores the device's colour
            // scheme until dark mode is finished.
            ->assertJsonPath('themeMode', 'light')
            ->assertJsonPath('fontScale', 3)
            ->assertJsonPath('accentColor', 'indigo')
            ->assertJsonPath('historyDays', 30)
            // null, not [] — the client falls back to its shipped catalog.
            ->assertJsonPath('plugins', null);
    }

    public function test_theme_preferences_round_trip(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/me/preferences', [
            'themeMode' => 'dark',
            'fontScale' => 5,
            'accentColor' => 'green',
        ])->assertOk();

        $this->actingAs($user)->getJson('/me/preferences')
            ->assertOk()
            ->assertJsonPath('themeMode', 'dark')
            ->assertJsonPath('fontScale', 5)
            ->assertJsonPath('accentColor', 'green');
    }

    public function test_privacy_preferences_round_trip(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/me/preferences', [
            'historyDays' => 365,
        ])->assertOk();

        $this->actingAs($user)->getJson('/me/preferences')
            ->assertOk()
            ->assertJsonPath('historyDays', 365);
    }

    public function test_numeric_preferences_come_back_as_integers(): void
    {
        $user = $this->user();

        // The client reads these out of localStorage, so they arrive as text.
        $this->actingAs($user)->putJson('/me/preferences', [
            'fontScale' => '4',
            'historyDays' => '90',
        ])->assertOk();

        $payload = $this->actingAs($user)->getJson('/me/preferences')->json();

        $this->assertSame(4, $payload['fontScale']);
        $this->assertSame(90, $payload['historyDays']);
    }

    public function test_plugin_list_round_trips_and_removal_sticks(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/me/preferences', [
            'plugins' => [
                ['id' => 'figma', 'enabled' => true],
                ['id' => 'slack', 'enabled' => false],
            ],
        ])->assertOk();

        $this->actingAs($user)->getJson('/me/preferences')
            ->assertOk()
            ->assertJsonPath('plugins.0.id', 'figma')
            ->assertJsonPath('plugins.0.enabled', true)
            ->assertJsonPath('plugins.1.id', 'slack')
            ->assertJsonPath('plugins.1.enabled', false);

        // Removing one writes the shorter list; it must not reappear.
        $this->actingAs($user)->putJson('/me/preferences', [
            'plugins' => [['id' => 'slack', 'enabled' => false]],
        ])->assertOk();

        $payload = $this->actingAs($user)->getJson('/me/preferences')->json();

        $this->assertCount(1, $payload['plugins']);
        $this->assertSame('slack', $payload['plugins'][0]['id']);
    }

    public function test_plugin_list_can_be_emptied(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/me/preferences', ['plugins' => []])->assertOk();

        $this->assertSame([], $this->actingAs($user)->getJson('/me/preferences')->json('plugins'));
    }

    public function test_duplicate_plugin_ids_are_collapsed(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/me/preferences', [
            'plugins' => [
                ['id' => 'figma', 'enabled' => true],
                ['id' => 'figma', 'enabled' => false],
            ],
        ])->assertOk();

        $payload = $this->actingAs($user)->getJson('/me/preferences')->json();

        $this->assertCount(1, $payload['plugins']);
        $this->assertTrue($payload['plugins'][0]['enabled']);
    }

    public function test_out_of_range_values_are_rejected(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/me/preferences', ['themeMode' => 'neon'])
            ->assertStatus(422);
        $this->actingAs($user)->putJson('/me/preferences', ['fontScale' => 9])
            ->assertStatus(422);
        $this->actingAs($user)->putJson('/me/preferences', ['accentColor' => 'chartreuse'])
            ->assertStatus(422);
        $this->actingAs($user)->putJson('/me/preferences', ['historyDays' => 1000])
            ->assertStatus(422);
    }

    public function test_saving_one_panel_leaves_the_others_alone(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/me/preferences', ['themeMode' => 'dark'])->assertOk();
        $this->actingAs($user)->putJson('/me/preferences', ['historyDays' => 7])->assertOk();

        $this->actingAs($user)->getJson('/me/preferences')
            ->assertOk()
            ->assertJsonPath('themeMode', 'dark')
            ->assertJsonPath('historyDays', 7);
    }

    public function test_auto_timezone_defaults_on_and_accepts_iana_zones(): void
    {
        $user = $this->user();

        $this->actingAs($user)->getJson('/me/preferences')
            ->assertOk()
            ->assertJsonPath('autoTimezone', true);

        $this->actingAs($user)->putJson('/me/preferences', ['timezone' => 'America/New_York'])
            ->assertOk()
            ->assertJsonPath('timezone', 'America/New_York');

        $this->actingAs($user)->putJson('/me/preferences', ['timezone' => 'not a zone'])
            ->assertStatus(422);
    }

    public function test_changing_the_timezone_retimes_local_calendars(): void
    {
        $user = $this->user();
        $calendar = \App\Support\Calendar\CalendarProvisioner::personalFor($user);
        $this->assertSame('UTC', $calendar->timezone);

        $this->actingAs($user)->putJson('/me/preferences', ['timezone' => 'America/New_York'])
            ->assertOk();

        $this->assertSame('America/New_York', $calendar->fresh()->timezone);
    }

    public function test_a_manual_offset_pick_maps_to_a_real_zone(): void
    {
        $user = $this->user();
        $calendar = \App\Support\Calendar\CalendarProvisioner::personalFor($user);

        $this->actingAs($user)->putJson('/me/preferences', ['timezone' => 'utc-5'])
            ->assertOk();

        // POSIX Etc zones carry inverted signs: UTC-5 is Etc/GMT+5.
        $this->assertSame('Etc/GMT+5', $calendar->fresh()->timezone);
    }
}
