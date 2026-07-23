<?php

namespace App\Http\Controllers;

use App\Jobs\RefreshIcsSubscription;
use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Support\Calendar\CalendarAccess;
use App\Support\Calendar\CalendarColours;
use App\Support\Calendar\CalendarProvisioner;
use App\Support\Calendar\IcsException;
use App\Support\Calendar\IcsImporter;
use App\Support\Calendar\IcsReader;
use App\Support\Calendar\IcsWriter;
use App\Support\Calendar\RecurrenceRule;
use App\Support\Calendar\SubscriptionUrl;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * ICS import and export.
 *
 * Import is deliberately two steps — preview, then commit — so the file's
 * contents can be seen and chosen from before anything is written. The parsed
 * events travel back with the commit rather than being cached server-side,
 * which keeps the flow stateless and means an abandoned preview leaves nothing
 * behind.
 */
class CalendarIcsController extends Controller
{
    /* ── export ──────────────────────────────────────────────── */

    /**
     * Export a whole calendar, a date range within it, or a chosen set of
     * events. Always filtered by what the caller may actually read.
     */
    public function export(Request $request, string $uuid): Response
    {
        $user = $request->user();
        $calendar = Calendar::where('uuid', $uuid)->firstOrFail();

        $role = CalendarAccess::role($user, $calendar);
        abort_if($role === null, 403, 'You do not have access to this calendar.');

        // Availability-only access carries no detail, so there is nothing
        // legitimate to export.
        abort_unless(
            CalendarAccess::atLeast($role, CalendarAccess::ROLE_DETAILS),
            403,
            'You can only see when this calendar is busy, so it cannot be exported.',
        );

        $data = $request->validate([
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
            'events' => ['sometimes', 'array', 'max:2000'],
            'events.*' => ['string'],
        ]);

        $query = CalendarEvent::where('calendar_id', $calendar->id)
            ->with(['organizer:id,name,email', 'attendees.user:id,name,email', 'attendees.group:id,uuid,name']);

        if (! empty($data['events'])) {
            $query->whereIn('uuid', $data['events']);
        } elseif (isset($data['from'], $data['to'])) {
            /*
             * A series master is kept whenever any of it could fall in the
             * range — its own start may be long before the window, and
             * dropping it would export the exceptions without the series.
             */
            $from = CarbonImmutable::parse($data['from']);
            $to = CarbonImmutable::parse($data['to']);

            $query->where(function ($q) use ($from, $to) {
                $q->where(function ($w) use ($from, $to) {
                    $w->whereNull('recurrence_rule')
                        ->where('starts_at', '<', $to)
                        ->where('ends_at', '>', $from);
                })->orWhere(function ($w) use ($to) {
                    $w->whereNotNull('recurrence_rule')->where('starts_at', '<', $to);
                });
            });
        }

        $events = $query->orderBy('starts_at')->limit(5000)->get();

        // Private events belong to their owner, whatever the exporter's role.
        $events = $events->filter(fn (CalendarEvent $e) => $e->visibility !== 'private'
            || $e->organizer_id === $user->id
            || $e->created_by === $user->id);

        $ics = IcsWriter::write($events, $calendar);

        return response($ics, 200, [
            'Content-Type' => 'text/calendar; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="'.IcsWriter::filename($calendar->name).'"',
        ]);
    }

    /** A single event as its own file. */
    public function exportEvent(Request $request, string $uuid): Response
    {
        $user = $request->user();

        $event = CalendarEvent::where('uuid', $uuid)
            ->with(['calendar', 'organizer:id,name,email', 'attendees.user:id,name,email', 'attendees.group:id,uuid,name'])
            ->firstOrFail();

        $role = CalendarAccess::role($user, $event->calendar);
        abort_if($role === null, 403, 'You do not have access to this event.');
        abort_unless(
            CalendarAccess::atLeast($role, CalendarAccess::ROLE_DETAILS),
            403,
            'You can only see that this time is busy, so it cannot be exported.',
        );

        abort_if(
            $event->visibility === 'private'
                && $event->organizer_id !== $user->id
                && $event->created_by !== $user->id,
            403,
            'That event is private.',
        );

        return response(IcsWriter::write(collect([$event]), $event->calendar), 200, [
            'Content-Type' => 'text/calendar; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="'.IcsWriter::filename($event->title).'"',
        ]);
    }

    /* ── import ──────────────────────────────────────────────── */

    /**
     * Step one: read the file and describe what is in it. Nothing is written.
     */
    public function preview(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CalendarAccess::isStaff($user), 403, 'You cannot import calendars.');

        $request->validate([
            'file' => ['required', 'file', 'max:'.(IcsReader::MAX_BYTES / 1024)],
        ]);

        try {
            $parsed = IcsReader::parse($request->file('file')->get());
        } catch (IcsException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $events = array_map(fn (array $e) => $e + [
            'key' => IcsImporter::keyFor($e),
            'recurrenceLabel' => RecurrenceRule::describe($e['recurrenceRule']),
        ], $parsed['events']);

        return response()->json([
            'events' => $events,
            'failed' => $parsed['failed'],
            'calendarName' => $parsed['calendarName'],
            'summary' => [
                'total' => count($events),
                'recurring' => count(array_filter($events, fn ($e) => (bool) $e['recurrenceRule'])),
                'allDay' => count(array_filter($events, fn ($e) => (bool) $e['allDay'])),
                'unreadable' => count($parsed['failed']),
            ],
        ]);
    }

    /**
     * Step two: write the chosen events onto a calendar.
     *
     * The parsed events are re-sent rather than held server-side, so the
     * preview is stateless and an abandoned import leaves nothing behind.
     */
    public function import(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'calendarId' => ['required', 'string', 'exists:calendars,uuid'],
            'onDuplicate' => ['sometimes', Rule::in(IcsImporter::DUPLICATE_MODES)],
            'keys' => ['sometimes', 'array', 'max:5000'],
            'keys.*' => ['string'],
            'withAttendees' => ['sometimes', 'boolean'],
            'file' => ['required', 'file', 'max:'.(IcsReader::MAX_BYTES / 1024)],
        ]);

        $calendar = Calendar::where('uuid', $data['calendarId'])->firstOrFail();

        abort_unless(CalendarAccess::can($user, $calendar, 'add_events'), 403,
            'You cannot add events to that calendar.');

        try {
            $parsed = IcsReader::parse($request->file('file')->get());
        } catch (IcsException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $result = IcsImporter::import(
            $calendar,
            $parsed['events'],
            $user,
            $data['onDuplicate'] ?? IcsImporter::ON_DUPLICATE_SKIP,
            $data['keys'] ?? null,
            $data['withAttendees'] ?? true,
        );

        // Events the file itself couldn't yield count as failures too — the
        // user cares how many didn't make it, not why they didn't.
        $result['failed'] += count($parsed['failed']);
        $result['errors'] = array_merge($result['errors'], $parsed['failed']);

        \App\Support\Calendar\CalendarAudit::record(
            \App\Support\Calendar\CalendarAudit::ICS_IMPORTED,
            $user, $calendar,
            context: ['imported' => $result['imported'], 'updated' => $result['updated']],
        );

        return response()->json(['result' => $result]);
    }

    /* ── URL subscriptions ───────────────────────────────────── */

    /**
     * Subscribe to an external ICS feed. The calendar is created immediately
     * and filled in by a background refresh, so a slow remote server doesn't
     * hold up the request.
     */
    public function subscribe(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CalendarAccess::isStaff($user), 403, 'You cannot add subscriptions.');

        $data = $request->validate([
            'url' => ['required', 'string', 'max:2048'],
            'name' => ['required', 'string', 'max:255'],
            'colour' => ['sometimes', Rule::in(CalendarColours::keys())],
            // How often to re-check, in minutes. Null/absent = manual only.
            'frequency' => ['sometimes', 'nullable', 'integer', Rule::in([60, 360, 720, 1440])],
        ]);

        try {
            // Resolves and rejects private/reserved addresses before we ever
            // fetch it. See App\Support\Calendar\SubscriptionUrl.
            $url = SubscriptionUrl::validate($data['url']);
        } catch (IcsException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $calendar = Calendar::create([
            'uuid' => (string) Str::uuid(),
            'name' => $data['name'],
            'colour' => $data['colour'] ?? CalendarColours::DEFAULT,
            'calendar_type' => Calendar::TYPE_PERSONAL,
            'owner_id' => $user->id,
            'created_by' => $user->id,
            'timezone' => CalendarProvisioner::defaultTimezone($user),
            'visibility' => 'private',
            'source' => Calendar::SOURCE_ICS_SUBSCRIPTION,
            'subscription_url' => $url,
            'subscription_frequency' => $data['frequency'] ?? 1440,
            'subscription_status' => 'syncing',
        ]);

        CalendarProvisioner::subscribe($user, $calendar);

        RefreshIcsSubscription::dispatch($calendar->id);

        return response()->json([
            'calendar' => $calendar->fresh(['owner'])
                ->toRecord($user, CalendarAccess::ROLE_OWNER, null),
        ]);
    }

    /** Fetch a subscription again now, rather than waiting for the schedule. */
    public function refresh(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = Calendar::where('uuid', $uuid)->firstOrFail();

        abort_unless(CalendarAccess::can($user, $calendar, 'edit_calendar'), 403,
            'You cannot refresh this calendar.');
        abort_unless($calendar->source === Calendar::SOURCE_ICS_SUBSCRIPTION, 422,
            'That calendar is not a subscription.');

        // A manual refresh clears the back-off, since the user has presumably
        // just fixed whatever was wrong.
        $calendar->forceFill([
            'subscription_status' => 'syncing',
            'subscription_failures' => 0,
        ])->save();

        RefreshIcsSubscription::dispatch($calendar->id);

        return response()->json(['status' => 'ok']);
    }

    /** Turn a subscription off without deleting the calendar or its events. */
    public function setEnabled(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = Calendar::where('uuid', $uuid)->firstOrFail();

        abort_unless(CalendarAccess::can($user, $calendar, 'edit_calendar'), 403,
            'You cannot change this calendar.');
        abort_unless($calendar->source === Calendar::SOURCE_ICS_SUBSCRIPTION, 422,
            'That calendar is not a subscription.');

        $enabled = $request->boolean('enabled');

        $calendar->forceFill([
            'subscription_status' => $enabled ? 'syncing' : 'disabled',
            'subscription_failures' => 0,
            'subscription_error' => null,
        ])->save();

        if ($enabled) {
            RefreshIcsSubscription::dispatch($calendar->id);
        }

        return response()->json(['status' => 'ok']);
    }
}
