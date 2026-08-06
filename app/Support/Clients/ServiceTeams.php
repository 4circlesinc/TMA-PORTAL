<?php

namespace App\Support\Clients;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Group;
use App\Models\GroupMember;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Support\Collection;

/**
 * Assigning a whole staff group to a client in one move.
 *
 * "Service teams" used to be its own list of names that saved to localStorage.
 * It is not rebuilt as a second kind of team, because the portal already has
 * one: {@see Group}, with `TYPE_TEAM`, org-wide and reusable, managed under
 * People > Groups. A second teams table would have meant two half-features and
 * two places to keep membership right.
 *
 * What was actually missing is this: staff could only be put on a client one
 * at a time. A service team is therefore not a new object but a verb — take a
 * group, and give every staff member in it the same assignment to a client.
 *
 * The fan-out goes through {@see Assignments::assign()} row by row rather than
 * writing a "group assignment" of its own, which matters more than it looks:
 *
 *  - FileAccess reads ClientAssignment and nothing else, so folder access
 *    arrives by the same route it always did.
 *  - Each row keeps its own history, so one person can be taken off the client
 *    later without unpicking the team.
 *  - Joining the group afterwards does NOT backfill the assignment. That is
 *    deliberate: an assignment is a decision about a client, and quietly
 *    handing a new joiner a client's files because somebody added them to a
 *    department is exactly the accident this should not enable. Re-apply the
 *    team to include them.
 */
class ServiceTeams
{
    /**
     * Staff in a group who may hold a client assignment.
     *
     * Clients are excluded even if somebody put one in a staff group — only
     * internal staff can be assigned to a client, and this is the one place
     * that would otherwise be able to slip past that rule in bulk.
     *
     * @return Collection<int, User>
     */
    public static function staffIn(Group $group): Collection
    {
        return User::query()
            ->whereIn('id', GroupMember::where('group_id', $group->id)->pluck('user_id'))
            ->get()
            ->filter(fn (User $u) => Role::isStaff($u))
            ->values();
    }

    /**
     * Assign every staff member of a group to a client.
     *
     * Returns the users actually assigned. A member who already holds a live
     * assignment is still passed through — Assignments::assign() treats that
     * as a change rather than a new ask, so nobody gets welcomed twice.
     *
     * @param  array{role?: string, level: string, endsAt?: ?string, notes?: ?string}  $attrs
     * @return array{assigned: list<string>, skipped: int}
     */
    public static function assignToClient(Group $group, Client $client, array $attrs, User $by): array
    {
        $staff = self::staffIn($group);
        $assigned = [];

        foreach ($staff as $member) {
            Assignments::assign($client, $member, [
                'role' => $attrs['role'] ?? 'general',
                'level' => $attrs['level'],
                // Never from a team. Primary is one named person per client,
                // and a bulk action has no way to know which one — assigning a
                // team of six would otherwise leave whoever happened to be
                // last as the client's primary contact.
                'primary' => false,
                'endsAt' => $attrs['endsAt'] ?? null,
                'notes' => $attrs['notes'] ?? null,
            ], $by);

            $assigned[] = $member->name;
        }

        return [
            'assigned' => $assigned,
            // Group members who are clients, and so were never eligible.
            'skipped' => GroupMember::where('group_id', $group->id)->count() - $staff->count(),
        ];
    }

    /**
     * End every live assignment a group's staff hold on a client.
     *
     * Only assignments the team would have created are ended — a person who is
     * on the client for their own reasons and happens to be in the group loses
     * it too, because from the client's side there is only ever one assignment
     * per person and no record of which action made it. Said plainly in the UI
     * rather than guessed at here.
     *
     * @return list<string> the people taken off the client
     */
    public static function removeFromClient(Group $group, Client $client, User $by): array
    {
        $removed = [];

        foreach (self::staffIn($group) as $member) {
            $assignment = ClientAssignment::live()
                ->where('client_id', $client->id)
                ->where('user_id', $member->id)
                ->first();

            if (! $assignment) {
                continue;
            }

            Assignments::end($client, $assignment, $by, 'Removed with the '.$group->name.' team');
            $removed[] = $member->name;
        }

        return $removed;
    }

    /**
     * How many clients this group's staff are currently working on together —
     * the clients every one of them holds a live assignment to.
     *
     * "Every one of them" rather than "any of them" is the honest number: it
     * answers "which clients is this team on", not "has anyone from this team
     * ever touched this client".
     */
    public static function clientCount(Group $group): int
    {
        $staff = self::staffIn($group);

        if ($staff->isEmpty()) {
            return 0;
        }

        return ClientAssignment::live()
            ->whereIn('user_id', $staff->pluck('id'))
            ->select('client_id')
            ->groupBy('client_id')
            ->havingRaw('COUNT(DISTINCT user_id) = ?', [$staff->count()])
            ->get()
            ->count();
    }
}
