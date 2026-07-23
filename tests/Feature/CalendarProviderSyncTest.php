<?php

namespace Tests\Feature;

use App\Jobs\SyncProviderCalendar;
use App\Models\Calendar;
use App\Models\CalendarAuditEvent;
use App\Models\CalendarEvent;
use App\Models\ConnectedAccount;
use App\Models\User;
use App\Support\Calendar\CalendarAudit;
use App\Support\Calendar\GroupMembership;
use App\Support\Calendar\Sync\CalendarProvider;
use App\Support\Calendar\Sync\CalendarSyncException;
use App\Support\Calendar\Sync\CalendarSynchronizer;
use App\Support\Calendar\Sync\ProviderFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phase 4: Google/Microsoft two-way sync, conflict handling and audit.
 *
 * The provider HTTP is never hit — a fake CalendarProvider is swapped in via
 * ProviderFactory::fake(), so the synchronizer's own logic (dedupe by external
 * id, direction, conflict detection, deletion) is what's under test.
 */
class CalendarProviderSyncTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        GroupMembership::flush();
    }

    protected function tearDown(): void
    {
        ProviderFactory::clearFake();
        parent::tearDown();
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

    /* ── pulling ─────────────────────────────────────────────── */

    public function test_a_pull_imports_remote_events(): void
    {
        [$user, $calendar] = $this->connectedCalendar();

        $this->fakeProvider(new FakeCalendarProvider([
            $this->remote('g-1', 'Board meeting', '2026-07-22T09:00:00+00:00', '2026-07-22T10:00:00+00:00'),
            $this->remote('g-2', 'Design review', '2026-07-23T14:00:00+00:00', '2026-07-23T15:00:00+00:00'),
        ]));

        $stats = (new CalendarSynchronizer($calendar))->run();

        $this->assertSame(2, $stats['pulled']);
        $this->assertDatabaseHas('calendar_events', [
            'calendar_id' => $calendar->id, 'external_event_id' => 'g-1', 'title' => 'Board meeting',
        ]);
    }

    public function test_a_second_pull_does_not_duplicate_unchanged_events(): void
    {
        [$user, $calendar] = $this->connectedCalendar();

        $remote = $this->remote('g-1', 'Standup', '2026-07-22T09:00:00+00:00', '2026-07-22T09:30:00+00:00');

        $this->fakeProvider(new FakeCalendarProvider([$remote]));
        (new CalendarSynchronizer($calendar))->run();

        // Same event, same etag, second run.
        $this->fakeProvider(new FakeCalendarProvider([$remote]));
        $stats = (new CalendarSynchronizer($calendar->fresh()))->run();

        $this->assertSame(0, $stats['pulled']);
        $this->assertSame(1, CalendarEvent::where('calendar_id', $calendar->id)->count());
    }

    public function test_an_expired_cursor_triggers_a_full_resync_without_duplicating(): void
    {
        [$user, $calendar] = $this->connectedCalendar();
        $calendar->forceFill(['sync_cursor' => 'stale-token'])->save();

        $remote = $this->remote('g-1', 'Recurring sync', '2026-07-22T09:00:00+00:00', '2026-07-22T09:30:00+00:00');

        // First call (with the stale cursor) throws expired; the retry with a
        // null cursor returns the event.
        $provider = new FakeCalendarProvider([$remote]);
        $provider->expireCursorOnce = true;
        $this->fakeProvider($provider);

        $stats = (new CalendarSynchronizer($calendar))->run();

        $this->assertSame(1, $stats['pulled']);
        $this->assertSame(1, CalendarEvent::where('calendar_id', $calendar->id)->count());
    }

    public function test_a_remote_deletion_removes_the_local_event(): void
    {
        [$user, $calendar] = $this->connectedCalendar();

        $this->fakeProvider(new FakeCalendarProvider([
            $this->remote('g-1', 'Doomed', '2026-07-22T09:00:00+00:00', '2026-07-22T10:00:00+00:00'),
        ]));
        (new CalendarSynchronizer($calendar))->run();
        $this->assertSame(1, CalendarEvent::where('calendar_id', $calendar->id)->count());

        $provider = new FakeCalendarProvider([]);
        $provider->deleted = ['g-1'];
        $this->fakeProvider($provider);

        $stats = (new CalendarSynchronizer($calendar->fresh()))->run();
        $this->assertSame(1, $stats['deleted']);
        $this->assertSame(0, CalendarEvent::where('calendar_id', $calendar->id)->count());
    }

    public function test_an_import_only_calendar_never_pushes(): void
    {
        [$user, $calendar] = $this->connectedCalendar(['sync_direction' => 'import']);
        $this->localEvent($calendar, 'Local only');

        $provider = new FakeCalendarProvider([]);
        $this->fakeProvider($provider);

        $stats = (new CalendarSynchronizer($calendar))->run();

        $this->assertSame(0, $stats['pushed']);
        $this->assertSame([], $provider->created);
    }

    /* ── pushing ─────────────────────────────────────────────── */

    public function test_a_new_local_event_is_pushed_to_the_provider(): void
    {
        [$user, $calendar] = $this->connectedCalendar(['sync_direction' => 'two_way']);
        $event = $this->localEvent($calendar, 'Push me');

        $provider = new FakeCalendarProvider([]);
        $this->fakeProvider($provider);

        $stats = (new CalendarSynchronizer($calendar))->run();

        $this->assertSame(1, $stats['pushed']);
        $this->assertCount(1, $provider->created);
        $this->assertSame('Push me', $provider->created[0]['event']['title']);

        // The event now carries its external identity, so it won't push again.
        $this->assertNotNull($event->fresh()->external_event_id);
    }

    public function test_an_export_only_calendar_does_not_pull(): void
    {
        [$user, $calendar] = $this->connectedCalendar(['sync_direction' => 'export']);

        $provider = new FakeCalendarProvider([
            $this->remote('g-1', 'Should not import', '2026-07-22T09:00:00+00:00', '2026-07-22T10:00:00+00:00'),
        ]);
        $this->fakeProvider($provider);

        $stats = (new CalendarSynchronizer($calendar))->run();

        $this->assertSame(0, $stats['pulled']);
        $this->assertSame(0, CalendarEvent::where('calendar_id', $calendar->id)->whereNotNull('external_event_id')->count());
    }

    /* ── conflicts ───────────────────────────────────────────── */

    public function test_a_two_sided_change_is_recorded_as_a_conflict_without_losing_the_local_version(): void
    {
        [$user, $calendar] = $this->connectedCalendar();

        // Pull an event in.
        $this->fakeProvider(new FakeCalendarProvider([
            $this->remote('g-1', 'Original', '2026-07-22T09:00:00+00:00', '2026-07-22T10:00:00+00:00', 'etag-1'),
        ]));
        (new CalendarSynchronizer($calendar))->run();

        // Change it locally.
        $event = CalendarEvent::where('external_event_id', 'g-1')->firstOrFail();
        $event->title = 'My local edit';
        $event->save();

        // The remote also changed (new etag, new content).
        $provider = new FakeCalendarProvider([
            $this->remote('g-1', 'Their remote edit', '2026-07-22T11:00:00+00:00', '2026-07-22T12:00:00+00:00', 'etag-2'),
        ]);
        $this->fakeProvider($provider);

        $stats = (new CalendarSynchronizer($calendar->fresh()))->run();

        $this->assertSame(1, $stats['conflicts']);

        $event->refresh();
        // Remote wins the live copy (most recent valid update).
        $this->assertSame('Their remote edit', $event->title);
        // But the local version is preserved, not lost.
        $this->assertNotNull($event->conflict_at);
        $this->assertSame('My local edit', $event->conflict_snapshot['title']);
    }

    public function test_a_conflict_can_be_resolved_by_keeping_the_local_version(): void
    {
        [$user, $calendar] = $this->connectedCalendar();

        $this->fakeProvider(new FakeCalendarProvider([
            $this->remote('g-1', 'Original', '2026-07-22T09:00:00+00:00', '2026-07-22T10:00:00+00:00', 'etag-1'),
        ]));
        (new CalendarSynchronizer($calendar))->run();

        $event = CalendarEvent::where('external_event_id', 'g-1')->firstOrFail();
        $event->title = 'Keep this one';
        $event->save();

        $this->fakeProvider(new FakeCalendarProvider([
            $this->remote('g-1', 'Overwritten', '2026-07-22T11:00:00+00:00', '2026-07-22T12:00:00+00:00', 'etag-2'),
        ]));
        (new CalendarSynchronizer($calendar->fresh()))->run();

        Queue::fake();

        // Resolve in favour of the local version.
        $this->actingAs($user)
            ->postJson("/portal/calendar/events/{$event->uuid}/resolve-conflict", ['keep' => 'yours'])
            ->assertOk();

        $event->refresh();
        $this->assertSame('Keep this one', $event->title);
        $this->assertNull($event->conflict_at);
        // A re-push is queued so the restored version reaches the provider.
        Queue::assertPushed(SyncProviderCalendar::class);
    }

    public function test_conflicts_are_listed_for_the_calendar(): void
    {
        [$user, $calendar] = $this->connectedCalendar();

        $event = $this->localEvent($calendar, 'Conflicted');
        $event->forceFill([
            'conflict_at' => now(),
            'conflict_snapshot' => ['title' => 'My version', 'startsAt' => '2026-07-22T09:00:00+00:00',
                'endsAt' => '2026-07-22T10:00:00+00:00'],
        ])->save();

        $response = $this->actingAs($user)->getJson("/portal/calendar/sync/{$calendar->uuid}/conflicts");

        $response->assertOk();
        $response->assertJsonPath('conflicts.0.yours.title', 'My version');
    }

    /* ── failures stay local ─────────────────────────────────── */

    public function test_a_sync_failure_is_recorded_on_the_calendar_not_thrown_to_the_page(): void
    {
        [$user, $calendar] = $this->connectedCalendar();

        $provider = new FakeCalendarProvider([]);
        $provider->failWith = 'Google is down';
        $this->fakeProvider($provider);

        // The job swallows the exception (already recorded on the row).
        SyncProviderCalendar::dispatchSync($calendar->id);

        $calendar->refresh();
        $this->assertSame('error', $calendar->subscription_status);
        $this->assertStringContainsString('Google is down', $calendar->subscription_error);
        $this->assertSame(1, $calendar->subscription_failures);
    }

    /* ── connect flow ────────────────────────────────────────── */

    public function test_connecting_a_provider_calendar_creates_a_mirror_and_queues_sync(): void
    {
        Queue::fake();

        $user = $this->user();
        $account = $this->account($user, ['https://www.googleapis.com/auth/calendar.events']);

        $response = $this->actingAs($user)->postJson("/portal/calendar/sync/accounts/{$account->id}/connect", [
            'externalId' => 'primary',
            'name' => 'My Google Calendar',
            'direction' => 'two_way',
        ]);

        $response->assertOk();
        $response->assertJsonPath('calendar.source', 'google');
        $response->assertJsonPath('calendar.section', 'connected');

        Queue::assertPushed(SyncProviderCalendar::class);
    }

    public function test_a_read_only_connection_is_forced_to_import_only(): void
    {
        Queue::fake();

        $user = $this->user();
        // Only the read scope granted.
        $account = $this->account($user, ['https://www.googleapis.com/auth/calendar.readonly']);

        $response = $this->actingAs($user)->postJson("/portal/calendar/sync/accounts/{$account->id}/connect", [
            'externalId' => 'primary',
            'name' => 'Read-only calendar',
            'direction' => 'two_way', // asked for two-way…
        ]);

        $response->assertOk();
        // …but downgraded, because the account cannot write.
        $this->assertSame('import', Calendar::where('external_id', 'primary')->value('sync_direction'));
    }

    public function test_switching_a_read_only_calendar_to_two_way_is_refused(): void
    {
        $user = $this->user();
        $account = $this->account($user, ['https://www.googleapis.com/auth/calendar.readonly']);
        [, $calendar] = $this->connectedCalendar(['sync_direction' => 'import'], $user, $account);

        $this->actingAs($user)
            ->putJson("/portal/calendar/sync/{$calendar->uuid}", ['direction' => 'two_way'])
            ->assertStatus(422);
    }

    public function test_disconnecting_keeps_the_events_as_a_local_calendar(): void
    {
        $user = $this->user();
        [, $calendar] = $this->connectedCalendar([], $user);
        $event = $this->localEvent($calendar, 'Survives disconnect');

        $this->actingAs($user)
            ->deleteJson("/portal/calendar/sync/{$calendar->uuid}")
            ->assertOk();

        $calendar->refresh();
        $this->assertSame('local', $calendar->source);
        $this->assertNull($calendar->connected_account_id);
        $this->assertNotSoftDeleted('calendar_events', ['id' => $event->id]);
    }

    /* ── audit ───────────────────────────────────────────────── */

    public function test_calendar_actions_are_recorded_in_the_audit_trail(): void
    {
        $user = $this->user();

        $create = $this->actingAs($user)->postJson('/portal/calendar/calendars', [
            'name' => 'Audited', 'colour' => 'blue', 'calendar_type' => 'shared',
        ]);
        $uuid = $create->json('calendar.id');

        $this->assertDatabaseHas('calendar_audit_events', [
            'action' => CalendarAudit::CALENDAR_CREATED, 'actor_id' => $user->id,
        ]);

        // Sharing is audited with who and what level.
        $colleague = $this->user();
        $this->actingAs($user)->postJson("/portal/calendar/calendars/{$uuid}/members", [
            'userId' => $colleague->id, 'role' => 'editor',
        ])->assertOk();

        $shared = CalendarAuditEvent::where('action', CalendarAudit::CALENDAR_SHARED)->first();
        $this->assertNotNull($shared);
        $this->assertSame('editor', $shared->context['role']);
    }

    public function test_the_history_endpoint_lists_recent_actions_for_managers_only(): void
    {
        $user = $this->user();
        [, $calendar] = $this->connectedCalendar([], $user);

        CalendarAudit::record(CalendarAudit::EVENT_CREATED, $user, $calendar);

        $this->actingAs($user)
            ->getJson("/portal/calendar/calendars/{$calendar->uuid}/history")
            ->assertOk()
            ->assertJsonStructure(['history' => [['action', 'label', 'actor', 'at']]]);

        // A plain viewer cannot read the history.
        $viewer = $this->user();
        $this->actingAs($viewer)
            ->getJson("/portal/calendar/calendars/{$calendar->uuid}/history")
            ->assertForbidden();
    }

    public function test_an_audit_row_survives_the_event_it_describes(): void
    {
        $user = $this->user();
        [, $calendar] = $this->connectedCalendar([], $user);
        $event = $this->localEvent($calendar, 'Fleeting');

        CalendarAudit::record(CalendarAudit::EVENT_DELETED, $user, $calendar, $event);
        $event->forceDelete();

        $row = CalendarAuditEvent::where('action', CalendarAudit::EVENT_DELETED)->firstOrFail();
        // Name is denormalised, so the line still reads.
        $this->assertSame('Fleeting', $row->event_title);
    }

    /* ── helpers ─────────────────────────────────────────────── */

    /**
     * @return array{0: User, 1: Calendar}
     */
    private function connectedCalendar(array $overrides = [], ?User $user = null, ?ConnectedAccount $account = null): array
    {
        $user ??= $this->user();
        $account ??= $this->account($user, ['https://www.googleapis.com/auth/calendar.events']);

        $calendar = Calendar::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'name' => 'Google Calendar',
            'colour' => 'blue',
            'calendar_type' => Calendar::TYPE_PERSONAL,
            'owner_id' => $user->id,
            'created_by' => $user->id,
            'timezone' => 'UTC',
            'visibility' => 'private',
            'source' => Calendar::SOURCE_GOOGLE,
            'connected_account_id' => $account->id,
            'external_id' => 'primary',
            'sync_direction' => 'two_way',
            'sync_window_start' => now()->subMonths(3),
        ], $overrides));

        return [$user, $calendar];
    }

    /**
     * @param  array<int, string>  $scopes
     */
    private function account(User $user, array $scopes): ConnectedAccount
    {
        return ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'google',
            'provider_id' => 'g-'.Str::random(8),
            'email' => 'sync@example.com',
            'name' => $user->name,
            'scopes' => $scopes,
            'sync_calendar' => true,
        ]);
    }

    private function localEvent(Calendar $calendar, string $title): CalendarEvent
    {
        return CalendarEvent::create([
            'uuid' => (string) Str::uuid(),
            'calendar_id' => $calendar->id,
            'title' => $title,
            'starts_at' => '2026-07-22T09:00:00+00:00',
            'ends_at' => '2026-07-22T10:00:00+00:00',
            'timezone' => 'UTC',
            'status' => CalendarEvent::STATUS_CONFIRMED,
            'visibility' => 'default',
            'organizer_id' => $calendar->owner_id,
            'created_by' => $calendar->owner_id,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function remote(string $id, string $title, string $start, string $end, string $etag = 'etag'): array
    {
        return [
            'externalId' => $id,
            'etag' => $etag,
            'title' => $title,
            'description' => null,
            'location' => null,
            'startsAt' => $start,
            'endsAt' => $end,
            'allDay' => false,
            'timezone' => 'UTC',
            'status' => 'confirmed',
            'recurrenceRule' => null,
            'recurrenceId' => null,
            'cancelled' => false,
            'meetingUrl' => null,
        ];
    }

    private function fakeProvider(FakeCalendarProvider $provider): void
    {
        ProviderFactory::fake(fn () => $provider);
    }
}

/**
 * A CalendarProvider that serves canned events and records what was pushed,
 * so the synchronizer can be tested without touching Google or Graph.
 */
class FakeCalendarProvider implements CalendarProvider
{
    public array $created = [];

    public array $updated = [];

    public array $deletedCalls = [];

    public array $deleted = [];

    public bool $expireCursorOnce = false;

    public ?string $failWith = null;

    private int $counter = 0;

    /**
     * @param  array<int, array<string, mixed>>  $events
     */
    public function __construct(private array $events = []) {}

    public static function for(ConnectedAccount $account): self
    {
        return new self;
    }

    public function listCalendars(): array
    {
        return [['id' => 'primary', 'name' => 'Primary', 'colour' => null, 'primary' => true, 'canWrite' => true]];
    }

    public function changedEvents(string $externalCalendarId, ?string $cursor, string $windowStart): array
    {
        if ($this->failWith) {
            throw new CalendarSyncException($this->failWith);
        }

        // Simulate an expired incremental token on the first attempt.
        if ($this->expireCursorOnce && $cursor !== null) {
            throw new CalendarSyncException('expired', cursorExpired: true);
        }

        return ['events' => $this->events, 'deleted' => $this->deleted, 'cursor' => 'next-token'];
    }

    public function createEvent(string $externalCalendarId, array $event): array
    {
        $id = 'created-'.(++$this->counter);
        $this->created[] = ['externalId' => $id, 'event' => $event];

        return ['externalId' => $id, 'etag' => 'etag-'.$id];
    }

    public function updateEvent(string $externalCalendarId, string $externalEventId, array $event, ?string $etag): array
    {
        $this->updated[] = ['externalId' => $externalEventId, 'event' => $event];

        return ['etag' => 'etag-updated'];
    }

    public function deleteEvent(string $externalCalendarId, string $externalEventId): void
    {
        $this->deletedCalls[] = $externalEventId;
    }
}
