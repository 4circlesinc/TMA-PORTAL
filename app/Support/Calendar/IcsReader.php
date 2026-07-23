<?php

namespace App\Support\Calendar;

use Carbon\CarbonImmutable;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\DateTimeParser;
use Sabre\VObject\Reader;

/**
 * Parses an .ics file into plain arrays the importer can preview and store.
 *
 * The governing rule from the brief: **a broken event must not stop the valid
 * ones importing.** Every VEVENT is therefore read inside its own try/catch,
 * and a failure is recorded as a skipped entry with a reason rather than being
 * allowed to abort the file.
 */
class IcsReader
{
    /** Refuse absurd files before spending memory on them. */
    public const MAX_BYTES = 12 * 1024 * 1024;

    public const MAX_EVENTS = 5000;

    /**
     * @return array{events: array<int, array<string, mixed>>, failed: array<int, string>, calendarName: ?string}
     */
    public static function parse(string $raw): array
    {
        if (trim($raw) === '') {
            throw new IcsException('That file is empty.');
        }

        if (strlen($raw) > self::MAX_BYTES) {
            throw new IcsException('That file is too large to import.');
        }

        try {
            // FORGIVING lets real-world files through: plenty of exporters
            // emit slightly malformed folding or stray characters, and
            // rejecting the whole file for that helps nobody.
            $vcalendar = Reader::read($raw, Reader::OPTION_FORGIVING);
        } catch (\Throwable $e) {
            throw new IcsException('That doesn’t look like a calendar file.');
        }

        if (! $vcalendar instanceof VCalendar) {
            throw new IcsException('That file contains no calendar data.');
        }

        $events = [];
        $failed = [];
        $seen = 0;

        foreach ($vcalendar->VEVENT ?? [] as $vevent) {
            if (++$seen > self::MAX_EVENTS) {
                $failed[] = 'Stopped after '.self::MAX_EVENTS.' events — the file is too large.';
                break;
            }

            try {
                $parsed = self::parseEvent($vevent);
                if ($parsed) {
                    $events[] = $parsed;
                }
            } catch (\Throwable $e) {
                // Named where possible, so the result screen is actionable.
                $title = (string) ($vevent->SUMMARY ?? 'Untitled event');
                $failed[] = $title.' — '.$e->getMessage();
            }
        }

        return [
            'events' => $events,
            'failed' => $failed,
            'calendarName' => isset($vcalendar->{'X-WR-CALNAME'})
                ? (string) $vcalendar->{'X-WR-CALNAME'}
                : null,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function parseEvent($vevent): ?array
    {
        if (! isset($vevent->DTSTART)) {
            throw new \RuntimeException('it has no start date');
        }

        $dtstart = $vevent->DTSTART;
        // An all-day event is a DATE value rather than a DATE-TIME.
        $allDay = ! $dtstart->hasTime();

        $start = CarbonImmutable::instance($dtstart->getDateTime());

        /*
         * DTEND is optional. RFC 5545 says a missing DTEND on a timed event
         * means zero duration, and on an all-day event means one day — but a
         * DURATION may be given instead, which several exporters prefer.
         */
        if (isset($vevent->DTEND)) {
            $end = CarbonImmutable::instance($vevent->DTEND->getDateTime());
        } elseif (isset($vevent->DURATION)) {
            $end = $start->add(DateTimeParser::parseDuration((string) $vevent->DURATION));
        } else {
            $end = $allDay ? $start->addDay() : $start;
        }

        if ($end < $start) {
            throw new \RuntimeException('it ends before it starts');
        }

        // The zone the event was authored in, needed for recurrence and to
        // render all-day events correctly.
        $tz = $dtstart->getDateTime()->getTimezone()->getName();
        if (! in_array($tz, timezone_identifiers_list(), true)) {
            $tz = 'UTC';
        }

        $exdates = [];
        foreach ($vevent->select('EXDATE') as $exdate) {
            foreach ($exdate->getDateTimes() as $dt) {
                $exdates[] = CarbonImmutable::instance($dt)->utc()->toIso8601String();
            }
        }

        $status = strtoupper((string) ($vevent->STATUS ?? 'CONFIRMED'));

        return [
            // The provider's UID is what duplicate detection keys on — never
            // the title or the date.
            'uid' => isset($vevent->UID) ? (string) $vevent->UID : null,
            'title' => trim((string) ($vevent->SUMMARY ?? '')) ?: 'Untitled event',
            'description' => isset($vevent->DESCRIPTION) ? (string) $vevent->DESCRIPTION : null,
            'location' => isset($vevent->LOCATION) ? (string) $vevent->LOCATION : null,
            'startsAt' => $start->utc()->toIso8601String(),
            'endsAt' => $end->utc()->toIso8601String(),
            'allDay' => $allDay,
            'timezone' => $tz,
            'status' => match ($status) {
                'TENTATIVE' => 'tentative',
                'CANCELLED' => 'cancelled',
                default => 'confirmed',
            },
            'visibility' => strtoupper((string) ($vevent->CLASS ?? '')) === 'PRIVATE' ? 'private' : 'default',
            'recurrenceRule' => isset($vevent->RRULE) ? (string) $vevent->RRULE : null,
            'recurrenceExdates' => $exdates ?: null,
            'recurrenceId' => isset($vevent->{'RECURRENCE-ID'})
                ? CarbonImmutable::instance($vevent->{'RECURRENCE-ID'}->getDateTime())->utc()->toIso8601String()
                : null,
            'organizer' => isset($vevent->ORGANIZER)
                ? self::stripMailto((string) $vevent->ORGANIZER)
                : null,
            'attendees' => self::parseAttendees($vevent),
            'meetingUrl' => isset($vevent->URL) ? (string) $vevent->URL : null,
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private static function parseAttendees($vevent): array
    {
        $out = [];

        foreach ($vevent->select('ATTENDEE') as $attendee) {
            $email = self::stripMailto((string) $attendee);
            if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                continue;
            }

            $out[] = [
                'email' => $email,
                'name' => isset($attendee['CN']) ? (string) $attendee['CN'] : null,
                'response' => match (strtoupper((string) ($attendee['PARTSTAT'] ?? ''))) {
                    'ACCEPTED' => 'accepted',
                    'DECLINED' => 'declined',
                    'TENTATIVE' => 'tentative',
                    default => 'needs_action',
                },
                'optional' => strtoupper((string) ($attendee['ROLE'] ?? '')) === 'OPT-PARTICIPANT',
            ];
        }

        return $out;
    }

    private static function stripMailto(string $value): string
    {
        return trim(preg_replace('/^mailto:/i', '', $value));
    }
}
