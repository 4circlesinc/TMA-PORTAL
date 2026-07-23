<?php

namespace Tests\Feature;

use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Models\CalendarSubscription;
use App\Models\User;
use App\Support\Calendar\GroupMembership;
use App\Support\Calendar\RecurrenceExpander;
use App\Support\Calendar\RecurrenceRule;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/**
 * Phase 3: recurring events — RRULE round-tripping, expansion across a window,
 * and the three edit/delete scopes.
 */
class CalendarRecurrenceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        GroupMembership::flush();
    }

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

    /* ── rule building and parsing ───────────────────────────── */

    public function test_a_rule_round_trips_through_build_and_parse(): void
    {
        $rule = RecurrenceRule::build([
            'freq' => 'WEEKLY', 'interval' => 2, 'byDay' => ['MO', 'WE'], 'count' => 10,
        ]);

        $this->assertSame('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10', $rule);

        $spec = RecurrenceRule::parse($rule);
        $this->assertSame('WEEKLY', $spec['freq']);
        $this->assertSame(2, $spec['interval']);
        $this->assertSame(['MO', 'WE'], $spec['byDay']);
        $this->assertSame(10, $spec['count']);
    }

    public function test_count_and_until_together_are_rejected(): void
    {
        // RFC 5545 forbids both; a rule carrying them is rejected by other
        // calendar clients, so it must never be built in the first place.
        $this->expectException(ValidationException::class);

        RecurrenceRule::build([
            'freq' => 'DAILY', 'count' => 5, 'until' => '2026-08-01T00:00:00+00:00',
        ]);
    }

    public function test_no_recurrence_yields_no_rule(): void
    {
        $this->assertNull(RecurrenceRule::build([]));
        $this->assertNull(RecurrenceRule::build(['freq' => 'NONE']));
    }

    public function test_weekdays_are_described_in_plain_language(): void
    {
        $rule = RecurrenceRule::build(['freq' => 'WEEKLY', 'byDay' => ['MO', 'TU', 'WE', 'TH', 'FR']]);
        $this->assertSame('Weekly on weekdays', RecurrenceRule::describe($rule));
    }

    /* ── expansion ───────────────────────────────────────────── */

    public function test_a_weekly_series_expands_across_the_window(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);

        $master = $this->makeEvent($calendar, [
            'starts_at' => '2026-07-06T09:00:00+00:00',
            'ends_at' => '2026-07-06T10:00:00+00:00',
            'recurrence_rule' => 'FREQ=WEEKLY',
        ]);

        $occurrences = RecurrenceExpander::expand(
            $master,
            CarbonImmutable::parse('2026-07-06T00:00:00+00:00'),
            CarbonImmutable::parse('2026-08-03T00:00:00+00:00'),
        );

        // 6, 13, 20, 27 July.
        $this->assertCount(4, $occurrences);
        $this->assertSame('2026-07-06T09:00:00+00:00',
            $occurrences[0]['startsAt']->utc()->toIso8601String());
        $this->assertSame('2026-07-27T09:00:00+00:00',
            $occurrences[3]['startsAt']->utc()->toIso8601String());
    }

    public function test_a_count_limited_series_stops_after_its_count(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);

        $master = $this->makeEvent($calendar, [
            'starts_at' => '2026-07-06T09:00:00+00:00',
            'ends_at' => '2026-07-06T10:00:00+00:00',
            'recurrence_rule' => 'FREQ=DAILY;COUNT=3',
        ]);

        $occurrences = RecurrenceExpander::expand(
            $master,
            CarbonImmutable::parse('2026-07-01T00:00:00+00:00'),
            CarbonImmutable::parse('2026-08-01T00:00:00+00:00'),
        );

        $this->assertCount(3, $occurrences);
    }

    /**
     * The reason the expander walks in the event's own zone rather than UTC:
     * a 09:00 local meeting must stay 09:00 local across a DST change, which
     * means its UTC instant shifts by an hour.
     */
    public function test_a_recurring_time_holds_local_clock_time_across_dst(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user, ['timezone' => 'Europe/London']);

        $master = $this->makeEvent($calendar, [
            // Late October, just before British Summer Time ends.
            'starts_at' => '2026-10-20T08:00:00+00:00', // 09:00 BST
            'ends_at' => '2026-10-20T09:00:00+00:00',
            'timezone' => 'Europe/London',
            'recurrence_rule' => 'FREQ=WEEKLY',
        ]);

        $occurrences = RecurrenceExpander::expand(
            $master,
            CarbonImmutable::parse('2026-10-19T00:00:00+00:00'),
            CarbonImmutable::parse('2026-11-10T00:00:00+00:00'),
        );

        foreach ($occurrences as $occurrence) {
            $this->assertSame(
                '09:00',
                $occurrence['startsAt']->setTimezone('Europe/London')->format('H:i'),
                'every occurrence should stay at 09:00 local',
            );
        }

        // …and the UTC instant really did move, which is the whole point.
        $utcHours = array_map(fn ($o) => $o['startsAt']->utc()->format('H:i'), $occurrences);
        $this->assertContains('08:00', $utcHours);
        $this->assertContains('09:00', $utcHours);
    }

    public function test_an_unparseable_rule_yields_nothing_instead_of_throwing(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);

        $master = $this->makeEvent($calendar, ['recurrence_rule' => 'FREQ=NONSENSE;;;']);

        // One broken event must not blank the whole grid.
        $this->assertSame([], RecurrenceExpander::expand(
            $master,
            CarbonImmutable::parse('2026-07-01T00:00:00+00:00'),
            CarbonImmutable::parse('2026-08-01T00:00:00+00:00'),
        ));
    }

    public function test_the_grid_returns_expanded_occurrences(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);
        CalendarSubscription::create([
            'user_id' => $user->id, 'calendar_id' => $calendar->id, 'is_visible' => true,
        ]);

        $this->makeEvent($calendar, [
            'title' => 'Weekly standup',
            'starts_at' => '2026-07-06T09:00:00+00:00',
            'ends_at' => '2026-07-06T09:30:00+00:00',
            'recurrence_rule' => 'FREQ=WEEKLY',
        ]);

        $events = $this->actingAs($user)->getJson(
            '/portal/calendar/events?from=2026-07-06T00:00:00%2B00:00&to=2026-07-27T00:00:00%2B00:00'
        )->json('events');

        // 6, 13, 20 July.
        $this->assertCount(3, $events);
        $this->assertTrue($events[0]['isOccurrence']);
        // Composite ids, so each instance is separately addressable.
        $this->assertStringContainsString('@', $events[0]['id']);
        $this->assertNotSame($events[0]['id'], $events[1]['id']);
    }

    /* ── editing scopes ──────────────────────────────────────── */

    public function test_editing_this_occurrence_only_detaches_it(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);
        CalendarSubscription::create([
            'user_id' => $user->id, 'calendar_id' => $calendar->id, 'is_visible' => true,
        ]);

        $master = $this->makeEvent($calendar, [
            'title' => 'Standup',
            'starts_at' => '2026-07-06T09:00:00+00:00',
            'ends_at' => '2026-07-06T09:30:00+00:00',
            'recurrence_rule' => 'FREQ=WEEKLY',
        ]);

        $second = RecurrenceExpander::occurrenceId(
            $master->uuid,
            CarbonImmutable::parse('2026-07-13T09:00:00+00:00')
        );

        $this->actingAs($user)->patchJson('/portal/calendar/events/'.urlencode($second), [
            'title' => 'Standup (moved room)',
            'scope' => 'this',
        ])->assertOk();

        // The series is intact; one instance now has a row of its own.
        $this->assertSame('Standup', $master->fresh()->title);
        $this->assertDatabaseHas('calendar_events', [
            'series_id' => $master->id, 'title' => 'Standup (moved room)',
        ]);

        $events = $this->actingAs($user)->getJson(
            '/portal/calendar/events?from=2026-07-06T00:00:00%2B00:00&to=2026-07-27T00:00:00%2B00:00'
        )->json('events');

        // Still three instances — the detached one replaces its occurrence
        // rather than appearing alongside it.
        $this->assertCount(3, $events);
        $titles = array_column($events, 'title');
        $this->assertContains('Standup (moved room)', $titles);
        $this->assertSame(2, count(array_filter($titles, fn ($t) => $t === 'Standup')));
    }

    public function test_editing_this_and_following_splits_the_series(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);
        CalendarSubscription::create([
            'user_id' => $user->id, 'calendar_id' => $calendar->id, 'is_visible' => true,
        ]);

        $master = $this->makeEvent($calendar, [
            'title' => 'Standup',
            'starts_at' => '2026-07-06T09:00:00+00:00',
            'ends_at' => '2026-07-06T09:30:00+00:00',
            'recurrence_rule' => 'FREQ=WEEKLY',
        ]);

        $third = RecurrenceExpander::occurrenceId(
            $master->uuid,
            CarbonImmutable::parse('2026-07-20T09:00:00+00:00')
        );

        $this->actingAs($user)->patchJson('/portal/calendar/events/'.urlencode($third), [
            'title' => 'Standup (new format)',
            'scope' => 'following',
        ])->assertOk();

        $events = $this->actingAs($user)->getJson(
            '/portal/calendar/events?from=2026-07-06T00:00:00%2B00:00&to=2026-08-10T00:00:00%2B00:00'
        )->json('events');

        $titles = array_column($events, 'title');

        // 6 and 13 keep the old name; 20 July onwards take the new one, and
        // nothing is duplicated at the split.
        $this->assertSame(2, count(array_filter($titles, fn ($t) => $t === 'Standup')));
        $this->assertGreaterThanOrEqual(2, count(array_filter($titles, fn ($t) => $t === 'Standup (new format)')));

        $starts = array_column($events, 'startsAt');
        $this->assertSame(count($starts), count(array_unique($starts)), 'no duplicate occurrence at the split');
    }

    public function test_a_split_series_keeps_the_original_total_count(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);
        CalendarSubscription::create([
            'user_id' => $user->id, 'calendar_id' => $calendar->id, 'is_visible' => true,
        ]);

        // Exactly five daily occurrences: 6-10 July.
        $master = $this->makeEvent($calendar, [
            'starts_at' => '2026-07-06T09:00:00+00:00',
            'ends_at' => '2026-07-06T09:30:00+00:00',
            'recurrence_rule' => 'FREQ=DAILY;COUNT=5',
        ]);

        $third = RecurrenceExpander::occurrenceId(
            $master->uuid,
            CarbonImmutable::parse('2026-07-08T09:00:00+00:00')
        );

        $this->actingAs($user)->patchJson('/portal/calendar/events/'.urlencode($third), [
            'location' => 'Room B',
            'scope' => 'following',
        ])->assertOk();

        $events = $this->actingAs($user)->getJson(
            '/portal/calendar/events?from=2026-07-01T00:00:00%2B00:00&to=2026-08-01T00:00:00%2B00:00'
        )->json('events');

        // Still five — a naive split would restart COUNT and produce seven.
        $this->assertCount(5, $events);
    }

    public function test_deleting_one_occurrence_leaves_the_rest(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);
        CalendarSubscription::create([
            'user_id' => $user->id, 'calendar_id' => $calendar->id, 'is_visible' => true,
        ]);

        $master = $this->makeEvent($calendar, [
            'starts_at' => '2026-07-06T09:00:00+00:00',
            'ends_at' => '2026-07-06T09:30:00+00:00',
            'recurrence_rule' => 'FREQ=WEEKLY',
        ]);

        $second = RecurrenceExpander::occurrenceId(
            $master->uuid,
            CarbonImmutable::parse('2026-07-13T09:00:00+00:00')
        );

        $this->actingAs($user)
            ->deleteJson('/portal/calendar/events/'.urlencode($second), ['scope' => 'this'])
            ->assertOk();

        $events = $this->actingAs($user)->getJson(
            '/portal/calendar/events?from=2026-07-06T00:00:00%2B00:00&to=2026-07-27T00:00:00%2B00:00'
        )->json('events');

        $this->assertCount(2, $events);
        $this->assertNotSoftDeleted('calendar_events', ['id' => $master->id]);
    }

    public function test_deleting_the_whole_series_removes_everything(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);
        CalendarSubscription::create([
            'user_id' => $user->id, 'calendar_id' => $calendar->id, 'is_visible' => true,
        ]);

        $master = $this->makeEvent($calendar, [
            'starts_at' => '2026-07-06T09:00:00+00:00',
            'ends_at' => '2026-07-06T09:30:00+00:00',
            'recurrence_rule' => 'FREQ=WEEKLY',
        ]);

        $this->actingAs($user)
            ->deleteJson("/portal/calendar/events/{$master->uuid}", ['scope' => 'all'])
            ->assertOk();

        $events = $this->actingAs($user)->getJson(
            '/portal/calendar/events?from=2026-07-06T00:00:00%2B00:00&to=2026-07-27T00:00:00%2B00:00'
        )->json('events');

        $this->assertSame([], $events);
        $this->assertSoftDeleted('calendar_events', ['id' => $master->id]);
    }

    /* ── helpers ─────────────────────────────────────────────── */

    private function makeCalendar(User $owner, array $overrides = []): Calendar
    {
        return Calendar::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'name' => 'Team',
            'colour' => 'blue',
            'calendar_type' => Calendar::TYPE_SHARED,
            'owner_id' => $owner->id,
            'timezone' => 'UTC',
            'visibility' => 'private',
            'default_role' => 'details',
            'source' => Calendar::SOURCE_LOCAL,
            'created_by' => $owner->id,
        ], $overrides));
    }

    private function makeEvent(Calendar $calendar, array $overrides = []): CalendarEvent
    {
        return CalendarEvent::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'calendar_id' => $calendar->id,
            'title' => 'Standup',
            'starts_at' => '2026-07-06T09:00:00+00:00',
            'ends_at' => '2026-07-06T09:30:00+00:00',
            'timezone' => 'UTC',
            'status' => CalendarEvent::STATUS_CONFIRMED,
            'visibility' => 'default',
            'organizer_id' => $calendar->owner_id,
            'created_by' => $calendar->owner_id,
        ], $overrides));
    }
}
