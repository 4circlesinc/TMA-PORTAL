<?php

namespace App\Support\Calendar;

use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Models\CalendarEventAttendee;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * Writes parsed ICS events onto a calendar.
 *
 * Duplicate detection keys on the file's UID, never on title/date/attendees —
 * an event that is genuinely already here must be recognised even after it has
 * been renamed or moved. Events with no UID at all fall back to a content
 * signature, which is the best available and is treated as such.
 */
class IcsImporter
{
    public const ON_DUPLICATE_SKIP = 'skip';

    public const ON_DUPLICATE_UPDATE = 'update';

    public const DUPLICATE_MODES = [self::ON_DUPLICATE_SKIP, self::ON_DUPLICATE_UPDATE];

    /**
     * @param  array<int, array<string, mixed>>  $events  from IcsReader::parse()
     * @param  array<int, string>|null  $only  UIDs to import; null means all
     * @return array{imported: int, updated: int, skipped: int, failed: int, errors: array<int, string>}
     */
    public static function import(
        Calendar $calendar,
        array $events,
        User $actor,
        string $onDuplicate = self::ON_DUPLICATE_SKIP,
        ?array $only = null,
        bool $withAttendees = true,
    ): array {
        $result = ['imported' => 0, 'updated' => 0, 'skipped' => 0, 'failed' => 0, 'errors' => []];

        $wanted = $only === null ? null : array_flip($only);

        /*
         * Detached occurrences (RECURRENCE-ID) are held back until every
         * master exists — a file may list them in any order, and attaching one
         * to a series that hasn't been created yet would orphan it.
         */
        $deferred = [];

        foreach ($events as $parsed) {
            $key = self::keyFor($parsed);

            if ($wanted !== null && ! isset($wanted[$key])) {
                $result['skipped']++;

                continue;
            }

            if ($parsed['recurrenceId'] ?? null) {
                $deferred[] = $parsed;

                continue;
            }

            self::importOne($calendar, $parsed, $actor, $onDuplicate, $withAttendees, $result);
        }

        foreach ($deferred as $parsed) {
            self::importOne($calendar, $parsed, $actor, $onDuplicate, $withAttendees, $result);
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $parsed
     * @param  array<string, mixed>  $result
     */
    private static function importOne(
        Calendar $calendar,
        array $parsed,
        User $actor,
        string $onDuplicate,
        bool $withAttendees,
        array &$result,
    ): void {
        try {
            $existing = self::findExisting($calendar, $parsed);

            if ($existing) {
                if ($onDuplicate === self::ON_DUPLICATE_SKIP) {
                    $result['skipped']++;

                    return;
                }

                $existing->fill(self::attributes($calendar, $parsed, $actor))->save();

                if ($withAttendees) {
                    self::syncAttendees($existing, $parsed);
                }

                $result['updated']++;

                return;
            }

            $event = CalendarEvent::create(array_merge(
                self::attributes($calendar, $parsed, $actor),
                [
                    'uuid' => (string) Str::uuid(),
                    'calendar_id' => $calendar->id,
                    'created_by' => $actor->id,
                    // The file's UID, so a re-import recognises this row.
                    'external_provider' => 'ics',
                    'external_calendar_id' => (string) $calendar->id,
                    'external_event_id' => self::keyFor($parsed),
                ],
            ));

            self::attachToSeries($calendar, $event, $parsed);

            if ($withAttendees) {
                self::syncAttendees($event, $parsed);
            }

            $result['imported']++;
        } catch (\Throwable $e) {
            // One bad event never takes the rest of the file with it.
            $result['failed']++;
            $result['errors'][] = ($parsed['title'] ?? 'Untitled').' — '.$e->getMessage();
        }
    }

    /**
     * @param  array<string, mixed>  $parsed
     * @return array<string, mixed>
     */
    private static function attributes(Calendar $calendar, array $parsed, User $actor): array
    {
        $tz = $parsed['timezone'] ?: ($calendar->timezone ?: 'UTC');

        return [
            'title' => $parsed['title'],
            'description' => $parsed['description'],
            'location' => $parsed['location'],
            'starts_at' => CarbonImmutable::parse($parsed['startsAt'])->utc(),
            'ends_at' => CarbonImmutable::parse($parsed['endsAt'])->utc(),
            'all_day' => (bool) $parsed['allDay'],
            'timezone' => $tz,
            'status' => $parsed['status'],
            'visibility' => $parsed['visibility'],
            'meeting_url' => $parsed['meetingUrl'] ?? null,
            'recurrence_rule' => $parsed['recurrenceRule'],
            'recurrence_exdates' => $parsed['recurrenceExdates'],
            'organizer_id' => self::resolveOrganizer($parsed['organizer'] ?? null) ?? $actor->id,
            'updated_by' => $actor->id,
            'external_synced_at' => now(),
        ];
    }

    /**
     * Link a detached occurrence to the master it belongs to, matching on the
     * series UID the file gave both of them.
     *
     * @param  array<string, mixed>  $parsed
     */
    private static function attachToSeries(Calendar $calendar, CalendarEvent $event, array $parsed): void
    {
        if (! ($parsed['recurrenceId'] ?? null) || ! ($parsed['uid'] ?? null)) {
            return;
        }

        $master = CalendarEvent::where('calendar_id', $calendar->id)
            ->where('external_event_id', $parsed['uid'])
            ->whereNotNull('recurrence_rule')
            ->first();

        if (! $master) {
            return;
        }

        $event->series_id = $master->id;
        $event->recurrence_starts_at = CarbonImmutable::parse($parsed['recurrenceId'])->utc();
        // Its own identity, so it doesn't collide with the master's UID.
        $event->external_event_id = $parsed['uid'].'#'.$event->recurrence_starts_at->format('Ymd\THis\Z');
        $event->save();
    }

    /**
     * The event this parsed entry already corresponds to, if any.
     *
     * @param  array<string, mixed>  $parsed
     */
    private static function findExisting(Calendar $calendar, array $parsed): ?CalendarEvent
    {
        $key = self::keyFor($parsed);

        return CalendarEvent::where('calendar_id', $calendar->id)
            ->where('external_event_id', $key)
            ->first();
    }

    /**
     * The identity an entry is deduplicated by.
     *
     * A UID when the file supplies one. Otherwise a hash of the fields that
     * define the event — deliberately a last resort, and noted as such,
     * because it will mis-match if any of them is edited.
     *
     * @param  array<string, mixed>  $parsed
     */
    public static function keyFor(array $parsed): string
    {
        if (! empty($parsed['uid'])) {
            $uid = (string) $parsed['uid'];

            return ($parsed['recurrenceId'] ?? null)
                ? $uid.'#'.CarbonImmutable::parse($parsed['recurrenceId'])->utc()->format('Ymd\THis\Z')
                : $uid;
        }

        return 'sig:'.substr(hash('sha256', implode('|', [
            $parsed['title'] ?? '',
            $parsed['startsAt'] ?? '',
            $parsed['endsAt'] ?? '',
            $parsed['location'] ?? '',
        ])), 0, 40);
    }

    /** Match an organizer address to a portal account, if one exists. */
    private static function resolveOrganizer(?string $email): ?int
    {
        if (! $email) {
            return null;
        }

        return User::where('email', $email)->value('id');
    }

    /**
     * @param  array<string, mixed>  $parsed
     */
    private static function syncAttendees(CalendarEvent $event, array $parsed): void
    {
        foreach ($parsed['attendees'] ?? [] as $attendee) {
            $user = User::where('email', $attendee['email'])->first();

            // A portal account becomes a real user attendee so they can reply
            // in-app; anyone else stays a bare address.
            $keys = $user
                ? ['event_id' => $event->id, 'user_id' => $user->id]
                : ['event_id' => $event->id, 'email' => $attendee['email']];

            CalendarEventAttendee::updateOrCreate($keys, [
                'attendee_type' => $user
                    ? CalendarEventAttendee::TYPE_USER
                    : CalendarEventAttendee::TYPE_EMAIL,
                'name' => $attendee['name'],
                'response' => $attendee['response'],
                'is_optional' => $attendee['optional'],
                /*
                 * Imported responses are historical record, not something this
                 * portal solicited — marking them notified stops a later
                 * change notice treating them as never-contacted.
                 */
                'notified_at' => now(),
            ]);
        }
    }
}
