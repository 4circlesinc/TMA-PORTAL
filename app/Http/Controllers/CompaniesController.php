<?php

namespace App\Http\Controllers;

use App\Models\Company;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Companies in the Client hub. Staff can create a company and attach people
 * (client contacts) to it.
 */
class CompaniesController extends Controller
{
    private const STAFF = ['Administrator', 'Employee'];

    public function index(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        $companies = Company::with(['clients' => fn ($q) => $q->orderBy('name')])
            ->orderBy('name')
            ->get()
            ->map->toRecord()
            ->values();

        return response()->json(['companies' => $companies]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        $data = $request->validate([
            'uid' => ['nullable', 'string', 'max:96', 'regex:/^[a-z0-9\-]+$/'],
            'name' => ['required', 'string', 'max:255'],
            'website' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string', 'max:5000'],
        ]);

        $base = $data['uid'] ?? Str::slug($data['name']);
        $company = Company::create([
            'uid' => $this->uniqueUid($base ?: 'company'),
            'name' => $data['name'],
            'website' => $data['website'] ?? null,
            'notes' => $data['notes'] ?? null,
            'created_by' => $request->user()->id,
        ]);

        return response()->json([
            'company' => $company->load(['clients' => fn ($q) => $q->orderBy('name')])->toRecord(),
        ], 201);
    }

    public function show(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);

        $company = Company::with(['clients' => fn ($q) => $q->orderBy('name')])
            ->where('uid', $uid)
            ->firstOrFail();

        return response()->json(['company' => $company->toRecord()]);
    }

    public function update(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);

        $company = Company::where('uid', $uid)->firstOrFail();
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'website' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string', 'max:5000'],
        ]);

        $company->fill($data);
        $company->save();

        // Keep denormalised company name on linked contacts in sync.
        if (array_key_exists('name', $data)) {
            foreach ($company->clients as $client) {
                $profile = $client->data ?? [];
                $profile['work'] = array_merge($profile['work'] ?? [], [
                    'company' => $company->name,
                ]);
                $client->company = $company->name;
                $client->data = $profile;
                $client->save();
            }
        }

        return response()->json([
            'company' => $company->fresh()->load(['clients' => fn ($q) => $q->orderBy('name')])->toRecord(),
        ]);
    }

    public function destroy(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);

        $company = Company::where('uid', $uid)->firstOrFail();
        // People stay; they just become unattached.
        $company->clients()->update(['company_id' => null]);
        $company->delete();

        return response()->json(['status' => 'ok']);
    }

    private function uniqueUid(string $base): string
    {
        $base = trim($base, '-') ?: 'company';
        $uid = $base;
        $n = 2;
        while (Company::withTrashed()->where('uid', $uid)->exists()) {
            $uid = $base.'-'.$n;
            $n++;
        }

        return $uid;
    }

    private function authorizeStaff(Request $request): void
    {
        abort_unless(
            in_array($request->user()?->account_type, self::STAFF, true),
            403,
            'Only staff can manage companies.'
        );
    }
}
