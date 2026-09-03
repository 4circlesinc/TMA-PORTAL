<?php

namespace App\Support\Calendar\Sync;

use App\Models\ConnectedAccount;

/**
 * What the portal needs from an external calendar backend, in the portal's own
 * vocabulary.
 *
 * Google Calendar and Microsoft Graph disagree about nearly everything —
 * Google syncs with a syncToken and 410s when it expires, Graph hands back a
 * deltaLink; Google's all-day events are `date` values, Graph's are marked
 * `isAllDay`; Google speaks RRULE arrays, Graph speaks a `recurrence` object.
 * All of that is each implementation's problem. Above this line an event is a
 * plain array in one shape (see RemoteEvent) and a calendar is an id.
 *
 * Mirrors App\Support\Mail\MailProvider on purpose: same "normalise at the
 * boundary" contract, same token handling underneath.
 */
interface CalendarProvider
{
    public static function for(ConnectedAccount $account): self;

    /**
     * The calendars this account can see, for the connect screen's picker.
     *
     * @return array<int, array{id: string, name: string, colour: ?string, primary: bool, canWrite: bool}>
     */
    public function listCalendars(): array;

    /**
     * Events in a calendar changed since `$cursor` (a full window when null).
     *
     * `$cursor` is the provider's own opaque token. A provider that reports its
     * cursor has expired throws CalendarSyncException so the caller can fall
     * back to a full window rather than losing events.
     *
     * With `$onPage` given, the provider streams instead of accumulating:
     * each fetched page is handed over as `$onPage($events, $deleted,
     * $resumeCursor)` and the returned arrays stay empty. `$resumeCursor`,
     * when non-null, is a token the NEXT run could pass back as `$cursor` to
     * continue from after this page - so the caller can persist progress and
     * a run killed mid-pull no longer loses the whole pass. A provider whose
     * mid-pass tokens are not self-contained (Google's page tokens only work
     * with their original query) passes null until the final page.
     *
     * @param  ?callable(array<int, array<string, mixed>>, array<int, string>, ?string): void  $onPage
     * @return array{events: array<int, array<string, mixed>>, deleted: array<int, string>, cursor: ?string}
     */
    public function changedEvents(string $externalCalendarId, ?string $cursor, string $windowStart, ?callable $onPage = null): array;

    /**
     * Create an event on the provider, returning its new external id and etag.
     *
     * @param  array<string, mixed>  $event  RemoteEvent shape
     * @return array{externalId: string, etag: ?string}
     */
    public function createEvent(string $externalCalendarId, array $event): array;

    /**
     * Update an event on the provider. `$etag` is sent as an
     * If-Match precondition where the provider supports it, so a push that
     * would clobber a newer remote change fails loudly instead of winning by
     * accident.
     *
     * @param  array<string, mixed>  $event
     * @return array{etag: ?string}
     */
    public function updateEvent(string $externalCalendarId, string $externalEventId, array $event, ?string $etag): array;

    /** Delete an event on the provider. A already-gone event is a no-op. */
    public function deleteEvent(string $externalCalendarId, string $externalEventId): void;
}
