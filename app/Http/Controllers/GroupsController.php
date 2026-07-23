<?php

namespace App\Http\Controllers;

use App\Models\Group;
use App\Models\GroupMember;
use App\Models\User;
use App\Support\Calendar\CalendarAccess;
use App\Support\Calendar\GroupMembership;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Teams, departments, projects and committees — the org structure the portal
 * previously had only as a JavaScript array on the Distribution Groups screen.
 *
 * Groups are staff-only and administrator-managed; a group manager may curate
 * membership but not create or delete groups. What a group can *see* is never
 * decided here — that is a grant made against a calendar (or, later, a folder).
 */
class GroupsController extends Controller
{
    /** A group may not grow unbounded through this endpoint. */
    private const MAX_MEMBERS = 512;

    /**
     * Groups the caller may see. Staff see the whole directory — a group is
     * org structure, not a secret — but membership detail needs opening one.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->authorizeStaff($user);

        $query = trim((string) $request->query('q', ''));
        $like = $this->likeOperator();

        $groups = Group::query()
            ->when(! $request->boolean('includeArchived'), fn ($q) => $q->where('is_archived', false))
            ->when($query !== '', fn ($q) => $q->where('name', $like, '%'.$query.'%'))
            ->orderBy('name')
            ->get();

        // One count query for the whole list rather than one per group.
        $counts = GroupMember::whereIn('group_id', $groups->pluck('id'))
            ->selectRaw('group_id, count(*) as aggregate')
            ->groupBy('group_id')
            ->pluck('aggregate', 'group_id');

        $mine = GroupMember::where('user_id', $user->id)
            ->pluck('role', 'group_id');

        $autoJoinCount = null;

        $records = $groups->map(function (Group $g) use ($counts, $mine, $user, &$autoJoinCount) {
            if ($g->auto_join) {
                // Membership is the staff list, so the stored rows aren't the
                // count. Measured once and reused across every auto-join group.
                $autoJoinCount ??= User::whereIn('account_type', ['Administrator', 'Employee'])
                    ->where('status', User::STATUS_APPROVED)
                    ->count();
                $count = $autoJoinCount;
                $role = CalendarAccess::isStaff($user) ? GroupMember::ROLE_MEMBER : null;
            } else {
                $count = (int) ($counts[$g->id] ?? 0);
                $role = $mine[$g->id] ?? null;
            }

            return $g->toRecord($count, $role);
        })->values();

        return response()->json([
            'groups' => $records,
            'types' => Group::TYPES,
            'canManage' => CalendarAccess::isAdmin($user),
        ]);
    }

    /**
     * The staff who can be put in a group — what the group builder's picker
     * lists. Clients are excluded: a group is internal structure.
     */
    public function staff(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->authorizeStaff($user);

        $query = trim((string) $request->query('q', ''));
        $like = $this->likeOperator();

        $staff = User::query()
            ->whereIn('account_type', ['Administrator', 'Employee'])
            ->where('status', User::STATUS_APPROVED)
            ->when($query !== '', fn ($q) => $q->where(function ($w) use ($query, $like) {
                $w->where('name', $like, '%'.$query.'%')
                    ->orWhere('email', $like, '%'.$query.'%');
            }))
            ->orderBy('name')
            ->limit(200)
            ->get(['id', 'name', 'email', 'avatar_url', 'job_title']);

        return response()->json([
            'staff' => $staff->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'avatarUrl' => $u->avatar_url,
                'jobTitle' => $u->job_title,
            ])->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        // Creating org structure is an administrator action.
        abort_unless(CalendarAccess::isAdmin($user), 403, 'Only administrators can create groups.');

        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'group_type' => ['sometimes', Rule::in(Group::TYPES)],
            'auto_join' => ['sometimes', 'boolean'],
            'memberIds' => ['sometimes', 'array', 'max:'.self::MAX_MEMBERS],
            'memberIds.*' => ['integer', 'exists:users,id'],
        ]);

        $group = Group::create([
            'uuid' => (string) Str::uuid(),
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'group_type' => $data['group_type'] ?? Group::TYPE_TEAM,
            'auto_join' => $data['auto_join'] ?? false,
            'created_by' => $user->id,
        ]);

        // The creator runs the group unless it manages itself.
        if (! $group->auto_join) {
            GroupMember::create([
                'group_id' => $group->id,
                'user_id' => $user->id,
                'role' => GroupMember::ROLE_MANAGER,
                'added_by' => $user->id,
            ]);
        }

        $count = $this->syncMembers($group, $data['memberIds'] ?? [], $user);

        return response()->json(['group' => $group->fresh()->toRecord($count, GroupMember::ROLE_MANAGER)]);
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $group = $this->find($uuid);

        abort_unless(GroupMembership::canManage($user, $group), 403, 'You cannot manage this group.');

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'group_type' => ['sometimes', Rule::in(Group::TYPES)],
            'auto_join' => ['sometimes', 'boolean'],
            'is_archived' => ['sometimes', 'boolean'],
        ]);

        // Turning membership over to the staff list, or taking it back, is a
        // structural change rather than day-to-day curation.
        if (array_key_exists('auto_join', $data) && $data['auto_join'] !== $group->auto_join) {
            abort_unless(CalendarAccess::isAdmin($user), 403,
                'Only administrators can change how this group gets its members.');
        }

        $group->fill($data)->save();

        return response()->json(['group' => $group->fresh()->toRecord($this->memberCount($group))]);
    }

    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        abort_unless(CalendarAccess::isAdmin($user), 403, 'Only administrators can delete groups.');

        $group = $this->find($uuid);

        /*
         * Soft delete. Calendar grants made to this group cascade away with
         * it, so nobody keeps access through a group that no longer exists —
         * but the row is recoverable if the deletion was a mistake.
         */
        $group->delete();

        return response()->json(['status' => 'ok']);
    }

    /** A group's people, for the members panel and the group selector. */
    public function members(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $this->authorizeStaff($user);

        $group = $this->find($uuid);

        $members = GroupMembership::usersIn($group);
        $roles = GroupMember::where('group_id', $group->id)->pluck('role', 'user_id');

        return response()->json([
            'members' => $members->map(fn (User $u) => [
                'userId' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'avatarUrl' => $u->avatar_url,
                'jobTitle' => $u->job_title,
                // auto-join members have no row, so they read as plain members.
                'role' => $group->auto_join
                    ? GroupMember::ROLE_MEMBER
                    : ($roles[$u->id] ?? GroupMember::ROLE_MEMBER),
            ])->values(),
            'autoJoin' => (bool) $group->auto_join,
            'canManage' => GroupMembership::canManage($user, $group),
        ]);
    }

    public function addMembers(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $group = $this->find($uuid);

        abort_unless(GroupMembership::canManage($user, $group), 403, 'You cannot manage this group.');
        abort_if($group->auto_join, 422, 'This group takes its members from the staff list.');

        $data = $request->validate([
            'memberIds' => ['required', 'array', 'min:1', 'max:'.self::MAX_MEMBERS],
            'memberIds.*' => ['integer', 'exists:users,id'],
            'role' => ['sometimes', Rule::in([GroupMember::ROLE_MEMBER, GroupMember::ROLE_MANAGER])],
        ]);

        $count = $this->syncMembers($group, $data['memberIds'], $user, $data['role'] ?? GroupMember::ROLE_MEMBER);

        return response()->json(['status' => 'ok', 'memberCount' => $count]);
    }

    public function removeMember(Request $request, string $uuid, int $userId): JsonResponse
    {
        $user = $request->user();
        $group = $this->find($uuid);

        abort_unless(GroupMembership::canManage($user, $group), 403, 'You cannot manage this group.');
        abort_if($group->auto_join, 422, 'This group takes its members from the staff list.');

        // A group with no manager can never be curated again.
        $managers = GroupMember::where('group_id', $group->id)
            ->where('role', GroupMember::ROLE_MANAGER)
            ->pluck('user_id');

        abort_if(
            $managers->count() === 1 && $managers->contains($userId),
            422,
            'Give someone else management of this group first.'
        );

        GroupMember::where('group_id', $group->id)->where('user_id', $userId)->delete();

        return response()->json(['status' => 'ok']);
    }

    /* ── helpers ─────────────────────────────────────────────── */

    private function find(string $uuid): Group
    {
        return Group::where('uuid', $uuid)->firstOrFail();
    }

    private function authorizeStaff(User $user): void
    {
        abort_unless(CalendarAccess::isStaff($user), 403, 'Groups are staff only.');
    }

    private function memberCount(Group $group): int
    {
        return GroupMembership::usersIn($group)->count();
    }

    /**
     * Add the given users, skipping clients and anyone already in. Returns the
     * resulting member count.
     *
     * @param  array<int, int>  $ids
     */
    private function syncMembers(Group $group, array $ids, User $actor, string $role = GroupMember::ROLE_MEMBER): int
    {
        if ($ids) {
            $staff = User::whereIn('id', $ids)
                // A group is internal structure; client accounts never join one.
                ->whereIn('account_type', ['Administrator', 'Employee'])
                ->pluck('id');

            foreach ($staff as $id) {
                GroupMember::firstOrCreate(
                    ['group_id' => $group->id, 'user_id' => $id],
                    ['role' => $role, 'added_by' => $actor->id],
                );
            }
        }

        return $this->memberCount($group);
    }

    private function likeOperator(): string
    {
        return Group::query()->getConnection()->getDriverName() === 'pgsql' ? 'ilike' : 'like';
    }
}
