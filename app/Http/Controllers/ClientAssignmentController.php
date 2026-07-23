<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Notifications\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Assigning staff to clients. Assignment is what grants a staff member access
 * to a client's folder (FileAccess reads the level), so creating and removing
 * assignments is administrator-only; staff may read who is assigned.
 */
class ClientAssignmentController extends Controller
{
    private const STAFF = ['Administrator', 'Employee'];

    /** Staff assigned to a client. */
    public function index(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);
        $client = Client::where('uid', $uid)->firstOrFail();

        return response()->json([
            'assignments' => $this->present($client),
            'assignable' => $this->assignableStaff(),
        ]);
    }

    /** Clients assigned to the signed-in staff member (their client list). */
    public function mine(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        $clients = Client::whereIn(
            'id',
            ClientAssignment::where('user_id', $request->user()->id)->pluck('client_id')
        )->orderBy('name')->get();

        return response()->json([
            'clients' => $clients->map(fn (Client $c) => [
                'id' => $c->uid,
                'name' => $c->name,
                'folderUuid' => $c->folder?->uuid,
            ])->values(),
        ]);
    }

    public function store(Request $request, string $uid): JsonResponse
    {
        $this->authorizeAdmin($request);
        $client = Client::where('uid', $uid)->firstOrFail();

        $data = $request->validate([
            'userId' => ['required', 'integer', Rule::exists('users', 'id')],
            'level' => ['required', Rule::in(array_keys(ClientAssignment::LEVELS))],
            'primary' => ['sometimes', 'boolean'],
        ]);

        // Only internal staff can be assigned to a client.
        $staff = User::findOrFail($data['userId']);
        abort_unless(in_array($staff->account_type, self::STAFF, true), 422, 'Only staff can be assigned to a client.');

        $assignment = ClientAssignment::updateOrCreate(
            ['client_id' => $client->id, 'user_id' => $staff->id],
            [
                'permission_level' => $data['level'],
                'is_primary' => $request->boolean('primary'),
                'assigned_by' => $request->user()->id,
            ],
        );

        if ($assignment->is_primary) {
            $this->makePrimary($client, $staff->id);
        }

        // Only tell someone the first time they're assigned, not on every level tweak.
        if ($assignment->wasRecentlyCreated) {
            ActivityLogger::log([
                'actor' => $request->user(),
                'type' => 'client.assigned',
                'description' => $request->user()->name.' assigned '.$staff->name.' to '.$client->name,
                'subject' => $client,
                'client' => $client,
            ]);
            Notifier::send([
                'user' => $staff,
                'actor' => $request->user(),
                'type' => 'client.assigned',
                'title' => $request->user()->name.' assigned you to '.$client->name,
                'subject' => $client,
                'client' => $client,
                'action_url' => '/clients?client='.$client->uid,
            ]);
        }

        return response()->json(['assignments' => $this->present($client->fresh())]);
    }

    public function destroy(Request $request, string $uid, int $userId): JsonResponse
    {
        $this->authorizeAdmin($request);
        $client = Client::where('uid', $uid)->firstOrFail();

        ClientAssignment::where('client_id', $client->id)->where('user_id', $userId)->delete();

        return response()->json(['assignments' => $this->present($client->fresh())]);
    }

    /** @return array<int, array<string, mixed>> */
    private function present(Client $client): array
    {
        return $client->assignments()->with('user')->get()->map(fn (ClientAssignment $a) => [
            'userId' => $a->user_id,
            'name' => $a->user?->name,
            'email' => $a->user?->email,
            'level' => $a->permission_level,
            'primary' => $a->is_primary,
        ])->values()->all();
    }

    /** @return array<int, array<string, mixed>> */
    private function assignableStaff(): array
    {
        return User::whereIn('account_type', self::STAFF)
            ->where('status', 'approved')
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'account_type'])
            ->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'accountType' => $u->account_type,
            ])->values()->all();
    }

    private function makePrimary(Client $client, int $userId): void
    {
        ClientAssignment::where('client_id', $client->id)
            ->where('user_id', '!=', $userId)
            ->update(['is_primary' => false]);
    }

    private function authorizeStaff(Request $request): void
    {
        abort_unless(in_array($request->user()?->account_type, self::STAFF, true), 403, 'Staff only.');
    }

    private function authorizeAdmin(Request $request): void
    {
        abort_unless($request->user()?->account_type === 'Administrator', 403, 'Only administrators can manage assignments.');
    }
}
