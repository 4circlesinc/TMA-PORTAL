<?php

namespace App\Support\Calendar;

use App\Models\Group;
use App\Models\GroupMember;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Answers "which groups is this person in?" — the question every group-granted
 * permission check reduces to.
 *
 * Cached per request because access resolution asks it repeatedly: once for
 * the calendar list, again for each event serialisation, again for
 * availability. Within one request the answer cannot change.
 */
class GroupMembership
{
    /** @var array<int, array<int, int>> user id => group ids */
    private static array $cache = [];

    /**
     * Group ids `$user` belongs to, including auto-join groups they qualify
     * for without an explicit row.
     *
     * @return array<int, int>
     */
    public static function idsFor(User $user): array
    {
        if (isset(self::$cache[$user->id])) {
            return self::$cache[$user->id];
        }

        $ids = GroupMember::where('user_id', $user->id)
            ->pluck('group_id')
            ->all();

        /*
         * auto_join groups follow the staff list rather than a curated
         * membership, so a new joiner belongs immediately instead of waiting
         * to be added. Clients are never folded in — an auto-join group is an
         * internal one by definition.
         */
        if (CalendarAccess::isStaff($user)) {
            $auto = Group::where('auto_join', true)
                ->where('is_archived', false)
                ->pluck('id')
                ->all();

            $ids = array_values(array_unique(array_merge($ids, $auto)));
        }

        return self::$cache[$user->id] = $ids;
    }

    public static function isMember(User $user, Group $group): bool
    {
        return in_array($group->id, self::idsFor($user), true);
    }

    /** Whether `$user` may add and remove this group's members. */
    public static function canManage(User $user, Group $group): bool
    {
        if (CalendarAccess::isAdmin($user)) {
            return true;
        }

        return GroupMember::where('group_id', $group->id)
            ->where('user_id', $user->id)
            ->where('role', GroupMember::ROLE_MANAGER)
            ->exists();
    }

    /**
     * Every user in a group, resolving auto-join to the current staff list.
     *
     * @return Collection<int, User>
     */
    public static function usersIn(Group $group)
    {
        if ($group->auto_join) {
            return User::whereIn('account_type', ['Administrator', 'Employee'])
                ->where('status', User::STATUS_APPROVED)
                ->get();
        }

        return User::whereIn('id', GroupMember::where('group_id', $group->id)->pluck('user_id'))->get();
    }

    /** Test seam: the per-request cache must not leak between test cases. */
    public static function flush(): void
    {
        self::$cache = [];
    }
}
