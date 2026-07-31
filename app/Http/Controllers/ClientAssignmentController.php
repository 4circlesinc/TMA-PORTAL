<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Clients\Assignments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Assigning staff to clients. Assignment is what grants a staff member access
 * to a client's folder (FileAccess reads the level), so creating and ending
 * assignments is administrator-only; staff may read who is assigned.
 *
 * The work itself lives in App\Support\Clients\Assignments — this only decides
 * who may ask and what shape the answer takes.
 */
class ClientAssignmentController extends Controller
{
    private const STAFF = ['Administrator', 'Employee'];

    /** Staff assigned to a client, live ones first. */
    public function index(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);
        $client = Client::where('uid', $uid)->firstOrFail();

        return response()->json([
            'assignments' => $this->present($client),
            'history' => $this->presentHistory($client),
            'assignable' => $this->assignableStaff($client),
            'roles' => $this->roleOptions(),
            'levels' => array_keys(ClientAssignment::LEVELS),
        ]);
    }

    /** Clients assigned to the signed-in staff member (their client list). */
    public function mine(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        $clients = Client::whereIn(
            'id',
            ClientAssignment::live()->where('user_id', $request->user()->id)->pluck('client_id')
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
            'role' => ['nullable', Rule::in(array_keys(ClientAssignment::ROLES))],
            'level' => ['required', Rule::in(array_keys(ClientAssignment::LEVELS))],
            'primary' => ['sometimes', 'boolean'],
            'startsAt' => ['nullable', 'date'],
            'endsAt' => ['nullable', 'date', 'after:now'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ], [
            'endsAt.after' => 'An end date has to be in the future.',
        ]);

        // Only internal staff can be assigned to a client.
        $staff = User::findOrFail($data['userId']);
        abort_unless(Role::isStaff($staff), 422, 'Only staff can be assigned to a client.');

        Assignments::assign($client, $staff, [
            'role' => $data['role'] ?? 'general',
            'level' => $data['level'],
            'primary' => $request->boolean('primary'),
            'startsAt' => $data['startsAt'] ?? null,
            'endsAt' => $data['endsAt'] ?? null,
            'notes' => $data['notes'] ?? null,
        ], $request->user());

        return response()->json([
            'assignments' => $this->present($client->fresh()),
            'assignable' => $this->assignableStaff($client->fresh()),
        ]);
    }

    /** Change the role, level, end date or primary flag of an assignment. */
    public function update(Request $request, string $uid, int $userId): JsonResponse
    {
        $this->authorizeAdmin($request);
        $client = Client::where('uid', $uid)->firstOrFail();

        $data = $request->validate([
            'role' => ['nullable', Rule::in(array_keys(ClientAssignment::ROLES))],
            'level' => ['nullable', Rule::in(array_keys(ClientAssignment::LEVELS))],
            'primary' => ['sometimes', 'boolean'],
            'endsAt' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $staff = User::findOrFail($userId);
        $current = ClientAssignment::live()
            ->where('client_id', $client->id)->where('user_id', $userId)->firstOrFail();

        Assignments::assign($client, $staff, [
            'role' => $data['role'] ?? $current->role,
            'level' => $data['level'] ?? $current->permission_level,
            'primary' => $request->has('primary') ? $request->boolean('primary') : $current->is_primary,
            'endsAt' => array_key_exists('endsAt', $data) ? $data['endsAt'] : $current->ends_at,
            'notes' => array_key_exists('notes', $data) ? $data['notes'] : $current->notes,
        ], $request->user());

        return response()->json(['assignments' => $this->present($client->fresh())]);
    }

    /** Hand this client's assignment to somebody else in one move. */
    public function reassign(Request $request, string $uid, int $userId): JsonResponse
    {
        $this->authorizeAdmin($request);
        $client = Client::where('uid', $uid)->firstOrFail();

        $data = $request->validate([
            'toUserId' => ['required', 'integer', Rule::exists('users', 'id')],
        ]);

        $from = ClientAssignment::live()
            ->where('client_id', $client->id)->where('user_id', $userId)->firstOrFail();
        $to = User::findOrFail($data['toUserId']);

        abort_unless(Role::isStaff($to), 422, 'Only staff can be assigned to a client.');
        abort_if($to->id === $userId, 422, 'Choose a different staff member.');

        Assignments::reassign($client, $from, $to, $request->user());

        return response()->json([
            'assignments' => $this->present($client->fresh()),
            'assignable' => $this->assignableStaff($client->fresh()),
        ]);
    }

    /**
     * End an assignment. The row is kept as history — see Assignments::end —
     * so this removes the access without erasing the record.
     */
    public function destroy(Request $request, string $uid, int $userId): JsonResponse
    {
        $this->authorizeAdmin($request);
        $client = Client::where('uid', $uid)->firstOrFail();

        $assignment = ClientAssignment::live()
            ->where('client_id', $client->id)->where('user_id', $userId)->first();

        if ($assignment) {
            Assignments::end($client, $assignment, $request->user());
        }

        return response()->json([
            'assignments' => $this->present($client->fresh()),
            'history' => $this->presentHistory($client->fresh()),
            'assignable' => $this->assignableStaff($client->fresh()),
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function present(Client $client): array
    {
        return ClientAssignment::live()
            ->where('client_id', $client->id)
            ->with(['user', 'assigner'])
            ->orderByDesc('is_primary')
            ->get()
            ->map(fn (ClientAssignment $a) => $a->toRecord())
            ->values()->all();
    }

    /** Assignments that have ended — who used to look after this client. */
    private function presentHistory(Client $client): array
    {
        return ClientAssignment::where('client_id', $client->id)
            ->where('status', ClientAssignment::STATUS_ENDED)
            ->with(['user', 'assigner'])
            ->latest('ended_at')
            ->limit(20)
            ->get()
            ->map(fn (ClientAssignment $a) => $a->toRecord())
            ->values()->all();
    }

    /** @return array<int, array<string, string>> */
    private function roleOptions(): array
    {
        return collect(ClientAssignment::ROLES)
            ->map(fn (string $label, string $value) => ['value' => $value, 'label' => $label])
            ->values()->all();
    }

    /**
     * Staff who could be assigned — everyone internal who does not already
     * hold a live assignment on this client.
     *
     * @return array<int, array<string, mixed>>
     */
    private function assignableStaff(?Client $client = null): array
    {
        $taken = $client
            ? ClientAssignment::live()->where('client_id', $client->id)->pluck('user_id')->all()
            : [];

        return User::whereIn('account_type', self::STAFF)
            ->where('status', 'approved')
            ->whereNotIn('id', $taken)
            ->orderBy('name')
            ->get()
            ->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'avatar' => $u->photoUrl(),
                'accountType' => $u->account_type,
            ])->values()->all();
    }

    private function authorizeStaff(Request $request): void
    {
        abort_unless(Role::can($request->user(), 'clients.view'), 403, 'Staff only.');
    }

    private function authorizeAdmin(Request $request): void
    {
        abort_unless(Role::can($request->user(), 'clients.assign'), 403, 'Only administrators can manage assignments.');
    }
}
