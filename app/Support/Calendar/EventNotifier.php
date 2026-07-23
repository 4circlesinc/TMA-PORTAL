<?php

namespace App\Support\Calendar;

use App\Mail\CalendarEventNotice;
use App\Models\CalendarEvent;
use App\Models\CalendarEventAttendee;
use App\Models\User;
use Illuminate\Support\Facades\Mail;

/**
 * Sends an event's email: invitations, change notices, cancellations, and the
 * organizer's copy of a response.
 *
 * Two rules govern everything here:
 *
 *  - **Group attendees are expanded at send time**, not stored expanded. That
 *    is what makes "invite Marketing, then add someone to Marketing" behave
 *    the way people expect.
 *  - **Nobody is emailed twice about one thing.** A person invited directly
 *    *and* through a group gets one message, and the organizer is never
 *    notified about their own event.
 */
class EventNotifier
{
    /**
     * Notify everyone invited. `$only` restricts to specific attendee rows,
     * which is how adding a person to an existing event notifies just them.
     *
     * @param  array<int, int>|null  $only  attendee row ids
     */
    public static function notify(
        CalendarEvent $event,
        string $kind,
        ?array $only = null,
        array $extra = [],
    ): int {
        $attendees = $event->attendees()
            ->with(['user', 'group'])
            ->when($only !== null, fn ($q) => $q->whereIn('id', $only))
            ->get();

        $sent = 0;
        $seen = [];

        foreach ($attendees as $attendee) {
            foreach (self::recipientsFor($attendee) as $recipient) {
                $email = $recipient['email'];

                // One message per address, however many ways they were invited.
                if (! $email || isset($seen[strtolower($email)])) {
                    continue;
                }

                // The organizer knows; they are the one who did it.
                if ($recipient['userId'] !== null && $recipient['userId'] === $event->organizer_id) {
                    continue;
                }

                $seen[strtolower($email)] = true;

                Mail::to($email)->send(new CalendarEventNotice(
                    $event,
                    $kind,
                    self::payload($event, $recipient['name'], $recipient['userId'] !== null) + $extra,
                ));

                $sent++;
            }
        }

        if ($only === null) {
            $event->attendees()->whereNull('notified_at')->update(['notified_at' => now()]);
        } else {
            $event->attendees()->whereIn('id', $only)->update(['notified_at' => now()]);
        }

        return $sent;
    }

    /**
     * Tell the organizer how someone replied. Silent when the organizer is the
     * one replying — accepting your own meeting should not email you.
     */
    public static function notifyOrganizerOfResponse(CalendarEvent $event, CalendarEventAttendee $attendee): bool
    {
        $organizer = $event->organizer;

        if (! $organizer || ! $organizer->email || $attendee->user_id === $organizer->id) {
            return false;
        }

        Mail::to($organizer->email)->send(new CalendarEventNotice(
            $event,
            CalendarEventNotice::KIND_RESPONSE,
            self::payload($event, $organizer->name, true) + [
                'attendee' => $attendee->displayName(),
                'responseLabel' => self::responseLabel($attendee->response),
            ],
        ));

        return true;
    }

    /**
     * Flatten one attendee row into the people it actually reaches.
     *
     * @return array<int, array{email: ?string, name: ?string, userId: ?int}>
     */
    private static function recipientsFor(CalendarEventAttendee $attendee): array
    {
        if ($attendee->attendee_type === CalendarEventAttendee::TYPE_GROUP) {
            if (! $attendee->group) {
                return [];
            }

            return GroupMembership::usersIn($attendee->group)
                ->map(fn (User $u) => ['email' => $u->email, 'name' => $u->name, 'userId' => $u->id])
                ->all();
        }

        if ($attendee->attendee_type === CalendarEventAttendee::TYPE_USER) {
            return $attendee->user
                ? [['email' => $attendee->user->email, 'name' => $attendee->user->name, 'userId' => $attendee->user->id]]
                : [];
        }

        return [['email' => $attendee->email, 'name' => $attendee->name, 'userId' => null]];
    }

    /**
     * The event as the templates want it. Times are rendered in the event's
     * own zone — an invitation showing UTC to someone in Johannesburg is
     * worse than useless.
     *
     * @return array<string, mixed>
     */
    public static function payload(CalendarEvent $event, ?string $recipientName, bool $hasPortalAccount): array
    {
        $tz = $event->timezone ?: 'UTC';
        $starts = $event->starts_at->setTimezone($tz);
        $ends = $event->ends_at->setTimezone($tz);

        if ($event->all_day) {
            $days = max(1, (int) $starts->diffInDays($ends));
            $whenLabel = $days === 1
                ? $starts->format('l, j F Y').' · All day'
                : $starts->format('j M').' – '.$ends->subDay()->format('j M Y').' · All day';
        } else {
            $whenLabel = $starts->format('l, j F Y').' · '.$starts->format('H:i').'–'.$ends->format('H:i');
        }

        return [
            'title' => $event->title,
            'name' => $recipientName,
            'organizer' => $event->organizer?->name,
            'whenLabel' => $whenLabel,
            'timezoneLabel' => $tz,
            'location' => $event->location,
            'description' => $event->description,
            'calendarName' => $event->calendar?->name,
            // Only portal users have somewhere to land; an external guest
            // would just hit the login wall.
            'url' => $hasPortalAccount ? url('/calendar') : null,
        ];
    }

    public static function responseLabel(string $response): string
    {
        return match ($response) {
            CalendarEventAttendee::ACCEPTED => 'accepted',
            CalendarEventAttendee::DECLINED => 'declined',
            CalendarEventAttendee::TENTATIVE => 'tentatively accepted',
            default => 'has not replied to',
        };
    }
}
