<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Support\Access\Role;
use App\Support\Companies\CompanyMembers;
use App\Support\Companies\CompanyRoles;
use App\Support\Invitations\Invitations;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * The people at a company account: who they are, what they may do, and getting
 * them invited.
 *
 * Reading the list is `clients.view`; changing it is `clients.manage`, the same
 * bar as editing the client records themselves, adding somebody to a company
 * hands them access to that company's files and invoices.
 */
class CompanyMemberController extends Controller
{
    public function index(Request $request, string $uid): JsonResponse
    {
        Role::authorize($request->user(), 'clients.view');
        $company = Company::where('uid', $uid)->firstOrFail();

        return response()->json([
            'members' => $this->present($company),
            'removed' => CompanyMember::where('company_id', $company->id)
                ->where('status', CompanyMember::STATUS_REMOVED)
                ->latest('removed_at')->limit(20)->get()
                ->map(fn (CompanyMember $m) => $m->toRecord())->values(),
            'roles' => CompanyRoles::options(),
            'abilities' => CompanyRoles::ABILITIES,
        ]);
    }

    public function store(Request $request, string $uid): JsonResponse
    {
        Role::authorize($request->user(), 'clients.manage');
        $company = Company::where('uid', $uid)->firstOrFail();

        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'max:255'],
            'jobTitle' => ['nullable', 'string', 'max:120'],
            'role' => ['required', Rule::in(CompanyRoles::all())],
            'primary' => ['sometimes', 'boolean'],
            'clientUid' => ['nullable', 'string', 'max:96'],
            'invite' => ['sometimes', 'boolean'],
            'abilities' => ['nullable', 'array'],
        ]);

        $client = ! empty($data['clientUid'])
            ? Client::where('uid', $data['clientUid'])->firstOrFail()
            : null;

        abort_if(
            empty($data['email']) && ! $client,
            422,
            'Give an email address, or pick an existing contact.',
        );

        $member = CompanyMembers::add($company, array_merge([
            'name' => $data['name'] ?? $client?->name,
            'email' => $data['email'] ?? $client?->email,
            'job_title' => $data['jobTitle'] ?? null,
            'role' => $data['role'],
            'is_primary' => $request->boolean('primary'),
            'client_id' => $client?->id,
        ], $this->abilityOverrides($data['abilities'] ?? [])), $request->user());

        $invitation = null;
        if ($request->boolean('invite')) {
            $invitation = CompanyMembers::invite($company, $member, $request->user());
        }

        return response()->json([
            'member' => $member->toRecord(),
            'members' => $this->present($company),
            'invitation' => $invitation ? Invitations::toRecord($invitation) : null,
        ], 201);
    }

    /** Send (or re-send) this member's invitation. */
    public function invite(Request $request, string $uid, string $memberUuid): JsonResponse
    {
        Role::authorize($request->user(), 'clients.manage');
        $company = Company::where('uid', $uid)->firstOrFail();
        $member = $this->member($company, $memberUuid);

        abort_if($member->user_id !== null, 422, 'This person already has portal access.');
        abort_if(! $member->displayEmail(), 422, 'Add an email address before inviting them.');

        $invitation = CompanyMembers::invite($company, $member, $request->user());

        return response()->json([
            'invitation' => $invitation ? Invitations::toRecord($invitation) : null,
            'members' => $this->present($company),
        ]);
    }

    /** Change role, permissions or the primary flag. */
    public function update(Request $request, string $uid, string $memberUuid): JsonResponse
    {
        Role::authorize($request->user(), 'clients.manage');
        $company = Company::where('uid', $uid)->firstOrFail();
        $member = $this->member($company, $memberUuid);

        $data = $request->validate([
            'role' => ['nullable', Rule::in(CompanyRoles::all())],
            'primary' => ['sometimes', 'boolean'],
            'abilities' => ['nullable', 'array'],
        ]);

        if (! empty($data['role']) && $data['role'] !== $member->role) {
            $member = CompanyMembers::changeRole(
                $company,
                $member,
                $data['role'],
                $request->user(),
                $this->abilityOverrides($data['abilities'] ?? []),
            );
        } elseif (! empty($data['abilities'])) {
            // Permissions tweaked without changing the role.
            $member->forceFill(CompanyRoles::resolve(
                $member->role,
                $this->abilityOverrides($data['abilities']),
            ))->save();
            $member = $member->fresh();
        }

        if ($request->boolean('primary')) {
            CompanyMembers::makePrimary($company, $member);
            $member = $member->fresh();
        }

        return response()->json([
            'member' => $member->toRecord(),
            'members' => $this->present($company),
        ]);
    }

    /** Take a member's access away. The row stays as a record. */
    public function destroy(Request $request, string $uid, string $memberUuid): JsonResponse
    {
        Role::authorize($request->user(), 'clients.manage');
        $company = Company::where('uid', $uid)->firstOrFail();
        $member = $this->member($company, $memberUuid);

        CompanyMembers::remove($company, $member, $request->user());

        return response()->json(['members' => $this->present($company)]);
    }

    /**
     * Turn the posted ability map into the snake_case flags a member row holds.
     * Anything not named is left to the role's default.
     *
     * @param  array<string, mixed>  $abilities
     * @return array<string, bool>
     */
    private function abilityOverrides(array $abilities): array
    {
        $out = [];

        foreach (CompanyRoles::ABILITIES as $flag) {
            $camel = Str::camel($flag);
            if (array_key_exists($flag, $abilities)) {
                $out[$flag] = (bool) $abilities[$flag];
            } elseif (array_key_exists($camel, $abilities)) {
                $out[$flag] = (bool) $abilities[$camel];
            }
        }

        return $out;
    }

    private function member(Company $company, string $uuid): CompanyMember
    {
        return CompanyMember::where('company_id', $company->id)
            ->where('uuid', $uuid)
            ->firstOrFail();
    }

    /** @return array<int, array<string, mixed>> */
    private function present(Company $company): array
    {
        return CompanyMember::current()
            ->where('company_id', $company->id)
            ->with(['user', 'client'])
            ->orderByDesc('is_primary')
            ->get()
            ->map(fn (CompanyMember $m) => $m->toRecord())
            ->values()->all();
    }
}
