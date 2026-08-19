<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\UserLocation;
use App\Models\UserPresenceState;
use App\Support\Presence\AvailabilityService;
use App\Support\Presence\AvailabilityStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
}
