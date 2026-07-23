<?php

namespace Tests\Feature;

use App\Jobs\RefreshIcsSubscription;
use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Models\User;
use App\Support\Calendar\GroupMembership;
use App\Support\Calendar\IcsException;
use App\Support\Calendar\IcsImporter;
use App\Support\Calendar\IcsReader;
use App\Support\Calendar\SubscriptionUrl;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phase 3: ICS export, import, and URL subscriptions.
 */
class CalendarIcsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
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

    /* ── export ──────────────────────────────────────────────── */

    public function test_a_calendar_exports_as_a_valid_ics_file(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user, ['name' => 'Team Calendar']);
        $this->makeEvent($calendar, ['title' => 'Requirements discussion', 'location' => 'Boardroom 2']);

        $response = $this->actingAs($user)->get("/portal/calendar/ics/{$calendar->uuid}/export");

        $response->assertOk();
        $response->assertHeader('Content-Type', 'text/calendar; charset=utf-8');

        $body = $response->getContent();

        $this->assertStringContainsString('BEGIN:VCALENDAR', $body);
        $this->assertStringContainsString('BEGIN:VEVENT', $body);
        $this->assertStringContainsString('SUMMARY:Requirements discussion', $body);
        $this->assertStringContainsString('LOCATION:Boardroom 2', $body);
        $this->assertStringContainsString('X-WR-CALNAME:Team Calendar', $body);

        // It must parse back cleanly — a file other clients would reject is
        // not an export.
        $parsed = IcsReader::parse($body);
        $this->assertCount(1, $parsed['events']);
        $this->assertSame('Requirements discussion', $parsed['events'][0]['title']);
    }

    public function test_a_recurring_event_exports_as_one_series_not_many_copies(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);
        $this->makeEvent($calendar, [
            'title' => 'Weekly standup',
            'recurrence_rule' => 'FREQ=WEEKLY;COUNT=52',
        ]);

        $body = $this->actingAs($user)
            ->get("/portal/calendar/ics/{$calendar->uuid}/export")
            ->getContent();

        // One VEVENT carrying the rule, not 52 separate events.
        $this->assertSame(1, substr_count($body, 'BEGIN:VEVENT'));
        $this->assertStringContainsString('RRULE:FREQ=WEEKLY;COUNT=52', $body);
    }

    public function test_availability_only_access_cannot_export(): void
    {
        $owner = $this->user();
        $viewer = $this->user();
        $calendar = $this->makeCalendar($owner, [
            'visibility' => 'all_staff', 'default_role' => 'availability',
        ]);
        $this->makeEvent($calendar);

        $this->actingAs($viewer)
            ->get("/portal/calendar/ics/{$calendar->uuid}/export")
            ->assertForbidden();
    }

    public function test_a_private_event_is_left_out_of_someone_elses_export(): void
    {
        $owner = $this->user();
        $viewer = $this->user();
        $calendar = $this->makeCalendar($owner, [
            'visibility' => 'all_staff', 'default_role' => 'details',
        ]);

        $this->makeEvent($calendar, ['title' => 'Public planning']);
        $this->makeEvent($calendar, [
            'title' => 'Confidential review',
            'visibility' => 'private',
            'organizer_id' => $owner->id,
            'created_by' => $owner->id,
        ]);

        $body = $this->actingAs($viewer)
            ->get("/portal/calendar/ics/{$calendar->uuid}/export")
            ->getContent();

        $this->assertStringContainsString('Public planning', $body);
        $this->assertStringNotContainsString('Confidential review', $body);
    }

    public function test_a_single_event_exports_on_its_own(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);
        $event = $this->makeEvent($calendar, ['title' => 'One-off meeting']);

        $body = $this->actingAs($user)
            ->get("/portal/calendar/ics/events/{$event->uuid}/export")
            ->assertOk()
            ->getContent();

        $this->assertSame(1, substr_count($body, 'BEGIN:VEVENT'));
        $this->assertStringContainsString('One-off meeting', $body);
    }

    /* ── import ──────────────────────────────────────────────── */

    public function test_preview_describes_the_file_without_writing_anything(): void
    {
        $user = $this->user();

        $response = $this->actingAs($user)->post('/portal/calendar/ics/preview', [
            'file' => UploadedFile::fake()->createWithContent('team.ics', $this->sampleIcs()),
        ]);

        $response->assertOk();
        $response->assertJsonPath('summary.total', 3);
        $response->assertJsonPath('summary.recurring', 1);
        $response->assertJsonPath('summary.allDay', 1);

        // Nothing stored yet.
        $this->assertSame(0, CalendarEvent::count());
    }

    public function test_importing_writes_the_events_and_reports_counts(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);

        $response = $this->actingAs($user)->post('/portal/calendar/ics/import', [
            'calendarId' => $calendar->uuid,
            'file' => UploadedFile::fake()->createWithContent('team.ics', $this->sampleIcs()),
        ]);

        $response->assertOk();
        $response->assertJsonPath('result.imported', 3);
        $response->assertJsonPath('result.failed', 0);

        $this->assertDatabaseHas('calendar_events', [
            'calendar_id' => $calendar->id, 'title' => 'Project kick off',
        ]);

        // The all-day event kept its flag, and the recurring one its rule.
        $this->assertDatabaseHas('calendar_events', ['title' => 'Company holiday', 'all_day' => true]);
        $this->assertNotNull(CalendarEvent::where('title', 'Weekly sync')->value('recurrence_rule'));
    }

    public function test_re_importing_the_same_file_skips_rather_than_duplicating(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);

        $payload = fn () => [
            'calendarId' => $calendar->uuid,
            'file' => UploadedFile::fake()->createWithContent('team.ics', $this->sampleIcs()),
        ];

        $this->actingAs($user)->post('/portal/calendar/ics/import', $payload())->assertOk();

        $second = $this->actingAs($user)->post('/portal/calendar/ics/import', $payload());
        $second->assertJsonPath('result.imported', 0);
        $second->assertJsonPath('result.skipped', 3);

        // Duplicate detection is by UID, so still three rows.
        $this->assertSame(3, CalendarEvent::where('calendar_id', $calendar->id)->count());
    }

    public function test_a_renamed_event_is_still_recognised_by_its_uid(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);

        $this->actingAs($user)->post('/portal/calendar/ics/import', [
            'calendarId' => $calendar->uuid,
            'file' => UploadedFile::fake()->createWithContent('a.ics', $this->sampleIcs()),
        ])->assertOk();

        // Same UID, different title — this is an update, not a new event.
        $renamed = str_replace('Project kick off', 'Project kickoff (renamed)', $this->sampleIcs());

        $response = $this->actingAs($user)->post('/portal/calendar/ics/import', [
            'calendarId' => $calendar->uuid,
            'onDuplicate' => 'update',
            'file' => UploadedFile::fake()->createWithContent('b.ics', $renamed),
        ]);

        $response->assertJsonPath('result.updated', 3);
        $this->assertSame(3, CalendarEvent::where('calendar_id', $calendar->id)->count());
        $this->assertDatabaseHas('calendar_events', ['title' => 'Project kickoff (renamed)']);
    }

    /**
     * The brief's rule: one broken event must not stop the valid ones.
     */
    public function test_a_broken_event_does_not_stop_the_rest_importing(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);

        // The middle event has no DTSTART at all.
        $ics = implode("\r\n", [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN',
            'BEGIN:VEVENT', 'UID:good-1', 'DTSTART:20260722T090000Z', 'DTEND:20260722T100000Z',
            'SUMMARY:Good one', 'END:VEVENT',
            'BEGIN:VEVENT', 'UID:broken-1', 'SUMMARY:No start date', 'END:VEVENT',
            'BEGIN:VEVENT', 'UID:good-2', 'DTSTART:20260723T090000Z', 'DTEND:20260723T100000Z',
            'SUMMARY:Good two', 'END:VEVENT',
            'END:VCALENDAR',
        ]);

        $response = $this->actingAs($user)->post('/portal/calendar/ics/import', [
            'calendarId' => $calendar->uuid,
            'file' => UploadedFile::fake()->createWithContent('mixed.ics', $ics),
        ]);

        $response->assertOk();
        $response->assertJsonPath('result.imported', 2);
        $response->assertJsonPath('result.failed', 1);

        $this->assertDatabaseHas('calendar_events', ['title' => 'Good one']);
        $this->assertDatabaseHas('calendar_events', ['title' => 'Good two']);
    }

    public function test_a_file_that_is_not_a_calendar_is_rejected_cleanly(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);

        $this->actingAs($user)->post('/portal/calendar/ics/import', [
            'calendarId' => $calendar->uuid,
            'file' => UploadedFile::fake()->createWithContent('notes.txt', 'just some text'),
        ])->assertStatus(422);
    }

    public function test_importing_needs_permission_on_the_destination(): void
    {
        $owner = $this->user();
        $outsider = $this->user();
        $calendar = $this->makeCalendar($owner, ['visibility' => 'private']);

        $this->actingAs($outsider)->post('/portal/calendar/ics/import', [
            'calendarId' => $calendar->uuid,
            'file' => UploadedFile::fake()->createWithContent('team.ics', $this->sampleIcs()),
        ])->assertForbidden();
    }

    public function test_only_selected_events_are_imported(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);

        $this->actingAs($user)->post('/portal/calendar/ics/import', [
            'calendarId' => $calendar->uuid,
            'keys' => ['kickoff-1@example.com'],
            'file' => UploadedFile::fake()->createWithContent('team.ics', $this->sampleIcs()),
        ])->assertJsonPath('result.imported', 1);

        $this->assertSame(1, CalendarEvent::where('calendar_id', $calendar->id)->count());
        $this->assertDatabaseHas('calendar_events', ['title' => 'Project kick off']);
    }

    /* ── round trip ──────────────────────────────────────────── */

    public function test_an_exported_calendar_re_imports_to_the_same_events(): void
    {
        $user = $this->user();
        $source = $this->makeCalendar($user, ['name' => 'Source']);
        $this->makeEvent($source, ['title' => 'Board meeting', 'location' => 'Room 1']);
        $this->makeEvent($source, [
            'title' => 'Weekly sync',
            'recurrence_rule' => 'FREQ=WEEKLY;COUNT=4',
        ]);
        $this->makeEvent($source, [
            'title' => 'Company holiday',
            'all_day' => true,
            'starts_at' => '2026-08-03T00:00:00+00:00',
            'ends_at' => '2026-08-04T00:00:00+00:00',
        ]);

        $body = $this->actingAs($user)->get("/portal/calendar/ics/{$source->uuid}/export")->getContent();

        $target = $this->makeCalendar($user, ['name' => 'Target']);

        $this->actingAs($user)->post('/portal/calendar/ics/import', [
            'calendarId' => $target->uuid,
            'file' => UploadedFile::fake()->createWithContent('round.ics', $body),
        ])->assertJsonPath('result.imported', 3);

        $imported = CalendarEvent::where('calendar_id', $target->id)->get()->keyBy('title');

        $this->assertSame('Room 1', $imported['Board meeting']->location);
        $this->assertSame('FREQ=WEEKLY;COUNT=4', $imported['Weekly sync']->recurrence_rule);
        $this->assertTrue((bool) $imported['Company holiday']->all_day);
    }

    /* ── subscriptions ───────────────────────────────────────── */

    public function test_subscribing_creates_a_calendar_and_queues_a_refresh(): void
    {
        Queue::fake();

        $user = $this->user();

        $response = $this->actingAs($user)->postJson('/portal/calendar/ics/subscribe', [
            'url' => 'https://example.com/team.ics',
            'name' => 'Public holidays',
            'colour' => 'teal',
            'frequency' => 1440,
        ]);

        $response->assertOk();
        $response->assertJsonPath('calendar.name', 'Public holidays');
        $response->assertJsonPath('calendar.source', 'ics_subscription');
        $response->assertJsonPath('calendar.section', 'imported');

        Queue::assertPushed(RefreshIcsSubscription::class);
    }

    /**
     * The SSRF guard. "Subscribe to this URL" is a server-side fetch of an
     * address an outsider chose, so private and reserved ranges — including
     * the cloud metadata endpoint — must be refused before any request runs.
     */
    public function test_a_subscription_url_pointing_inside_the_network_is_refused(): void
    {
        Queue::fake();

        $user = $this->user();

        foreach ([
            'http://127.0.0.1/team.ics',
            'http://localhost/team.ics',
            'http://169.254.169.254/latest/meta-data/',
            'http://10.0.0.5/internal.ics',
            'http://192.168.1.10/team.ics',
            'file:///etc/passwd',
        ] as $url) {
            $this->actingAs($user)
                ->postJson('/portal/calendar/ics/subscribe', ['url' => $url, 'name' => 'Sneaky'])
                ->assertStatus(422, "expected {$url} to be refused");
        }

        Queue::assertNothingPushed();
        $this->assertSame(0, Calendar::where('source', Calendar::SOURCE_ICS_SUBSCRIPTION)->count());
    }

    public function test_the_url_guard_accepts_a_normal_public_address(): void
    {
        // Uses a literal public IP so the test doesn't depend on DNS.
        $this->assertSame(
            'https://93.184.216.34/team.ics',
            SubscriptionUrl::validate('https://93.184.216.34/team.ics'),
        );

        // webcal:// is the conventional scheme and normalises to https.
        $this->assertSame(
            'https://93.184.216.34/team.ics',
            SubscriptionUrl::validate('webcal://93.184.216.34/team.ics'),
        );
    }

    public function test_the_url_guard_rejects_loopback_directly(): void
    {
        $this->expectException(IcsException::class);
        SubscriptionUrl::validate('http://127.0.0.1/x.ics');
    }

    public function test_a_manual_refresh_queues_the_job_and_clears_the_backoff(): void
    {
        Queue::fake();

        $user = $this->user();
        $calendar = $this->makeCalendar($user, [
            'source' => Calendar::SOURCE_ICS_SUBSCRIPTION,
            'subscription_url' => 'https://example.com/team.ics',
            'subscription_status' => 'error',
            'subscription_failures' => 4,
        ]);

        $this->actingAs($user)
            ->postJson("/portal/calendar/ics/{$calendar->uuid}/refresh")
            ->assertOk();

        Queue::assertPushed(RefreshIcsSubscription::class);
        $this->assertSame(0, $calendar->fresh()->subscription_failures);
    }

    public function test_a_subscription_can_be_disabled_without_losing_its_events(): void
    {
        Queue::fake();

        $user = $this->user();
        $calendar = $this->makeCalendar($user, [
            'source' => Calendar::SOURCE_ICS_SUBSCRIPTION,
            'subscription_url' => 'https://example.com/team.ics',
        ]);
        $event = $this->makeEvent($calendar);

        $this->actingAs($user)
            ->putJson("/portal/calendar/ics/{$calendar->uuid}/enabled", ['enabled' => false])
            ->assertOk();

        $this->assertSame('disabled', $calendar->fresh()->subscription_status);
        $this->assertNotSoftDeleted('calendar_events', ['id' => $event->id]);
    }

    public function test_refresh_rejects_a_calendar_that_is_not_a_subscription(): void
    {
        $user = $this->user();
        $calendar = $this->makeCalendar($user);

        $this->actingAs($user)
            ->postJson("/portal/calendar/ics/{$calendar->uuid}/refresh")
            ->assertStatus(422);
    }

    /* ── importer keying ─────────────────────────────────────── */

    public function test_events_without_a_uid_fall_back_to_a_content_signature(): void
    {
        $a = ['title' => 'Standup', 'startsAt' => '2026-07-22T09:00:00+00:00',
            'endsAt' => '2026-07-22T09:30:00+00:00', 'location' => 'Zoom', 'uid' => null];

        $this->assertStringStartsWith('sig:', IcsImporter::keyFor($a));

        // Stable for identical content…
        $this->assertSame(IcsImporter::keyFor($a), IcsImporter::keyFor($a));

        // …and different when any defining field differs. This is why a UID is
        // strongly preferred: renaming a UID-less event makes it look new.
        $renamed = array_merge($a, ['title' => 'Standup (renamed)']);
        $this->assertNotSame(IcsImporter::keyFor($a), IcsImporter::keyFor($renamed));

        $moved = array_merge($a, ['startsAt' => '2026-07-23T09:00:00+00:00']);
        $this->assertNotSame(IcsImporter::keyFor($a), IcsImporter::keyFor($moved));
    }

    /* ── helpers ─────────────────────────────────────────────── */

    private function sampleIcs(): string
    {
        return implode("\r\n", [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Example Corp//Calendar//EN',
            'X-WR-CALNAME:Imported team calendar',
            'BEGIN:VEVENT',
            'UID:kickoff-1@example.com',
            'DTSTART:20260722T140000Z',
            'DTEND:20260722T153000Z',
            'SUMMARY:Project kick off',
            'LOCATION:Conference Room B',
            'DESCRIPTION:Kick off the advisory portal redesign.',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:sync-1@example.com',
            'DTSTART:20260720T090000Z',
            'DTEND:20260720T093000Z',
            'SUMMARY:Weekly sync',
            'RRULE:FREQ=WEEKLY;COUNT=8',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:holiday-1@example.com',
            'DTSTART;VALUE=DATE:20260803',
            'DTEND;VALUE=DATE:20260804',
            'SUMMARY:Company holiday',
            'END:VEVENT',
            'END:VCALENDAR',
        ]);
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
