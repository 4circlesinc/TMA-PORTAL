<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipOfficerRole;
use App\Models\CipProvider;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\CipAccess;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Settings → CIP management: the provider registry and officer grants — the
 * minimum configuration the module needs before applications can exist.
 *
 * Gate contract matches CBI: 404, never 403. `cip.configure` is admin-only in
 * the matrix and Role::can() checks FEATURE_CIP before the admin
 * short-circuit, so one abort covers the flag and the role at once.
 */
class CipAdminController extends Controller
{
    private function gate(Request $request): void
    {
        abort_unless(Role::can($request->user(), 'cip.configure'), 404);
    }

    public function show(Request $request): JsonResponse
    {
        $this->gate($request);

        return response()->json($this->payload());
    }

    public function storeProvider(Request $request): JsonResponse
    {
        $this->gate($request);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:191'],
            'code' => ['required', 'string', 'min:2', 'max:8', 'alpha', Rule::unique('cip_providers', 'code')],
            'contactName' => ['nullable', 'string', 'max:191'],
            'contactEmail' => ['nullable', 'email', 'max:191'],
        ]);

        $provider = CipProvider::create([
            'name' => $data['name'],
            'code' => $data['code'],
            'contact_name' => $data['contactName'] ?? null,
            'contact_email' => $data['contactEmail'] ?? null,
        ]);

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'cip.provider_created',
            'module' => 'cip',
            'description' => 'CIP provider '.$provider->name.' registered as '.$provider->code,
            'subject' => $provider,
        ]);

        return response()->json($this->payload(), 201);
    }

    public function updateProvider(Request $request, string $uuid): JsonResponse
    {
        $this->gate($request);

        $provider = CipProvider::where('uuid', $uuid)->firstOrFail();

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:191'],
            'contactName' => ['sometimes', 'nullable', 'string', 'max:191'],
            'contactEmail' => ['sometimes', 'nullable', 'email', 'max:191'],
            'active' => ['sometimes', 'boolean'],
        ]);

        // The code is deliberately not editable: numbers already minted under
        // it must keep meaning what they meant.
        $provider->fill([
            'name' => $data['name'] ?? $provider->name,
            'contact_name' => array_key_exists('contactName', $data) ? $data['contactName'] : $provider->contact_name,
            'contact_email' => array_key_exists('contactEmail', $data) ? $data['contactEmail'] : $provider->contact_email,
            'active' => $data['active'] ?? $provider->active,
        ])->save();

        return response()->json($this->payload());
    }

    public function grantOfficer(Request $request): JsonResponse
    {
        $this->gate($request);

        $data = $request->validate([
            'userId' => ['required', 'integer', Rule::exists('users', 'id')],
            'role' => ['required', Rule::in(array_keys(CipAccess::ROLES))],
        ]);

        $user = User::findOrFail($data['userId']);

        if (! Role::isStaff($user)) {
            return response()->json(['message' => 'Officer roles are for staff accounts.'], 422);
        }

        CipAccess::grant($user, $data['role'], $request->user());

        return response()->json($this->payload(), 201);
    }

    public function revokeOfficer(Request $request): JsonResponse
    {
        $this->gate($request);

        $data = $request->validate([
            'userId' => ['required', 'integer', Rule::exists('users', 'id')],
            'role' => ['required', Rule::in(array_keys(CipAccess::ROLES))],
        ]);

        CipAccess::revoke(User::findOrFail($data['userId']), $data['role'], $request->user());

        return response()->json($this->payload());
    }

    /** The whole management screen in one response, after every change. */
    private function payload(): array
    {
        $providers = CipProvider::withTrashed()
            ->withCount('applications')
            ->orderBy('name')
            ->get()
            ->map(fn (CipProvider $p) => [
                'uuid' => $p->uuid,
                'name' => $p->name,
                'code' => $p->code,
                'contactName' => $p->contact_name,
                'contactEmail' => $p->contact_email,
                'active' => $p->active && ! $p->trashed(),
                'applications' => $p->applications_count,
            ])->values();

        $grants = CipOfficerRole::with('user:id,name,email')
            ->get()
            ->groupBy('user_id')
            ->map(fn ($rows) => [
                'userId' => $rows->first()->user_id,
                'name' => $rows->first()->user?->name,
                'email' => $rows->first()->user?->email,
                'roles' => $rows->pluck('role')->values(),
            ])->values();

        $staff = User::query()
            ->whereIn('account_type', Role::STAFF)
            ->where('status', 'approved')
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'account_type'])
            ->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'admin' => Role::isAdmin($u),
            ])->values();

        return [
            'canEdit' => true,
            'providers' => $providers,
            'officers' => $grants,
            'staff' => $staff,
            'roles' => CipAccess::ROLES,
        ];
    }
}
