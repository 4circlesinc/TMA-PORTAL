<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Group;
use App\Support\Access\Role;
use App\Support\Clients\ServiceTeams;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Account settings > Client hub management > Service teams.
 *
 * The screen lists the firm's staff groups and lets an administrator put a
 * whole one onto a client, or take it off again. It deliberately does not
 * create teams, those are groups, managed under People > Groups, and this
 * page links there rather than growing a second place to keep membership.
 *
 * See {@see ServiceTeams} for why the fan-out writes ordinary per-person
 * assignments instead of a group assignment of its own.
 */
class ServiceTeamsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        Role::authorize($request->user(), 'settings.clientHub');

        $teams = Group::query()
            ->where('is_archived', false)
            ->orderBy('name')
            ->get()
            ->map(fn (Group $g) => [
                'id' => $g->uuid,
                'name' => $g->name,
                'type' => $g->group_type,
                'description' => $g->description,
                'memberCount' => ServiceTeams::staffIn($g)->count(),
                'clientCount' => ServiceTeams::clientCount($g),
            ])
            ->values();

        return response()->json([
            'canEdit' => Role::isAdmin($request->user()),
            'teams' => $teams,
            'clients' => Client::query()->orderBy('name')->get()
                ->map(fn (Client $c) => ['uid' => $c->uid, 'name' => $c->name])
                ->values(),
            'roles' => ClientAssignment::ROLES,
            'levels' => array_keys(ClientAssignment::LEVELS),
        ]);
    }

    /** Put every staff member of a group onto a client. */
    public function assign(Request $request, string $id): JsonResponse
    {
        $this->authorizeWrite($request);

        $data = $request->validate([
            'client' => ['required', 'string'],
            'role' => ['nullable', Rule::in(array_keys(ClientAssignment::ROLES))],
            'level' => ['required', Rule::in(array_keys(ClientAssignment::LEVELS))],
            'endsAt' => ['nullable', 'date', 'after:now'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ], [
            'endsAt.after' => 'An end date has to be in the future.',
        ]);

        $group = Group::where('uuid', $id)->firstOrFail();
        $client = Client::where('uid', $data['client'])->firstOrFail();

        $staff = ServiceTeams::staffIn($group);
        abort_if($staff->isEmpty(), 422, 'That team has no staff members to assign.');

        $result = ServiceTeams::assignToClient($group, $client, [
            'role' => $data['role'] ?? 'general',
            'level' => $data['level'],
            'endsAt' => $data['endsAt'] ?? null,
            'notes' => $data['notes'] ?? null,
        ], $request->user());

        return response()->json([
            'assigned' => $result['assigned'],
            'skipped' => $result['skipped'],
            'client' => ['uid' => $client->uid, 'name' => $client->name],
        ] + $this->index($request)->getData(true));
    }

    /** Take a group's staff back off a client. */
    public function unassign(Request $request, string $id): JsonResponse
    {
        $this->authorizeWrite($request);

        $data = $request->validate(['client' => ['required', 'string']]);

        $group = Group::where('uuid', $id)->firstOrFail();
        $client = Client::where('uid', $data['client'])->firstOrFail();

        $removed = ServiceTeams::removeFromClient($group, $client, $request->user());

        return response()->json([
            'removed' => $removed,
            'client' => ['uid' => $client->uid, 'name' => $client->name],
        ] + $this->index($request)->getData(true));
    }

    private function authorizeWrite(Request $request): void
    {
        Role::authorize($request->user(), 'settings.clientHub');
        abort_unless(Role::isAdmin($request->user()), 403, 'Only administrators can assign service teams.');
    }
}
