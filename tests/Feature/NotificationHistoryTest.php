<?php

namespace Tests\Feature;

use App\Models\EmailDelivery;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Settings → Account and Reporting → Notification History.
 *
 * The page claims to list "all email messages that have been sent from the
 * portal", so what is worth pinning is that it tells the truth about mail that
 * did *not* get out — the portal's characteristic failure is a queued email
 * nobody notices — and that the date filter agrees with the reader's own day
 * rather than UTC's.
 */
class NotificationHistoryTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type = 'Administrator', string $email = 'admin@example.com', array $preferences = []): User
    {
        return User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'preferences' => $preferences,
        ]);
    }

    private function delivery(array $overrides = []): EmailDelivery
    {
        $delivery = EmailDelivery::create(array_merge([
            'recipient' => 'dana@example.com',
            'subject' => 'Your invitation to the portal',
            'template' => 'clientInvite',
            'status' => EmailDelivery::STATUS_SENT,
            'queued_at' => now(),
            'sent_at' => now(),
        ], $overrides));

        if (isset($overrides['created_at'])) {
            $delivery->forceFill(['created_at' => $overrides['created_at']])->saveQuietly();
        }

        return $delivery;
    }

    private function history(User $as, array $query = []): array
    {
        return $this->actingAs($as)
            ->getJson('/admin/notification-history'.($query ? '?'.http_build_query($query) : ''))
            ->assertOk()
            ->json();
    }

    public function test_the_history_is_closed_to_employees_and_clients(): void
    {
        foreach (['Employee', 'Client'] as $type) {
            $this->actingAs($this->user($type, mb_strtolower($type).'@example.com'))
                ->getJson('/admin/notification-history')
                ->assertForbidden();
        }
    }

    public function test_it_lists_real_deliveries_newest_first(): void
    {
        $admin = $this->user();

        $this->delivery(['subject' => 'Older', 'created_at' => now()->subDays(2)]);
        $this->delivery(['subject' => 'Newer']);

        $body = $this->history($admin);

        $this->assertSame(['Newer', 'Older'], collect($body['notifications'])->pluck('subject')->all());
        $this->assertSame(2, $body['total']);
        // The Postcards helper name is rendered for a table cell.
        $this->assertSame('Client invite', $body['notifications'][0]['template']);
    }

    public function test_mail_that_never_left_is_reported_as_such(): void
    {
        $admin = $this->user();

        $this->delivery(['subject' => 'Delivered one', 'status' => EmailDelivery::STATUS_SENT]);
        $this->delivery(['subject' => 'Stuck one', 'status' => EmailDelivery::STATUS_QUEUED, 'sent_at' => null]);
        $this->delivery([
            'subject' => 'Refused one',
            'status' => EmailDelivery::STATUS_FAILED,
            'sent_at' => null,
            'error' => 'Mailbox unavailable',
        ]);

        $body = $this->history($admin);

        $this->assertSame(1, $body['summary']['queued']);
        $this->assertSame(1, $body['summary']['failed']);
        $this->assertSame(3, $body['summary']['total']);

        $failed = collect($body['notifications'])->firstWhere('subject', 'Refused one');
        $this->assertTrue($failed['failed']);
        $this->assertSame('Mailbox unavailable', $failed['error']);

        // A bounce reads as a failure too, not as a separate silent state.
        $this->assertSame(
            ['Refused one'],
            collect($this->history($admin, ['status' => 'failed'])['notifications'])->pluck('subject')->all(),
        );
    }

    public function test_it_filters_by_recipient(): void
    {
        $admin = $this->user();

        $this->delivery(['recipient' => 'dana@example.com', 'subject' => 'For Dana']);
        $this->delivery(['recipient' => 'sam@example.com', 'subject' => 'For Sam']);

        $body = $this->history($admin, ['recipient' => 'sam@example.com']);

        $this->assertSame(['For Sam'], collect($body['notifications'])->pluck('subject')->all());
        // The filter's own list of addresses comes from the log.
        $this->assertSame(['dana@example.com', 'sam@example.com'], $body['recipients']);
    }

    public function test_the_date_filter_uses_the_readers_day_not_utc(): void
    {
        // Sydney is UTC+10/+11, so breakfast there is still *yesterday* in UTC.
        // Comparing stored dates to the picker's date string drops this email
        // off the day it was actually sent on.
        $admin = $this->user(preferences: ['timezone' => 'Australia/Sydney']);

        $sentAt = now()->setTimezone('Australia/Sydney')->setTime(8, 0)->utc();
        $sydneyDay = $sentAt->copy()->setTimezone('Australia/Sydney')->toDateString();

        // The premise of the test: the two calendars disagree about this instant.
        $this->assertNotSame($sentAt->toDateString(), $sydneyDay);

        $this->delivery(['subject' => 'Breakfast mail', 'created_at' => $sentAt, 'sent_at' => $sentAt]);

        $body = $this->history($admin, ['date' => $sydneyDay]);

        $this->assertSame(['Breakfast mail'], collect($body['notifications'])->pluck('subject')->all());
        // And the row is stamped with the reader's own date, not UTC's.
        $this->assertSame(
            $sentAt->copy()->setTimezone('Australia/Sydney')->format('j M Y'),
            $body['notifications'][0]['date'],
        );

        // Asking for the UTC day it was stored under finds nothing.
        $this->assertSame([], $this->history($admin, ['date' => $sentAt->toDateString()])['notifications']);
    }

    public function test_the_date_filter_excludes_other_days(): void
    {
        $admin = $this->user();

        $this->delivery(['subject' => 'Today']);
        $this->delivery(['subject' => 'Last week', 'created_at' => now()->subWeek()]);

        $body = $this->history($admin, ['date' => now()->toDateString()]);

        $this->assertSame(['Today'], collect($body['notifications'])->pluck('subject')->all());
    }

    public function test_a_long_history_pages(): void
    {
        $admin = $this->user();

        for ($i = 0; $i < 55; $i++) {
            $this->delivery(['subject' => 'Message '.$i, 'created_at' => now()->subMinutes($i)]);
        }

        $first = $this->history($admin);
        $this->assertCount(50, $first['notifications']);
        $this->assertSame(2, $first['pages']);
        $this->assertSame(55, $first['total']);

        $second = $this->history($admin, ['page' => 2]);
        $this->assertCount(5, $second['notifications']);
        $this->assertSame('Message 54', $second['notifications'][4]['subject']);
    }
}
