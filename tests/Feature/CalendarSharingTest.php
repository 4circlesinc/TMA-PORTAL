<?php

namespace Tests\Feature;

use App\Mail\CalendarEventNotice;
use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Models\CalendarEventAttendee;
use App\Models\CalendarMember;
use App\Models\CalendarSubscription;
use App\Models\Group;
use App\Models\GroupMember;
use App\Models\User;
use App\Support\Calendar\Availability;
use App\Support\Calendar\CalendarAccess;
use App\Support\Calendar\GroupMembership;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phase 2: groups, sharing a calendar with a group, event invitations and
 * responses, and free/busy availability.
 */
class CalendarSharingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Group membership is cached per request; tests share a process.
        GroupMembership::flush();
    }

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

    /* ── groups ──────────────────────────────────────────────── */

    public function test_an_administrator_can_create_a_group_and_becomes_its_manager(): void
    {
        $admin = $this->admin();
        $member = $this->user();

        $response = $this->actingAs($admin)->postJson('/portal/groups', [
            'name' => 'Marketing Team',
            'group_type' => 'team',
            'memberIds' => [$member->id],
        ]);

        $response->assertOk();
        $response->assertJsonPath('group.name', 'Marketing Team');
        $response->assertJsonPath('group.myRole', 'manager');
        // The creator plus the one member.
        $response->assertJsonPath('group.memberCount', 2);
    }

    public function test_a_non_administrator_cannot_create_or_delete_groups(): void
    {
        $staff = $this->user();

        $this->actingAs($staff)->postJson('/portal/groups', ['name' => 'Rogue'])->assertForbidden();

        $group = $this->makeGroup($this->admin());
        $this->actingAs($staff)->deleteJson("/portal/groups/{$group->uuid}")->assertForbidden();
    }

    public function test_clients_cannot_see_or_join_groups(): void
    {
        $admin = $this->admin();
        $group = $this->makeGroup($admin);
        $clientUser = $this->client();

        $this->actingAs($clientUser)->getJson('/portal/groups')->assertForbidden();

        // Adding one is silently skipped rather than accepted.
        $this->actingAs($admin)->postJson("/portal/groups/{$group->uuid}/members", [
            'memberIds' => [$clientUser->id],
        ])->assertOk();

        $this->assertDatabaseMissing('group_members', [
            'group_id' => $group->id, 'user_id' => $clientUser->id,
        ]);
    }

    public function test_the_last_manager_cannot_be_removed(): void
    {
        $admin = $this->admin();
        $group = $this->makeGroup($admin);

        $this->actingAs($admin)
            ->deleteJson("/portal/groups/{$group->uuid}/members/{$admin->id}")
            ->assertStatus(422);
    }

    public function test_an_auto_join_group_contains_every_staff_member(): void
    {
        $admin = $this->admin();
        $group = $this->makeGroup($admin, ['name' => 'General Staff', 'auto_join' => true]);

        $newJoiner = $this->user();
        $clientUser = $this->client();

        GroupMembership::flush();
        $members = GroupMembership::usersIn($group);

        $this->assertTrue($members->contains('id', $newJoiner->id));
        $this->assertFalse($members->contains('id', $clientUser->id));
    }

    /* ── sharing a calendar with a group ─────────────────────── */

    public function test_a_group_grant_gives_every_member_access(): void
    {
        $owner = $this->user();
        $member = $this->user();
        $outsider = $this->user();

        $group = $this->makeGroup($owner);
        GroupMember::create(['group_id' => $group->id, 'user_id' => $member->id, 'role' => 'member']);

        $calendar = $this->makeCalendar($owner, ['visibility' => 'private']);

        $this->actingAs($owner)->postJson("/portal/calendar/calendars/{$calendar->uuid}/members", [
            'groupId' => $group->uuid,
            'role' => 'editor',
        ])->assertOk();

        GroupMembership::flush();
        $this->assertSame('editor', CalendarAccess::role($member->fresh(), $calendar));
        $this->assertNull(CalendarAccess::role($outsider->fresh(), $calendar));
    }

    public function test_a_direct_grant_wins_over_a_weaker_group_grant(): void
    {
        $owner = $this->user();
        $member = $this->user();

        $group = $this->makeGroup($owner);
        GroupMember::create(['group_id' => $group->id, 'user_id' => $member->id, 'role' => 'member']);

        $calendar = $this->makeCalendar($owner, ['visibility' => 'private']);

        CalendarMember::create([
            'calendar_id' => $calendar->id, 'member_type' => 'group',
            'group_id' => $group->id, 'role' => 'availability',
        ]);
        CalendarMember::create([
            'calendar_id' => $calendar->id, 'member_type' => 'user',
            'user_id' => $member->id, 'role' => 'editor',
        ]);

        GroupMembership::flush();
        $this->assertSame('editor', CalendarAccess::role($member->fresh(), $calendar));
    }

    public function test_the_strongest_of_two_group_grants_applies(): void
    {
        $owner = $this->user();
        $member = $this->user();

        $weak = $this->makeGroup($owner, ['name' => 'Weak']);
        $strong = $this->makeGroup($owner, ['name' => 'Strong']);
        GroupMember::create(['group_id' => $weak->id, 'user_id' => $member->id, 'role' => 'member']);
        GroupMember::create(['group_id' => $strong->id, 'user_id' => $member->id, 'role' => 'member']);

        $calendar = $this->makeCalendar($owner, ['visibility' => 'private']);
        CalendarMember::create(['calendar_id' => $calendar->id, 'member_type' => 'group',
            'group_id' => $weak->id, 'role' => 'titles']);
        CalendarMember::create(['calendar_id' => $calendar->id, 'member_type' => 'group',
            'group_id' => $strong->id, 'role' => 'manager']);

        GroupMembership::flush();
        $this->assertSame('manager', CalendarAccess::role($member->fresh(), $calendar));
    }

    public function test_revoking_a_group_drops_subscribers_who_had_no_other_route(): void
    {
        $owner = $this->user();
        $viaGroupOnly = $this->user();
        $alsoDirect = $this->user();

        $group = $this->makeGroup($owner);
        foreach ([$viaGroupOnly, $alsoDirect] as $u) {
            GroupMember::create(['group_id' => $group->id, 'user_id' => $u->id, 'role' => 'member']);
        }

        $calendar = $this->makeCalendar($owner, ['visibility' => 'private']);
        CalendarMember::create(['calendar_id' => $calendar->id, 'member_type' => 'group',
            'group_id' => $group->id, 'role' => 'details']);
        CalendarMember::create(['calendar_id' => $calendar->id, 'member_type' => 'user',
            'user_id' => $alsoDirect->id, 'role' => 'details']);

        foreach ([$viaGroupOnly, $alsoDirect] as $u) {
            CalendarSubscription::create(['user_id' => $u->id, 'calendar_id' => $calendar->id, 'is_visible' => true]);
        }

        $this->actingAs($owner)
            ->deleteJson("/portal/calendar/calendars/{$calendar->uuid}/group-members/{$group->uuid}")
            ->assertOk();

        $this->assertDatabaseMissing('calendar_subscriptions', [
            'user_id' => $viaGroupOnly->id, 'calendar_id' => $calendar->id,
        ]);
        // Kept: they still hold a direct grant.
        $this->assertDatabaseHas('calendar_subscriptions', [
            'user_id' => $alsoDirect->id, 'calendar_id' => $calendar->id,
        ]);
    }

    public function test_sharing_needs_either_a_person_or_a_group_but_not_both(): void
    {
        $owner = $this->user();
        $calendar = $this->makeCalendar($owner);
        $group = $this->makeGroup($owner);

        $this->actingAs($owner)->postJson("/portal/calendar/calendars/{$calendar->uuid}/members", [
            'userId' => $this->user()->id,
            'groupId' => $group->uuid,
            'role' => 'details',
        ])->assertStatus(422);

        $this->actingAs($owner)->postJson("/portal/calendar/calendars/{$calendar->uuid}/members", [
            'role' => 'details',
        ])->assertStatus(422);
    }

    /* ── invitations and responses ───────────────────────────── */

    public function test_inviting_people_and_groups_emails_only_the_new_ones(): void
    {
        Mail::fake();

        $owner = $this->user();
        $invitee = $this->user();
        $groupMember = $this->user();

        $group = $this->makeGroup($owner);
        GroupMember::create(['group_id' => $group->id, 'user_id' => $groupMember->id, 'role' => 'member']);

        $calendar = $this->makeCalendar($owner);
        $event = $this->makeEvent($calendar, ['organizer_id' => $owner->id, 'created_by' => $owner->id]);

        $this->actingAs($owner)->postJson("/portal/calendar/events/{$event->uuid}/attendees", [
            'userIds' => [$invitee->id],
            'groupIds' => [$group->uuid],
        ])->assertOk();

        // The invitee, plus the group's member. The owner organizes it and the
        // group's manager is the owner, so they are not mailed.
        Mail::assertQueued(CalendarEventNotice::class, 2);

        // Re-inviting the same people sends nothing new.
        Mail::fake();
        $this->actingAs($owner)->postJson("/portal/calendar/events/{$event->uuid}/attendees", [
            'userIds' => [$invitee->id],
        ])->assertOk();

        Mail::assertNothingQueued();
    }

    public function test_someone_invited_twice_is_emailed_once(): void
    {
        Mail::fake();

        $owner = $this->user();
        $both = $this->user();

        $group = $this->makeGroup($owner);
        GroupMember::create(['group_id' => $group->id, 'user_id' => $both->id, 'role' => 'member']);

        $calendar = $this->makeCalendar($owner);
        $event = $this->makeEvent($calendar, ['organizer_id' => $owner->id, 'created_by' => $owner->id]);

        // Directly *and* through the group.
        $this->actingAs($owner)->postJson("/portal/calendar/events/{$event->uuid}/attendees", [
            'userIds' => [$both->id],
            'groupIds' => [$group->uuid],
        ])->assertOk();

        Mail::assertQueued(CalendarEventNotice::class, 1);
    }

    public function test_an_invited_email_that_matches_an_account_becomes_a_user_attendee(): void
    {
        Mail::fake();

        $owner = $this->user();
        $existing = $this->user(['email' => 'colleague@example.com']);
        $calendar = $this->makeCalendar($owner);
        $event = $this->makeEvent($calendar, ['organizer_id' => $owner->id, 'created_by' => $owner->id]);

        $this->actingAs($owner)->postJson("/portal/calendar/events/{$event->uuid}/attendees", [
            'emails' => ['colleague@example.com', 'outsider@elsewhere.com'],
        ])->assertOk();

        $this->assertDatabaseHas('calendar_event_attendees', [
            'event_id' => $event->id, 'user_id' => $existing->id, 'attendee_type' => 'user',
        ]);
        $this->assertDatabaseHas('calendar_event_attendees', [
            'event_id' => $event->id, 'email' => 'outsider@elsewhere.com', 'attendee_type' => 'email',
        ]);
    }

    public function test_an_invitee_can_respond_and_the_organizer_is_told(): void
    {
        Mail::fake();

        $owner = $this->user();
        $invitee = $this->user();
        $calendar = $this->makeCalendar($owner);
        $event = $this->makeEvent($calendar, ['organizer_id' => $owner->id, 'created_by' => $owner->id]);

        CalendarEventAttendee::create([
            'event_id' => $event->id, 'attendee_type' => 'user', 'user_id' => $invitee->id,
        ]);

        $this->actingAs($invitee)
            ->postJson("/portal/calendar/events/{$event->uuid}/respond", ['response' => 'accepted'])
            ->assertOk();

        $this->assertDatabaseHas('calendar_event_attendees', [
            'event_id' => $event->id, 'user_id' => $invitee->id, 'response' => 'accepted',
        ]);

        Mail::assertQueued(CalendarEventNotice::class, fn ($m) => $m->kind === CalendarEventNotice::KIND_RESPONSE);
    }

    public function test_responding_via_a_group_invitation_creates_a_personal_row(): void
    {
        Mail::fake();

        $owner = $this->user();
        $member = $this->user();
        $group = $this->makeGroup($owner);
        GroupMember::create(['group_id' => $group->id, 'user_id' => $member->id, 'role' => 'member']);

        $calendar = $this->makeCalendar($owner);
        $event = $this->makeEvent($calendar, ['organizer_id' => $owner->id, 'created_by' => $owner->id]);

        CalendarEventAttendee::create([
            'event_id' => $event->id, 'attendee_type' => 'group', 'group_id' => $group->id,
        ]);

        GroupMembership::flush();
        $this->actingAs($member)
            ->postJson("/portal/calendar/events/{$event->uuid}/respond", ['response' => 'tentative'])
            ->assertOk();

        $this->assertDatabaseHas('calendar_event_attendees', [
            'event_id' => $event->id, 'user_id' => $member->id, 'response' => 'tentative',
        ]);
        // The group stays on the guest list.
        $this->assertDatabaseHas('calendar_event_attendees', [
            'event_id' => $event->id, 'group_id' => $group->id,
        ]);
    }

    public function test_an_uninvited_person_cannot_respond(): void
    {
        $owner = $this->user();
        $calendar = $this->makeCalendar($owner);
        $event = $this->makeEvent($calendar, ['organizer_id' => $owner->id, 'created_by' => $owner->id]);

        $this->actingAs($this->user())
            ->postJson("/portal/calendar/events/{$event->uuid}/respond", ['response' => 'accepted'])
            ->assertForbidden();
    }

    public function test_a_meaningful_edit_notifies_attendees_but_a_note_change_does_not(): void
    {
        $owner = $this->user();
        $invitee = $this->user();
        $calendar = $this->makeCalendar($owner);
        $event = $this->makeEvent($calendar, ['organizer_id' => $owner->id, 'created_by' => $owner->id]);

        CalendarEventAttendee::create([
            'event_id' => $event->id, 'attendee_type' => 'user', 'user_id' => $invitee->id,
        ]);

        // Notes only — nobody needs to rearrange their day for this.
        Mail::fake();
        $this->actingAs($owner)
            ->patchJson("/portal/calendar/events/{$event->uuid}", ['description' => 'Agenda attached'])
            ->assertOk();
        Mail::assertNothingQueued();

        // Moving it is a different matter.
        Mail::fake();
        $this->actingAs($owner)->patchJson("/portal/calendar/events/{$event->uuid}", [
            'startsAt' => '2026-07-22T14:00:00+00:00',
            'endsAt' => '2026-07-22T15:00:00+00:00',
        ])->assertOk();

        Mail::assertQueued(CalendarEventNotice::class, fn ($m) => $m->kind === CalendarEventNotice::KIND_UPDATED);
    }

    /**
     * A retitled or relocated event must notify too. Worth its own test: the
     * "what changed" snapshot was originally taken *after* the new values had
     * already been assigned, so only time changes were ever detected.
     */
    public function test_renaming_or_moving_the_location_notifies_attendees(): void
    {
        $owner = $this->user();
        $invitee = $this->user();
        $calendar = $this->makeCalendar($owner);
        $event = $this->makeEvent($calendar, [
            'title' => 'Design feedback',
            'location' => 'Zoom',
            'organizer_id' => $owner->id,
            'created_by' => $owner->id,
        ]);

        CalendarEventAttendee::create([
            'event_id' => $event->id, 'attendee_type' => 'user', 'user_id' => $invitee->id,
        ]);

        Mail::fake();
        $this->actingAs($owner)
            ->patchJson("/portal/calendar/events/{$event->uuid}", ['title' => 'Design review'])
            ->assertOk();

        Mail::assertQueued(CalendarEventNotice::class, fn ($m) => $m->kind === CalendarEventNotice::KIND_UPDATED
            && collect($m->payload['changes'] ?? [])->contains(fn ($c) => str_contains($c, 'Design feedback')));

        Mail::fake();
        $this->actingAs($owner)
            ->patchJson("/portal/calendar/events/{$event->uuid}", ['location' => 'Boardroom 2'])
            ->assertOk();

        Mail::assertQueued(CalendarEventNotice::class, fn ($m) => collect($m->payload['changes'] ?? [])
            ->contains(fn ($c) => str_contains($c, 'Boardroom 2')));
    }

    public function test_deleting_an_event_tells_the_invitees(): void
    {
        Mail::fake();

        $owner = $this->user();
        $invitee = $this->user();
        $calendar = $this->makeCalendar($owner);
        $event = $this->makeEvent($calendar, ['organizer_id' => $owner->id, 'created_by' => $owner->id]);

        CalendarEventAttendee::create([
            'event_id' => $event->id, 'attendee_type' => 'user', 'user_id' => $invitee->id,
        ]);

        $this->actingAs($owner)->deleteJson("/portal/calendar/events/{$event->uuid}")->assertOk();

        Mail::assertQueued(CalendarEventNotice::class, fn ($m) => $m->kind === CalendarEventNotice::KIND_CANCELLED);
    }

    /* ── availability ────────────────────────────────────────── */

    public function test_availability_reports_busy_blocks_without_any_detail(): void
    {
        $viewer = $this->user();
        $subject = $this->user();

        $calendar = $this->makeCalendar($subject, [
            'visibility' => 'all_staff',
            'default_role' => 'availability',
        ]);
        $this->makeEvent($calendar, ['title' => 'Confidential board matter', 'location' => 'Boardroom']);

        $response = $this->actingAs($viewer)->getJson(
            '/portal/calendar/availability?from=2026-07-22T00:00:00%2B00:00&to=2026-07-23T00:00:00%2B00:00'
            ."&userIds[]={$subject->id}"
        );

        $response->assertOk();
        $person = $response->json('availability.0');

        $this->assertSame('busy', $person['status']);
        $this->assertCount(1, $person['blocks']);
        // The whole point: times only.
        $this->assertArrayNotHasKey('title', $person['blocks'][0]);
        $this->assertStringNotContainsString('Confidential', json_encode($person));
    }

    public function test_a_diary_the_viewer_cannot_see_reads_as_unknown_not_free(): void
    {
        $viewer = $this->user();
        $subject = $this->user();

        $calendar = $this->makeCalendar($subject, ['visibility' => 'private']);
        $this->makeEvent($calendar);

        $response = $this->actingAs($viewer)->getJson(
            '/portal/calendar/availability?from=2026-07-22T00:00:00%2B00:00&to=2026-07-23T00:00:00%2B00:00'
            ."&userIds[]={$subject->id}"
        );

        $response->assertOk();
        // "unknown" — saying "free" would invite scheduling straight over them.
        $response->assertJsonPath('availability.0.status', 'unknown');
        $response->assertJsonPath('availability.0.blocks', []);
    }

    public function test_overlapping_blocks_are_merged(): void
    {
        $viewer = $this->user();
        $subject = $this->user();

        $calendar = $this->makeCalendar($subject, [
            'visibility' => 'all_staff', 'default_role' => 'availability',
        ]);

        // Two overlapping meetings should read as one busy stretch.
        $this->makeEvent($calendar, [
            'starts_at' => '2026-07-22T09:00:00+00:00', 'ends_at' => '2026-07-22T10:00:00+00:00',
        ]);
        $this->makeEvent($calendar, [
            'starts_at' => '2026-07-22T09:30:00+00:00', 'ends_at' => '2026-07-22T11:00:00+00:00',
        ]);

        $result = Availability::forUser(
            $viewer,
            $subject,
            CarbonImmutable::parse('2026-07-22T00:00:00+00:00'),
            CarbonImmutable::parse('2026-07-23T00:00:00+00:00'),
        );

        $this->assertCount(1, $result['blocks']);
        $this->assertSame('2026-07-22T11:00:00+00:00', CarbonImmutable::parse($result['blocks'][0]['endsAt'])
            ->setTimezone('UTC')->toIso8601String());
    }

    public function test_find_a_time_returns_the_first_gap_everyone_shares(): void
    {
        $viewer = $this->user();
        $a = $this->user();
        $b = $this->user();

        foreach ([[$a, '09:00', '10:00'], [$b, '10:00', '11:00']] as [$person, $start, $end]) {
            $cal = $this->makeCalendar($person, [
                'visibility' => 'all_staff', 'default_role' => 'availability',
            ]);
            $this->makeEvent($cal, [
                'starts_at' => "2026-07-22T{$start}:00+00:00",
                'ends_at' => "2026-07-22T{$end}:00+00:00",
            ]);
        }

        $response = $this->actingAs($viewer)->getJson(
            '/portal/calendar/availability?from=2026-07-22T09:00:00%2B00:00&to=2026-07-22T17:00:00%2B00:00'
            ."&userIds[]={$a->id}&userIds[]={$b->id}&slotMinutes=60"
        );

        $response->assertOk();
        // Both are busy 09:00-11:00 between them, so 11:00 is the first slot.
        $this->assertSame(
            '2026-07-22T11:00:00+00:00',
            CarbonImmutable::parse($response->json('suggestion.startsAt'))->setTimezone('UTC')->toIso8601String()
        );
    }

    /* ── helpers ─────────────────────────────────────────────── */

    private function makeGroup(User $creator, array $overrides = []): Group
    {
        $group = Group::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'name' => 'Marketing Team',
            'group_type' => 'team',
            'created_by' => $creator->id,
        ], $overrides));

        if (! $group->auto_join) {
            GroupMember::create([
                'group_id' => $group->id,
                'user_id' => $creator->id,
                'role' => GroupMember::ROLE_MANAGER,
            ]);
        }

        return $group;
    }

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
}
