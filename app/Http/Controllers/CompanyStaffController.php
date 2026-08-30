<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\Cache;
use App\Support\Clients\ClientDirectory;
use App\Support\Realtime\Live;
use App\Models\ClientAssignment;
use App\Models\Company;
use App\Models\CompanyStaffAssignment;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\Pages;
use App\Support\Companies\CompanyAccess;
use App\Support\Notifications\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The firm's own staff assigned to a whole company.
 *
 * The reach of one of these is much wider than a client assignment, so the
 * spec's rule applies here above all: *do not silently assign broad access
 * without showing the administrator what will happen*. {@see self::preview()}
 * exists for exactly that, and `company_only` is the default so the broad
 * option has to be chosen deliberately.
 */
class CompanyStaffController extends Controller
{
    public function index(Request $request, string $uid): JsonResponse
    {
        Role::authorize($request->user(), 'clients.view');
        $company = Company::where('uid', $uid)->firstOrFail();

        return response()->json([
            'assignments' => $this->present($company),
            'history' => CompanyStaffAssignment::where('company_id', $company->id)
                ->where('status', CompanyStaffAssignment::STATUS_ENDED)
                ->with(['user', 'assigner'])->latest('ended_at')->limit(20)->get()
                ->map(fn (CompanyStaffAssignment $a) => $a->toRecord())->values(),
            'assignable' => $this->assignableStaff($company),
            'roles' => collect(ClientAssignment::ROLES)
                ->map(fn ($l, $v) => ['value' => $v, 'label' => $l])->values(),
            'scopes' => collect(CompanyStaffAssignment::SCOPES)
                ->map(fn ($l, $v) => ['value' => $v, 'label' => $l])->values(),
        ]);
    }

    /**
     * What an assignment would actually cover, before it is made. The UI shows
     * this and asks for confirmation whenever the scope is wider than the
     * company itself.
     */
    public function preview(Request $request, string $uid): JsonResponse
    {
        Role::authorize($request->user(), 'clients.view');
        $company = Company::where('uid', $uid)->firstOrFail();

        $data = $request->validate([
            'appliesToClients' => ['required', Rule::in(array_keys(CompanyStaffAssignment::SCOPES))],
        ]);

        return response()->json([
            'preview' => CompanyAccess::previewReach($company, $data['appliesToClients']),
        ]);
    }

    public function store(Request $request, string $uid): JsonResponse
    {
        Role::authorize($request->user(), 'clients.assign');
        $company = Company::where('uid', $uid)->firstOrFail();

        $data = $request->validate([
            'userId' => ['required', 'integer', Rule::exists('users', 'id')],
            'role' => ['nullable', Rule::in(array_keys(ClientAssignment::ROLES))],
            'level' => ['required', Rule::in(array_keys(ClientAssignment::LEVELS))],
            'appliesToClients' => ['nullable', Rule::in(array_keys(CompanyStaffAssignment::SCOPES))],
            'primary' => ['sometimes', 'boolean'],
            'endsAt' => ['nullable', 'date', 'after:now'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ], [
            'endsAt.after' => 'An end date has to be in the future.',
        ]);

        $staff = User::findOrFail($data['userId']);
        abort_unless(Role::isStaff($staff), 422, 'Only staff can be assigned to a company.');

        $scope = $data['appliesToClients'] ?? CompanyStaffAssignment::SCOPE_COMPANY_ONLY;

        $existing = CompanyStaffAssignment::where('company_id', $company->id)
            ->where('user_id', $staff->id)->latest('id')->first();
        $wasLive = $existing?->isLive() ?? false;

        $assignment = $existing ?? new CompanyStaffAssignment;
        $assignment->forceFill([
            'company_id' => $company->id,
            'user_id' => $staff->id,
            'role' => $data['role'] ?? 'general',
            'permission_level' => $data['level'],
            'is_primary' => $request->boolean('primary'),
            'applies_to_clients' => $scope,
            'status' => CompanyStaffAssignment::STATUS_ACTIVE,
            'ends_at' => $data['endsAt'] ?? null,
            'notes' => $data['notes'] ?? null,
            'assigned_by' => $request->user()->id,
            'ended_at' => null,
            'ended_by' => null,
        ])->save();

        if ($assignment->is_primary) {
            CompanyStaffAssignment::where('company_id', $company->id)
                ->where('id', '!=', $assignment->id)
                ->update(['is_primary' => false]);
        }

        $reach = CompanyAccess::previewReach($company, $scope);

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'company.staff_assigned',
            'module' => 'clients',
            'description' => $request->user()->name.' assigned '.$staff->name.' to '.$company->name
                .' ('.($reach['label'] ?: $scope).')',
            'subject' => $company,
            'metadata' => [
                'companyUid' => $company->uid,
                'role' => $assignment->role,
                'appliesToClients' => $scope,
                'contactsCovered' => $reach['contactsCovered'],
            ],
        ]);

        if (! $wasLive) {
            Notifier::send([
                'user' => $staff,
                'actor' => $request->user(),
                'type' => 'company.staff_assigned',
                'title' => $request->user()->name.' assigned you to '.$company->name,
                'message' => $reach['label'] ?: null,
                'subject' => $company,
                'action_url' => Pages::HOME,
            ]);
        }

        // The provider directory is assignment-scoped, so this row can put a
        // provider into somebody's list for the first time.
        Live::staffAnd(Live::COMPANIES, [$staff->id]);
        Live::staffAnd(Live::CLIENTS, [$staff->id]);
        // A company assignment can reach that firm's clients too.
        Cache::forget('companies.directory');
        ClientDirectory::flushFor($staff);

        return response()->json([
            'assignments' => $this->present($company),
            'assignable' => $this->assignableStaff($company),
            'applied' => $reach,
        ]);
    }

    /** End a company assignment; the inherited access goes with it. */
    public function destroy(Request $request, string $uid, int $userId): JsonResponse
    {
        Role::authorize($request->user(), 'clients.assign');
        $company = Company::where('uid', $uid)->firstOrFail();

        $assignment = CompanyStaffAssignment::live()
            ->where('company_id', $company->id)->where('user_id', $userId)->first();

        if ($assignment) {
            $assignment->forceFill([
                'status' => CompanyStaffAssignment::STATUS_ENDED,
                'ended_at' => now(),
                'ended_by' => $request->user()->id,
                'is_primary' => false,
            ])->save();

            ActivityLogger::log([
                'actor' => $request->user(),
                'type' => 'company.staff_removed',
                'module' => 'clients',
                'description' => $request->user()->name.' removed '
                    .($assignment->user?->name ?? 'a staff member').' from '.$company->name,
                'subject' => $company,
                'metadata' => ['companyUid' => $company->uid],
            ]);

            if ($assignment->user) {
                Notifier::send([
                    'user' => $assignment->user,
                    'actor' => $request->user(),
                    'type' => 'company.staff_removed',
                    'title' => 'You are no longer assigned to '.$company->name,
                    'message' => 'Any access that came from it has been removed.',
                    'subject' => $company,
                ]);
            }
        }

        Live::staffAnd(Live::COMPANIES, [$userId]);
        Live::staffAnd(Live::CLIENTS, [$userId]);
        Cache::forget('companies.directory');
        ClientDirectory::flushFor($assignment?->user);

        return response()->json([
            'assignments' => $this->present($company),
            'assignable' => $this->assignableStaff($company),
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function present(Company $company): array
    {
        return CompanyStaffAssignment::live()
            ->where('company_id', $company->id)
            ->with(['user', 'assigner'])
            ->orderByDesc('is_primary')
            ->get()
            ->map(fn (CompanyStaffAssignment $a) => $a->toRecord())
            ->values()->all();
    }

    /** @return array<int, array<string, mixed>> */
    private function assignableStaff(Company $company): array
    {
        $taken = CompanyStaffAssignment::live()->where('company_id', $company->id)->pluck('user_id')->all();

        return User::whereIn('account_type', Role::OFFICERS)
            ->where('status', 'approved')
            ->whereNotIn('id', $taken)
            ->orderBy('name')
            ->get()
            ->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'avatar' => $u->photoUrl(),
            ])->values()->all();
    }
}
