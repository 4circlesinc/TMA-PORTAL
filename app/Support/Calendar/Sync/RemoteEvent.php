<?php

namespace App\Support\Calendar\Sync;

use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Support\Calendar\RecurrenceRule;
use Carbon\CarbonImmutable;

/**
 * The one event shape that crosses the provider boundary, and the two
 * conversions to and from a stored CalendarEvent.
 *
 * A provider implementation returns rows in this shape from changedEvents(),
 * and is handed this shape to createEvent()/updateEvent(). Keeping the mapping
 * to and from CalendarEvent here — rather than in the synchronizer — means the
 * sync engine never has to know a Google field name from a Graph one.
 *
 * Fields (all keys always present, values nullable):
 *   externalId, etag, title, description, location, startsAt, endsAt (ISO),
 *   allDay (bool), timezone, status, recurrenceRule, recurrenceId, cancelled,
 *   meetingUrl
 */
class RemoteEvent
{
    /**
     * A stored event as the payload a provider create/update wants.
     *
     * @return array<string, mixed>
     */
    public static function fromEvent(CalendarEvent $event): array
    {
        return [
            'title' => $event->title,
            'description' => $event->description,
            'location' => $event->location,
            'startsAt' => $event->starts_at->toIso8601String(),
            'endsAt' => $event->ends_at->toIso8601String(),
            'allDay' => (bool) $event->all_day,
            'timezone' => $event->timezone ?: 'UTC',
            'status' => $event->status,
            'recurrenceRule' => $event->recurrence_rule,
            'meetingUrl' => $event->meeting_url,
        ];
    }

    /**
     * The columns to write when a remote event lands locally.
     *
     * Never sets uuid, calendar_id or the external identity — those belong to
     * the synchronizer, which knows which local row (if any) this maps to.
     *
     * @param  array<string, mixed>  $remote
     * @return array<string, mixed>
     */
    public static function toAttributes(array $remote, Calendar $calendar): array
    {
        $tz = $remote['timezone'] ?: ($calendar->timezone ?: 'UTC');

        return [
            'title' => $remote['title'] ?: 'Untitled event',
            'description' => $remote['description'] ?? null,
            'location' => $remote['location'] ?? null,
            'starts_at' => CarbonImmutable::parse($remote['startsAt'])->utc(),
            'ends_at' => CarbonImmutable::parse($remote['endsAt'])->utc(),
            'all_day' => (bool) ($remote['allDay'] ?? false),
            'timezone' => $tz,
            'status' => self::normaliseStatus($remote['status'] ?? 'confirmed'),
            'visibility' => 'default',
            'recurrence_rule' => $remote['recurrenceRule'] ?? null,
        ];
    }

    /**
     * A content fingerprint, used both to tell "the remote actually changed"
     * from "the provider re-sent an identical event" and to tell "this was
     * edited locally" from "untouched since last sync".
     *
     * Only the fields a user would notice, so a provider bumping an internal
     * timestamp does not read as an edit. Dates are canonicalised to a single
     * UTC form so the same instant hashes identically whether it arrived as
     * '…+00:00' or '…Z' — otherwise a pure format difference would masquerade
     * as a change and fabricate conflicts.
     *
     * @param  array<string, mixed>  $remote
     */
    public static function fingerprint(array $remote): string
    {
        return hash('sha256', implode('|', [
            trim((string) ($remote['title'] ?? '')),
            self::canonicalDate($remote['startsAt'] ?? null),
            self::canonicalDate($remote['endsAt'] ?? null),
            trim((string) ($remote['location'] ?? '')),
            trim((string) ($remote['description'] ?? '')),
            ($remote['allDay'] ?? false) ? '1' : '0',
            (string) ($remote['recurrenceRule'] ?? ''),
            self::normaliseStatus($remote['status'] ?? 'confirmed'),
        ]));
    }

    /** The same fingerprint, computed from a stored event. */
    public static function fingerprintEvent(CalendarEvent $event): string
    {
        return self::fingerprint(self::fromEvent($event));
    }

    private static function canonicalDate(?string $value): string
    {
        if (! $value) {
            return '';
        }

        try {
            return CarbonImmutable::parse($value)->utc()->format('Y-m-d\TH:i:s');
        } catch (\Throwable) {
            return $value;
        }
    }

    private static function normaliseStatus(string $status): string
    {
        return match (strtolower($status)) {
            'tentative' => CalendarEvent::STATUS_TENTATIVE,
            'cancelled', 'canceled' => CalendarEvent::STATUS_CANCELLED,
            default => CalendarEvent::STATUS_CONFIRMED,
        };
    }

    /**
     * Parse a provider recurrence into an RRULE string, tolerating both the
     * "RRULE:FREQ=…" prefixed form and a bare rule.
     */
    public static function normaliseRule(?string $rule): ?string
    {
        if (! $rule) {
            return null;
        }

        $rule = preg_replace('/^RRULE:/i', '', trim($rule));

        // Validate by round-tripping through the parser; an unparseable rule
        // is dropped rather than stored and later failing expansion.
        $spec = RecurrenceRule::parse($rule);

        return $spec['freq'] === 'NONE' ? null : $rule;
    }
}
