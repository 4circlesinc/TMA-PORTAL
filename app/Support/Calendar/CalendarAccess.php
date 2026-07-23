<?php

namespace App\Support\Calendar;

use App\Models\Calendar;
use App\Models\CalendarMember;
use App\Models\User;

/**
 * The single server-side authorization surface for calendar actions.
 *
 * Every controller action resolves permission through here; a hidden control
 * on the client is never trusted. Mirrors App\Support\Files\FileAccess — same
 * shape, same "role ladder + capability table" approach.
 *
 * Access comes from ownership, the admin role, an explicit calendar_members
 * grant, or the calendar's broad `visibility` default. The strongest of those
 * wins.
 */
class CalendarAccess
{
    /*
     * The permission ladder from the brief, weakest first. Each level is a
     * superset of the one below it, so a numeric comparison is enough to
     * answer "does this role reach that one?".
     */
    public const ROLE_AVAILABILITY = 'availability';  // see busy/free only

    public const ROLE_TITLES = 'titles';              // + event titles

    public const ROLE_DETAILS = 'details';            // + full event details

    public const ROLE_CONTRIBUTOR = 'contributor';    // + add events

    public const ROLE_EDITOR = 'editor';              // + edit/delete events

    public const ROLE_MANAGER = 'manager';            // + manage sharing

    public const ROLE_OWNER = 'owner';                // + full administration

    private const RANK = [
        self::ROLE_AVAILABILITY => 1,
        self::ROLE_TITLES => 2,
        self::ROLE_DETAILS => 3,
        self::ROLE_CONTRIBUTOR => 4,
        self::ROLE_EDITOR => 5,
        self::ROLE_MANAGER => 6,
        self::ROLE_OWNER => 7,
    ];

    public const ROLES = [
        self::ROLE_AVAILABILITY, self::ROLE_TITLES, self::ROLE_DETAILS,
        self::ROLE_CONTRIBUTOR, self::ROLE_EDITOR, self::ROLE_MANAGER,
        self::ROLE_OWNER,
    ];

    private const CAPS = [
        self::ROLE_AVAILABILITY => ['view_availability'],
        self::ROLE_TITLES => ['view_availability', 'view_titles'],
        self::ROLE_DETAILS => ['view_availability', 'view_titles', 'view_details'],
        self::ROLE_CONTRIBUTOR => ['view_availability', 'view_titles', 'view_details', 'add_events'],
        self::ROLE_EDITOR => ['view_availability', 'view_titles', 'view_details', 'add_events',
            'edit_events', 'delete_events'],
        self::ROLE_MANAGER => ['view_availability', 'view_titles', 'view_details', 'add_events',
            'edit_events', 'delete_events', 'manage_sharing', 'edit_calendar'],
        self::ROLE_OWNER => ['view_availability', 'view_titles', 'view_details', 'add_events',
            'edit_events', 'delete_events', 'manage_sharing', 'edit_calendar',
            'delete_calendar', 'archive_calendar'],
    ];

    public static function isAdmin(User $user): bool
    {
        return $user->account_type === 'Administrator';
    }

    /** Staff = internal users (never clients). */
    public static function isStaff(User $user): bool
    {
        return in_array($user->account_type, ['Administrator', 'Employee'], true);
    }

    /**
     * The effective role `$user` holds over `$calendar`, or null for no access.
     */
    public static function role(User $user, Calendar $calendar): ?string
    {
        if ($calendar->owner_id === $user->id) {
            return self::ROLE_OWNER;
        }

        /*
         * Administrators run the organization's and groups' calendars, but a
         * colleague's personal calendar is not org property — an admin reaches
         * it only through a real grant, the same as anyone else. Without this
         * split, "Administrator" would silently mean "reads everyone's diary".
         */
        if (self::isAdmin($user) && $calendar->calendar_type !== Calendar::TYPE_PERSONAL) {
            return self::ROLE_OWNER;
        }

        $roles = [
            self::grantRole($user, $calendar),
            self::groupGrantRole($user, $calendar),
            self::defaultRole($user, $calendar),
        ];

        return self::highest(array_filter($roles));
    }

    /** An explicit calendar_members grant, if one exists. */
    private static function grantRole(User $user, Calendar $calendar): ?string
    {
        $role = CalendarMember::where('calendar_id', $calendar->id)
            ->where('member_type', 'user')
            ->where('user_id', $user->id)
            ->value('role');

        return is_string($role) && isset(self::RANK[$role]) ? $role : null;
    }

    /**
     * The best grant reaching this user through any group they belong to.
     *
     * Someone in two groups that both hold the calendar keeps the stronger of
     * the two, and a personal grant still wins over both if it is higher —
     * highest() across all sources decides.
     */
    private static function groupGrantRole(User $user, Calendar $calendar): ?string
    {
        $groupIds = GroupMembership::idsFor($user);
        if (! $groupIds) {
            return null;
        }

        $roles = CalendarMember::where('calendar_id', $calendar->id)
            ->where('member_type', 'group')
            ->whereIn('group_id', $groupIds)
            ->pluck('role')
            ->all();

        return self::highest(array_filter($roles, fn ($r) => is_string($r) && isset(self::RANK[$r])));
    }

    /**
     * What the calendar's broad visibility grants on its own.
     *
     * Only `all_staff` grants anything without an explicit member row, and
     * only to staff — which is the rule that keeps clients out of internal
     * calendars by default.
     */
    private static function defaultRole(User $user, Calendar $calendar): ?string
    {
        if ($calendar->visibility !== 'all_staff' || ! self::isStaff($user)) {
            return null;
        }

        $role = $calendar->default_role;

        return is_string($role) && isset(self::RANK[$role]) ? $role : self::ROLE_DETAILS;
    }

    /**
     * Roles over many calendars at once, keyed by calendar id.
     *
     * role() costs one members query per calendar, which the sidebar would
     * multiply by every calendar in the list. This resolves the same answer
     * with a single query over all of them.
     *
     * @param  iterable<Calendar>  $calendars
     * @return array<int, string> calendar id => role (absent = no access)
     */
    public static function rolesFor(User $user, iterable $calendars): array
    {
        $calendars = collect($calendars);
        if ($calendars->isEmpty()) {
            return [];
        }

        $grants = CalendarMember::whereIn('calendar_id', $calendars->pluck('id'))
            ->where('member_type', 'user')
            ->where('user_id', $user->id)
            ->pluck('role', 'calendar_id')
            ->all();

        // Group grants, collapsed to the strongest role per calendar so a
        // person in several groups holding one calendar keeps the best of them.
        $groupIds = GroupMembership::idsFor($user);
        $groupGrants = [];
        if ($groupIds) {
            CalendarMember::whereIn('calendar_id', $calendars->pluck('id'))
                ->where('member_type', 'group')
                ->whereIn('group_id', $groupIds)
                ->get(['calendar_id', 'role'])
                ->each(function (CalendarMember $m) use (&$groupGrants) {
                    $best = $groupGrants[$m->calendar_id] ?? null;
                    if ($best === null || (self::RANK[$m->role] ?? 0) > (self::RANK[$best] ?? 0)) {
                        $groupGrants[$m->calendar_id] = $m->role;
                    }
                });
        }

        $out = [];
        foreach ($calendars as $calendar) {
            if ($calendar->owner_id === $user->id) {
                $out[$calendar->id] = self::ROLE_OWNER;

                continue;
            }

            if (self::isAdmin($user) && $calendar->calendar_type !== Calendar::TYPE_PERSONAL) {
                $out[$calendar->id] = self::ROLE_OWNER;

                continue;
            }

            $grant = $grants[$calendar->id] ?? null;
            $groupGrant = $groupGrants[$calendar->id] ?? null;
            $role = self::highest([
                isset(self::RANK[$grant]) ? $grant : null,
                isset(self::RANK[$groupGrant]) ? $groupGrant : null,
                self::defaultRole($user, $calendar),
            ]);

            if ($role !== null) {
                $out[$calendar->id] = $role;
            }
        }

        return $out;
    }

    /** Whether `$user` may perform `$capability` on `$calendar`. */
    public static function can(User $user, Calendar $calendar, string $capability): bool
    {
        $role = self::role($user, $calendar);
        if ($role === null) {
            return false;
        }

        // An archived calendar is readable history; nothing may be written to
        // it until it is restored.
        if ($calendar->is_archived && ! in_array($capability, self::CAPS[self::ROLE_DETAILS], true)) {
            return $capability === 'archive_calendar' && $role === self::ROLE_OWNER;
        }

        return in_array($capability, self::CAPS[$role] ?? [], true);
    }

    /** Whether `$role` reaches at least `$minimum` on the ladder. */
    public static function atLeast(?string $role, string $minimum): bool
    {
        if ($role === null) {
            return false;
        }

        return (self::RANK[$role] ?? 0) >= (self::RANK[$minimum] ?? 0);
    }

    /**
     * @param  array<int, string|null>  $roles
     */
    private static function highest(array $roles): ?string
    {
        $best = null;
        foreach ($roles as $role) {
            if ($role === null) {
                continue;
            }
            if ($best === null || (self::RANK[$role] ?? 0) > (self::RANK[$best] ?? 0)) {
                $best = $role;
            }
        }

        return $best;
    }
}
