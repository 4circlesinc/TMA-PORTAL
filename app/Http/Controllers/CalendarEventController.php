<?php

namespace App\Http\Controllers;

use App\Mail\CalendarEventNotice;
use App\Models\Calendar;
use App\Models\CalendarEvent;
use App\Models\CalendarEventAttendee;
use App\Models\CalendarSubscription;
use App\Models\Group;
use App\Models\User;
use App\Support\Calendar\Availability;
use App\Support\Calendar\CalendarAccess;
use App\Support\Calendar\CalendarAudit;
use App\Support\Calendar\CalendarColours;
use App\Support\Calendar\CalendarProvisioner;
use App\Support\Calendar\EventNotifier;
use App\Support\Calendar\GroupMembership;
use App\Support\Calendar\RecurrenceExpander;
use App\Support\Calendar\RecurrenceRule;
use App\Support\Calendar\SeriesEditor;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Events on the Calendar page.
 *
 * Reads are always scoped to a date window and to the calendars the user has
 * *visible* in their sidebar, so switching a checkbox changes what comes back
 * without the client filtering anything itself. Every event is serialised
 * through the viewer's permission level, which is what keeps an
 * availability-only viewer from receiving details they may not read.
 */
class CalendarEventController extends Controller
{
    /** Widest window a single request may ask for, to bound the query. */
    private const MAX_RANGE_DAYS = 400;

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after_or_equal:from'],
            // Optional explicit narrowing; defaults to every visible calendar.
            'calendars' => ['sometimes', 'array'],
            'calendars.*' => ['string'],
        ]);

        $from = CarbonImmutable::parse($data['from']);
        $to = CarbonImmutable::parse($data['to']);

        abort_if($from->diffInDays($to) > self::MAX_RANGE_DAYS, 422, 'That date range is too wide.');

        $subscriptions = CalendarSubscription::where('user_id', $user->id)
            ->where('is_visible', true)
            ->with('calendar')
            ->get()
            ->filter(fn (CalendarSubscription $s) => $s->calendar !== null);

        if (isset($data['calendars'])) {
            $wanted = collect($data['calendars']);
            $subscriptions = $subscriptions->filter(
                fn (CalendarSubscription $s) => $wanted->contains($s->calendar->uuid)
            );
        }

        $calendars = $subscriptions->map->calendar;
        $roles = CalendarAccess::rolesFor($user, $calendars);

        $readable = $calendars->filter(fn (Calendar $c) => isset($roles[$c->id]));

        if ($readable->isEmpty()) {
            return response()->json(['events' => []]);
        }

        $colours = $subscriptions->mapWithKeys(fn (CalendarSubscription $s) => [
            $s->calendar->id => $s->colour_override ?: $s->calendar->colour,
        ]);

        $calendarIds = $readable->pluck('id');

        /*
         * Single events and detached occurrences: anything that physically
         * overlaps the window. Overlap, not containment — an event starting
         * before the window and ending inside it still belongs on the grid.
         */
        $rows = CalendarEvent::query()
            ->whereIn('calendar_id', $calendarIds)
            ->with(['calendar', 'organizer:id,name', 'client:id,uid'])
            ->whereNull('recurrence_rule')
            ->where('starts_at', '<', $to)
            ->where('ends_at', '>', $from)
            ->orderBy('starts_at')
            ->limit(2000)
            ->get();

        /*
         * Series masters are fetched by rule rather than by date, because a
         * weekly meeting that began last year still generates occurrences in
         * this week's window — a date filter would miss it entirely. Masters
         * that have already finished are excluded cheaply via `starts_at`.
         */
        $masters = CalendarEvent::query()
            ->whereIn('calendar_id', $calendarIds)
            ->with(['calendar', 'organizer:id,name', 'client:id,uid'])
            ->whereNotNull('recurrence_rule')
            ->where('starts_at', '<', $to)
            ->limit(200)
            ->get();

        $detached = CalendarEvent::query()
            ->whereIn('calendar_id', $calendarIds)
            ->whereNotNull('series_id')
            ->get(['id', 'series_id', 'recurrence_starts_at']);

        $events = $rows->map(fn (CalendarEvent $e) => $e->toRecord(
            $roles[$e->calendar_id],
            $user->id,
            $colours[$e->calendar_id] ?? null,
        ))->values()->all();

        foreach (RecurrenceExpander::expandAll($masters, $detached, $from, $to) as $occurrence) {
            $master = $occurrence['master'];
            $events[] = RecurrenceExpander::toRecord(
                $occurrence,
                $roles[$master->calendar_id],
                $user->id,
                $colours[$master->calendar_id] ?? null,
            );
        }

        usort($events, fn ($a, $b) => strcmp((string) $a['startsAt'], (string) $b['startsAt']));

        return response()->json(['events' => $events]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $this->validated($request);

        $calendar = isset($data['calendarId'])
            ? Calendar::where('uuid', $data['calendarId'])->firstOrFail()
            : CalendarProvisioner::personalFor($user);

        abort_unless(CalendarAccess::can($user, $calendar, 'add_events'), 403,
            'You cannot add events to this calendar.');

        $times = $this->resolveTimes($data, $calendar);

        $event = CalendarEvent::create([
            'uuid' => (string) Str::uuid(),
            'calendar_id' => $calendar->id,
            'title' => $data['title'],
            'description' => $data['description'] ?? null,
            'location' => $data['location'] ?? null,
            'starts_at' => $times['starts_at'],
            'ends_at' => $times['ends_at'],
            'all_day' => $times['all_day'],
            'timezone' => $times['timezone'],
            'status' => $data['status'] ?? CalendarEvent::STATUS_CONFIRMED,
            'visibility' => $data['visibility'] ?? 'default',
            'colour' => $data['colour'] ?? null,
            'meeting_url' => $data['meetingUrl'] ?? null,
            'organizer_id' => $user->id,
            'created_by' => $user->id,
            'updated_by' => $user->id,
            'recurrence_rule' => RecurrenceRule::build($data['recurrence'] ?? []),
        ]);

        CalendarAudit::record(CalendarAudit::EVENT_CREATED, $user, $calendar, $event);

        return $this->eventJson($event, $user);
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $data = $this->validated($request, partial: true);
        $scope = $request->input('scope', SeriesEditor::SCOPE_ALL);

        /*
         * A recurring occurrence arrives as `<master-uuid>@<instant>` rather
         * than a row id. Which row the edit lands on depends on the scope:
         * "this" detaches the single instance, "following" splits the series,
         * "all" edits the master in place.
         */
        $occurrence = RecurrenceExpander::parseOccurrenceId($uuid);

        if ($occurrence) {
            [$masterUuid, $instant] = $occurrence;
            $master = $this->find($masterUuid);

            abort_unless($this->canWrite($user, $master), 403, 'You cannot edit this event.');

            $event = match ($scope) {
                SeriesEditor::SCOPE_THIS => SeriesEditor::materialise($master, $instant, $user),
                SeriesEditor::SCOPE_FOLLOWING => SeriesEditor::split($master, $instant, $user),
                default => $master,
            };

            // The row is now a plain event as far as the rest of update() is
            // concerned; re-read it with the relations that method expects.
            $event = $this->find($event->uuid);
        } else {
            $event = $this->find($uuid);
        }

        abort_unless($this->canWrite($user, $event), 403, 'You cannot edit this event.');

        /*
         * Snapshot what invitees care about *before* anything is written, so
         * the change notice can say what actually moved rather than "something
         * changed". Only the fields that would make someone rearrange their
         * day — a note edit should not mail thirty people.
         */
        $before = [
            'title' => $event->title,
            'startsAt' => $event->starts_at?->toIso8601String(),
            'endsAt' => $event->ends_at?->toIso8601String(),
            'location' => $event->location,
        ];

        // Moving an event to another calendar needs permission on both ends.
        $movedCalendar = false;
        if (isset($data['calendarId']) && $data['calendarId'] !== $event->calendar->uuid) {
            $target = Calendar::where('uuid', $data['calendarId'])->firstOrFail();
            abort_unless(CalendarAccess::can($user, $target, 'add_events'), 403,
                'You cannot move events into that calendar.');
            $event->calendar_id = $target->id;
            $event->setRelation('calendar', $target);
            $movedCalendar = true;
        }

        foreach ([
            'title' => 'title',
            'description' => 'description',
            'location' => 'location',
            'status' => 'status',
            'visibility' => 'visibility',
            'colour' => 'colour',
            'meetingUrl' => 'meeting_url',
        ] as $input => $column) {
            if (array_key_exists($input, $data)) {
                $event->{$column} = $data[$input];
            }
        }

        // Times move together — a start without an end is not a valid edit.
        if (isset($data['startsAt']) || isset($data['endsAt'])) {
            $times = $this->resolveTimes([
                'startsAt' => $data['startsAt'] ?? $event->starts_at->toIso8601String(),
                'endsAt' => $data['endsAt'] ?? $event->ends_at->toIso8601String(),
                'allDay' => $data['allDay'] ?? $event->all_day,
                'timezone' => $data['timezone'] ?? $event->timezone,
            ], $event->calendar);

            $event->starts_at = $times['starts_at'];
            $event->ends_at = $times['ends_at'];
            $event->all_day = $times['all_day'];
            $event->timezone = $times['timezone'];
        }

        // Recurrence is only settable on a series master or a plain event —
        // a detached occurrence is by definition a single instance.
        if (array_key_exists('recurrence', $data) && $event->series_id === null) {
            $event->recurrence_rule = RecurrenceRule::build($data['recurrence']);
        }

        $event->updated_by = $user->id;
        $event->save();

        // Only worth an email if something an invitee would act on moved, and
        // only if anyone was actually invited.
        $changes = $this->describeChanges($before, $event);
        if ($changes && $event->attendees()->exists()) {
            EventNotifier::notify($event, CalendarEventNotice::KIND_UPDATED, null, ['changes' => $changes]);
        }

        CalendarAudit::record(
            $movedCalendar ? CalendarAudit::EVENT_MOVED : CalendarAudit::EVENT_UPDATED,
            $user, $event->calendar, $event,
            context: $changes ? ['changes' => $changes] : [],
        );

        return $this->eventJson($event, $user);
    }

    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $scope = $request->input('scope', SeriesEditor::SCOPE_ALL);

        // Deleting one occurrence of a series excludes that instant rather
        // than removing a row — there is no row for a virtual occurrence.
        $occurrence = RecurrenceExpander::parseOccurrenceId($uuid);

        if ($occurrence) {
            [$masterUuid, $instant] = $occurrence;
            $master = $this->find($masterUuid);

            abort_unless($this->canWrite($user, $master), 403, 'You cannot delete this event.');

            if ($master->attendees()->exists() && $scope === SeriesEditor::SCOPE_ALL) {
                EventNotifier::notify($master, CalendarEventNotice::KIND_CANCELLED);
            }

            SeriesEditor::delete($master, $scope, $instant);

            return response()->json(['status' => 'ok']);
        }

        $event = $this->find($uuid);

        abort_unless($this->canWrite($user, $event), 403, 'You cannot delete this event.');

        // Sent before the delete: the notifier reads the guest list off the
        // event, and the cascade takes it with the row.
        if ($event->attendees()->exists()) {
            EventNotifier::notify($event, CalendarEventNotice::KIND_CANCELLED);
        }

        CalendarAudit::record(CalendarAudit::EVENT_DELETED, $user, $event->calendar, $event);

        // A master carries its detached occurrences with it.
        if ($event->recurrence_rule) {
            SeriesEditor::delete($event, $scope, null);

            return response()->json(['status' => 'ok']);
        }

        $event->delete();

        return response()->json(['status' => 'ok']);
    }

    /** The detail panel's Mark completed toggle. */
    public function complete(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $event = $this->find($uuid);

        abort_unless($this->canWrite($user, $event), 403, 'You cannot change this event.');

        $event->completed_at = $event->completed_at ? null : now();
        $event->updated_by = $user->id;
        $event->save();

        return $this->eventJson($event, $user);
    }

    /* ── attendees and invitations ───────────────────────────── */

    /** The full event including its guest list and their responses. */
    public function show(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $event = $this->find($uuid, withAttendees: true);

        $role = CalendarAccess::role($user, $event->calendar);
        abort_if($role === null, 403, 'You do not have access to this event.');

        return $this->eventJson($event, $user, withAttendees: true);
    }

    /**
     * Invite people, groups, or bare email addresses. Only the newly added
     * rows are emailed, so re-opening the guest list doesn't spam everyone
     * who was already on it.
     */
    public function invite(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $event = $this->find($uuid);

        abort_unless($this->canWrite($user, $event), 403, 'You cannot change this event.');

        $data = $request->validate([
            'userIds' => ['sometimes', 'array', 'max:256'],
            'userIds.*' => ['integer', 'exists:users,id'],
            'groupIds' => ['sometimes', 'array', 'max:64'],
            'groupIds.*' => ['string', 'exists:groups,uuid'],
            'emails' => ['sometimes', 'array', 'max:256'],
            'emails.*' => ['email'],
            'optional' => ['sometimes', 'boolean'],
            'notify' => ['sometimes', 'boolean'],
        ]);

        $optional = $data['optional'] ?? false;
        $added = [];

        foreach ($data['userIds'] ?? [] as $id) {
            $attendee = CalendarEventAttendee::firstOrCreate(
                ['event_id' => $event->id, 'user_id' => $id],
                ['attendee_type' => CalendarEventAttendee::TYPE_USER, 'is_optional' => $optional],
            );
            if ($attendee->wasRecentlyCreated) {
                $added[] = $attendee->id;
            }
        }

        foreach ($data['groupIds'] ?? [] as $groupUuid) {
            $group = Group::where('uuid', $groupUuid)->firstOrFail();
            $attendee = CalendarEventAttendee::firstOrCreate(
                ['event_id' => $event->id, 'group_id' => $group->id],
                ['attendee_type' => CalendarEventAttendee::TYPE_GROUP, 'is_optional' => $optional],
            );
            if ($attendee->wasRecentlyCreated) {
                $added[] = $attendee->id;
            }
        }

        foreach ($data['emails'] ?? [] as $email) {
            /*
             * An address that belongs to a portal account becomes a user
             * attendee rather than a bare email, so they can actually reply
             * in the portal instead of being a dead entry on the list.
             */
            $existing = User::where('email', $email)->first();

            $attendee = $existing
                ? CalendarEventAttendee::firstOrCreate(
                    ['event_id' => $event->id, 'user_id' => $existing->id],
                    ['attendee_type' => CalendarEventAttendee::TYPE_USER, 'is_optional' => $optional],
                )
                : CalendarEventAttendee::firstOrCreate(
                    ['event_id' => $event->id, 'email' => $email],
                    ['attendee_type' => CalendarEventAttendee::TYPE_EMAIL, 'is_optional' => $optional],
                );

            if ($attendee->wasRecentlyCreated) {
                $added[] = $attendee->id;
            }
        }

        if ($added && ($data['notify'] ?? true)) {
            EventNotifier::notify($event, CalendarEventNotice::KIND_INVITATION, $added);
        }

        if ($added) {
            CalendarAudit::record(CalendarAudit::INVITATION_SENT, $user, $event->calendar, $event,
                context: ['count' => count($added)]);
        }

        return $this->eventJson($event->fresh(), $user, withAttendees: true);
    }

    public function removeAttendee(Request $request, string $uuid, int $attendeeId): JsonResponse
    {
        $user = $request->user();
        $event = $this->find($uuid);

        abort_unless($this->canWrite($user, $event), 403, 'You cannot change this event.');

        CalendarEventAttendee::where('event_id', $event->id)->where('id', $attendeeId)->delete();

        return $this->eventJson($event->fresh(), $user, withAttendees: true);
    }

    /**
     * Accept, decline, or mark tentative.
     *
     * The caller answers for themselves only — an organizer cannot RSVP on
     * someone else's behalf, so the attendee row is resolved from the signed-in
     * user rather than taken from the request.
     */
    public function respond(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $event = $this->find($uuid);

        $data = $request->validate([
            'response' => ['required', Rule::in([
                CalendarEventAttendee::ACCEPTED,
                CalendarEventAttendee::TENTATIVE,
                CalendarEventAttendee::DECLINED,
            ])],
        ]);

        $attendee = CalendarEventAttendee::where('event_id', $event->id)
            ->where('user_id', $user->id)
            ->first();

        /*
         * Someone invited only through a group has no row of their own yet.
         * Replying creates one, which is what turns "Marketing is invited"
         * into "Marketing is invited, and Sam accepted" without the organizer
         * losing the group on the list.
         */
        if (! $attendee) {
            $viaGroup = CalendarEventAttendee::where('event_id', $event->id)
                ->where('attendee_type', CalendarEventAttendee::TYPE_GROUP)
                ->whereIn('group_id', GroupMembership::idsFor($user))
                ->exists();

            abort_unless($viaGroup, 403, 'You were not invited to this event.');

            $attendee = CalendarEventAttendee::create([
                'event_id' => $event->id,
                'attendee_type' => CalendarEventAttendee::TYPE_USER,
                'user_id' => $user->id,
            ]);
        }

        $attendee->response = $data['response'];
        $attendee->responded_at = now();
        $attendee->save();

        EventNotifier::notifyOrganizerOfResponse($event, $attendee);

        CalendarAudit::record(CalendarAudit::RESPONSE_RECEIVED, $user, $event->calendar, $event,
            context: ['response' => EventNotifier::responseLabel($attendee->response)]);

        return $this->eventJson($event->fresh(), $user, withAttendees: true);
    }

    /* ── availability ────────────────────────────────────────── */

    /**
     * Free/busy for a set of people and groups over a window, plus the first
     * slot where everyone is free.
     */
    public function availability(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after:from'],
            'userIds' => ['sometimes', 'array', 'max:64'],
            'userIds.*' => ['integer', 'exists:users,id'],
            'groupIds' => ['sometimes', 'array', 'max:16'],
            'groupIds.*' => ['string', 'exists:groups,uuid'],
            'slotMinutes' => ['sometimes', 'integer', 'min:5', 'max:1440'],
        ]);

        $from = CarbonImmutable::parse($data['from']);
        $to = CarbonImmutable::parse($data['to']);

        abort_if($from->diffInDays($to) > 31, 422, 'That availability range is too wide.');

        $users = User::whereIn('id', $data['userIds'] ?? [])->get();

        // Groups contribute their members, deduplicated against the people
        // already named directly.
        foreach ($data['groupIds'] ?? [] as $groupUuid) {
            $group = Group::where('uuid', $groupUuid)->firstOrFail();
            $users = $users->concat(GroupMembership::usersIn($group));
        }

        $users = $users->unique('id')->values();

        $availability = Availability::forUsers($user, $users, $from, $to);

        $suggestion = null;
        if (! empty($data['slotMinutes']) && $availability) {
            $suggestion = Availability::firstFreeSlot($availability, $from, $to, $data['slotMinutes']);
        }

        return response()->json([
            'availability' => array_values($availability),
            'suggestion' => $suggestion,
        ]);
    }

    /* ── helpers ─────────────────────────────────────────────── */

    private function find(string $uuid, bool $withAttendees = false): CalendarEvent
    {
        return CalendarEvent::where('uuid', $uuid)
            ->with(array_merge(
                // email is load-bearing: the organizer is emailed when someone
                // responds, and omitting it made that silently never fire.
                ['calendar', 'organizer:id,name,email', 'client:id,uid'],
                $withAttendees ? ['attendees.user:id,name,email,avatar_url', 'attendees.group:id,uuid,name'] : [],
            ))
            ->firstOrFail();
    }

    /**
     * Whether the user may change this specific event.
     *
     * Contributors are a special case: they may add events, and may edit the
     * ones they added, but not anybody else's.
     */
    private function canWrite($user, CalendarEvent $event): bool
    {
        if (CalendarAccess::can($user, $event->calendar, 'edit_events')) {
            return true;
        }

        return CalendarAccess::can($user, $event->calendar, 'add_events')
            && $event->created_by === $user->id;
    }

    /**
     * Plain-language list of what changed, for the update notice. Empty when
     * nothing an invitee would act on moved — an edit to the private notes
     * should not mail thirty people.
     *
     * @param  array<string, mixed>  $before
     * @return array<int, string>
     */
    private function describeChanges(array $before, CalendarEvent $event): array
    {
        $changes = [];

        if ($before['title'] !== $event->title) {
            $changes[] = 'Renamed from “'.$before['title'].'”';
        }

        if ($before['startsAt'] !== $event->starts_at?->toIso8601String()
            || $before['endsAt'] !== $event->ends_at?->toIso8601String()) {
            $tz = $event->timezone ?: 'UTC';
            $changes[] = 'Moved to '.$event->starts_at->setTimezone($tz)->format('l, j F Y · H:i');
        }

        if ($before['location'] !== $event->location) {
            $changes[] = $event->location
                ? 'Location is now '.$event->location
                : 'Location removed';
        }

        return $changes;
    }

    /**
     * The single-event JSON body. Named `eventJson` rather than `respond`
     * because `respond()` is the RSVP action.
     */
    private function eventJson(CalendarEvent $event, $user, bool $withAttendees = false): JsonResponse
    {
        $with = ['calendar', 'organizer:id,name', 'client:id,uid'];
        if ($withAttendees) {
            $with[] = 'attendees.user:id,name,email,avatar_url';
            $with[] = 'attendees.group:id,uuid,name';
        }

        $event = $event->fresh($with);
        $role = CalendarAccess::role($user, $event->calendar) ?? CalendarAccess::ROLE_DETAILS;

        $subscription = CalendarSubscription::where('user_id', $user->id)
            ->where('calendar_id', $event->calendar_id)
            ->first();

        $record = $event->toRecord(
            $role,
            $user->id,
            $subscription?->colour_override ?: $event->calendar->colour,
        );

        if ($withAttendees) {
            $record['myInvitation'] = $this->myInvitation($event, $user);
        }

        return response()->json(['event' => $record]);
    }

    /**
     * The viewer's own place on the guest list, or null if they aren't on it.
     *
     * Resolved here rather than by the client hunting for its own row, because
     * someone invited only through a group has no row yet — they still need
     * the RSVP buttons, and replying is what creates the row.
     *
     * @return array<string, mixed>|null
     */
    private function myInvitation(CalendarEvent $event, User $user): ?array
    {
        $own = $event->attendees->firstWhere('user_id', $user->id);

        if ($own) {
            return ['attendeeId' => $own->id, 'response' => $own->response, 'viaGroup' => false];
        }

        $groupIds = GroupMembership::idsFor($user);
        $viaGroup = $event->attendees->first(
            fn (CalendarEventAttendee $a) => $a->attendee_type === CalendarEventAttendee::TYPE_GROUP
                && in_array($a->group_id, $groupIds, true)
        );

        return $viaGroup
            ? ['attendeeId' => null, 'response' => CalendarEventAttendee::NEEDS_ACTION, 'viaGroup' => true]
            : null;
    }

    /**
     * Normalise the submitted times into stored instants.
     *
     * All-day events are snapped to midnight-to-midnight in the event's own
     * zone and the end is made exclusive (a one-day event ends at the next
     * midnight), which is both what the grid expects and what ICS export will
     * need later.
     *
     * The result is converted to UTC before it is returned. The zone the event
     * was authored in is not lost — it is kept in `timezone`, which is the
     * column recurrence and ICS export read. Storing UTC explicitly means the
     * instant survives a driver that serialises without an offset, rather than
     * being re-read as a different moment.
     *
     * @param  array<string, mixed>  $data
     * @return array{starts_at: CarbonImmutable, ends_at: CarbonImmutable, all_day: bool, timezone: string}
     */
    private function resolveTimes(array $data, Calendar $calendar): array
    {
        $tz = $data['timezone'] ?? $calendar->timezone ?? 'UTC';
        $allDay = (bool) ($data['allDay'] ?? false);

        $starts = CarbonImmutable::parse($data['startsAt'], $tz);
        $ends = CarbonImmutable::parse($data['endsAt'], $tz);

        if ($allDay) {
            $starts = $starts->setTimezone($tz)->startOfDay();
            $ends = $ends->setTimezone($tz)->startOfDay();
            if ($ends <= $starts) {
                $ends = $starts->addDay();
            }
        } elseif ($ends <= $starts) {
            abort(422, 'The end time must be after the start time.');
        }

        return [
            'starts_at' => $starts->utc(),
            'ends_at' => $ends->utc(),
            'all_day' => $allDay,
            'timezone' => $tz,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, bool $partial = false): array
    {
        $rule = fn (array $rules) => $partial ? array_merge(['sometimes'], $rules) : $rules;

        return $request->validate([
            'calendarId' => ['sometimes', 'nullable', 'string'],
            'title' => $rule(['required', 'string', 'max:255']),
            'description' => ['sometimes', 'nullable', 'string', 'max:20000'],
            'location' => ['sometimes', 'nullable', 'string', 'max:255'],
            'startsAt' => $rule(['required', 'date']),
            'endsAt' => $rule(['required', 'date']),
            'allDay' => ['sometimes', 'boolean'],
            'timezone' => ['sometimes', 'string', Rule::in(timezone_identifiers_list())],
            'status' => ['sometimes', Rule::in(CalendarEvent::STATUSES)],
            'visibility' => ['sometimes', Rule::in(CalendarEvent::VISIBILITIES)],
            'colour' => ['sometimes', 'nullable', Rule::in(CalendarColours::keys())],
            'meetingUrl' => ['sometimes', 'nullable', 'url', 'max:2048'],

            // Recurrence arrives as the form's shape and is turned into an
            // RRULE by RecurrenceRule::build().
            'recurrence' => ['sometimes', 'array'],
            'recurrence.freq' => ['sometimes', 'nullable', 'string'],
            'recurrence.interval' => ['sometimes', 'integer', 'min:1', 'max:366'],
            'recurrence.byDay' => ['sometimes', 'array'],
            'recurrence.byDay.*' => ['string', Rule::in(RecurrenceRule::DAYS)],
            'recurrence.count' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000'],
            'recurrence.until' => ['sometimes', 'nullable', 'date'],

            // Which part of a series an edit or delete applies to.
            'scope' => ['sometimes', Rule::in(SeriesEditor::SCOPES)],
        ]);
    }
}
