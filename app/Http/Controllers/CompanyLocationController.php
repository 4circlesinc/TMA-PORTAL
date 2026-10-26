<?php

namespace App\Http\Controllers;

use App\Models\Company;
use App\Models\CompanyLocation;
use App\Support\Companies\CompanyAccess;
use App\Support\Companies\CompanyLocations;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Offices and branches under a service provider.
 *
 * Reading follows who may see the firm's access list. Adding and removing
 * a branch follows who may change that list: TMA staff with clients.manage,
 * or the firm's Service Provider admin.
 */
class CompanyLocationController extends Controller
{
    public function index(Request $request, string $uid): JsonResponse
    {
        $company = $this->company($uid);
        abort_unless(CompanyAccess::canViewMembers($request->user(), $company), 403);

        return response()->json([
            'locations' => CompanyLocations::records($company),
        ]);
    }

    public function store(Request $request, string $uid): JsonResponse
    {
        $company = $this->company($uid);
        abort_unless(CompanyAccess::canManageMembers($request->user(), $company), 403);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
        ]);

        $location = CompanyLocations::addBranch($company, $data['name'], $request->user());

        return response()->json([
            'location' => $location->toRecord(),
            'locations' => CompanyLocations::records($company),
        ], 201);
    }

    public function destroy(Request $request, string $uid, string $locationUid): JsonResponse
    {
        $company = $this->company($uid);
        abort_unless(CompanyAccess::canManageMembers($request->user(), $company), 403);

        $location = CompanyLocation::query()
            ->where('company_id', $company->id)
            ->where('uid', $locationUid)
            ->firstOrFail();

        CompanyLocations::removeBranch($company, $location, $request->user());

        return response()->json([
            'locations' => CompanyLocations::records($company),
        ]);
    }

    private function company(string $uid): Company
    {
        return Company::where('uid', $uid)->firstOrFail();
    }
}
