<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\Company;
use App\Support\Access\AccessSync;
use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
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
            // Every count the record prints, aggregated in the listing query.
            // toRecord() falls back to a query per count when the figure is
            // absent, which for member counts meant one round trip per company.
            ->withCount([
                'referredClients',
                'clients',
                'members as current_members_count' => fn ($q) => $q->current(),
            ])
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
            'logoUrl' => ['nullable', 'string', 'max:2048'],
            'companyType' => ['nullable', 'string', 'max:32'],
            'registrationNumber' => ['nullable', 'string', 'max:64'],
            'taxNumber' => ['nullable', 'string', 'max:64'],
            'industry' => ['nullable', 'string', 'max:120'],
            'email' => ['nullable', 'email', 'max:255'],
            'phone' => ['nullable', 'string', 'max:64'],
            'address' => ['nullable', 'array'],
            'billing' => ['nullable', 'array'],
            'status' => ['nullable', 'in:active,prospect,archived'],
        ]);

        $base = $data['uid'] ?? Str::slug($data['name']);
        $company = Company::create(array_merge([
            'uid' => $this->uniqueUid($base ?: 'company'),
            'name' => $data['name'],
            'created_by' => $request->user()->id,
        ], $this->profileColumns($data)));

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
            'logoUrl' => ['nullable', 'string', 'max:2048'],
            'companyType' => ['nullable', 'string', 'max:32'],
            'registrationNumber' => ['nullable', 'string', 'max:64'],
            'taxNumber' => ['nullable', 'string', 'max:64'],
            'industry' => ['nullable', 'string', 'max:120'],
            'email' => ['nullable', 'email', 'max:255'],
            'phone' => ['nullable', 'string', 'max:64'],
            'address' => ['nullable', 'array'],
            'billing' => ['nullable', 'array'],
            'status' => ['nullable', 'in:active,prospect,archived'],
        ]);

        if (array_key_exists('name', $data)) {
            $company->name = $data['name'];
        }
        $company->forceFill($this->profileColumns($data));
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
        // Settle the access first, while the company still exists to log it.
        AccessSync::companyArchived($company, $request->user());
        // People stay; they just become unattached.
        $company->clients()->update(['company_id' => null]);
        // Same for anyone it referred. The referral goes back to "not
        // recorded" rather than lingering as a company nothing can name.
        $company->referredClients()->update([
            'referred_by_company_id' => null,
            'referral_type' => Client::REFERRAL_NONE,
        ]);
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

    /**
     * Map the posted camelCase profile fields onto columns. Only keys that were
     * actually sent are touched, so a form that edits one section never blanks
     * the rest of the company record.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function profileColumns(array $data): array
    {
        $map = [
            'website' => 'website',
            'notes' => 'notes',
            'logoUrl' => 'logo_url',
            'companyType' => 'company_type',
            'registrationNumber' => 'registration_number',
            'taxNumber' => 'tax_number',
            'industry' => 'industry',
            'email' => 'email',
            'phone' => 'phone',
            'address' => 'address',
            'billing' => 'billing',
            'status' => 'status',
        ];

        $columns = [];
        foreach ($map as $input => $column) {
            if (array_key_exists($input, $data)) {
                $columns[$column] = $data[$input];
            }
        }

        return $columns;
    }

    private function authorizeStaff(Request $request): void
    {
        abort_unless(
            Role::can($request->user(), 'clients.view'),
            403,
            'Only staff can manage companies.'
        );
    }
}
