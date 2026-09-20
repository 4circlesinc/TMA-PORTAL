<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\AuthEvent;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Notifications\NotificationPresenter;
use App\Support\Security\IpLocation;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Where a sign-in came from, and the "one sign-in, one row" rule.
 *
 * The duplicate test is the important one. Laravel fires Login again every
 * time the guard re-authenticates the same person — the remember-me re-login
 * and the two-factor path both do — and each firing used to write its own
 * audit row, so a single sign-in appeared two or three times in the trail. An
 * audit log that invents events is worse than no audit log, because somebody
 * will eventually read those rows as evidence.
 */
class SignInLocationTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_re_authenticating_does_not_duplicate_the_sign_in(): void
    {
        $user = $this->user();

        // Sign in, then the two re-logins that StaySignedIn::applyRemember and
        // the two-factor controller perform on a real sign-in.
        Auth::login($user);
        Auth::login($user, true);
        Auth::login($user, true);

        $this->assertSame(1, AuthEvent::where('user_id', $user->id)->where('event', 'login')->count());
        $this->assertSame(1, ActivityLog::where('actor_id', $user->id)->where('activity_type', 'security.login')->count());
    }

    public function test_a_later_sign_in_is_still_recorded(): void
    {
        $user = $this->user();

        Auth::login($user);

        // Past the dedupe window: a genuine second sign-in, which must not be
        // swallowed. Suppressing real events would be the worse bug of the two.
        $this->travel(30)->seconds();
        Auth::login($user);

        $this->assertSame(2, AuthEvent::where('user_id', $user->id)->where('event', 'login')->count());
    }

    public function test_a_sign_in_by_someone_else_is_never_suppressed(): void
    {
        $first = $this->user();
        $second = $this->user();

        Auth::login($first);
        Auth::login($second);

        $this->assertSame(1, AuthEvent::where('user_id', $first->id)->where('event', 'login')->count());
        $this->assertSame(1, AuthEvent::where('user_id', $second->id)->where('event', 'login')->count());
    }

    public function test_location_is_null_without_a_configured_provider(): void
    {
        config(['services.ip_reputation.driver' => '', 'services.ip_reputation.key' => '']);

        $this->assertNull(IpLocation::lookup('203.0.113.9'));
    }

    public function test_a_private_address_is_never_looked_up(): void
    {
        config(['services.ip_reputation.driver' => 'ipapi', 'services.ip_reputation.key' => 'test-key']);
        Http::fake();

        $this->assertNull(IpLocation::lookup('127.0.0.1'));
        $this->assertNull(IpLocation::lookup('10.0.0.4'));

        // The container's own address is not a place anybody signed in from,
        // and paying a lookup to learn that would be waste.
        Http::assertNothingSent();
    }

    public function test_a_provider_answer_becomes_a_location(): void
    {
        config(['services.ip_reputation.driver' => 'ipapi', 'services.ip_reputation.key' => 'test-key']);

        Http::fake(['ipapi.co/*' => Http::response([
            'city' => 'Toronto',
            'region' => 'Ontario',
            'postal' => 'M5H 2N2',
            'country_code' => 'CA',
            'latitude' => 43.6532,
            'longitude' => -79.3832,
        ])]);

        $location = IpLocation::lookup('203.0.113.9');

        $this->assertSame('Toronto', $location['city']);
        $this->assertSame('Ontario', $location['region']);
        $this->assertSame('CA', $location['country']);
        $this->assertSame(43.6532, $location['latitude']);
        $this->assertSame('Toronto, Ontario, CA', IpLocation::describe($location));
    }

    public function test_an_outage_is_not_a_location(): void
    {
        config(['services.ip_reputation.driver' => 'ipapi', 'services.ip_reputation.key' => 'test-key']);
        Http::fake(['ipapi.co/*' => Http::response('', 500)]);

        // A sign-in must never fail, or stall, because a geo API did.
        $this->assertNull(IpLocation::lookup('203.0.113.9'));
    }

    public function test_null_island_and_placeholders_are_discarded(): void
    {
        config(['services.ip_reputation.driver' => 'ipapi', 'services.ip_reputation.key' => 'test-key']);

        Http::fake(['ipapi.co/*' => Http::response([
            'city' => 'N/A',
            'region' => 'Unknown',
            'postal' => '',
            'country_code' => 'XX',
            'latitude' => 0,
            'longitude' => 0,
        ])]);

        // Every field is a provider's way of saying "I don't know", so the row
        // must read as unresolved rather than as a place in the Atlantic.
        $this->assertNull(IpLocation::lookup('203.0.113.9'));
    }

    public function test_location_reaches_administrators_only(): void
    {
        $log = ActivityLogger::log([
            'actor' => $this->user(),
            'type' => 'security.login',
            'description' => 'Someone signed in',
            'ip' => '203.0.113.9',
            'location' => [
                'country' => 'CA', 'city' => 'Toronto', 'region' => 'Ontario',
                'postal' => 'M5H', 'latitude' => 43.6532, 'longitude' => -79.3832,
            ],
        ]);

        $admin = NotificationPresenter::activity($log->fresh(), true);
        $this->assertSame('Toronto, Ontario, CA', $admin['location']);
        $this->assertSame('M5H', $admin['postal']);
        $this->assertSame(43.6532, $admin['latitude']);

        // Where a colleague was is as personal as the address it came from,
        // so it is withheld from everyone the IP is withheld from.
        $other = NotificationPresenter::activity($log->fresh(), false);
        $this->assertNull($other['location']);
        $this->assertNull($other['postal']);
        $this->assertNull($other['latitude']);
    }

    public function test_an_ordinary_activity_row_costs_no_lookup(): void
    {
        config(['services.ip_reputation.driver' => 'ipapi', 'services.ip_reputation.key' => 'test-key']);
        Http::fake();

        // The trail records file downloads and edits by the hundred; resolving
        // a location for each would spend a lookup to learn the same office
        // address over and over.
        ActivityLogger::log([
            'actor' => $this->user(),
            'type' => 'file.downloaded',
            'description' => 'Someone downloaded a file',
            'ip' => '203.0.113.9',
        ]);

        Http::assertNothingSent();
    }
}
