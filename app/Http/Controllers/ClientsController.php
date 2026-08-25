<?php

namespace App\Http\Controllers;

use App\Support\Realtime\Live;
use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use App\Support\Access\AccessSync;
use App\Support\Access\ClientScope;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Clients\Assignments;
use App\Support\Clients\ClientCustomFields;
use App\Support\Clients\ClientDirectory;
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
    /** Shortest term worth asking the database about. */
    private const SEARCH_MIN = 2;

    /**
     * The directory listing.
     *
     * Deliberately lean: `data` is not selected and no profile is returned.
     * The firm has eleven thousand clients and this endpoint used to hand back
     * every full contact record on every page load. 9.6 MB of JSON, seven
     * seconds of query-and-serialise, and a 127 MB memory peak for a page that
     * shows a hundred rows. Profiles now load one at a time from show(), and
     * searching the profile happens in the database (see search()).
     *
     * The payload is kept warm briefly ({@see ClientDirectory}) so the hub,
     * live refresh and any other full-list consumer share one rebuild.
     */
    public function index(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        return response()->json(ClientDirectory::for($request->user()));
    }

    /**
     * Every client record that has changed since a device last looked.
     *
     * The third cursor of the offline plan's phase 2/3, and the one its
     * "eleven thousand clients is a large first sync" sentence was written
     * about. Same contract as the applications and files cursors: the pair is
     * `updated_at` AND the row id with an INCLUSIVE tie-break (a same-instant
     * second change, delete then restore, must never be skipped for ever;
     * the re-delivered boundary row is absorbed by the upsert), no cursor
     * means everything, and a soft-deleted row arrives as a tombstone rather
     * than an absence.
     *
     * Full records (`toRecord`), not the directory's lean rows: the replica
     * exists so a profile can open offline for a client nobody has clicked
     * before, and the lean row is exactly the part the directory blob
     * already covers.
     */
    public function sync(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        $since = $this->syncCursorTime($request->query('since'));
        $after = (int) $request->query('after', 0);

        $query = ClientScope::query($request->user(), Client::withTrashed())
            ->with(['folder', 'companyRecord', 'referredByCompany']);

        if ($since !== null) {
            $query->where(function ($q) use ($since, $after) {
                $q->where('updated_at', '>', $since)
                    ->orWhere(fn ($same) => $same
                        ->where('updated_at', '=', $since)
                        ->where('id', '>=', $after));
            });
        }

        $page = $query
            ->orderBy('updated_at')
            ->orderBy('id')
            ->limit(200)
            ->get();

        $last = $page->last();

        return response()->json([
            'clients' => $page->map(fn (Client $client) => $client->trashed()
                ? ['id' => $client->uid, 'deleted' => true, 'deletedAt' => $client->deleted_at?->toIso8601String()]
                : $client->toRecord())->values()->all(),
            'cursor' => [
                'since' => $last ? $last->updated_at?->toIso8601String() : $request->query('since'),
                'after' => $last ? $last->id : $after,
            ],
            'more' => $page->count() === 200,
        ]);
    }

    /**
     * A cursor timestamp, or null, an unparseable value is no cursor at all,
     * because the worst case of that is re-reading a page the device already
     * holds, and the alternative is a client that can never recover from a
     * corrupt value it stored itself.
     */
    private function syncCursorTime(?string $value): ?\Carbon\CarbonImmutable
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        try {
            return \Carbon\CarbonImmutable::parse($value);
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * A short named slice for the right sidebar.
     *
     * The sidebar only ever paints six-to-ten rows. It used to pull the entire
     * directory on every portal page to do that, the same eleven-thousand-row
     * payload the hub needs, so opening Overview felt like opening Clients.
     */
    public function preview(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        $limit = (int) $request->query('limit', 10);

        return response()->json([
            'clients' => ClientDirectory::preview($request->user(), $limit),
        ]);
    }

    /**
     * Which clients match a search term.
     *
     * The hub asks for ids (it already holds the directory entries). Global
     * search asks for a capped set of lean records via `limit`, so it never
     * has to download the full directory just to filter twelve names.
     */
    public function search(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        $term = trim((string) $request->query('q', ''));
        $limit = (int) $request->query('limit', 0);

        // One character matches most of the directory and answers nothing.
        // The caller filters by name locally until there are two.
        if (mb_strlen($term) < self::SEARCH_MIN) {
            return response()->json([
                'query' => $term,
                'ids' => [],
                'clients' => [],
            ]);
        }

        // Global search: records only, capped. Skip the full id list.
        if ($limit > 0) {
            return response()->json([
                'query' => $term,
                'clients' => ClientDirectory::searchRecords($request->user(), $term, $limit),
            ]);
        }

        $like = '%'.addcslashes($term, '\\%_').'%';
        $op = $this->likeOperator();

        $ids = ClientScope::query($request->user())
            ->where(function ($q) use ($like, $op, $term) {
                $q->where('name', $op, $like)
                    ->orWhere('email', $op, $like)
                    ->orWhere('phone', $op, $like)
                    ->orWhere('company', $op, $like)
                    // The rest of the searchable fields, nickname, job title,
                    // extra emails and phones, have no column of their own.
                    ->orWhereRaw($this->blobTextExpression().' '.$op.' ?', [$like]);

                ClientDirectory::matchApplicationNumber($q, $term);
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
         * out for this one, the same reason they are kept out of the
         * assignment list. Manager level, because creating a client is the act
         * of somebody who owns the relationship rather than observes it.
         */
        if (in_array(Role::of($request->user()), Role::EMPLOYEE_LIKE, true)) {
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

        ClientDirectory::flushFor($request->user());
        Live::staff(Live::CLIENTS);

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

        ClientDirectory::flushFor($request->user());
        Live::staff(Live::CLIENTS);

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
        ClientDirectory::flushFor($request->user());
        Live::staff(Live::CLIENTS);

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

        ClientDirectory::flushFor($request->user());
        Live::staff(Live::CLIENTS);

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

        ClientDirectory::flushFor($request->user());
        Live::staff(Live::CLIENTS);

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
