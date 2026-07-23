<?php

namespace Tests\Feature;

use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Models\CalendarMember;
use App\Models\CalendarSubscription;
use App\Models\User;
use App\Support\Calendar\CalendarAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class CalendarTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    private function admin(): User
    {
        return $this->user(['account_type' => 'Administrator']);
    }

    private function client(): User
    {
        return $this->user(['account_type' => 'Client']);
    }

    /* ── provisioning + the sidebar list ─────────────────────── */

    public function test_first_visit_provisions_an_undeletable_personal_calendar(): void
    {
        $user = $this->user();

        $response = $this->actingAs($user)->getJson('/portal/calendar/calendars');

        $response->assertOk();
        $calendars = $response->json('calendars');

        $this->assertCount(1, $calendars);
        $this->assertSame('Personal', $calendars[0]['name']);
        $this->assertSame('mine', $calendars[0]['section']);
        $this->assertSame('owner', $calendars[0]['role']);
        $this->assertTrue($calendars[0]['isSystem']);
        $this->assertFalse($calendars[0]['canDelete']);
        $this->assertTrue($calendars[0]['visible']);
    }

    public function test_provisioning_is_idempotent(): void
    {
        $user = $this->user();

        $this->actingAs($user)->getJson('/portal/calendar/calendars')->assertOk();
        $this->actingAs($user)->getJson('/portal/calendar/calendars')->assertOk();

        $this->assertSame(1, Calendar::where('owner_id', $user->id)->count());
        $this->assertSame(1, CalendarSubscription::where('user_id', $user->id)->count());
    }

    public function test_personal_calendar_cannot_be_deleted(): void
    {
        $user = $this->user();
        $this->actingAs($user)->getJson('/portal/calendar/calendars');
        $personal = Calendar::where('owner_id', $user->id)->firstOrFail();

        $this->actingAs($user)
            ->deleteJson("/portal/calendar/calendars/{$personal->uuid}")
            ->assertStatus(422);

        $this->assertNotSoftDeleted('calendars', ['id' => $personal->id]);
    }

    /* ── creating calendars ──────────────────────────────────── */

    public function test_staff_can_create_a_calendar(): void
    {
        $user = $this->user();

        $response = $this->actingAs($user)->postJson('/portal/calendar/calendars', [
            'name' => 'Marketing Team',
            'colour' => 'purple',
            'calendar_type' => 'group',
            'visibility' => 'all_staff',
            'default_role' => 'details',
        ]);

        $response->assertOk();
        $response->assertJsonPath('calendar.name', 'Marketing Team');
        $response->assertJsonPath('calendar.colour', 'purple');
        $response->assertJsonPath('calendar.role', 'owner');
        $response->assertJsonPath('calendar.section', 'mine');
        $this->assertTrue($response->json('calendar.canDelete'));
    }

    public function test_clients_cannot_create_calendars(): void
    {
        $this->actingAs($this->client())
            ->postJson('/portal/calendar/calendars', ['name' => 'Sneaky'])
            ->assertForbidden();
    }

    public function test_only_administrators_can_create_organization_calendars(): void
    {
        $this->actingAs($this->user())
            ->postJson('/portal/calendar/calendars', [
                'name' => 'Company Wide',
                'calendar_type' => 'organization',
            ])
            ->assertForbidden();

        $this->actingAs($this->admin())
            ->postJson('/portal/calendar/calendars', [
                'name' => 'Company Wide',
                'calendar_type' => 'organization',
            ])
            ->assertOk();
    }

    /* ── permissions ─────────────────────────────────────────── */

    public function test_a_colleagues_private_calendar_is_invisible_without_a_grant(): void
    {
        $owner = $this->user();
        $other = $this->user();

        $calendar = $this->makeCalendar($owner, ['visibility' => 'private']);

        $this->assertNull(CalendarAccess::role($other, $calendar));

        $this->actingAs($other)
            ->postJson("/portal/calendar/calendars/{$calendar->uuid}/subscribe")
            ->assertForbidden();
    }

    public function test_an_administrator_cannot_read_a_colleagues_personal_calendar(): void
    {
        $owner = $this->user();
        $admin = $this->admin();

        $personal = $this->makeCalendar($owner, [
            'calendar_type' => Calendar::TYPE_PERSONAL,
            'visibility' => 'private',
        ]);

        // Admins run org and group calendars, not private diaries.
        $this->assertNull(CalendarAccess::role($admin, $personal));
    }

    public function test_an_administrator_administers_group_calendars(): void
    {
        $owner = $this->user();
        $admin = $this->admin();

        $group = $this->makeCalendar($owner, [
            'calendar_type' => Calendar::TYPE_GROUP,
            'visibility' => 'private',
        ]);

        $this->assertSame('owner', CalendarAccess::role($admin, $group));
    }

    public function test_all_staff_visibility_reaches_staff_but_never_clients(): void
    {
        $owner = $this->user();
        $calendar = $this->makeCalendar($owner, [
            'calendar_type' => Calendar::TYPE_GROUP,
            'visibility' => 'all_staff',
            'default_role' => 'details',
        ]);

        $this->assertSame('details', CalendarAccess::role($this->user(), $calendar));
        $this->assertNull(CalendarAccess::role($this->client(), $calendar));
    }

    public function test_an_explicit_grant_beats_the_calendar_default(): void
    {
        $owner = $this->user();
        $member = $this->user();
        $calendar = $this->makeCalendar($owner, [
            'visibility' => 'all_staff',
            'default_role' => 'availability',
        ]);

        CalendarMember::create([
            'calendar_id' => $calendar->id,
            'member_type' => 'user',
            'user_id' => $member->id,
            'role' => 'editor',
        ]);

        $this->assertSame('editor', CalendarAccess::role($member, $calendar));
    }

    public function test_clients_cannot_be_added_to_internal_calendars(): void
    {
        $owner = $this->user();
        $calendar = $this->makeCalendar($owner);

        $this->actingAs($owner)
            ->postJson("/portal/calendar/calendars/{$calendar->uuid}/members", [
                'userId' => $this->client()->id,
                'role' => 'details',
            ])
            ->assertStatus(422);
    }

    /* ── show / hide, colour, and removing from the list ─────── */

    public function test_hiding_a_calendar_keeps_it_and_its_events(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);
        $this->subscribe($user, $calendar);
        $event = $this->makeEvent($calendar);

        $this->actingAs($user)
            ->putJson("/portal/calendar/calendars/{$calendar->uuid}/subscription", ['visible' => false])
            ->assertOk()
            ->assertJsonPath('calendar.visible', false);

        // Still owned, still subscribed, event intact — just not drawn.
        $this->assertDatabaseHas('calendars', ['id' => $calendar->id, 'deleted_at' => null]);
        $this->assertDatabaseHas('calendar_events', ['id' => $event->id, 'deleted_at' => null]);

        $events = $this->actingAs($user)->getJson($this->eventsUrl())->json('events');
        $this->assertSame([], $events);
    }

    public function test_removing_a_calendar_from_my_list_does_not_delete_it(): void
    {
        $owner = $this->user();
        $viewer = $this->user();
        $calendar = $this->makeCalendar($owner, ['visibility' => 'all_staff']);
        $this->subscribe($viewer, $calendar);

        $this->actingAs($viewer)
            ->deleteJson("/portal/calendar/calendars/{$calendar->uuid}/subscribe")
            ->assertOk();

        $this->assertDatabaseMissing('calendar_subscriptions', [
            'user_id' => $viewer->id, 'calendar_id' => $calendar->id,
        ]);
        $this->assertNotSoftDeleted('calendars', ['id' => $calendar->id]);
    }

    public function test_a_managers_colour_change_is_official_and_a_viewers_is_personal(): void
    {
        $owner = $this->user();
        $viewer = $this->user();
        $calendar = $this->makeCalendar($owner, ['colour' => 'blue', 'visibility' => 'all_staff']);
        $this->subscribe($owner, $calendar);
        $this->subscribe($viewer, $calendar);

        // The owner runs the calendar: their colour is the official one.
        $this->actingAs($owner)
            ->putJson("/portal/calendar/calendars/{$calendar->uuid}/subscription", ['colour' => 'purple'])
            ->assertOk()
            ->assertJsonPath('calendar.colour', 'purple');

        $this->assertSame('purple', $calendar->fresh()->colour);

        // A viewer only repaints their own sidebar.
        $this->actingAs($viewer)
            ->putJson("/portal/calendar/calendars/{$calendar->uuid}/subscription", ['colour' => 'blue'])
            ->assertOk()
            ->assertJsonPath('calendar.colour', 'blue');

        // …and the official colour is untouched by it.
        $this->assertSame('purple', $calendar->fresh()->colour);

        $seenByOwner = collect($this->actingAs($owner)
            ->getJson('/portal/calendar/calendars')
            ->json('calendars'))
            ->firstWhere('id', $calendar->uuid);

        $this->assertSame('purple', $seenByOwner['colour']);
    }

    /* ── events ──────────────────────────────────────────────── */

    public function test_creating_an_event_lands_on_the_personal_calendar_by_default(): void
    {
        $user = $this->user();

        $response = $this->actingAs($user)->postJson('/portal/calendar/events', [
            'title' => 'Requirements discussion',
            'startsAt' => '2026-07-23T10:30:00+02:00',
            'endsAt' => '2026-07-23T12:30:00+02:00',
            'timezone' => 'Africa/Johannesburg',
        ]);

        $response->assertOk();
        $response->assertJsonPath('event.title', 'Requirements discussion');
        $response->assertJsonPath('event.canEdit', true);

        $personal = Calendar::where('owner_id', $user->id)->where('is_system', true)->firstOrFail();
        $this->assertSame($personal->uuid, $response->json('event.calendarId'));
    }

    public function test_an_event_ending_before_it_starts_is_rejected(): void
    {
        $user = $this->user();

        $this->actingAs($user)->postJson('/portal/calendar/events', [
            'title' => 'Backwards',
            'startsAt' => '2026-07-23T12:00:00+02:00',
            'endsAt' => '2026-07-23T10:00:00+02:00',
        ])->assertStatus(422);
    }

    public function test_an_all_day_event_spans_midnight_to_midnight_in_its_own_zone(): void
    {
        $user = $this->user();

        $response = $this->actingAs($user)->postJson('/portal/calendar/events', [
            'title' => 'Drew birthday',
            'startsAt' => '2026-07-25T14:00:00+02:00',
            'endsAt' => '2026-07-25T15:00:00+02:00',
            'allDay' => true,
            'timezone' => 'Africa/Johannesburg',
        ]);

        $response->assertOk();
        $event = CalendarEvent::where('uuid', $response->json('event.id'))->firstOrFail();

        $this->assertTrue($event->all_day);
        $this->assertSame('00:00', $event->starts_at->setTimezone('Africa/Johannesburg')->format('H:i'));
        // End is exclusive: a one-day event runs to the next midnight.
        $this->assertSame('00:00', $event->ends_at->setTimezone('Africa/Johannesburg')->format('H:i'));
        $this->assertSame(1, (int) $event->starts_at->diffInDays($event->ends_at));
    }

    public function test_the_range_query_includes_events_overlapping_the_window(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);
        $this->subscribe($user, $calendar);

        // Starts before the window, ends inside it.
        $this->makeEvent($calendar, [
            'starts_at' => '2026-07-19T22:00:00+00:00',
            'ends_at' => '2026-07-20T02:00:00+00:00',
        ]);

        $events = $this->actingAs($user)
            ->getJson('/portal/calendar/events?from=2026-07-20T00:00:00%2B00:00&to=2026-07-27T00:00:00%2B00:00')
            ->json('events');

        $this->assertCount(1, $events);
    }

    public function test_an_availability_only_viewer_gets_a_busy_block_without_details(): void
    {
        $owner = $this->user();
        $viewer = $this->user();
        $calendar = $this->makeCalendar($owner, [
            'visibility' => 'all_staff',
            'default_role' => 'availability',
        ]);
        $this->subscribe($viewer, $calendar);
        $this->makeEvent($calendar, ['title' => 'Board strategy', 'location' => 'Boardroom 2']);

        $events = $this->actingAs($viewer)->getJson($this->eventsUrl())->json('events');

        $this->assertCount(1, $events);
        $this->assertSame('Busy', $events[0]['title']);
        $this->assertTrue($events[0]['private']);
        $this->assertArrayNotHasKey('location', $events[0]);
        $this->assertArrayNotHasKey('description', $events[0]);
    }

    public function test_a_private_event_hides_its_details_from_other_viewers(): void
    {
        $owner = $this->user();
        $viewer = $this->user();
        $calendar = $this->makeCalendar($owner, [
            'visibility' => 'all_staff',
            'default_role' => 'details',
        ]);
        $this->subscribe($viewer, $calendar);
        $this->makeEvent($calendar, [
            'title' => 'Doctor',
            'visibility' => 'private',
            'organizer_id' => $owner->id,
            'created_by' => $owner->id,
        ]);

        $events = $this->actingAs($viewer)->getJson($this->eventsUrl())->json('events');
        $this->assertSame('Busy', $events[0]['title']);

        // The organizer still sees their own.
        $this->subscribe($owner, $calendar);
        $own = $this->actingAs($owner)->getJson($this->eventsUrl())->json('events');
        $this->assertSame('Doctor', $own[0]['title']);
    }

    public function test_a_details_only_viewer_cannot_edit_or_delete_events(): void
    {
        $owner = $this->user();
        $viewer = $this->user();
        $calendar = $this->makeCalendar($owner, [
            'visibility' => 'all_staff',
            'default_role' => 'details',
        ]);
        $event = $this->makeEvent($calendar);

        $this->actingAs($viewer)
            ->patchJson("/portal/calendar/events/{$event->uuid}", ['title' => 'Hijacked'])
            ->assertForbidden();

        $this->actingAs($viewer)
            ->deleteJson("/portal/calendar/events/{$event->uuid}")
            ->assertForbidden();
    }

    public function test_a_contributor_may_edit_only_their_own_events(): void
    {
        $owner = $this->user();
        $contributor = $this->user();
        $calendar = $this->makeCalendar($owner, [
            'visibility' => 'all_staff',
            'default_role' => 'contributor',
        ]);

        $theirs = $this->makeEvent($calendar, ['created_by' => $contributor->id]);
        $someoneElses = $this->makeEvent($calendar, ['created_by' => $owner->id]);

        $this->actingAs($contributor)
            ->patchJson("/portal/calendar/events/{$theirs->uuid}", ['title' => 'Updated'])
            ->assertOk();

        $this->actingAs($contributor)
            ->patchJson("/portal/calendar/events/{$someoneElses->uuid}", ['title' => 'Nope'])
            ->assertForbidden();
    }

    public function test_moving_an_event_between_calendars_requires_access_to_both(): void
    {
        $user = $this->user();
        $source = $this->makeCalendar($user);
        $foreign = $this->makeCalendar($this->user(), ['visibility' => 'private']);
        $event = $this->makeEvent($source);

        $this->actingAs($user)
            ->patchJson("/portal/calendar/events/{$event->uuid}", ['calendarId' => $foreign->uuid])
            ->assertForbidden();
    }

    public function test_completing_an_event_toggles(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);
        $event = $this->makeEvent($calendar);

        $this->actingAs($user)
            ->postJson("/portal/calendar/events/{$event->uuid}/complete")
            ->assertOk()
            ->assertJsonPath('event.completed', true);

        $this->actingAs($user)
            ->postJson("/portal/calendar/events/{$event->uuid}/complete")
            ->assertOk()
            ->assertJsonPath('event.completed', false);
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
            'title' => 'Design feedback',
            'starts_at' => '2026-07-22T09:00:00+00:00',
            'ends_at' => '2026-07-22T10:00:00+00:00',
            'timezone' => 'UTC',
            'status' => CalendarEvent::STATUS_CONFIRMED,
            'visibility' => 'default',
            'organizer_id' => $calendar->owner_id,
            'created_by' => $calendar->owner_id,
        ], $overrides));
    }

    private function subscribe(User $user, Calendar $calendar): CalendarSubscription
    {
        return CalendarSubscription::create([
            'user_id' => $user->id,
            'calendar_id' => $calendar->id,
            'is_visible' => true,
        ]);
    }

    private function eventsUrl(): string
    {
        return '/portal/calendar/events?from=2026-07-20T00:00:00%2B00:00&to=2026-07-27T00:00:00%2B00:00';
    }
}
