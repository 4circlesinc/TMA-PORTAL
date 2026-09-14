<?php

namespace Tests\Feature;

use App\Jobs\SyncProviderCalendar;
use App\Models\Calendar;
use App\Models\ConnectedAccount;
use App\Models\Notification;
use App\Models\User;
use App\Support\Calendar\Sync\CalendarSynchronizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Graph 429s ("Application is over its MailboxConcurrency limit") used to
 * fail every connected Outlook calendar at once and page the user. The
 * provider must wait and retry; a still-hot mailbox must reschedule, not
 * record an error.
 */
class CalendarMicrosoftThrottleTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_429_listing_events_is_retried_and_the_page_lands(): void
    {
        [$user, $calendar] = $this->outlookCalendar();

        $calls = 0;

        Http::fake(function ($request) use (&$calls) {
            if (str_contains($request->url(), 'login.microsoftonline.com')) {
                return Http::response(['access_token' => 'access-token', 'expires_in' => 3600]);
            }

            $calls++;

            if ($calls === 1) {
                return Http::response(
                    ['error' => ['code' => 'ApplicationThrottled', 'message' => 'Application is over its MailboxConcurrency limit.']],
                    429,
                    ['Retry-After' => '0'],
                );
            }

            return Http::response([
                'value' => [$this->graphEvent('evt-1', 'Standup')],
                '@odata.deltaLink' => 'https://graph.microsoft.com/v1.0/me/calendars/cal/calendarView/delta?$deltatoken=next',
            ]);
        });

        $stats = (new CalendarSynchronizer($calendar))->run();

        $this->assertSame(1, $stats['pulled']);
        $this->assertGreaterThanOrEqual(2, $calls);
        $this->assertDatabaseHas('calendar_events', [
            'calendar_id' => $calendar->id,
            'external_event_id' => 'evt-1',
            'title' => 'Standup',
        ]);
        $this->assertSame('ok', $calendar->fresh()->subscription_status);
        $this->assertSame(0, Notification::where('type', 'calendar.sync_error')->count());
    }

    public function test_a_still_hot_mailbox_is_rescheduled_instead_of_failing(): void
    {
        Queue::fake();

        [$user, $calendar] = $this->outlookCalendar();

        Http::fake([
            'login.microsoftonline.com/*' => Http::response(['access_token' => 'access-token', 'expires_in' => 3600]),
            'graph.microsoft.com/*' => Http::response(
                ['error' => ['message' => 'Application is over its MailboxConcurrency limit.']],
                429,
                ['Retry-After' => '0'],
            ),
        ]);

        (new SyncProviderCalendar($calendar->id))->handle();

        $calendar->refresh();
        $this->assertSame('syncing', $calendar->subscription_status);
        $this->assertNull($calendar->subscription_error);
        $this->assertSame(0, (int) $calendar->subscription_failures);
        $this->assertSame(0, Notification::where('user_id', $user->id)->where('type', 'calendar.sync_error')->count());

        Queue::assertPushed(SyncProviderCalendar::class, fn (SyncProviderCalendar $j) => $j->calendarId === $calendar->id);
    }

    /** @return array{0: User, 1: Calendar} */
    private function outlookCalendar(): array
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

        return [$user, $calendar];
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
            'start' => ['dateTime' => '2026-09-14T09:00:00.0000000', 'timeZone' => 'UTC'],
            'end' => ['dateTime' => '2026-09-14T09:30:00.0000000', 'timeZone' => 'UTC'],
        ];
    }
}
