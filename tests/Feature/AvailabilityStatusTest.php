<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\UserLocation;
use App\Models\UserPresence;
use App\Models\UserPresenceState;
use App\Models\UserStatusSchedule;
use App\Support\Presence\AvailabilityService;
use App\Support\Presence\AvailabilityStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AvailabilityStatusTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'status' => User::STATUS_APPROVED,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_on_call_takes_priority_over_in_office(): void
    {
        $user = $this->user();

        AvailabilityService::setState(
            $user,
            AvailabilityStatus::IN_OFFICE,
            AvailabilityStatus::SOURCE_LOCATION,
        );
        AvailabilityService::setState(
            $user,
            AvailabilityStatus::ON_CALL,
            AvailabilityStatus::SOURCE_CALL,
        );

        $presence = AvailabilityService::recompute($user);

        $this->assertSame(AvailabilityStatus::ON_CALL, $presence->primary_status);
    }

    public function test_manual_away_can_be_set_with_expiry(): void
    {
        $user = $this->user();
        $expires = now()->addHour();

        AvailabilityService::setManual($user, AvailabilityStatus::AWAY, [
            'expiresAt' => $expires->toIso8601String(),
        ]);

        $state = UserPresenceState::where('user_id', $user->id)
            ->where('status', AvailabilityStatus::AWAY)
            ->first();

        $this->assertNotNull($state);
        $this->assertSame(AvailabilityStatus::SOURCE_MANUAL, $state->source);
    }

    public function test_location_geofence_sets_in_office(): void
    {
        $user = $this->user();

        UserLocation::create([
            'user_id' => $user->id,
            'type' => UserLocation::TYPE_OFFICE,
            'latitude' => 45.5017,
            'longitude' => -73.5673,
            'radius_m' => 200,
            'enabled' => true,
        ]);

        AvailabilityService::applyLocation($user, ['lat' => 45.5018, 'lng' => -73.5674]);

        $presence = AvailabilityService::recompute($user);
        $this->assertSame(AvailabilityStatus::IN_OFFICE, $presence->primary_status);
    }

    public function test_active_schedule_applies_without_recursing(): void
    {
        $user = $this->user();

        UserStatusSchedule::create([
            'user_id' => $user->id,
            'status' => AvailabilityStatus::DO_NOT_DISTURB,
            'status_message' => 'Focus time',
            'starts_at' => now()->subHour(),
            'ends_at' => now()->addHour(),
            'enabled' => true,
        ]);

        $presence = AvailabilityService::recompute($user);

        $this->assertSame(AvailabilityStatus::DO_NOT_DISTURB, $presence->primary_status);
        $this->assertSame(AvailabilityStatus::SOURCE_SCHEDULED, $presence->status_source);
    }

    public function test_me_survives_an_active_schedule(): void
    {
        $user = $this->user();

        UserStatusSchedule::create([
            'user_id' => $user->id,
            'status' => AvailabilityStatus::AWAY,
            'starts_at' => now()->subMinutes(5),
            'ends_at' => now()->addMinutes(30),
            'enabled' => true,
        ]);

        $this->actingAs($user)
            ->getJson('/me')
            ->assertOk()
            ->assertJsonPath('availability.primary.status', AvailabilityStatus::AWAY);
    }

    public function test_me_runs_no_presence_deletes_for_stateless_users(): void
    {
        $user = $this->user();
        $this->actingAs($user)->getJson('/me')->assertOk();

        DB::enableQueryLog();
        $this->getJson('/me')->assertOk();
        $deletes = collect(DB::getQueryLog())->filter(
            fn ($q) => str_starts_with(strtolower(trim($q['query'])), 'delete')
                && str_contains($q['query'], 'user_presence_states')
        );

        $this->assertCount(0, $deletes, 'a user with no layered states must not pay presence purges on /me');
    }

    public function test_me_includes_availability_payload(): void
    {
        $user = $this->user();

        $this->actingAs($user)
            ->getJson('/me')
            ->assertOk()
            ->assertJsonPath('availability.primary.status', AvailabilityStatus::OFFLINE);
    }

    public function test_update_status_via_api(): void
    {
        $user = $this->user();

        $this->actingAs($user)
            ->putJson('/me/availability/status', [
                'status' => AvailabilityStatus::DO_NOT_DISTURB,
                'expiresAt' => now()->addMinutes(30)->toIso8601String(),
            ])
            ->assertOk()
            ->assertJsonPath('primary.status', AvailabilityStatus::DO_NOT_DISTURB);
    }

    public function test_upsert_location_via_api(): void
    {
        $user = $this->user();

        $this->actingAs($user)
            ->putJson('/me/availability/locations', [
                'type' => UserLocation::TYPE_OFFICE,
                'label' => 'HQ',
                'address' => '123 Main St',
                'latitude' => 45.5017,
                'longitude' => -73.5673,
                'radiusM' => 200,
                'enabled' => true,
            ])
            ->assertOk()
            ->assertJsonPath('locations.0.type', UserLocation::TYPE_OFFICE)
            ->assertJsonPath('locations.0.latitude', 45.5017)
            ->assertJsonPath('locations.0.enabled', true);

        $this->assertDatabaseHas('user_locations', [
            'user_id' => $user->id,
            'type' => UserLocation::TYPE_OFFICE,
            'enabled' => true,
        ]);
    }

    public function test_upsert_location_can_disable_detection(): void
    {
        $user = $this->user();

        UserLocation::create([
            'user_id' => $user->id,
            'type' => UserLocation::TYPE_OFFICE,
            'latitude' => 45.5017,
            'longitude' => -73.5673,
            'radius_m' => 200,
            'enabled' => true,
        ]);

        $this->actingAs($user)
            ->putJson('/me/availability/locations', [
                'type' => UserLocation::TYPE_OFFICE,
                'latitude' => 45.5017,
                'longitude' => -73.5673,
                'enabled' => false,
            ])
            ->assertOk()
            ->assertJsonPath('locations.0.enabled', false);

        $this->assertDatabaseHas('user_locations', [
            'user_id' => $user->id,
            'type' => UserLocation::TYPE_OFFICE,
            'enabled' => false,
        ]);
    }

    public function test_report_location_applies_geofence_via_api(): void
    {
        $user = $this->user();

        UserLocation::create([
            'user_id' => $user->id,
            'type' => UserLocation::TYPE_OFFICE,
            'latitude' => 45.5017,
            'longitude' => -73.5673,
            'radius_m' => 200,
            'enabled' => true,
        ]);

        $this->actingAs($user)
            ->postJson('/me/availability/location', [
                'lat' => 45.5018,
                'lng' => -73.5674,
            ])
            ->assertOk()
            ->assertJsonPath('primary.status', AvailabilityStatus::IN_OFFICE);
    }

    public function test_report_location_uses_gps_accuracy_buffer(): void
    {
        $user = $this->user();

        UserLocation::create([
            'user_id' => $user->id,
            'type' => UserLocation::TYPE_OFFICE,
            'latitude' => 45.5017,
            'longitude' => -73.5673,
            'radius_m' => 100,
            'enabled' => true,
        ]);

        $this->actingAs($user)
            ->postJson('/me/availability/location', [
                'lat' => 45.5030,
                'lng' => -73.5674,
                'accuracyM' => 200,
            ])
            ->assertOk()
            ->assertJsonPath('primary.status', AvailabilityStatus::IN_OFFICE);
    }

    public function test_a_manual_pick_replaces_do_not_disturb(): void
    {
        $user = $this->user();

        AvailabilityService::setManual($user, AvailabilityStatus::DO_NOT_DISTURB);
        $presence = AvailabilityService::setManual($user, AvailabilityStatus::IN_OFFICE);

        $this->assertSame(AvailabilityStatus::IN_OFFICE, $presence->primary_status);
        $this->assertDatabaseMissing('user_presence_states', [
            'user_id' => $user->id,
            'status' => AvailabilityStatus::DO_NOT_DISTURB,
        ]);
    }

    public function test_manual_working_remote_overrides_an_office_geofence(): void
    {
        $user = $this->user();

        UserLocation::create([
            'user_id' => $user->id,
            'type' => UserLocation::TYPE_OFFICE,
            'latitude' => 45.5017,
            'longitude' => -73.5673,
            'radius_m' => 200,
            'enabled' => true,
        ]);

        AvailabilityService::applyLocation($user, ['lat' => 45.5018, 'lng' => -73.5674]);
        $presence = AvailabilityService::setManual($user, AvailabilityStatus::WORKING_REMOTE);

        $this->assertSame(AvailabilityStatus::WORKING_REMOTE, $presence->primary_status);
    }

    public function test_a_live_call_still_beats_a_manual_status(): void
    {
        $user = $this->user();

        AvailabilityService::setOnCall($user, true);
        $presence = AvailabilityService::setManual($user, AvailabilityStatus::DO_NOT_DISTURB);

        $this->assertSame(AvailabilityStatus::ON_CALL, $presence->primary_status);
    }

    public function test_duration_without_a_start_is_accepted(): void
    {
        $user = $this->user();

        $this->actingAs($user)
            ->putJson('/me/availability/status', [
                'status' => AvailabilityStatus::DO_NOT_DISTURB,
                'startsAt' => null,
                'expiresAt' => now()->addMinutes(30)->toIso8601String(),
            ])
            ->assertOk()
            ->assertJsonPath('primary.status', AvailabilityStatus::DO_NOT_DISTURB);
    }

    public function test_switching_away_from_do_not_disturb_through_the_api(): void
    {
        $user = $this->user();

        $this->actingAs($user)
            ->putJson('/me/availability/status', [
                'status' => AvailabilityStatus::DO_NOT_DISTURB,
                'expiresAt' => now()->addHour()->toIso8601String(),
            ])
            ->assertOk();

        $this->putJson('/me/availability/status', [
            'status' => AvailabilityStatus::AT_MEETING,
            'expiresAt' => now()->addMinutes(30)->toIso8601String(),
        ])
            ->assertOk()
            ->assertJsonPath('primary.status', AvailabilityStatus::AT_MEETING);
    }

    public function test_a_future_status_is_kept_until_it_starts(): void
    {
        $user = $this->user();

        AvailabilityService::setManual($user, AvailabilityStatus::AT_MEETING, [
            'startsAt' => now()->addHour()->toIso8601String(),
            'expiresAt' => now()->addHours(2)->toIso8601String(),
        ]);

        $this->assertDatabaseHas('user_presence_states', [
            'user_id' => $user->id,
            'status' => AvailabilityStatus::AT_MEETING,
        ]);

        $presence = UserPresence::where('user_id', $user->id)->first();
        $this->assertNotNull($presence);
        $this->assertNotSame(AvailabilityStatus::AT_MEETING, $presence->primary_status);
    }

    public function test_status_message_survives_a_recompute(): void
    {
        $user = $this->user();

        AvailabilityService::setManual($user, AvailabilityStatus::DO_NOT_DISTURB);
        $presence = AvailabilityService::setMessage($user, 'Back at 3');

        $this->assertSame('Back at 3', $presence->status_message);
        $this->assertSame('Back at 3', AvailabilityService::recompute($user)->status_message);
    }

    public function test_a_message_without_a_manual_status_sticks(): void
    {
        $user = $this->user();

        $this->actingAs($user)
            ->putJson('/me/availability/message', ['message' => 'At my desk'])
            ->assertOk()
            ->assertJsonPath('primary.message', 'At my desk');

        $this->getJson('/me/availability')
            ->assertOk()
            ->assertJsonPath('primary.message', 'At my desk');
    }
}
