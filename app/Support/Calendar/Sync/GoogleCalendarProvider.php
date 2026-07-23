<?php

namespace App\Support\Calendar\Sync;

use App\Models\ConnectedAccount;
use App\Support\Mail\MailTokens;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;

/**
 * Google Calendar over the v3 REST API.
 *
 * Google's incremental sync is a `syncToken` returned on the last page of a
 * full or delta list; presenting an expired one gets a 410, which is the
 * signal to start a fresh full window. All-day events are `date` values rather
 * than `dateTime`; recurrence is an array of RRULE/EXDATE lines.
 */
class GoogleCalendarProvider implements CalendarProvider
{
    private const BASE = 'https://www.googleapis.com/calendar/v3';

    private function __construct(private ConnectedAccount $account) {}

    public static function for(ConnectedAccount $account): self
    {
        return new self($account);
    }

    public function listCalendars(): array
    {
        $response = $this->request()->get(self::BASE.'/users/me/calendarList');
        $this->assertOk($response, 'list calendars');

        return collect($response->json('items', []))
            ->map(fn (array $c) => [
                'id' => $c['id'],
                'name' => $c['summary'] ?? $c['id'],
                'colour' => $c['backgroundColor'] ?? null,
                'primary' => (bool) ($c['primary'] ?? false),
                // owner/writer can push; reader/freeBusyReader cannot.
                'canWrite' => in_array($c['accessRole'] ?? '', ['owner', 'writer'], true),
            ])
            ->all();
    }

    public function changedEvents(string $externalCalendarId, ?string $cursor, string $windowStart): array
    {
        $query = ['singleEvents' => 'false', 'showDeleted' => 'true', 'maxResults' => 250];

        if ($cursor) {
            $query['syncToken'] = $cursor;
        } else {
            // A full window only on the first sync, or after a token expiry.
            $query['timeMin'] = CarbonImmutable::parse($windowStart)->utc()->toRfc3339String();
        }

        $events = [];
        $deleted = [];
        $nextCursor = $cursor;
        $pageToken = null;

        do {
            if ($pageToken) {
                $query['pageToken'] = $pageToken;
            }

            $response = $this->request()->get(
                self::BASE.'/calendars/'.rawurlencode($externalCalendarId).'/events',
                $query,
            );

            // 410 Gone: the syncToken has expired. The caller must full-resync.
            if ($response->status() === 410) {
                throw new CalendarSyncException('Google sync token expired.', cursorExpired: true);
            }

            $this->assertOk($response, 'list events');

            foreach ($response->json('items', []) as $item) {
                if (($item['status'] ?? '') === 'cancelled') {
                    // A cancellation with no other data is a delete; a
                    // cancelled event that still carries a body is a real
                    // (cancelled-status) event, kept for calendars that mirror
                    // cancellations.
                    if (empty($item['summary']) && empty($item['start'])) {
                        $deleted[] = $item['id'];

                        continue;
                    }
                }

                $mapped = $this->mapEvent($item);
                if ($mapped) {
                    $events[] = $mapped;
                }
            }

            $pageToken = $response->json('nextPageToken');
            $nextCursor = $response->json('nextSyncToken') ?: $nextCursor;
        } while ($pageToken);

        return ['events' => $events, 'deleted' => $deleted, 'cursor' => $nextCursor];
    }

    public function createEvent(string $externalCalendarId, array $event): array
    {
        $response = $this->request()->post(
            self::BASE.'/calendars/'.rawurlencode($externalCalendarId).'/events',
            $this->toGoogle($event),
        );
        $this->assertOk($response, 'create event');

        return ['externalId' => $response->json('id'), 'etag' => $response->json('etag')];
    }

    public function updateEvent(string $externalCalendarId, string $externalEventId, array $event, ?string $etag): array
    {
        $request = $this->request();

        // If-Match makes the update fail (412) rather than clobber a newer
        // remote change we haven't seen yet.
        if ($etag) {
            $request = $request->withHeaders(['If-Match' => $etag]);
        }

        $response = $request->put(
            self::BASE.'/calendars/'.rawurlencode($externalCalendarId).'/events/'.rawurlencode($externalEventId),
            $this->toGoogle($event),
        );

        if ($response->status() === 412) {
            throw new CalendarSyncException('The event changed in Google since it was last synced.');
        }

        $this->assertOk($response, 'update event');

        return ['etag' => $response->json('etag')];
    }

    public function deleteEvent(string $externalCalendarId, string $externalEventId): void
    {
        $response = $this->request()->delete(
            self::BASE.'/calendars/'.rawurlencode($externalCalendarId).'/events/'.rawurlencode($externalEventId),
        );

        // 404/410 means it is already gone, which is the goal.
        if ($response->status() === 404 || $response->status() === 410) {
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
        $start = $item['start'] ?? null;
        $end = $item['end'] ?? null;
        if (! $start || ! $end) {
            return null;
        }

        $allDay = isset($start['date']);

        return [
            'externalId' => $item['id'],
            'etag' => $item['etag'] ?? null,
            'title' => $item['summary'] ?? '',
            'description' => $item['description'] ?? null,
            'location' => $item['location'] ?? null,
            'startsAt' => $allDay ? $start['date'].'T00:00:00'.$this->offset($start) : $start['dateTime'],
            'endsAt' => $allDay ? $end['date'].'T00:00:00'.$this->offset($end) : $end['dateTime'],
            'allDay' => $allDay,
            'timezone' => $start['timeZone'] ?? 'UTC',
            'status' => $item['status'] ?? 'confirmed',
            'recurrenceRule' => $this->extractRule($item['recurrence'] ?? null),
            'recurrenceId' => isset($item['recurringEventId']) ? ($item['originalStartTime']['dateTime'] ?? null) : null,
            'cancelled' => ($item['status'] ?? '') === 'cancelled',
            'meetingUrl' => $item['hangoutLink'] ?? null,
        ];
    }

    /**
     * Google returns recurrence as an array of lines; we store only the RRULE.
     *
     * @param  array<int, string>|null  $recurrence
     */
    private function extractRule(?array $recurrence): ?string
    {
        foreach ($recurrence ?? [] as $line) {
            if (stripos($line, 'RRULE:') === 0) {
                return RemoteEvent::normaliseRule($line);
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    private function toGoogle(array $event): array
    {
        $tz = $event['timezone'] ?: 'UTC';

        $body = [
            'summary' => $event['title'],
            'description' => $event['description'],
            'location' => $event['location'],
            'status' => match ($event['status']) {
                'tentative' => 'tentative',
                'cancelled' => 'cancelled',
                default => 'confirmed',
            },
        ];

        if ($event['allDay']) {
            $body['start'] = ['date' => CarbonImmutable::parse($event['startsAt'])->format('Y-m-d')];
            $body['end'] = ['date' => CarbonImmutable::parse($event['endsAt'])->format('Y-m-d')];
        } else {
            $body['start'] = ['dateTime' => CarbonImmutable::parse($event['startsAt'])->toRfc3339String(), 'timeZone' => $tz];
            $body['end'] = ['dateTime' => CarbonImmutable::parse($event['endsAt'])->toRfc3339String(), 'timeZone' => $tz];
        }

        if (! empty($event['recurrenceRule'])) {
            $body['recurrence'] = ['RRULE:'.$event['recurrenceRule']];
        }

        return array_filter($body, fn ($v) => $v !== null);
    }

    /** A timezone offset string for an all-day date, so parse() gets a zone. */
    private function offset(array $part): string
    {
        return '+00:00';
    }

    private function request(): PendingRequest
    {
        return Http::withToken(MailTokens::accessToken($this->account))
            ->acceptJson()
            ->timeout(30);
    }

    private function assertOk($response, string $what): void
    {
        if ($response->successful()) {
            return;
        }

        if ($response->status() === 401 || $response->status() === 403) {
            throw new CalendarSyncException("Google refused to {$what} — the connection may need reauthorising.");
        }

        throw new CalendarSyncException("Google could not {$what} (HTTP {$response->status()}).");
    }
}
