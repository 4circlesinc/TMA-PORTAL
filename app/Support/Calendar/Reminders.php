<?php

namespace App\Support\Calendar;

use App\Models\CalendarEvent;
use App\Models\CalendarEventAttendee;
use App\Models\User;
use App\Support\Cip\Pages;
use App\Support\Notifications\Notifier;
use App\Support\UserTime;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Personal reminders: a calendar entry that tells its people when it is due.
 *
 * Each event may carry `reminder_minutes` — how long before it starts to
 * remind (0 is at the time). Every minute the scheduler asks which are due
 * and sends each one once per occurrence, to the owner and to every portal
 * guest who has not declined. A reminder arrives as a portal notification
 * (the bell, the toast, the phone) and as an email, both on the reminder's
 * own preference row, and it opens the client's application when the entry
 * is about one, otherwise the entry itself.
 */
final class Reminders
{
    /** A reminder the scheduler missed by more than this is not sent late. */
    public const GRACE_MINUTES = 15;

    /** The longest lead the picker offers: four weeks. */
    public const MAX_LEAD_MINUTES = 40320;

    /**
     * Send every reminder that is due now.
     *
     * @return int how many occurrences were reminded
     */
    public static function sendDue(?CarbonImmutable $now = null): int
    {
        $now ??= CarbonImmutable::now();
        $sent = 0;

        foreach (self::dueOccurrences($now) as [$event, $start]) {
            if (! self::claim($event, $start, $now)) {
                continue;
            }

            self::notify($event, $start);
            $sent++;
        }

        return $sent;
    }

    /**
     * @return list<array{0: CalendarEvent, 1: CarbonImmutable}>
     */
    private static function dueOccurrences(CarbonImmutable $now): array
    {
        $due = [];
        $isDue = fn (CarbonImmutable $start, int $lead) => $start->subMinutes($lead)->lte($now)
            && $start->gt($now->subMinutes(self::GRACE_MINUTES));

        $base = fn () => CalendarEvent::query()
            ->whereNotNull('reminder_minutes')
            ->whereNull('completed_at')
            ->where('status', '!=', CalendarEvent::STATUS_CANCELLED);

        // One-off entries starting from just behind now to the longest lead.
        $base()
            ->whereNull('recurrence_rule')
            ->where('starts_at', '>', $now->subMinutes(self::GRACE_MINUTES))
            ->where('starts_at', '<=', $now->addMinutes(self::MAX_LEAD_MINUTES))
            ->get()
            ->each(function (CalendarEvent $event) use (&$due, $isDue) {
                $start = CarbonImmutable::instance($event->starts_at);
                if ($isDue($start, (int) $event->reminder_minutes)) {
                    $due[] = [$event, $start];
                }
            });

        // Recurring entries: the occurrences inside this event's own window.
        $base()
            ->whereNotNull('recurrence_rule')
            ->where('starts_at', '<=', $now->addMinutes(self::MAX_LEAD_MINUTES))
            ->get()
            ->each(function (CalendarEvent $event) use (&$due, $isDue, $now) {
                $lead = (int) $event->reminder_minutes;
                $occurrences = RecurrenceExpander::expand(
                    $event,
                    $now->subMinutes(self::GRACE_MINUTES),
                    $now->addMinutes($lead + 1),
                );

                foreach ($occurrences as $occurrence) {
                    $start = CarbonImmutable::instance($occurrence['startsAt']);
                    if ($isDue($start, $lead)) {
                        $due[] = [$event, $start];
                    }
                }
            });

        return $due;
    }

    /** Write the reminder down first, so two schedulers never send it twice. */
    private static function claim(CalendarEvent $event, CarbonImmutable $start, CarbonImmutable $now): bool
    {
        try {
            DB::table('calendar_event_reminders')->insert([
                'event_id' => $event->id,
                'occurrence_at' => $start->utc()->toDateTimeString(),
                'sent_at' => $now->utc()->toDateTimeString(),
            ]);

            return true;
        } catch (QueryException) {
            return false;
        }
    }

    private static function notify(CalendarEvent $event, CarbonImmutable $start): void
    {
        $event->loadMissing(['organizer', 'client:id,uid,name', 'attendees.user']);
        $path = $event->client?->uid
            ? Pages::application($event->client->uid)
            : '/calendar?event='.$event->uuid;

        foreach (self::recipients($event) as $user) {
            Notifier::send([
                'user' => $user,
                'type' => 'calendar.reminder',
                'title' => 'Reminder: '.($event->title ?: 'Calendar entry'),
                'message' => self::when($event, $start, $user),
                'subject' => $event,
                'client' => $event->client,
                'action_url' => $path,
                'action_label' => $event->client ? 'Open application' : 'View in calendar',
                // A reminder is the one thing that must reach them by both
                // routes: the email goes out even while they are online.
                'email_always' => true,
                'dedupe_key' => 'calendar.reminder:'.$event->id.':'.$start->utc()->timestamp,
                'dedupe_minutes' => 60 * 24,
                'metadata' => array_filter([
                    'eventId' => $event->uuid,
                    'startsAt' => $start->toIso8601String(),
                    'clientName' => $event->client?->name,
                ]),
            ]);
        }
    }

    /**
     * The owner, and every portal guest who has not said no.
     *
     * @return Collection<int, User>
     */
    private static function recipients(CalendarEvent $event): Collection
    {
        $people = collect([$event->organizer]);

        foreach ($event->attendees as $attendee) {
            if ($attendee->user && $attendee->response !== CalendarEventAttendee::DECLINED) {
                $people->push($attendee->user);
            }
        }

        return $people
            ->filter(fn ($user) => $user instanceof User && $user->isApproved())
            ->unique('id')
            ->values();
    }

    /** "Today at 3:00 PM", on the reader's own clock, with where and what. */
    private static function when(CalendarEvent $event, CarbonImmutable $start, User $user): string
    {
        $local = $start->setTimezone(UserTime::zone($user));
        $today = CarbonImmutable::now(UserTime::zone($user));

        $day = match (true) {
            $local->isSameDay($today) => 'Today',
            $local->isSameDay($today->addDay()) => 'Tomorrow',
            default => $local->format('l, F j'),
        };

        $line = $event->all_day ? $day : $day.' at '.$local->format('g:i A');

        if ($event->client?->name) {
            $line .= ' · '.$event->client->name;
        }
        if ($event->location) {
            $line .= ' · '.$event->location;
        }

        return $line;
    }
}
