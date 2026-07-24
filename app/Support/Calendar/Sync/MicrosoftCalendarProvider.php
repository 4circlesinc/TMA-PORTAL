<?php

namespace App\Support\Calendar\Sync;

use App\Models\ConnectedAccount;
use App\Support\Mail\MailTokens;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;

/**
 * Microsoft 365 / Outlook calendars over Graph.
 *
 * Graph's incremental sync is a `deltaLink` — a fully-formed URL returned at
 * the end of a delta run, followed verbatim next time. An expired one yields a
 * 410 with code 'syncStateNotFound', the signal to restart. All-day events set
 * `isAllDay`; recurrence is a structured `recurrence` object rather than an
 * RRULE, so it is translated on both sides.
 */
class MicrosoftCalendarProvider implements CalendarProvider
{
    private const BASE = 'https://graph.microsoft.com/v1.0';

    private function __construct(private ConnectedAccount $account) {}

    public static function for(ConnectedAccount $account): self
    {
        return new self($account);
    }

    public function listCalendars(): array
    {
        // This runs inside the interactive "connect a calendar" request, so it
        // must fail fast rather than let a slow provider push the whole request
        // past the gateway timeout (a 504). Background sync keeps the full 30s.
        $response = $this->request(timeout: 12)->get(self::BASE.'/me/calendars');
        $this->assertOk($response, 'list calendars');

        return collect($response->json('value', []))
            ->map(fn (array $c) => [
                'id' => $c['id'],
                'name' => $c['name'] ?? 'Calendar',
                'colour' => $c['hexColor'] ?? null,
                'primary' => (bool) ($c['isDefaultCalendar'] ?? false),
                'canWrite' => (bool) ($c['canEdit'] ?? false),
            ])
            ->all();
    }

    public function changedEvents(string $externalCalendarId, ?string $cursor, string $windowStart): array
    {
        // A stored deltaLink is followed as-is; otherwise start a delta run
        // bounded by the import window.
        $url = $cursor ?: self::BASE.'/me/calendars/'.rawurlencode($externalCalendarId).'/calendarView/delta'
            .'?startDateTime='.CarbonImmutable::parse($windowStart)->utc()->toIso8601String()
            .'&endDateTime='.now()->addYears(2)->utc()->toIso8601String();

        $events = [];
        $deleted = [];
        $nextCursor = $cursor;

        do {
            $response = $this->request()
                ->withHeaders(['Prefer' => 'odata.maxpagesize=100'])
                ->get($url);

            if ($response->status() === 410) {
                throw new CalendarSyncException('Microsoft sync state expired.', cursorExpired: true);
            }

            $this->assertOk($response, 'list events');

            foreach ($response->json('value', []) as $item) {
                // A delta removal carries only an id and @removed.
                if (isset($item['@removed'])) {
                    $deleted[] = $item['id'];

                    continue;
                }

                $mapped = $this->mapEvent($item);
                if ($mapped) {
                    $events[] = $mapped;
                }
            }

            $url = $response->json('@odata.nextLink');
            $nextCursor = $response->json('@odata.deltaLink') ?: $nextCursor;
        } while ($url);

        return ['events' => $events, 'deleted' => $deleted, 'cursor' => $nextCursor];
    }

    public function createEvent(string $externalCalendarId, array $event): array
    {
        $response = $this->request()->post(
            self::BASE.'/me/calendars/'.rawurlencode($externalCalendarId).'/events',
            $this->toGraph($event),
        );
        $this->assertOk($response, 'create event');

        return ['externalId' => $response->json('id'), 'etag' => $response->json('@odata.etag')];
    }

    public function updateEvent(string $externalCalendarId, string $externalEventId, array $event, ?string $etag): array
    {
        $request = $this->request();

        if ($etag) {
            $request = $request->withHeaders(['If-Match' => $etag]);
        }

        // Graph updates events at /me/events/{id} regardless of calendar.
        $response = $request->patch(self::BASE.'/me/events/'.rawurlencode($externalEventId), $this->toGraph($event));

        if ($response->status() === 412) {
            throw new CalendarSyncException('The event changed in Microsoft since it was last synced.');
        }

        $this->assertOk($response, 'update event');

        return ['etag' => $response->json('@odata.etag')];
    }

    public function deleteEvent(string $externalCalendarId, string $externalEventId): void
    {
        $response = $this->request()->delete(self::BASE.'/me/events/'.rawurlencode($externalEventId));

        if ($response->status() === 404) {
            return;
        }

        $this->assertOk($response, 'delete event');
    }

    /* ── mapping ─────────────────────────────────────────────── */

    /**
     * @param  array<string, mixed>  $item
     * @return array<string, mixed>|null
     */
    private function mapEvent(array $item): ?array
    {
        if (empty($item['start']) || empty($item['end'])) {
            return null;
        }

        $allDay = (bool) ($item['isAllDay'] ?? false);
        $tz = $item['start']['timeZone'] ?? 'UTC';

        return [
            'externalId' => $item['id'],
            'etag' => $item['@odata.etag'] ?? null,
            'title' => $item['subject'] ?? '',
            'description' => $item['bodyPreview'] ?? null,
            'location' => $item['location']['displayName'] ?? null,
            // Graph datetimes are zone-naive with the zone alongside; combine.
            'startsAt' => $this->combine($item['start']),
            'endsAt' => $this->combine($item['end']),
            'allDay' => $allDay,
            'timezone' => $this->normaliseZone($tz),
            'status' => ($item['isCancelled'] ?? false) ? 'cancelled'
                : (($item['showAs'] ?? '') === 'tentative' ? 'tentative' : 'confirmed'),
            'recurrenceRule' => $this->extractRule($item['recurrence'] ?? null),
            'recurrenceId' => $item['seriesMasterId'] ?? null,
            'cancelled' => (bool) ($item['isCancelled'] ?? false),
            'meetingUrl' => $item['onlineMeeting']['joinUrl'] ?? null,
        ];
    }

    private function combine(array $part): string
    {
        $tz = $this->normaliseZone($part['timeZone'] ?? 'UTC');

        return CarbonImmutable::parse($part['dateTime'], $tz)->toIso8601String();
    }

    /**
     * Graph's `recurrence` object into an RRULE. Only the patterns the portal
     * itself produces are translated; anything richer is dropped so it can't
     * later fail expansion.
     *
     * @param  array<string, mixed>|null  $recurrence
     */
    private function extractRule(?array $recurrence): ?string
    {
        $pattern = $recurrence['pattern'] ?? null;
        $range = $recurrence['range'] ?? null;
        if (! $pattern) {
            return null;
        }

        $freq = match ($pattern['type'] ?? '') {
            'daily' => 'DAILY',
            'weekly' => 'WEEKLY',
            'absoluteMonthly', 'relativeMonthly' => 'MONTHLY',
            'absoluteYearly', 'relativeYearly' => 'YEARLY',
            default => null,
        };
        if (! $freq) {
            return null;
        }

        $parts = ['FREQ='.$freq];

        if (($pattern['interval'] ?? 1) > 1) {
            $parts[] = 'INTERVAL='.$pattern['interval'];
        }

        if (! empty($pattern['daysOfWeek'])) {
            $map = ['monday' => 'MO', 'tuesday' => 'TU', 'wednesday' => 'WE', 'thursday' => 'TH',
                'friday' => 'FR', 'saturday' => 'SA', 'sunday' => 'SU'];
            $days = array_filter(array_map(fn ($d) => $map[strtolower($d)] ?? null, $pattern['daysOfWeek']));
            if ($days) {
                $parts[] = 'BYDAY='.implode(',', $days);
            }
        }

        if (($range['type'] ?? '') === 'numbered' && ! empty($range['numberOfOccurrences'])) {
            $parts[] = 'COUNT='.$range['numberOfOccurrences'];
        } elseif (($range['type'] ?? '') === 'endDate' && ! empty($range['endDate'])) {
            $parts[] = 'UNTIL='.CarbonImmutable::parse($range['endDate'])->utc()->format('Ymd\THis\Z');
        }

        return implode(';', $parts);
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    private function toGraph(array $event): array
    {
        $tz = $event['timezone'] ?: 'UTC';

        $body = [
            'subject' => $event['title'],
            'body' => ['contentType' => 'text', 'content' => $event['description'] ?? ''],
            'isAllDay' => (bool) $event['allDay'],
            'isCancelled' => $event['status'] === 'cancelled',
            'showAs' => $event['status'] === 'tentative' ? 'tentative' : 'busy',
            'start' => ['dateTime' => CarbonImmutable::parse($event['startsAt'])->toIso8601String(), 'timeZone' => $tz],
            'end' => ['dateTime' => CarbonImmutable::parse($event['endsAt'])->toIso8601String(), 'timeZone' => $tz],
        ];

        if (! empty($event['location'])) {
            $body['location'] = ['displayName' => $event['location']];
        }

        return $body;
    }

    /**
     * Graph accepts both IANA and Windows zone names; normalise the obvious
     * Windows ones so the stored event carries an IANA zone the rest of the
     * portal understands.
     */
    private function normaliseZone(string $zone): string
    {
        if (in_array($zone, timezone_identifiers_list(), true)) {
            return $zone;
        }

        return match ($zone) {
            'UTC', 'Coordinated Universal Time' => 'UTC',
            'GMT Standard Time' => 'Europe/London',
            'Pacific Standard Time' => 'America/Los_Angeles',
            'Eastern Standard Time' => 'America/New_York',
            'Central Standard Time' => 'America/Chicago',
            'South Africa Standard Time' => 'Africa/Johannesburg',
            default => 'UTC',
        };
    }

    private function request(int $timeout = 30): PendingRequest
    {
        return Http::withToken(MailTokens::accessToken($this->account))
            ->acceptJson()
            ->timeout($timeout);
    }

    private function assertOk($response, string $what): void
    {
        if ($response->successful()) {
            return;
        }

        if ($response->status() === 401 || $response->status() === 403) {
            throw new CalendarSyncException("Microsoft refused to {$what} — the connection may need reauthorising.");
        }

        throw new CalendarSyncException("Microsoft could not {$what} (HTTP {$response->status()}).");
    }
}
