<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\User;
use App\Support\Files\FolderProvisioner;
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

    public function index(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        $clients = Client::orderBy('name')->get()->map->toRecord()->values();

        return response()->json(['clients' => $clients]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        $data = $this->validated($request, requireUid: true);

        // Never trust a collided uid: the UI proposes one, we make it unique.
        $uid = $this->uniqueUid($data['uid']);

        $client = Client::create($this->columns($uid, $data, $request->user()));

        // Every client gets a main folder (+ configured default subfolders),
        // linked by id. Admins have access immediately; assigned staff get it
        // when assigned; the client sees nothing until something is shared.
        FolderProvisioner::provisionClientFolder($client, $request->user());

        return response()->json(['client' => $client->fresh()->toRecord()]);
    }

    public function show(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);

        $client = Client::where('uid', $uid)->firstOrFail();

        return response()->json(['client' => $client->toRecord()]);
    }

    public function update(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);

        $client = Client::where('uid', $uid)->firstOrFail();
        $data = $this->validated($request, requireUid: false);

        $client->fill($this->columns($uid, $data, $client->creator));
        $client->save();

        // A renamed client keeps its folder and files; only the visible name
        // follows. Make sure the folder exists too (older clients predate it).
        FolderProvisioner::provisionClientFolder($client, $request->user());
        FolderProvisioner::syncClientFolderName($client);

        return response()->json(['client' => $client->fresh()->toRecord()]);
    }

    public function destroy(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);

        Client::where('uid', $uid)->firstOrFail()->delete();

        return response()->json(['status' => 'ok']);
    }

    public function bulkDestroy(Request $request): JsonResponse
    {
        $this->authorizeStaff($request);

        $data = $request->validate([
            'uids' => ['required', 'array', 'min:1'],
            'uids.*' => ['string'],
        ]);

        $deleted = Client::whereIn('uid', $data['uids'])->delete();

        return response()->json(['deleted' => $deleted]);
    }

    public function duplicate(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);

        $source = Client::where('uid', $uid)->firstOrFail();

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
        $profile = $data['profile'];

        return [
            'uid' => $uid,
            'name' => $this->deriveName($data, $profile),
            'company' => $profile['work']['company'] ?? null,
            'email' => $this->firstValue($profile['emails'] ?? []),
            'phone' => $this->firstValue($profile['phones'] ?? []),
            'initial' => $data['initial'] ?? null,
            'initial_color' => $data['initialColor'] ?? null,
            'data' => $profile,
            'created_by' => $creator?->id,
        ];
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
            in_array($request->user()?->account_type, self::STAFF, true),
            403,
            'Only staff can manage the client directory.'
        );
    }
}
