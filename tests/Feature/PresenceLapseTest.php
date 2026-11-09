<?php

namespace Tests\Feature;

use App\Events\UserStatusChanged;
use App\Models\User;
use App\Models\UserPresence;
use App\Support\Messaging\PresenceService;
use App\Support\Presence\AvailabilityService;
use App\Support\Presence\AvailabilityStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * Online is a heartbeat lease. These hold the portal to telling every screen
 * when the lease ends, not only when somebody signs out.
 */
class PresenceLapseTest extends TestCase
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

    public function test_a_lapsed_heartbeat_is_announced_offline(): void
    {
        $user = $this->user();
        PresenceService::touch($user);

        Event::fake([UserStatusChanged::class]);
        $this->travel(UserPresence::ONLINE_TTL_SECONDS + 5)->seconds();

        $this->assertSame(1, PresenceService::expireLapsed());

        $presence = UserPresence::where('user_id', $user->id)->first();
        $this->assertNull($presence->online_until);
        $this->assertFalse($presence->isOnline());
        $this->assertSame(AvailabilityStatus::OFFLINE, $presence->primary_status);
        $this->assertNotNull($presence->last_seen_at, 'Last seen stays the last heartbeat.');

        Event::assertDispatched(UserStatusChanged::class, fn (UserStatusChanged $e) => $e->user->is($user)
            && $e->broadcastWith()['online'] === false
            && $e->broadcastWith()['status'] === AvailabilityStatus::OFFLINE);

        // Already announced: the next sweep has nothing to say.
        $this->assertSame(0, PresenceService::expireLapsed());
    }

    public function test_a_live_lease_is_left_alone(): void
    {
        $user = $this->user();
        PresenceService::touch($user);

        $this->assertSame(0, PresenceService::expireLapsed());
        $this->assertTrue(UserPresence::where('user_id', $user->id)->first()->isOnline());
    }

    /**
     * "In Office" outlives the connection, so the status does not change when
     * the laptop closes. The event has to go out anyway, and say offline.
     */
    public function test_somebody_with_a_chosen_status_is_announced_offline_too(): void
    {
        $user = $this->user();
        PresenceService::touch($user);
        AvailabilityService::setManual($user, AvailabilityStatus::IN_OFFICE);

        Event::fake([UserStatusChanged::class]);
        $this->travel(UserPresence::ONLINE_TTL_SECONDS + 5)->seconds();
        PresenceService::expireLapsed();

        Event::assertDispatched(UserStatusChanged::class, fn (UserStatusChanged $e) => $e->broadcastWith()['online'] === false
            && $e->broadcastWith()['status'] === AvailabilityStatus::IN_OFFICE);

        // And coming back is announced, though the status is the same.
        Event::fake([UserStatusChanged::class]);
        PresenceService::touch($user);
        Event::assertDispatched(UserStatusChanged::class, fn (UserStatusChanged $e) => $e->broadcastWith()['online'] === true
            && $e->broadcastWith()['status'] === AvailabilityStatus::IN_OFFICE);
    }

    public function test_heartbeats_while_online_announce_nothing(): void
    {
        $user = $this->user();
        PresenceService::touch($user);

        Event::fake([UserStatusChanged::class]);
        PresenceService::touch($user);

        Event::assertNotDispatched(UserStatusChanged::class);
    }

    /** The last page closing cuts the lease to a few seconds, it does not end it. */
    public function test_the_leaving_beacon_shortens_the_lease(): void
    {
        $user = $this->user();
        PresenceService::touch($user);

        $this->actingAs($user)
            ->postJson('/portal/messaging/presence/leaving')
            ->assertOk();

        $presence = UserPresence::where('user_id', $user->id)->first();
        $this->assertTrue($presence->isOnline(), 'A reload in the next few seconds keeps them online.');
        $this->assertTrue($presence->online_until->lte(now()->addSeconds(PresenceService::LEAVING_GRACE_SECONDS)));

        $this->travel(PresenceService::LEAVING_GRACE_SECONDS + 1)->seconds();
        $this->assertSame(1, PresenceService::expireLapsed());
    }
}
