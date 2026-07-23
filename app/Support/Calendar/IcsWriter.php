<?php

namespace App\Support\Calendar;

use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Models\CalendarEventAttendee;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Sabre\VObject\Component\VCalendar;

/**
 * Generates the .ics file the export actions hand back.
 *
 * Series masters are written **as series** — one VEVENT carrying the RRULE,
 * plus a VEVENT per detached occurrence with a RECURRENCE-ID — rather than as
 * hundreds of expanded copies. That is what keeps a re-import, or a sync to
 * Google, recognisably the same recurring meeting instead of a pile of
 * unrelated events.
 */
class IcsWriter
{
    private const PRODID = '-//TM ANTOINE Advisory//Portal Calendar//EN';

    /**
     * @param  Collection<int, CalendarEvent>  $events
     */
    public static function write(Collection $events, ?Calendar $calendar = null): string
    {
        $vcalendar = new VCalendar([
            'PRODID' => self::PRODID,
            'VERSION' => '2.0',
            'CALSCALE' => 'GREGORIAN',
            'METHOD' => 'PUBLISH',
        ]);

        if ($calendar) {
            // Non-standard but universally understood: most clients show this
            // as the calendar's name on import.
            $vcalendar->add('X-WR-CALNAME', $calendar->name);
            $vcalendar->add('X-WR-TIMEZONE', $calendar->timezone ?: 'UTC');
            if ($calendar->description) {
                $vcalendar->add('X-WR-CALDESC', $calendar->description);
            }
        }

        foreach ($events as $event) {
            self::addEvent($vcalendar, $event);
        }

        return $vcalendar->serialize();
    }

    private static function addEvent(VCalendar $vcalendar, CalendarEvent $event): void
    {
        $tz = $event->timezone ?: 'UTC';

        $vevent = $vcalendar->add('VEVENT', [
            /*
             * UID must be stable across exports: it is what stops a re-import
             * creating a second copy of an event that is already there. A
             * synced event keeps the provider's own UID so the round trip
             * lines up with what Google or Microsoft already holds.
             */
            'UID' => $event->external_event_id ?: $event->uuid.'@tma-portal',
            'DTSTAMP' => $event->updated_at ?? now(),
            'SUMMARY' => $event->title,
            'SEQUENCE' => 0,
        ]);

        if ($event->all_day) {
            /*
             * All-day events are DATE values, not DATE-TIMEs, and DTEND is
             * exclusive — which is exactly how they are stored, so no
             * adjustment is needed here beyond dropping the time.
             */
            $vevent->add('DTSTART', $event->starts_at->setTimezone($tz), ['VALUE' => 'DATE']);
            $vevent->add('DTEND', $event->ends_at->setTimezone($tz), ['VALUE' => 'DATE']);
        } else {
            $vevent->add('DTSTART', $event->starts_at->setTimezone($tz));
            $vevent->add('DTEND', $event->ends_at->setTimezone($tz));
        }

        if ($event->description) {
            $vevent->add('DESCRIPTION', $event->description);
        }

        if ($event->location) {
            $vevent->add('LOCATION', $event->location);
        }

        $vevent->add('STATUS', match ($event->status) {
            CalendarEvent::STATUS_TENTATIVE => 'TENTATIVE',
            CalendarEvent::STATUS_CANCELLED => 'CANCELLED',
            default => 'CONFIRMED',
        });

        if ($event->visibility === 'private') {
            $vevent->add('CLASS', 'PRIVATE');
        }

        if ($event->meeting_url) {
            $vevent->add('URL', $event->meeting_url);
        }

        if ($event->recurrence_rule) {
            $vevent->add('RRULE', $event->recurrence_rule);
        }

        foreach ((array) ($event->recurrence_exdates ?? []) as $exdate) {
            try {
                $vevent->add('EXDATE', CarbonImmutable::parse($exdate)->setTimezone($tz));
            } catch (\Throwable) {
                // A malformed stored exdate is skipped rather than aborting
                // the whole export.
                continue;
            }
        }

        // A detached occurrence points back at the instance it replaces.
        if ($event->series_id && $event->recurrence_starts_at) {
            $vevent->add('RECURRENCE-ID', $event->recurrence_starts_at->setTimezone($tz));
        }

        if ($event->organizer) {
            $vevent->add('ORGANIZER', 'mailto:'.$event->organizer->email, [
                'CN' => $event->organizer->name,
            ]);
        }

        if ($event->relationLoaded('attendees')) {
            self::addAttendees($vevent, $event);
        }
    }

    private static function addAttendees($vevent, CalendarEvent $event): void
    {
        foreach ($event->attendees as $attendee) {
            /*
             * Groups are a portal concept with no iCalendar equivalent, so
             * they are expanded to their members here. Exporting "Marketing"
             * as a mailto: nobody can deliver to would be worse than useless.
             */
            $people = $attendee->attendee_type === CalendarEventAttendee::TYPE_GROUP
                ? ($attendee->group ? GroupMembership::usersIn($attendee->group)
                    ->map(fn ($u) => ['email' => $u->email, 'name' => $u->name])->all() : [])
                : [['email' => $attendee->deliveryEmail(), 'name' => $attendee->displayName()]];

            foreach ($people as $person) {
                if (! $person['email']) {
                    continue;
                }

                $vevent->add('ATTENDEE', 'mailto:'.$person['email'], array_filter([
                    'CN' => $person['name'],
                    'PARTSTAT' => match ($attendee->response) {
                        CalendarEventAttendee::ACCEPTED => 'ACCEPTED',
                        CalendarEventAttendee::DECLINED => 'DECLINED',
                        CalendarEventAttendee::TENTATIVE => 'TENTATIVE',
                        default => 'NEEDS-ACTION',
                    },
                    'ROLE' => $attendee->is_optional ? 'OPT-PARTICIPANT' : 'REQ-PARTICIPANT',
                ]));
            }
        }
    }

    /** A filename safe on every platform, derived from what was exported. */
    public static function filename(string $label): string
    {
        $slug = preg_replace('/[^A-Za-z0-9._-]+/', '-', $label) ?: 'calendar';

        return trim($slug, '-').'.ics';
    }
}
