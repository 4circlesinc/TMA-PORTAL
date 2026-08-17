<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Company;
use App\Models\CompanyStaffAssignment;
use App\Models\User;
use App\Support\Access\AccessSync;
use App\Support\Access\ClientScope;
use App\Support\Access\CompanyScope;
use App\Support\Access\Role;
use App\Support\Cip\Providers;
use App\Support\Clients\ClientDirectory;
use App\Support\Realtime\Live;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Companies in the Client hub. Staff can create a company and attach people
 * (client contacts) to it.
 */
class CompaniesController extends Controller
{
    private const STAFF = ['Administrator', 'Employee'];

    /**
     * The client columns a company record prints for a person, in both the
     * `people` list and the `referred` preview. Notably not `data`: the blob is
     * the widest column on the table and neither list draws any of it.
     *
     * @see Company::toRecord()
     */
    private const PERSON_COLUMNS = [
        'id', 'company_id', 'uid', 'name', 'initial', 'initial_color', 'email', 'user_id',
    ];

    /** Warm the company list briefly — it rides next to the client directory
     *  on hub mount and is identical for every staff reader. */
    private const INDEX_TTL_SECONDS = 60;

    public function index(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        /*
         * The firm-wide cache is only right for accounts that see the whole
         * directory — the counts and previews inside it are viewer-scoped
         * now, so a cached slice would be one officer's view served to the
         * next reader. Everyone else gets their assignment slice, computed
         * per request: a handful of rows, not worth a per-user cache.
         */
        if (CompanyScope::seesEveryCompany($request->user())) {
            $payload = Cache::remember(
                'companies.directory',
                self::INDEX_TTL_SECONDS,
                fn () => $this->directoryPayload(Company::query(), $request->user()),
            );
        } else {
            $payload = $this->directoryPayload(CompanyScope::query($request->user()), $request->user());
        }

        return response()->json($payload);
    }

    /** The listing payload for whichever slice of companies the query holds. */
    private function directoryPayload(Builder $query, User $viewer): array
    {
        $companies = $query->with(['clients' => fn ($q) => $q
            // Only the columns toRecord() prints for a person. Unconstrained,
            // this pulls each member's whole `data` blob — harmless while one
            // client belongs to a company, and a second copy of the clients
            // problem the moment the firm starts using membership.
            ->select(self::PERSON_COLUMNS)
            ->orderBy('name')
            ->orderBy('id')])
            // Every count the record prints, aggregated in the listing query.
            // toRecord() falls back to a query per count when the figure is
            // absent, which for member counts meant one round trip per company.
            ->withCount([
                'referredClients' => fn ($q) => $this->viewerClients($viewer, $q),
                'clients' => fn ($q) => $this->viewerClients($viewer, $q),
                'members as current_members_count' => fn ($q) => $q->current(),
            ])
            ->orderBy('name')
            ->get();

        $this->attachReferredPreviews($companies, $viewer);

        return [
            'companies' => $companies->map->toRecord()->values()->all(),
        ];
    }

    /**
     * Give every company its referred-client preview, in one query.
     *
     * toRecord() falls back to a `limit 12` query per company when the relation
     * is not loaded — sixty-four round trips to a remote database to print
     * sixty-four short lists, which was half of this endpoint's twenty seconds.
     * Eloquent cannot eager load a per-parent limit, so the ranking is done in
     * the database and only the first rows of each company come back.
     *
     * @param  Collection<int, Company>  $companies
     */
    private function attachReferredPreviews(Collection $companies, User $viewer): void
    {
        $ids = $companies->pluck('id')->all();

        $previews = $ids ? $this->referredPreviews($ids, $viewer) : [];

        foreach ($companies as $company) {
            $company->setRelation(
                'referredClients',
                $previews[$company->id] ?? new EloquentCollection,
            );
        }
    }

    /**
     * @param  array<int, int>  $companyIds
     * @return array<int, EloquentCollection<int, Client>>
     */
    private function referredPreviews(array $companyIds, User $viewer): array
    {
        // The base builder rather than the model, so the soft-delete scope is
        // not applied twice once this is wrapped in the outer query.
        $ranked = DB::table('clients')
            ->select(self::PERSON_COLUMNS)
            ->addSelect('referred_by_company_id')
            // `name, id`, not `name` alone. The caseload is full of repeated
            // names — one referrer has 188 that appear more than once — and
            // ordering by name only leaves the tie to the planner, so which of
            // two "ABBAS DARWICH" rows the preview showed could change between
            // identical requests. The id settles it the same way every time.
            ->selectRaw(
                'row_number() over (partition by referred_by_company_id order by name, id) as preview_rank'
            )
            ->whereIn('referred_by_company_id', $companyIds)
            ->whereNull('deleted_at');

        /*
         * The viewer's slice, not the firm's book.
         *
         * An officer holds one applicant at Galaxy Partners; the firm has
         * three. Their providers tab must preview — and count — the one, for
         * the same reason the directory shows them the one: the rest of the
         * book is not theirs to read, and a count of three above a page that
         * shows one person reads as the page being broken.
         */
        if (! ClientScope::seesEveryClient($viewer)) {
            $ranked->whereIn('id', ClientAssignment::query()
                ->select('client_id')->live()->where('user_id', $viewer->id));
        }

        $rows = DB::query()
            ->fromSub($ranked, 'ranked')
            ->where('preview_rank', '<=', Company::REFERRED_PREVIEW)
            ->get();

        $grouped = [];
        foreach ($rows as $row) {
            $grouped[$row->referred_by_company_id][] = (array) $row;
        }

        return array_map(fn (array $rows) => Client::hydrate($rows), $grouped);
    }

    /**
     * Narrow a client list or count to what this viewer may see.
     *
     * The rule is {@see ClientScope}'s, restated as a constraint because these
     * are relation closures on a company query rather than a client query of
     * their own. Somebody with clients.viewAll reads the firm's whole book;
     * everybody else reads the clients they are assigned to, here exactly as
     * in the directory — the company page is another window onto the same
     * records, not a way around the slice.
     */
    private function viewerClients(User $viewer, $query)
    {
        if (! ClientScope::seesEveryClient($viewer)) {
            $query->whereIn($query->getModel()->getQualifiedKeyName(), ClientAssignment::query()
                ->select('client_id')->live()->where('user_id', $viewer->id));
        }

        return $query;
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
            'cipCode' => ['nullable', 'string', 'max:8', 'alpha'],
        ]);

        $base = $data['uid'] ?? Str::slug($data['name']);
        $company = Company::create(array_merge([
            'uid' => $this->uniqueUid($base ?: 'company'),
            'name' => $data['name'],
            'created_by' => $request->user()->id,
        ], $this->profileColumns($data)));

        if (array_key_exists('cipCode', $data)) {
            Providers::syncCode($company, $data['cipCode']);
        }

        // An employee's directory is their assignments — without this row the
        // provider they just created would vanish from their own list.
        if (! CompanyScope::seesEveryCompany($request->user())) {
            CompanyStaffAssignment::create([
                'company_id' => $company->id,
                'user_id' => $request->user()->id,
                'role' => 'general',
                'permission_level' => 'manager',
                'applies_to_clients' => CompanyStaffAssignment::SCOPE_COMPANY_ONLY,
                'status' => CompanyStaffAssignment::STATUS_ACTIVE,
                'assigned_by' => $request->user()->id,
            ]);
        }

        Cache::forget('companies.directory');
        Live::staff(Live::COMPANIES);
        Live::staff(Live::CLIENTS);

        return response()->json([
            'company' => $company->load(['clients' => fn ($q) => $q->orderBy('name')->orderBy('id')])->toRecord(),
        ], 201);
    }

    public function show(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);

        /*
         * Every people list and count preloaded, viewer-scoped. toRecord()
         * falls back to its own unscoped queries for whatever is absent, so a
         * relation left unloaded here would hand an officer the firm's whole
         * book on the profile page the directory had correctly narrowed.
         */
        $company = CompanyScope::query(
            $request->user(),
            Company::with([
                'clients' => fn ($q) => $this->viewerClients($request->user(), $q)
                    ->orderBy('name')->orderBy('id'),
                'referredClients' => fn ($q) => $this->viewerClients($request->user(), $q)
                    ->select(self::PERSON_COLUMNS)
                    ->addSelect('referred_by_company_id')
                    ->orderBy('name')->orderBy('id')
                    ->limit(Company::REFERRED_PREVIEW),
            ])->withCount([
                'referredClients' => fn ($q) => $this->viewerClients($request->user(), $q),
                'clients' => fn ($q) => $this->viewerClients($request->user(), $q),
            ]),
        )->where('uid', $uid)->firstOrFail();

        return response()->json(['company' => $company->toRecord()]);
    }

    public function update(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);

        $company = CompanyScope::findOrFail($request->user(), $uid);
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
            'cipCode' => ['nullable', 'string', 'max:8', 'alpha'],
        ]);

        if (array_key_exists('name', $data)) {
            $company->name = $data['name'];
        }
        $company->forceFill($this->profileColumns($data));
        $company->save();

        if (array_key_exists('cipCode', $data)) {
            Providers::syncCode($company, $data['cipCode']);
        }

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
            ClientDirectory::flush();
        }

        Cache::forget('companies.directory');
        Live::staff(Live::COMPANIES);
        Live::staff(Live::CLIENTS);

        return response()->json([
            'company' => $company->fresh()->load(['clients' => fn ($q) => $q->orderBy('name')->orderBy('id')])->toRecord(),
        ]);
    }

    public function destroy(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);

        $company = CompanyScope::findOrFail($request->user(), $uid);

        /*
         * A company backing a CIP provider firm is not deletable at all.
         *
         * It used to be refused only once the provider had applications, and
         * the gap put four provider firms in the bin: the CIP registry kept
         * naming them (the wizard still offered Galaxy Partners, the table
         * still printed it) while the Service providers tab — which lists
         * companies — showed nothing, and the Recycle Bin does not list
         * companies, so there was no way back from inside the portal. A firm
         * half-present like that reads as the module being broken.
         */
        $provider = $company->cipProvider;

        if ($provider !== null) {
            $applications = $provider->applications()->count();

            abort(422, $applications > 0
                ? 'This service provider has '.$applications.' application'
                    .($applications === 1 ? '' : 's').' and cannot be deleted.'
                : 'This company is the service provider firm '.$provider->code
                    .'. Remove the provider registration first.');
        }

        // Settle the access first, while the company still exists to log it.
        AccessSync::companyArchived($company, $request->user());

        /*
         * Everyone attached to the provider can go with it — its own contacts
         * and the clients it referred alike, which is what "its people" means
         * to the person looking at the record. Left alone (the default) they
         * survive and are simply unlinked.
         */
        if ($request->boolean('withPeople')) {
            foreach ($company->clients()->get() as $person) {
                AccessSync::clientArchived($person, $request->user());
                $person->delete();
            }
            foreach ($company->referredClients()->get() as $person) {
                AccessSync::clientArchived($person, $request->user());
                $person->delete();
            }
        } else {
            // People stay; they just become unattached.
            $company->clients()->update(['company_id' => null]);
        }
        // Same for anyone it referred. The referral goes back to "not
        // recorded" rather than lingering as a company nothing can name.
        $company->referredClients()->update([
            'referred_by_company_id' => null,
            'referral_type' => Client::REFERRAL_NONE,
        ]);
        $company->delete();

        Cache::forget('companies.directory');
        Live::staff(Live::COMPANIES);
        Live::staff(Live::CLIENTS);
        ClientDirectory::flush();

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
