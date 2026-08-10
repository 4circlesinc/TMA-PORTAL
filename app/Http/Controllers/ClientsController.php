<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use App\Support\Access\AccessSync;
use App\Support\Access\ClientScope;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Clients\Assignments;
use App\Support\Clients\ClientCustomFields;
use App\Support\Files\FolderProvisioner;
use App\Support\Notifications\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The firm's client directory (the "Client hub"). Staff-facing: administrators
 * and employees manage the shared list of clients. The rich, irregular contact
 * record is kept verbatim in `clients.data`; this controller only extracts a
 * few columns for listing and search and hands the record back unchanged.
 */
class ClientsController extends Controller
{
    /** Staff who may manage clients. Client accounts never reach this data. */
    private const STAFF = ['Administrator', 'Employee'];

    /**
     * What the directory listing selects. Note the absence of `data`: see
     * index() for why, and {@see Client::toDirectoryRecord()} for what may be
     * read here. `deleted_at` is listed because the soft-delete trait reads it.
     */
    private const DIRECTORY_COLUMNS = [
        'id', 'uid', 'user_id', 'folder_id', 'company_id', 'name', 'client_type',
        'company', 'referral_type', 'referred_by_company_id', 'email', 'phone',
        'initial', 'initial_color', 'deleted_at',
    ];

    /** Shortest term worth asking the database about. */
    private const SEARCH_MIN = 2;

    /**
     * The directory listing.
     *
     * Deliberately lean: `data` is not selected and no profile is returned.
     * The firm has eleven thousand clients and this endpoint used to hand back
     * every full contact record on every page load — 9.6 MB of JSON, seven
     * seconds of query-and-serialise, and a 127 MB memory peak for a page that
     * shows a hundred rows. Profiles now load one at a time from show(), and
     * searching the profile happens in the database (see search()).
     */
    public function index(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        $clients = ClientScope::query($request->user())
            ->select(self::DIRECTORY_COLUMNS)
            // Constrained to the columns the record actually reads, so a wide
            // companies row is not loaded to print one name either.
            ->with([
                'folder:id,uuid',
                'companyRecord:id,uid,name',
                'referredByCompany:id,uid,name',
            ])
            ->orderBy('name')
            ->get()
            ->map->toDirectoryRecord()
            ->values();

        // The definitions ride along with the list: the client form has to
        // render whatever the firm defined, and a field list nothing can draw
        // is the mock this replaced.
        return response()->json([
            'clients' => $clients,
            'customFields' => ClientCustomFields::all(),
        ]);
    }

    /**
     * Which clients match a search term, as uids.
     *
     * The directory searches names, contact details, job titles and company
     * names — fields that live inside the `data` blob the listing no longer
     * ships. Rather than send every profile to the browser so it can filter
     * them, the browser asks here and gets back the set of matching ids.
     *
     * Only ids: the caller already holds the directory entries, so the answer
     * to "who matches" is a few kilobytes however many clients match.
     */
    public function search(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        $term = trim((string) $request->query('q', ''));

        // One character matches most of the directory and answers nothing.
        // The caller filters by name locally until there are two.
        if (mb_strlen($term) < self::SEARCH_MIN) {
            return response()->json(['query' => $term, 'ids' => []]);
        }

        $like = '%'.addcslashes($term, '\\%_').'%';
        $op = $this->likeOperator();

        $ids = ClientScope::query($request->user())
            ->where(function ($q) use ($like, $op) {
                $q->where('name', $op, $like)
                    ->orWhere('email', $op, $like)
                    ->orWhere('phone', $op, $like)
                    ->orWhere('company', $op, $like)
                    // The rest of the searchable fields — nickname, job title,
                    // extra emails and phones — have no column of their own.
                    ->orWhereRaw($this->blobTextExpression().' '.$op.' ?', [$like]);
            })
            ->orderBy('name')
            ->pluck('uid');

        return response()->json(['query' => $term, 'ids' => $ids]);
    }

    /** Case-insensitive LIKE: Postgres needs ILIKE, SQLite's LIKE already is. */
    private function likeOperator(): string
    {
        return Client::query()->getConnection()->getDriverName() === 'pgsql' ? 'ilike' : 'like';
    }

    /** The `data` blob as searchable text, in this connection's dialect. */
    private function blobTextExpression(): string
    {
        return Client::query()->getConnection()->getDriverName() === 'pgsql'
            ? 'clients.data::text'
            : 'clients.data';
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorizeManage($request);

        $data = $this->validated($request, requireUid: true);

        // Never trust a collided uid: the UI proposes one, we make it unique.
        $uid = $this->uniqueUid($data['uid']);

        $client = Client::create($this->columns($uid, $data, $request->user()));

        // Every client gets a main folder (+ configured default subfolders),
        // linked by id. Admins have access immediately; assigned staff get it
        // when assigned; the client sees nothing until something is shared.
        FolderProvisioner::provisionClientFolder($client, $request->user());

        /*
         * The employee who created the client is its first assignee.
         *
         * Employees only. An administrator already reaches every client, so a
         * row for them would grant nothing while implying they had been picked
         * out for this one — the same reason they are kept out of the
         * assignment list. Manager level, because creating a client is the act
         * of somebody who owns the relationship rather than observes it.
         */
        if (Role::of($request->user()) === Role::EMPLOYEE) {
            Assignments::assign($client, $request->user(), [
                'role' => 'account_manager',
                'level' => 'manager',
                'primary' => true,
            ], $request->user());
        }

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'client.created',
            'description' => $request->user()->name.' created client '.$client->name,
            'subject' => $client,
            'client' => $client,
            'new' => ['name' => $client->name, 'company' => $client->company],
        ]);
        Notifier::notifyAdmins([
            'actor' => $request->user(),
            'type' => 'client.created',
            'title' => $request->user()->name.' added a new client: '.$client->name,
            'subject' => $client,
            'client' => $client,
            'action_url' => '/clients?client='.$client->uid,
        ]);

        return response()->json(['client' => $client->fresh(['folder', 'companyRecord', 'referredByCompany'])->toRecord()]);
    }

    public function show(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);

        $client = ClientScope::query($request->user())
            ->with(['folder', 'companyRecord', 'referredByCompany'])
            ->where('uid', $uid)
            ->firstOrFail();

        return response()->json(['client' => $client->toRecord()]);
    }

    public function update(Request $request, string $uid): JsonResponse
    {
        $this->authorizeManage($request);

        $client = ClientScope::findOrFail($request->user(), $uid);
        $data = $this->validated($request, requireUid: false);

        $client->fill($this->columns($uid, $data, $client->creator));
        $client->save();

        // A renamed client keeps its folder and files; only the visible name
        // follows. Make sure the folder exists too (older clients predate it).
        FolderProvisioner::provisionClientFolder($client, $request->user());
        FolderProvisioner::syncClientFolderName($client);

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'client.updated',
            'description' => $request->user()->name.' edited client '.$client->name,
            'subject' => $client,
            'client' => $client,
        ]);

        return response()->json(['client' => $client->fresh(['folder', 'companyRecord', 'referredByCompany'])->toRecord()]);
    }

    public function destroy(Request $request, string $uid): JsonResponse
    {
        $this->authorizeManage($request);

        $client = ClientScope::findOrFail($request->user(), $uid);
        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'client.deleted',
            'description' => $request->user()->name.' deleted client '.$client->name,
            'subject' => $client,
            'client' => $client,
        ]);
        // Settle the access before the record goes: a soft-deleted client must
        // not leave live assignments or an invitation somebody could accept.
        AccessSync::clientArchived($client, $request->user());
        $client->delete();

        return response()->json(['status' => 'ok']);
    }

    public function bulkDestroy(Request $request): JsonResponse
    {
        $this->authorizeManage($request);

        $data = $request->validate([
            'uids' => ['required', 'array', 'min:1'],
            'uids.*' => ['string'],
        ]);

        $deleted = ClientScope::query($request->user())
            ->whereIn('uid', $data['uids'])
            ->delete();

        return response()->json(['deleted' => $deleted]);
    }

    public function duplicate(Request $request, string $uid): JsonResponse
    {
        $this->authorizeManage($request);

        $source = ClientScope::findOrFail($request->user(), $uid);

        $copy = $source->replicate(['uid', 'name']);
        $copy->uid = $this->uniqueUid($source->uid.'-copy');
        $copy->name = $source->name.' (copy)';
        $copy->created_by = $request->user()->id;
        $copy->save();

        return response()->json(['client' => $copy->toRecord()]);
    }

    /**
     * Validate the incoming payload. `profile` is the UI's full contact draft;
     * we keep its shape loose on purpose - the page owns it - but require the
     * nested collections to be arrays so column extraction is safe.
     *
     * @return array<string, mixed>
     */
    private function validated(Request $request, bool $requireUid): array
    {
        $data = $request->validate([
            'uid' => [$requireUid ? 'required' : 'nullable', 'string', 'max:96', 'regex:/^[a-z0-9\-]+$/'],
            'name' => ['nullable', 'string', 'max:255'],
            'initial' => ['nullable', 'string', 'max:4'],
            'initialColor' => ['nullable', 'string', 'max:24'],
            'companyId' => ['nullable', 'string', 'max:96'],
            'clientType' => ['nullable', 'in:private,company'],
            'referralType' => ['nullable', 'in:company,private,none'],
            'referredByCompanyId' => ['nullable', 'string', 'max:96'],
            'profile' => ['required', 'array'],
            'profile.phones' => ['nullable', 'array'],
            'profile.emails' => ['nullable', 'array'],
            'profile.addresses' => ['nullable', 'array'],
            'profile.importantDates' => ['nullable', 'array'],
            'profile.work' => ['nullable', 'array'],
        ]);

        // Mixing `profile` and `profile.*` rules makes validated() drop the
        // blob when it has none of those sub-keys; take it whole from input.
        $data['profile'] = $request->input('profile', []);

        return $data;
    }

    /**
     * Map the validated payload onto table columns, pulling the searchable
     * scalars out of the profile blob.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function columns(string $uid, array $data, ?User $creator): array
    {
        // Every client write comes through here, which is why the custom
        // fields are normalised at this point rather than per endpoint: a
        // deleted field stops being stored, and a dropdown cannot keep a value
        // that is no longer one of its options.
        $profile = ClientCustomFields::sanitise($data['profile']);
        $company = $this->resolveCompany($data['companyId'] ?? null, $profile['work']['company'] ?? null);

        if ($company) {
            $profile['work'] = array_merge($profile['work'] ?? [], [
                'company' => $company->name,
            ]);
        }

        $referral = $this->resolveReferral($data);

        return [
            'uid' => $uid,
            'name' => $this->deriveName($data, $profile),
            'client_type' => $data['clientType'] ?? 'private',
            'company_id' => $company?->id,
            'company' => $company?->name ?? ($profile['work']['company'] ?? null),
            'referral_type' => $referral['type'],
            'referred_by_company_id' => $referral['company_id'],
            'email' => $this->firstValue($profile['emails'] ?? []),
            'phone' => $this->firstValue($profile['phones'] ?? []),
            'initial' => $data['initial'] ?? null,
            'initial_color' => $data['initialColor'] ?? null,
            'data' => $profile,
            'created_by' => $creator?->id,
        ];
    }

    /**
     * Settle the referral into a pair the table can trust: the type is only
     * `company` when a company was actually found, so a referrer that has since
     * been deleted degrades to "not recorded" rather than leaving a row that
     * claims a referral it cannot name.
     *
     * @param  array<string, mixed>  $data
     * @return array{type: string, company_id: int|null}
     */
    private function resolveReferral(array $data): array
    {
        $type = $data['referralType'] ?? Client::REFERRAL_NONE;

        if ($type === Client::REFERRAL_PRIVATE) {
            return ['type' => Client::REFERRAL_PRIVATE, 'company_id' => null];
        }

        $uid = $data['referredByCompanyId'] ?? null;
        $referrer = $uid ? Company::where('uid', $uid)->first() : null;

        return $referrer
            ? ['type' => Client::REFERRAL_COMPANY, 'company_id' => $referrer->id]
            : ['type' => Client::REFERRAL_NONE, 'company_id' => null];
    }

    private function resolveCompany(?string $companyUid, ?string $companyName): ?Company
    {
        if ($companyUid) {
            return Company::where('uid', $companyUid)->first();
        }

        $name = trim((string) $companyName);
        if ($name === '') {
            return null;
        }

        // Legacy free-text company: attach to an existing match when possible.
        return Company::whereRaw('LOWER(name) = ?', [mb_strtolower($name)])->first();
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, mixed>  $profile
     */
    private function deriveName(array $data, array $profile): string
    {
        if (! empty($data['name'])) {
            return $data['name'];
        }

        $parts = array_filter([
            $profile['firstName'] ?? null,
            $profile['middleName'] ?? null,
            $profile['lastName'] ?? null,
        ]);

        return trim(implode(' ', $parts)) ?: 'Client';
    }

    /** The first non-empty `value` in a [{type,value}, ...] collection. */
    private function firstValue(mixed $rows): ?string
    {
        if (! is_array($rows)) {
            return null;
        }

        foreach ($rows as $row) {
            if (is_array($row) && ! empty($row['value'])) {
                return (string) $row['value'];
            }
        }

        return null;
    }

    private function uniqueUid(string $base): string
    {
        $base = trim($base, '-') ?: 'client';
        $uid = $base;
        $n = 2;
        while (Client::withTrashed()->where('uid', $uid)->exists()) {
            $uid = $base.'-'.$n;
            $n++;
        }

        return $uid;
    }

    private function authorizeStaff(Request $request): void
    {
        abort_unless(
            Role::can($request->user(), 'clients.view'),
            403,
            'Only staff can manage the client directory.'
        );
    }

    /**
     * Writing to the directory, as opposed to reading it.
     *
     * `clients.manage` sat in the matrix from the start and nothing ever read
     * it, so every reader was a writer and the capability decided nothing.
     * It is switchable from Account settings > Client hub access now, which
     * only means anything if the write paths ask. Checked before validation,
     * so a refusal reads as a refusal rather than a form error.
     */
    private function authorizeManage(Request $request): void
    {
        $this->authorizeStaff($request);

        abort_unless(
            Role::can($request->user(), 'clients.manage'),
            403,
            'You do not have permission to change client records.'
        );
    }
}
