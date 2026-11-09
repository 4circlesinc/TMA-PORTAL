<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Models\CalendarEventAttendee;
use App\Models\Client;
use App\Models\Notification;
use App\Models\User;
use App\Support\Calendar\Reminders;
use App\Support\Messaging\PresenceService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Personal reminders: a calendar entry tells its people when it is due, in
 * the portal and by email, once per occurrence, and opens the right place.
 */
class CalendarReminderTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    private function user(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    private function calendar(User $owner): Calendar
    {
        return Calendar::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Mine',
            'colour' => 'blue',
            'calendar_type' => Calendar::TYPE_SHARED,
            'owner_id' => $owner->id,
            'timezone' => 'UTC',
            'visibility' => 'private',
            'default_role' => 'details',
            'source' => Calendar::SOURCE_LOCAL,
            'created_by' => $owner->id,
        ]);
    }

    private function event(Calendar $calendar, array $overrides = []): CalendarEvent
    {
        return CalendarEvent::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'calendar_id' => $calendar->id,
            'title' => 'Call the bank about the escrow letter',
            'starts_at' => '2026-11-10T15:00:00+00:00',
            'ends_at' => '2026-11-10T15:15:00+00:00',
            'timezone' => 'UTC',
            'status' => CalendarEvent::STATUS_CONFIRMED,
            'visibility' => 'default',
            'organizer_id' => $calendar->owner_id,
            'created_by' => $calendar->owner_id,
            'reminder_minutes' => 15,
        ], $overrides));
    }

    public function test_a_reminder_goes_out_when_it_is_due_and_only_once(): void
    {
        $me = $this->user();
        $event = $this->event($this->calendar($me));

        // Too early.
        $this->assertSame(0, Reminders::sendDue(CarbonImmutable::parse('2026-11-10T14:40:00Z')));
        $this->assertSame(0, Notification::where('type', 'calendar.reminder')->count());

        // Fifteen minutes before.
        $this->assertSame(1, Reminders::sendDue(CarbonImmutable::parse('2026-11-10T14:45:00Z')));
        $note = Notification::where('type', 'calendar.reminder')->where('user_id', $me->id)->firstOrFail();
        $this->assertSame('Reminder: Call the bank about the escrow letter', $note->title);
        $this->assertStringContainsString('3:00 PM', (string) $note->message);
        $this->assertSame('/calendar?event='.$event->uuid, $note->action_url);

        // The next minute, and the one after: nothing new.
        $this->assertSame(0, Reminders::sendDue(CarbonImmutable::parse('2026-11-10T14:46:00Z')));
        $this->assertSame(0, Reminders::sendDue(CarbonImmutable::parse('2026-11-10T14:50:00Z')));
        $this->assertSame(1, Notification::where('type', 'calendar.reminder')->count());
    }

    /** Both routes: the email goes out even while the person is in the portal. */
    public function test_the_reminder_is_emailed_even_while_they_are_online(): void
    {
        $me = $this->user();
        $this->event($this->calendar($me));

        $this->travelTo(CarbonImmutable::parse('2026-11-10T14:45:00Z'));
        PresenceService::touch($me);
        Reminders::sendDue(CarbonImmutable::parse('2026-11-10T14:45:00Z'));

        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo($me->email));
    }

    public function test_guests_who_are_coming_are_reminded_and_those_who_declined_are_not(): void
    {
        $me = $this->user();
        $coming = $this->user();
        $declined = $this->user();
        $event = $this->event($this->calendar($me));
        foreach ([[$coming, CalendarEventAttendee::ACCEPTED], [$declined, CalendarEventAttendee::DECLINED]] as [$guest, $response]) {
            CalendarEventAttendee::create([
                'event_id' => $event->id,
                'attendee_type' => CalendarEventAttendee::TYPE_USER,
                'user_id' => $guest->id,
                'response' => $response,
            ]);
        }

        Reminders::sendDue(CarbonImmutable::parse('2026-11-10T14:45:00Z'));

        $reminded = Notification::where('type', 'calendar.reminder')->pluck('user_id')->sort()->values()->all();
        $this->assertSame(collect([$me->id, $coming->id])->sort()->values()->all(), $reminded);
    }

    /** An entry about a client opens that client's application. */
    public function test_an_entry_about_a_client_opens_the_application(): void
    {
        $me = $this->user();
        $client = Client::create(['uid' => 'chen-wei', 'name' => 'Chen Wei', 'created_by' => $me->id, 'data' => []]);
        $this->event($this->calendar($me), ['client_id' => $client->id, 'reminder_minutes' => 0]);

        Reminders::sendDue(CarbonImmutable::parse('2026-11-10T15:00:00Z'));

        $note = Notification::where('type', 'calendar.reminder')->firstOrFail();
        $this->assertSame('/citizenship-applications/chen-wei', $note->action_url);
        $this->assertStringContainsString('Chen Wei', (string) $note->message);
    }

    public function test_a_recurring_entry_reminds_once_each_time(): void
    {
        $me = $this->user();
        $this->event($this->calendar($me), [
            'starts_at' => '2026-11-02T09:00:00+00:00',
            'ends_at' => '2026-11-02T09:30:00+00:00',
            'recurrence_rule' => 'FREQ=WEEKLY',
            'reminder_minutes' => 0,
        ]);

        $this->assertSame(1, Reminders::sendDue(CarbonImmutable::parse('2026-11-09T09:00:00Z')));
        $this->assertSame(0, Reminders::sendDue(CarbonImmutable::parse('2026-11-09T09:05:00Z')));
        $this->assertSame(1, Reminders::sendDue(CarbonImmutable::parse('2026-11-16T09:00:00Z')));
    }

    public function test_cancelled_or_unreminded_entries_stay_quiet(): void
    {
        $me = $this->user();
        $calendar = $this->calendar($me);
        $this->event($calendar, ['status' => CalendarEvent::STATUS_CANCELLED]);
        $this->event($calendar, ['reminder_minutes' => null]);

        $this->assertSame(0, Reminders::sendDue(CarbonImmutable::parse('2026-11-10T14:45:00Z')));
    }

    public function test_the_reminder_is_saved_and_read_back_through_the_api(): void
    {
        $me = $this->user();

        $id = $this->actingAs($me)->postJson('/portal/calendar/events', [
            'title' => 'Reminder',
            'startsAt' => '2026-11-10T15:00:00+00:00',
            'endsAt' => '2026-11-10T15:15:00+00:00',
            'timezone' => 'UTC',
            'reminderMinutes' => 0,
        ])->assertOk()->assertJsonPath('event.reminderMinutes', 0)->json('event.id');

        $this->actingAs($me)->patchJson('/portal/calendar/events/'.$id, ['reminderMinutes' => 60])
            ->assertOk()
            ->assertJsonPath('event.reminderMinutes', 60);

        $this->actingAs($me)->patchJson('/portal/calendar/events/'.$id, ['reminderMinutes' => null])
            ->assertOk()
            ->assertJsonPath('event.reminderMinutes', null);
    }
}
