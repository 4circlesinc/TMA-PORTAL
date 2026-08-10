<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\UserPresence;
use App\Support\Presence\LastSeen;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * The one "last seen" phrasing, and the boundaries between its cases.
 *
 * The interesting ones are the seams: 59 seconds versus 61, and an event two
 * hours ago that happened to be on the other side of midnight — which is a
 * different sentence even though the elapsed time is the same.
 */
class LastSeenTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // A fixed Tuesday afternoon, so "Friday" and "yesterday" mean the same
        // thing on every machine that runs this.
        Carbon::setTestNow(Carbon::parse('2026-08-11 14:00:00', config('app.timezone')));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_recent_activity_reads_in_minutes_then_hours(): void
    {
        $this->assertSame('Last seen just now', LastSeen::label(now()->subSeconds(20)));
        $this->assertSame('Last seen just now', LastSeen::label(now()->subSeconds(59)));
        $this->assertSame('Last seen 1 minute ago', LastSeen::label(now()->subSeconds(61)));
        $this->assertSame('Last seen 5 minutes ago', LastSeen::label(now()->subMinutes(5)));
        $this->assertSame('Last seen 1 hour ago', LastSeen::label(now()->subHour()));
        $this->assertSame('Last seen 3 hours ago', LastSeen::label(now()->subHours(3)));
    }

    /**
     * Two hours before 01:00 is yesterday evening, not "2 hours ago".
     *
     * Elapsed time alone gets this wrong, and it is wrong in the way people
     * notice: a colleague who logged off at 11pm reading as "2 hours ago" at
     * 1am tells you nothing about which day they were last at their desk.
     */
    public function test_the_day_boundary_wins_over_elapsed_hours(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-08-11 01:00:00', config('app.timezone')));

        $this->assertSame(
            'Last seen yesterday at 11:00 PM',
            LastSeen::label(Carbon::parse('2026-08-10 23:00:00', config('app.timezone'))),
        );
    }

    public function test_this_week_reads_as_a_weekday_and_older_as_a_date(): void
    {
        // The Friday before the fixed "now" (Tuesday 11 Aug 2026).
        $this->assertSame(
            'Last seen Friday at 8:15 PM',
            LastSeen::label(Carbon::parse('2026-08-07 20:15:00', config('app.timezone'))),
        );

        // Past a week, a weekday name stops being an anchor.
        $this->assertSame(
            'Last seen August 2, 2026 at 8:15 PM',
            LastSeen::label(Carbon::parse('2026-08-02 20:15:00', config('app.timezone'))),
        );
    }

    /** No timestamp is "recently" — never "never", never blank. */
    public function test_an_absent_timestamp_is_recently(): void
    {
        $this->assertSame('Last seen recently', LastSeen::label(null));
        $this->assertSame('recently', LastSeen::relative(null));
        $this->assertNull(LastSeen::short(null));
    }

    /** A clock a little ahead of ours must not produce a negative sentence. */
    public function test_a_future_timestamp_reads_as_just_now(): void
    {
        $this->assertSame('Last seen just now', LastSeen::label(now()->addMinutes(2)));
    }

    public function test_the_short_form_fits_a_table_column(): void
    {
        $this->assertSame('Just now', LastSeen::short(now()->subSeconds(10)));
        $this->assertSame('7 min ago', LastSeen::short(now()->subMinutes(7)));
        $this->assertSame('2 hours ago', LastSeen::short(now()->subHours(2)));
        $this->assertSame('Yesterday', LastSeen::short(Carbon::parse('2026-08-10 09:00:00', config('app.timezone'))));
        $this->assertSame('Friday', LastSeen::short(Carbon::parse('2026-08-07 09:00:00', config('app.timezone'))));
        $this->assertSame('Aug 2, 2026', LastSeen::short(Carbon::parse('2026-08-02 09:00:00', config('app.timezone'))));
    }

    /**
     * The label is rendered on the *reader's* wall clock.
     *
     * The same instant is "yesterday" to one colleague and "today" to another,
     * which is exactly why this cannot be formatted once and broadcast.
     */
    public function test_the_label_follows_the_readers_time_zone(): void
    {
        $at = Carbon::parse('2026-08-11 02:00:00', 'UTC');
        Carbon::setTestNow(Carbon::parse('2026-08-11 12:00:00', 'UTC'));

        $inNewYork = User::factory()->create(['preferences' => ['timezone' => 'America/New_York']]);
        $inTokyo = User::factory()->create(['preferences' => ['timezone' => 'Asia/Tokyo']]);

        // 02:00 UTC is 22:00 the previous evening in New York…
        $this->assertSame('Last seen yesterday at 10:00 PM', LastSeen::label($at, $inNewYork));
        // …and 11:00 the same morning in Tokyo, an hour before "now" there.
        $this->assertSame('Last seen 10 hours ago', LastSeen::label($at, $inTokyo));
    }

    /**
     * An offline colleague's presence payload carries both the sentence and
     * the instant it was derived from, so the browser can keep it true.
     */
    public function test_the_staff_board_sends_a_label_and_the_instant_behind_it(): void
    {
        // `presence.view` is an administrator capability — an employee gets
        // `{staff: false}` and no board at all.
        $viewer = $this->approvedStaff(['account_type' => 'Administrator']);
        $other = $this->approvedStaff(['name' => 'Ada Byron']);

        UserPresence::create([
            'user_id' => $other->id,
            'last_seen_at' => now()->subMinutes(5),
            'online_until' => now()->subMinutes(4),
        ]);

        $res = $this->actingAs($viewer)->getJson('/portal/dashboard/staff')->assertOk();

        $row = collect($res->json('employees'))->firstWhere('id', $other->id);

        $this->assertFalse($row['online']);
        $this->assertSame('Last seen 5 minutes ago', $row['lastSeen']);
        $this->assertNotEmpty($row['lastSeenAt']);
    }

    private function approvedStaff(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }
}
