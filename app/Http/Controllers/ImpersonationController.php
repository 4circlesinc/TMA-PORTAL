<?php

namespace App\Http\Controllers;

use App\Models\Company;
use App\Models\User;
use App\Support\Access\Impersonation;
use App\Support\Access\Role;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * An administrator signing in as a service provider, and the way back.
 */
class ImpersonationController extends Controller
{
    public function store(Request $request, User $user): JsonResponse
    {
        Impersonation::start($request, $user);

        return response()->json([
            'status' => 'ok',
            'redirect' => Impersonation::landing($request->user()),
        ]);
    }

    /**
     * Open the portal as this firm's admin. Uses the admin who can already
     * sign in, or opens that admin account when the firm does not have one.
     */
    public function company(Request $request, string $uid): JsonResponse
    {
        Role::authorizeAdmin($request->user());

        $company = Company::query()->where('uid', $uid)->firstOrFail();
        $account = Impersonation::ensureAccount($company, $request->user());

        Impersonation::start($request, $account, $company);

        return response()->json([
            'status' => 'ok',
            'redirect' => Impersonation::landing($request->user(), $company),
            'account' => [
                'id' => $request->user()->id,
                'name' => $request->user()->name,
            ],
        ]);
    }

    public function destroy(Request $request): JsonResponse
    {
        abort_unless(Impersonation::isActive(), 403, 'You are not signed in as someone else.');

        return response()->json([
            'status' => 'ok',
            'redirect' => Impersonation::stop($request),
        ]);
    }
}
