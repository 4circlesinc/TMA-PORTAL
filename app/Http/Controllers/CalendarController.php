<?php

namespace App\Http\Controllers;

use App\Models\Calendar;
use App\Models\CalendarMember;
use App\Models\CalendarSubscription;
use App\Models\Group;
use App\Models\User;
use App\Support\Calendar\CalendarAccess;
use App\Support\Calendar\CalendarAudit;
use App\Support\Calendar\CalendarColours;
use App\Support\Calendar\CalendarProvisioner;
use App\Support\Calendar\GroupMembership;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * The calendar list behind the Calendar page's sidebar: which calendars a user
 * has, what they may do with each, and their personal show/hide and colour.
 *
 * Events live in CalendarEventController. Permission is always resolved
 * through CalendarAccess — the sidebar's hidden actions are never trusted.
 */
class CalendarController extends Controller
{
    /**
     * Plain-language names for the permission ladder, served with the sharing
     * panel so the wording lives beside the roles rather than being restated
     * in JavaScript.
     */
    private const ROLE_LABELS = [
        CalendarAccess::ROLE_AVAILABILITY => 'See availability only',
        CalendarAccess::ROLE_TITLES => 'View event titles',
        CalendarAccess::ROLE_DETAILS => 'View full event details',
        CalendarAccess::ROLE_CONTRIBUTOR => 'Add events',
        CalendarAccess::ROLE_EDITOR => 'Edit and delete events',
        CalendarAccess::ROLE_MANAGER => 'Manage sharing',
        CalendarAccess::ROLE_OWNER => 'Full administration',
    ];

    /**
     * Every calendar in the signed-in user's sidebar, already grouped into
     * the sections the sidebar renders.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        // Guarantees a landing place for a new event on a brand-new account.
        CalendarProvisioner::personalFor($user);

        $subscriptions = CalendarSubscription::where('user_id', $user->id)
            ->with(['calendar.owner', 'calendar.client'])
            ->orderBy('sort_order')
            ->get()
            // A soft-deleted calendar leaves its subscription behind.
            ->filter(fn (CalendarSubscription $s) => $s->calendar !== null);

        $calendars = $subscriptions->map->calendar;
        $roles = CalendarAccess::rolesFor($user, $calendars);

        $records = $subscriptions
            // Access can be revoked after subscribing; drop what they can no
            // longer see rather than rendering a calendar that returns 403s.
            ->filter(fn (CalendarSubscription $s) => isset($roles[$s->calendar->id]))
            ->map(fn (CalendarSubscription $s) => $s->calendar->toRecord(
                $user,
                $roles[$s->calendar->id],
                $s
            ))
            ->values();

        $prefs = $user->preferences ?? [];

        return response()->json([
            'calendars' => $records,
            'sections' => $this->sectionOrder(),
            'defaultCalendar' => CalendarProvisioner::personalFor($user)->uuid,
            'timezone' => CalendarProvisioner::defaultTimezone($user),
            'canCreate' => CalendarAccess::isStaff($user),
            'colours' => CalendarColours::keys(),
            /*
             * The page's remembered chrome, served here rather than fetched
             * separately: the calendar list is already the first request the
             * page makes, and a second round trip would let the page paint in
             * the wrong view before correcting itself.
             */
            'preferences' => [
                'view' => in_array($prefs['calendarView'] ?? null, ['week', 'month', 'agenda'], true)
                    ? $prefs['calendarView']
                    : 'week',
                'sidebarOpen' => (bool) ($prefs['calendarSidebarOpen'] ?? true),
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        // Clients get the personal calendar they are provisioned and nothing
        // more; creating shared or group calendars is a staff action.
        abort_unless(CalendarAccess::isStaff($user), 403, 'You cannot create calendars.');

        $data = $this->validated($request);

        // Only administrators may stand up organization-wide calendars.
        if (($data['calendar_type'] ?? null) === Calendar::TYPE_ORGANIZATION) {
            abort_unless(CalendarAccess::isAdmin($user), 403, 'Only administrators can create organization calendars.');
        }

        $calendar = Calendar::create($data + [
            'uuid' => (string) Str::uuid(),
            'owner_id' => $user->id,
            'created_by' => $user->id,
            'source' => Calendar::SOURCE_LOCAL,
        ]);

        CalendarProvisioner::subscribe($user, $calendar);
        CalendarAudit::record(CalendarAudit::CALENDAR_CREATED, $user, $calendar);

        return response()->json([
            'calendar' => $calendar->fresh(['owner', 'client'])
                ->toRecord($user, CalendarAccess::ROLE_OWNER, $this->subscription($user, $calendar)),
        ]);
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        abort_unless(CalendarAccess::can($user, $calendar, 'edit_calendar'), 403, 'You cannot edit this calendar.');

        $data = $this->validated($request, partial: true);

        if (array_key_exists('calendar_type', $data) && $data['calendar_type'] === Calendar::TYPE_ORGANIZATION) {
            abort_unless(CalendarAccess::isAdmin($user), 403, 'Only administrators can create organization calendars.');
        }

        // The personal calendar is the guaranteed destination for new events;
        // letting it be retyped or shared out would break that guarantee.
        if ($calendar->is_system) {
            unset($data['calendar_type'], $data['visibility']);
        }

        $calendar->fill($data)->save();

        $role = CalendarAccess::role($user, $calendar) ?? CalendarAccess::ROLE_DETAILS;

        return response()->json([
            'calendar' => $calendar->fresh(['owner', 'client'])
                ->toRecord($user, $role, $this->subscription($user, $calendar)),
        ]);
    }

    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        abort_unless(CalendarAccess::can($user, $calendar, 'delete_calendar'), 403, 'You cannot delete this calendar.');
        abort_if($calendar->is_system, 422, 'Your personal calendar cannot be deleted.');

        CalendarAudit::record(CalendarAudit::CALENDAR_DELETED, $user, $calendar);

        // Soft delete: events go with it and both can be restored.
        $calendar->delete();

        return response()->json(['status' => 'ok']);
    }

    /**
     * Add a calendar to the signed-in user's sidebar. Adding never transfers
     * ownership and never grants access — the caller must already have it.
     */
    public function subscribe(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        $role = CalendarAccess::role($user, $calendar);
        abort_if($role === null, 403, 'You do not have access to this calendar.');

        $subscription = CalendarProvisioner::subscribe($user, $calendar);

        return response()->json([
            'calendar' => $calendar->fresh(['owner', 'client'])->toRecord($user, $role, $subscription),
        ]);
    }

    /**
     * Remove a calendar from the sidebar. The calendar itself is untouched —
     * this is the "remove from my list without deleting it" action.
     */
    public function unsubscribe(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        abort_if($calendar->is_system, 422, 'Your personal calendar cannot be removed from your list.');

        CalendarSubscription::where('user_id', $user->id)
            ->where('calendar_id', $calendar->id)
            ->delete();

        return response()->json(['status' => 'ok']);
    }

    /**
     * The signed-in user's own view of a calendar: shown/hidden, and their
     * colour. Never touches the calendar or anyone else's view of it.
     */
    public function updateSubscription(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        $role = CalendarAccess::role($user, $calendar);
        abort_if($role === null, 403, 'You do not have access to this calendar.');

        $data = $request->validate([
            'visible' => ['sometimes', 'boolean'],
            'colour' => ['sometimes', 'nullable', Rule::in(CalendarColours::keys())],
        ]);

        $subscription = CalendarProvisioner::subscribe($user, $calendar);

        if (array_key_exists('visible', $data)) {
            $subscription->is_visible = $data['visible'];
        }

        /*
         * Who a colour change belongs to depends on whether the caller runs
         * the calendar.
         *
         * An owner or manager sets the *official* colour, which everyone sees
         * — that is the rule for organization and group calendars. Anyone else
         * is only recolouring their own sidebar, so their choice is stored as
         * a personal override and is invisible to the rest of the firm.
         */
        if (array_key_exists('colour', $data)) {
            if (CalendarAccess::can($user, $calendar, 'edit_calendar')) {
                $calendar->colour = $data['colour'] ?: $calendar->colour;
                $calendar->save();
                // Clear any stale personal override so the official colour
                // isn't immediately masked for the person who just set it.
                $subscription->colour_override = null;
            } else {
                $subscription->colour_override = $data['colour'];
            }
        }

        $subscription->save();

        return response()->json([
            'calendar' => $calendar->fresh(['owner', 'client'])->toRecord($user, $role, $subscription->fresh()),
        ]);
    }

    /**
     * Calendars and colleagues the user could add but hasn't — what the
     * sidebar's "Add calendar → browse" and staff search read from.
     */
    public function discover(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CalendarAccess::isStaff($user), 403, 'You cannot browse calendars.');

        $query = trim((string) $request->query('q', ''));
        $like = $this->likeOperator();

        $subscribed = CalendarSubscription::where('user_id', $user->id)->pluck('calendar_id');

        $candidates = Calendar::query()
            ->with(['owner', 'client'])
            ->whereNotIn('id', $subscribed)
            ->where('is_archived', false)
            ->when($query !== '', fn ($q) => $q->where('name', $like, '%'.$query.'%'))
            ->orderBy('name')
            ->limit(50)
            ->get();

        $roles = CalendarAccess::rolesFor($user, $candidates);

        $calendars = $candidates
            ->filter(fn (Calendar $c) => isset($roles[$c->id]))
            ->map(fn (Calendar $c) => $c->toRecord($user, $roles[$c->id], null))
            ->values();

        // Staff search, so a colleague's calendar can be requested by name.
        $people = User::query()
            ->whereIn('account_type', ['Administrator', 'Employee'])
            ->where('id', '!=', $user->id)
            ->when($query !== '', fn ($q) => $q->where(function ($w) use ($query, $like) {
                $w->where('name', $like, '%'.$query.'%')
                    ->orWhere('email', $like, '%'.$query.'%');
            }))
            ->orderBy('name')
            ->limit(20)
            ->get(['id', 'name', 'email', 'avatar_url', 'job_title'])
            ->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'avatarUrl' => $u->avatar_url,
                'jobTitle' => $u->job_title,
            ]);

        // Groups, so a calendar can be shared with a whole team by name.
        $groups = Group::query()
            ->where('is_archived', false)
            ->when($query !== '', fn ($q) => $q->where('name', $like, '%'.$query.'%'))
            ->orderBy('name')
            ->limit(20)
            ->get(['id', 'uuid', 'name', 'group_type'])
            ->map(fn (Group $g) => [
                'id' => $g->uuid,
                'name' => $g->name,
                'type' => $g->group_type,
            ]);

        return response()->json([
            'calendars' => $calendars,
            'people' => $people,
            'groups' => $groups,
        ]);
    }

    /** Who a calendar is shared with, and at what level. */
    public function members(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        abort_unless(CalendarAccess::can($user, $calendar, 'manage_sharing'), 403, 'You cannot manage sharing.');

        $members = CalendarMember::where('calendar_id', $calendar->id)
            ->with(['user:id,name,email,avatar_url', 'group:id,uuid,name,group_type'])
            ->get()
            ->map(fn (CalendarMember $m) => $m->member_type === 'group'
                ? [
                    'type' => 'group',
                    'groupId' => $m->group?->uuid,
                    'name' => $m->group?->name,
                    'groupType' => $m->group?->group_type,
                    'role' => $m->role,
                ]
                : [
                    'type' => 'user',
                    'userId' => $m->user_id,
                    'name' => $m->user?->name,
                    'email' => $m->user?->email,
                    'avatarUrl' => $m->user?->avatar_url,
                    'role' => $m->role,
                ])
            // A grant whose user or group has since been deleted has nothing
            // left to show; the cascade will clear the row.
            ->filter(fn (array $m) => $m['name'] !== null)
            ->values();

        return response()->json([
            'members' => $members,
            'owner' => ['userId' => $calendar->owner_id, 'name' => $calendar->owner?->name],
            'roles' => CalendarAccess::ROLES,
            'roleLabels' => self::ROLE_LABELS,
        ]);
    }

    /**
     * Share a calendar with a colleague or a group, or change the level of an
     * existing grant. Re-sharing updates the role rather than stacking rows.
     */
    public function addMember(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        abort_unless(CalendarAccess::can($user, $calendar, 'manage_sharing'), 403, 'You cannot manage sharing.');

        $data = $request->validate([
            'userId' => ['sometimes', 'integer', 'exists:users,id'],
            'groupId' => ['sometimes', 'string', 'exists:groups,uuid'],
            'role' => ['required', Rule::in(CalendarAccess::ROLES)],
        ]);

        abort_unless(isset($data['userId']) xor isset($data['groupId']), 422,
            'Share with either a person or a group.');

        // Only the owner may hand out ownership-level administration.
        if ($data['role'] === CalendarAccess::ROLE_OWNER) {
            abort_unless($calendar->owner_id === $user->id || CalendarAccess::isAdmin($user), 403,
                'Only the calendar owner can grant full administration.');
        }

        if (isset($data['groupId'])) {
            $group = Group::where('uuid', $data['groupId'])->firstOrFail();

            $grant = CalendarMember::where('calendar_id', $calendar->id)
                ->where('member_type', 'group')->where('group_id', $group->id)->exists();

            CalendarMember::updateOrCreate(
                ['calendar_id' => $calendar->id, 'member_type' => 'group', 'group_id' => $group->id],
                ['role' => $data['role'], 'added_by' => $user->id],
            );

            CalendarAudit::record(
                $grant ? CalendarAudit::PERMISSION_CHANGED : CalendarAudit::CALENDAR_SHARED,
                $user, $calendar, context: ['with' => $group->name, 'role' => $data['role']],
            );

            return response()->json(['status' => 'ok']);
        }

        abort_if((int) $data['userId'] === $calendar->owner_id, 422, 'The owner already has full access.');

        $target = User::findOrFail($data['userId']);

        /*
         * Clients never receive access to internal calendars by this route. A
         * client sees an event only when it is shared with them explicitly,
         * which is the client-calendar phase's job.
         */
        abort_unless(CalendarAccess::isStaff($target), 422,
            'Client accounts cannot be added to internal calendars.');

        $grant = CalendarMember::where('calendar_id', $calendar->id)
            ->where('member_type', 'user')->where('user_id', $target->id)->exists();

        CalendarMember::updateOrCreate(
            ['calendar_id' => $calendar->id, 'member_type' => 'user', 'user_id' => $target->id],
            ['role' => $data['role'], 'added_by' => $user->id],
        );

        CalendarAudit::record(
            $grant ? CalendarAudit::PERMISSION_CHANGED : CalendarAudit::CALENDAR_SHARED,
            $user, $calendar, context: ['with' => $target->name, 'role' => $data['role']],
        );

        return response()->json(['status' => 'ok']);
    }

    public function removeMember(Request $request, string $uuid, int $userId): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        abort_unless(CalendarAccess::can($user, $calendar, 'manage_sharing'), 403, 'You cannot manage sharing.');

        CalendarMember::where('calendar_id', $calendar->id)
            ->where('member_type', 'user')
            ->where('user_id', $userId)
            ->delete();

        // Their sidebar entry goes too, so it can't linger and 403. Only safe
        // for a direct grant — a group member may still reach the calendar
        // through the group, and revokeGroup re-checks that properly.
        if (CalendarAccess::role(User::findOrFail($userId), $calendar->fresh()) === null) {
            CalendarSubscription::where('calendar_id', $calendar->id)
                ->where('user_id', $userId)
                ->delete();
        }

        return response()->json(['status' => 'ok']);
    }

    /** Withdraw a whole group's access to a calendar. */
    public function removeGroupMember(Request $request, string $uuid, string $groupUuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        abort_unless(CalendarAccess::can($user, $calendar, 'manage_sharing'), 403, 'You cannot manage sharing.');

        $group = Group::where('uuid', $groupUuid)->firstOrFail();

        CalendarMember::where('calendar_id', $calendar->id)
            ->where('member_type', 'group')
            ->where('group_id', $group->id)
            ->delete();

        /*
         * Drop the sidebar entry for anyone who reached this calendar only
         * through the group — but keep it for those who also hold a direct
         * grant, or who are in another group that still has access.
         */
        $subscribers = CalendarSubscription::where('calendar_id', $calendar->id)->pluck('user_id');
        $fresh = $calendar->fresh();

        foreach (User::whereIn('id', $subscribers)->get() as $subscriber) {
            GroupMembership::flush();
            if (CalendarAccess::role($subscriber, $fresh) === null) {
                CalendarSubscription::where('calendar_id', $calendar->id)
                    ->where('user_id', $subscriber->id)
                    ->delete();
            }
        }

        return response()->json(['status' => 'ok']);
    }

    /**
     * The audit trail for a calendar: who did what, when. Managers and owners
     * only — history can reveal who a calendar was shared with.
     */
    public function history(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $calendar = $this->find($uuid);

        abort_unless(CalendarAccess::can($user, $calendar, 'manage_sharing'), 403,
            'You cannot view this calendar’s history.');

        $rows = \App\Models\CalendarAuditEvent::where('calendar_id', $calendar->id)
            ->with('actor:id,name')
            ->orderByDesc('created_at')
            ->limit(100)
            ->get()
            ->map->toRecord();

        return response()->json(['history' => $rows]);
    }

    /* ── helpers ─────────────────────────────────────────────── */

    private function find(string $uuid): Calendar
    {
        return Calendar::where('uuid', $uuid)->firstOrFail();
    }

    /**
     * Case-insensitive LIKE for the current driver. Postgres needs ILIKE;
     * SQLite (which the test suite runs on) has no such operator and is
     * already case-insensitive for ASCII with plain LIKE.
     */
    private function likeOperator(): string
    {
        return Calendar::query()->getConnection()->getDriverName() === 'pgsql' ? 'ilike' : 'like';
    }

    private function subscription(User $user, Calendar $calendar): ?CalendarSubscription
    {
        return CalendarSubscription::where('user_id', $user->id)
            ->where('calendar_id', $calendar->id)
            ->first();
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, bool $partial = false): array
    {
        $rule = fn (array $rules) => $partial ? array_merge(['sometimes'], $rules) : $rules;

        return $request->validate([
            'name' => $rule(['required', 'string', 'max:255']),
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'colour' => ['sometimes', Rule::in(CalendarColours::keys())],
            'calendar_type' => ['sometimes', Rule::in(Calendar::TYPES)],
            'visibility' => ['sometimes', Rule::in(Calendar::VISIBILITIES)],
            'timezone' => ['sometimes', 'string', Rule::in(timezone_identifiers_list())],
            'default_role' => ['sometimes', Rule::in(CalendarAccess::ROLES)],
            'is_archived' => ['sometimes', 'boolean'],
        ]);
    }

    /**
     * The sidebar's section order and labels. Served with the list so the
     * grouping is defined in one place rather than duplicated in JS.
     *
     * @return array<int, array<string, string>>
     */
    private function sectionOrder(): array
    {
        return [
            ['key' => 'mine', 'label' => 'My Calendars'],
            ['key' => 'people', 'label' => 'People’s Calendars'],
            ['key' => 'group', 'label' => 'Group Calendars'],
            ['key' => 'shared', 'label' => 'Shared Calendars'],
            ['key' => 'connected', 'label' => 'Connected Calendars'],
            ['key' => 'imported', 'label' => 'Imported Calendars'],
        ];
    }
}
