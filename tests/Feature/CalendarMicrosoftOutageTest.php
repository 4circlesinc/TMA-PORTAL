<?php

namespace Tests\Feature;

use App\Jobs\SyncProviderCalendar;
use App\Models\Calendar;
use App\Models\ConnectedAccount;
use App\Models\Notification;
use App\Models\User;
use App\Support\Calendar\Sync\CalendarSyncException;
use App\Support\Calendar\Sync\CalendarSynchronizer;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Sleep;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * "Calendar: Microsoft could not list events (HTTP 502)" in the bell, and
 * Outlook events missing from the portal. Graph's gateway giving up on a
 * page failed the calendar on the spot and backed it off for 20 minutes
 * doubling to a day; a page link Graph had stopped serving was asked for
 * again on every run, so the calendar never synced again.
 */
class CalendarMicrosoftOutageTest extends TestCase
{
    use RefreshDatabase;

    private const STALE_CURSOR = 'https://graph.microsoft.com/v1.0/me/calendars/cal-primary/calendarView/delta?$skiptoken=stale';

    private const NEW_DELTA = 'https://graph.microsoft.com/v1.0/me/calendars/cal-primary/calendarView/delta?$deltatoken=fresh';

    protected function setUp(): void
    {
        parent::setUp();

        Sleep::fake();
    }

    public function test_every_page_is_fetched_and_the_delta_link_is_kept(): void
    {
        [, $calendar] = $this->outlookCalendar();
        $next = 'https://graph.microsoft.com/v1.0/me/calendars/cal-primary/calendarView/delta?$skiptoken=page2';

        $this->fakeGraph(fn ($request) => str_contains(urldecode($request->url()), 'skiptoken=page2')
            ? Http::response(['value' => [$this->graphEvent('evt-2', 'Second page')], '@odata.deltaLink' => self::NEW_DELTA])
            : Http::response(['value' => [$this->graphEvent('evt-1', 'First page')], '@odata.nextLink' => $next]));

        $stats = (new CalendarSynchronizer($calendar))->run();

        $calendar->refresh();
        $this->assertSame(2, $stats['pulled'], 'The second page used to be dropped: Laravel read "@odata.nextLink" as a path.');
        $this->assertSame(self::NEW_DELTA, $calendar->sync_cursor);
        $this->assertNotNull($calendar->sync_round_started_at);
    }

    public function test_the_next_run_follows_the_delta_link_and_sees_deletions(): void
    {
        [, $calendar] = $this->outlookCalendar();
        $this->fakeGraph(fn () => Http::response(['value' => [$this->graphEvent('evt-1', 'Hearing')], '@odata.deltaLink' => self::NEW_DELTA]));
        (new CalendarSynchronizer($calendar))->run();

        $urls = [];
        $this->fakeGraph(function ($request) use (&$urls) {
            $urls[] = urldecode($request->url());

            return Http::response([
                'value' => [['id' => 'evt-1', '@removed' => ['reason' => 'deleted']]],
                '@odata.deltaLink' => self::NEW_DELTA.'2',
            ]);
        });

        $stats = (new CalendarSynchronizer($calendar->fresh()))->run();

        $this->assertSame([urldecode(self::NEW_DELTA)], $urls, 'Incremental: the kept link, not the whole window again.');
        $this->assertSame(1, $stats['deleted']);
        $this->assertDatabaseMissing('calendar_events', ['calendar_id' => $calendar->id, 'external_event_id' => 'evt-1', 'deleted_at' => null]);
        $this->assertSame(self::NEW_DELTA.'2', $calendar->fresh()->sync_cursor);
    }

    public function test_a_month_old_round_moves_its_range_on_after_the_changes_are_in(): void
    {
        $old = 'https://graph.microsoft.com/v1.0/me/calendars/cal-primary/calendarView/delta?$deltatoken=old';
        [, $calendar] = $this->outlookCalendar([
            'sync_cursor' => $old,
            'sync_round_started_at' => now()->subDays(31),
            'subscription_synced_at' => now()->subMinutes(10),
        ]);

        $urls = [];
        $this->fakeGraph(function ($request) use (&$urls) {
            $urls[] = $url = urldecode($request->url());

            return str_contains($url, 'deltatoken=old')
                ? Http::response(['value' => [], '@odata.deltaLink' => $url.'-next'])
                : Http::response(['value' => [$this->graphEvent('evt-far', 'Trial, seven months out')], '@odata.deltaLink' => self::NEW_DELTA]);
        });

        (new CalendarSynchronizer($calendar))->run();

        $calendar->refresh();
        $this->assertCount(2, $urls);
        $this->assertStringContainsString('deltatoken=old', $urls[0], 'Changes since the last run first.');
        $this->assertStringContainsString('endDateTime=', $urls[1], 'Then a new round over today\'s range.');
        $this->assertSame(self::NEW_DELTA, $calendar->sync_cursor);
        $this->assertTrue($calendar->sync_round_started_at->gt(now()->subMinute()));
        $this->assertDatabaseHas('calendar_events', ['calendar_id' => $calendar->id, 'external_event_id' => 'evt-far']);
    }

    public function test_a_recent_round_is_simply_followed(): void
    {
        $recent = 'https://graph.microsoft.com/v1.0/me/calendars/cal-primary/calendarView/delta?$deltatoken=recent';
        [, $calendar] = $this->outlookCalendar([
            'sync_cursor' => $recent,
            'sync_round_started_at' => now()->subDays(3),
        ]);

        $calls = 0;
        $this->fakeGraph(function () use (&$calls, $recent) {
            $calls++;

            return Http::response(['value' => [], '@odata.deltaLink' => $recent]);
        });

        (new CalendarSynchronizer($calendar))->run();

        $this->assertSame(1, $calls);
    }

    public function test_a_page_graph_could_not_serve_is_asked_again_smaller_and_lands(): void
    {
        [$user, $calendar] = $this->outlookCalendar();

        $prefers = [];
        $this->fakeGraph(function ($request) use (&$prefers) {
            $prefers[] = $request->header('Prefer')[0] ?? null;

            return count($prefers) === 1
                ? $this->badGateway()
                : Http::response(['value' => [$this->graphEvent('evt-1', 'Hearing')], '@odata.deltaLink' => self::NEW_DELTA]);
        });

        $stats = (new CalendarSynchronizer($calendar))->run();

        $this->assertSame(1, $stats['pulled']);
        $this->assertSame(['odata.maxpagesize=100', 'odata.maxpagesize=25'], $prefers);
        $this->assertSame('ok', $calendar->fresh()->subscription_status);
        $this->assertSame(0, Notification::where('user_id', $user->id)->where('type', 'calendar.sync_error')->count());
    }

    public function test_one_run_without_an_answer_keeps_the_calendar_as_it_was_and_asks_again_soon(): void
    {
        Queue::fake();
        [$user, $calendar] = $this->outlookCalendar([
            'subscription_status' => 'ok',
            'subscription_synced_at' => now()->subMinutes(10),
        ]);
        $this->fakeGraph(fn () => $this->badGateway());

        (new SyncProviderCalendar($calendar->id))->handle();

        $calendar->refresh();
        $this->assertSame('ok', $calendar->subscription_status);
        $this->assertNull($calendar->subscription_error);
        $this->assertSame(1, (int) $calendar->subscription_failures);
        $this->assertSame(0, Notification::where('user_id', $user->id)->where('type', 'calendar.sync_error')->count());

        Queue::assertPushed(SyncProviderCalendar::class, fn (SyncProviderCalendar $job) => $job->calendarId === $calendar->id
            && $job->delay !== null
            && CarbonImmutable::instance($job->delay)->gte(now()->addSeconds(90)));
    }

    public function test_the_third_run_in_a_row_without_an_answer_is_reported(): void
    {
        Queue::fake();
        [$user, $calendar] = $this->outlookCalendar(['subscription_failures' => 2]);
        $this->fakeGraph(fn () => $this->badGateway());

        (new SyncProviderCalendar($calendar->id))->handle();

        $calendar->refresh();
        $this->assertSame('error', $calendar->subscription_status);
        $this->assertStringContainsString('not answering (HTTP 502)', $calendar->subscription_error);
        $this->assertSame(1, Notification::where('user_id', $user->id)->where('type', 'calendar.sync_error')->count());
        Queue::assertNotPushed(SyncProviderCalendar::class);
    }

    public function test_a_page_link_graph_keeps_failing_on_is_dropped_for_a_fresh_pass(): void
    {
        [$user, $calendar] = $this->outlookCalendar([
            'sync_cursor' => self::STALE_CURSOR,
            'subscription_failures' => 2,
            'subscription_synced_at' => now()->subDays(2),
        ]);

        // Graph down for everything: the third miss is reported, and the
        // stored link is kept, because nothing fresh landed in its place.
        $this->fakeGraph(fn () => $this->badGateway());
        $this->runExpectingTransient($calendar);

        $calendar->refresh();
        $this->assertSame('error', $calendar->subscription_status);
        $this->assertSame(self::STALE_CURSOR, $calendar->sync_cursor);
        $unread = fn () => Notification::where('user_id', $user->id)->where('type', 'calendar.sync_error')->whereNull('read_at')->count();
        $this->assertSame(1, $unread());

        // Graph is back, but still will not serve that link: a fresh pass
        // brings the events in and replaces it.
        $this->fakeGraph(fn ($request) => str_contains(urldecode($request->url()), 'skiptoken=stale')
            ? $this->badGateway()
            : Http::response(['value' => [$this->graphEvent('evt-9', 'Filing deadline')], '@odata.deltaLink' => self::NEW_DELTA]));

        (new CalendarSynchronizer($calendar))->run();

        $calendar->refresh();
        $this->assertSame('ok', $calendar->subscription_status);
        $this->assertSame(0, (int) $calendar->subscription_failures);
        $this->assertSame(self::NEW_DELTA, $calendar->sync_cursor);
        $this->assertDatabaseHas('calendar_events', ['calendar_id' => $calendar->id, 'external_event_id' => 'evt-9']);
        $this->assertSame(0, $unread(), 'The "sync failed" notice is cleared once the calendar syncs.');
    }

    public function test_a_single_blip_on_a_good_link_keeps_the_link(): void
    {
        $good = 'https://graph.microsoft.com/v1.0/me/calendars/cal-primary/calendarView/delta?$deltatoken=good';
        [, $calendar] = $this->outlookCalendar(['sync_cursor' => $good]);

        $urls = [];
        $this->fakeGraph(function ($request) use (&$urls) {
            $urls[] = urldecode($request->url());

            return $this->badGateway();
        });

        $this->runExpectingTransient($calendar);

        $this->assertSame($good, $calendar->fresh()->sync_cursor);
        $this->assertNotEmpty($urls);
        foreach ($urls as $url) {
            $this->assertStringContainsString('deltatoken=good', $url, 'No fresh pass on the first miss.');
        }
    }

    public function test_no_answer_in_time_is_treated_like_a_502(): void
    {
        Queue::fake();
        [, $calendar] = $this->outlookCalendar(['subscription_status' => 'ok']);
        $this->fakeGraph(fn () => Http::failedConnection('cURL error 28: Operation timed out'));

        (new SyncProviderCalendar($calendar->id))->handle();

        $calendar->refresh();
        $this->assertSame('ok', $calendar->subscription_status);
        $this->assertNull($calendar->subscription_error);
        $this->assertSame(1, (int) $calendar->subscription_failures);
        Queue::assertPushed(SyncProviderCalendar::class);
    }

    public function test_a_calendar_failed_by_a_502_is_retried_by_the_sweep_not_a_day_later(): void
    {
        [, $calendar] = $this->outlookCalendar([
            'subscription_status' => 'error',
            'subscription_error' => 'Microsoft could not list events (HTTP 502)',
            'subscription_failures' => 8,
            'subscription_attempted_at' => now()->subMinutes(20),
        ]);

        $this->assertTrue($calendar->providerSyncIsDue());

        $calendar->forceFill(['subscription_attempted_at' => now()->subMinutes(5)])->save();
        $this->assertFalse($calendar->fresh()->providerSyncIsDue());
    }

    public function test_a_repull_asks_for_recent_months_not_the_whole_first_import(): void
    {
        [, $calendar] = $this->outlookCalendar([
            'sync_window_start' => now()->subMonths(12),
            'subscription_synced_at' => now()->subDay(),
        ]);

        $start = null;
        $this->fakeGraph(function ($request) use (&$start) {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
            $start = $query['startDateTime'] ?? null;

            return Http::response(['value' => [], '@odata.deltaLink' => self::NEW_DELTA]);
        });

        (new CalendarSynchronizer($calendar))->run();

        $this->assertNotNull($start);
        $this->assertEqualsWithDelta(
            now()->subMonths(3)->getTimestamp(),
            CarbonImmutable::parse($start)->getTimestamp(),
            120,
        );
    }

    public function test_waiting_for_another_calendar_on_the_mailbox_uses_no_attempts(): void
    {
        $job = new SyncProviderCalendar(1);

        // WithoutOverlapping releases a job whose lock is busy, and a release
        // counted against `$tries = 2`. Time bounds the waiting now; only
        // real exceptions are counted.
        $this->assertFalse(property_exists($job, 'tries'));
        $this->assertSame(2, $job->maxExceptions);
        $this->assertTrue(CarbonImmutable::instance($job->retryUntil())->gte(now()->addMinutes(25)));
    }

    public function test_transient_wording_is_recognised(): void
    {
        $this->assertTrue(CalendarSyncException::looksTransient('Microsoft could not list events (HTTP 502)'));
        $this->assertTrue(CalendarSyncException::looksTransient('Microsoft’s calendar service is not answering. This usually clears up within minutes.'));
        $this->assertFalse(CalendarSyncException::looksTransient('Microsoft could not list events (HTTP 400): Bad request'));
        $this->assertFalse(CalendarSyncException::looksTransient('Microsoft refused to list events, the connection may need reauthorising.'));
    }

    private function runExpectingTransient(Calendar $calendar): void
    {
        try {
            (new CalendarSynchronizer($calendar))->run();
            $this->fail('Expected the provider not answering to surface.');
        } catch (CalendarSyncException $e) {
            $this->assertTrue($e->transient);
        }
    }

    private function badGateway()
    {
        return Http::response(['error' => ['code' => 'UnknownError', 'message' => '']], 502);
    }

    private function fakeGraph(callable $graph): void
    {
        // A fresh factory per phase: Http::fake() adds to the earlier stubs,
        // and the first one that answers wins.
        Http::swap(new Factory);
        Http::fake(function ($request) use ($graph) {
            if (str_contains($request->url(), 'login.microsoftonline.com')) {
                return Http::response(['access_token' => 'access-token', 'expires_in' => 3600]);
            }

            return $graph($request);
        });
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array{0: User, 1: Calendar}
     */
    private function outlookCalendar(array $overrides = []): array
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $account = ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$user->id,
            'email' => 'outlook@example.com',
            'name' => $user->name,
            'token' => 'refresh-token',
            'scopes' => ['Calendars.ReadWrite'],
            'sync_calendar' => true,
        ]);

        $calendar = Calendar::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Calendar',
            'colour' => 'blue',
            'calendar_type' => Calendar::TYPE_PERSONAL,
            'owner_id' => $user->id,
            'created_by' => $user->id,
            'timezone' => 'UTC',
            'visibility' => 'private',
            'source' => Calendar::SOURCE_MICROSOFT,
            'connected_account_id' => $account->id,
            'external_id' => 'cal-primary',
            'sync_direction' => 'import',
            'remote_can_write' => true,
            'sync_window_start' => now()->subMonths(3),
        ]);

        if ($overrides) {
            $calendar->forceFill($overrides)->save();
        }

        return [$user, $calendar->fresh()];
    }

    /** @return array<string, mixed> */
    private function graphEvent(string $id, string $title): array
    {
        return [
            'id' => $id,
            '@odata.etag' => 'W/"etag-'.$id.'"',
            'subject' => $title,
            'bodyPreview' => '',
            'isAllDay' => false,
            'isCancelled' => false,
            'showAs' => 'busy',
            'start' => ['dateTime' => '2026-11-20T09:00:00.0000000', 'timeZone' => 'UTC'],
            'end' => ['dateTime' => '2026-11-20T09:30:00.0000000', 'timeZone' => 'UTC'],
        ];
    }
}
