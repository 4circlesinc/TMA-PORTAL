<?php

namespace App\Http\Controllers\Files;

use App\Models\Client;
use App\Models\EmailDelivery;
use App\Models\FileRequest;
use App\Support\Files\ClientDocuments;
use App\Support\Files\FileAccess;
use App\Support\Files\FileRequests;
use App\Support\Files\FileType;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Presence\LastSeen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Document requests, from the signed-in side.
 *
 * Creating one hands out a write token to a stranger, so the destination and
 * every limit are settled here against the requester's own permissions and
 * then never taken from the visitor again, see App\Support\Files\FileRequests.
 */
class FileRequestController extends BaseFilesController
{
    public function index(Request $request): JsonResponse
    {
        $user = $this->user($request);

        $requests = FileRequest::query()
            ->with(['folder:id,uuid,name', 'client:id,uid,name', 'creator:id,name'])
            // Administrators oversee the firm's collection links; everybody
            // else sees the ones they issued.
            ->when(! FileAccess::isAdmin($user), fn ($q) => $q->where('created_by', $user->id))
            ->when($request->filled('folder'), function ($q) use ($request) {
                $folder = $this->findFolder((string) $request->input('folder'));
                $q->where('folder_id', $folder->id);
            })
            ->when($request->filled('client'), function ($q) use ($request) {
                $client = Client::where('uid', $request->input('client'))->first();
                $q->where('client_id', $client?->id ?? 0);
            })
            ->orderByDesc('id')
            ->limit(100)
            ->get();

        return response()->json([
            'requests' => $requests->map(fn (FileRequest $r) => FileRequests::present($r))->values(),
            'sizeChoices' => FileRequests::SIZE_CHOICES,
            'typeGroups' => FileRequests::TYPE_GROUPS,
            'maxBytes' => FileType::MAX_BYTES,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:150'],
            'message' => ['nullable', 'string', 'max:2000'],
            'folder' => ['nullable', 'string', 'max:64'],
            'client' => ['nullable', 'string', 'max:64'],
            'recipientEmail' => ['nullable', 'email', 'max:191'],
            'recipientName' => ['nullable', 'string', 'max:120'],
            'allowedExtensions' => ['nullable', 'array', 'max:64'],
            'allowedExtensions.*' => ['string', 'max:32'],
            'maxBytes' => ['nullable', 'integer', 'min:1'],
            'maxFiles' => ['nullable', 'integer', 'min:1', 'max:'.FileRequests::MAX_FILES_CEILING],
            'allowMultiple' => ['nullable', 'boolean'],
            'password' => ['nullable', 'string', 'min:4', 'max:128'],
            'expiresAt' => ['nullable', 'date'],
            'send' => ['nullable', 'boolean'],
        ]);

        $user = $this->user($request);
        $folder = FileRequests::resolveDestination($user, $data['folder'] ?? null);
        $client = $this->resolveClient($data['client'] ?? null, $folder);

        $allowMultiple = (bool) ($data['allowMultiple'] ?? true);

        $fileRequest = new FileRequest([
            'uuid' => (string) Str::uuid(),
            'token' => FileRequests::token(),
            'title' => $data['title'],
            'message' => $data['message'] ?? null,
            'folder_id' => $folder?->id,
            'client_id' => $client?->id,
            'created_by' => $user->id,
            'recipient_email' => $data['recipientEmail'] ?? null,
            'recipient_name' => $data['recipientName'] ?? null,
            'allowed_extensions' => FileRequests::normalizeExtensions($data['allowedExtensions'] ?? null),
            'max_bytes' => FileRequests::normalizeMaxBytes($data['maxBytes'] ?? null),
            // "One file only" is a limit of one, not a separate concept, the
            // upload page and the server then enforce the same single number.
            'max_files' => $allowMultiple ? (int) ($data['maxFiles'] ?? 20) : 1,
            'allow_multiple' => $allowMultiple,
            'expires_at' => $data['expiresAt'] ?? null,
        ]);

        FileRequests::setPassword($fileRequest, $data['password'] ?? null);
        $fileRequest->save();
        $fileRequest->load(['folder:id,uuid,name', 'client:id,uid,name', 'creator:id,name']);

        $sent = false;
        if (($data['send'] ?? false) && $fileRequest->recipient_email) {
            $sent = $this->email($fileRequest);
        }

        return response()->json([
            'request' => FileRequests::present($fileRequest),
            'emailed' => $sent,
        ], 201);
    }

    public function show(Request $request, string $uuid): JsonResponse
    {
        $fileRequest = $this->findRequest($request, $uuid);

        return response()->json([
            'request' => FileRequests::present($fileRequest),
            'uploads' => $fileRequest->uploads()->orderByDesc('id')->limit(100)->get()
                ->map(fn ($u) => [
                    'id' => $u->id,
                    'name' => $u->name,
                    'size' => (int) $u->size,
                    'from' => $u->uploader_name ?: $u->uploader_email,
                    'at' => LastSeen::short($u->created_at, $this->user($request)),
                    'atIso' => optional($u->created_at)->toIso8601String(),
                ])->values(),
        ]);
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $data = $request->validate([
            'title' => ['sometimes', 'string', 'max:150'],
            'message' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'recipientEmail' => ['sometimes', 'nullable', 'email', 'max:191'],
            'recipientName' => ['sometimes', 'nullable', 'string', 'max:120'],
            'allowedExtensions' => ['sometimes', 'nullable', 'array', 'max:64'],
            'allowedExtensions.*' => ['string', 'max:32'],
            'maxBytes' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'maxFiles' => ['sometimes', 'integer', 'min:1', 'max:'.FileRequests::MAX_FILES_CEILING],
            // '' clears the password; omitting the key leaves it untouched.
            'password' => ['sometimes', 'nullable', 'string', 'max:128'],
            'expiresAt' => ['sometimes', 'nullable', 'date'],
            'closed' => ['sometimes', 'boolean'],
        ]);

        $fileRequest = $this->findRequest($request, $uuid);

        foreach ([
            'title' => 'title',
            'message' => 'message',
            'recipientEmail' => 'recipient_email',
            'recipientName' => 'recipient_name',
            'maxFiles' => 'max_files',
        ] as $input => $column) {
            if (array_key_exists($input, $data)) {
                $fileRequest->{$column} = $data[$input];
            }
        }

        if (array_key_exists('allowedExtensions', $data)) {
            $fileRequest->allowed_extensions = FileRequests::normalizeExtensions($data['allowedExtensions']);
        }

        if (array_key_exists('maxBytes', $data)) {
            $fileRequest->max_bytes = FileRequests::normalizeMaxBytes($data['maxBytes']);
        }

        if (array_key_exists('expiresAt', $data)) {
            $fileRequest->expires_at = $data['expiresAt'];
        }

        if (array_key_exists('password', $data)) {
            FileRequests::setPassword($fileRequest, (string) ($data['password'] ?? ''));
        }

        if (array_key_exists('closed', $data)) {
            $fileRequest->closed_at = $data['closed'] ? now() : null;
        }

        $fileRequest->save();
        $fileRequest->load(['folder:id,uuid,name', 'client:id,uid,name', 'creator:id,name']);

        return response()->json(['request' => FileRequests::present($fileRequest)]);
    }

    /** Revoke the link. The files that already arrived are untouched. */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $fileRequest = $this->findRequest($request, $uuid);
        $fileRequest->revoked_at = now();
        $fileRequest->save();

        return response()->json(['ok' => true]);
    }

    /** Email the link to the recipient recorded on the request. */
    public function send(Request $request, string $uuid): JsonResponse
    {
        $data = $request->validate([
            'email' => ['nullable', 'email', 'max:191'],
            'name' => ['nullable', 'string', 'max:120'],
        ]);

        $fileRequest = $this->findRequest($request, $uuid);

        if (! empty($data['email'])) {
            $fileRequest->recipient_email = $data['email'];
        }
        if (array_key_exists('name', $data) && $data['name'] !== null) {
            $fileRequest->recipient_name = $data['name'];
        }

        abort_unless($fileRequest->recipient_email, 422, 'Add an email address to send this request to.');
        abort_unless($fileRequest->isOpen(), 422, 'This request is closed, reopen it before sending.');

        $fileRequest->save();

        return response()->json(['emailed' => $this->email($fileRequest)]);
    }

    /* ── internals ─────────────────────────────────── */

    private function findRequest(Request $request, string $uuid): FileRequest
    {
        $fileRequest = FileRequest::with(['folder:id,uuid,name', 'client:id,uid,name', 'creator:id,name'])
            ->where('uuid', $uuid)
            ->first();

        abort_unless($fileRequest, 404, 'That request no longer exists.');
        abort_unless(
            FileRequests::canManage($this->user($request), $fileRequest),
            403,
            'Only the person who created this request can change it.'
        );

        return $fileRequest;
    }

    /**
     * The client a request is for.
     *
     * An explicit choice wins; otherwise the destination folder answers it,
     * because a folder inside a client's area already belongs to that client
     * and asking the requester to repeat it is a chance to get it wrong.
     */
    private function resolveClient(?string $uid, $folder): ?Client
    {
        if ($uid) {
            $client = Client::where('uid', $uid)->first();
            abort_unless($client, 404, 'That client no longer exists.');

            return $client;
        }

        if (! $folder) {
            return null;
        }

        $clientId = ClientDocuments::clientIdFor($folder->id);

        return $clientId ? Client::find($clientId) : null;
    }

    /**
     * Send the invitation.
     *
     * Inline, not queued: the queue has swallowed portal mail before, and a
     * request the recipient never receives is worse than a slow response —
     * the account-lifecycle emails take the same view for the same reason.
     */
    private function email(FileRequest $fileRequest): bool
    {
        $details = [];

        if ($fileRequest->expires_at) {
            $details[] = ['Upload by', $fileRequest->expires_at->format('j M Y')];
        }
        if (is_array($fileRequest->allowed_extensions) && $fileRequest->allowed_extensions !== []) {
            $details[] = ['Accepted', FileRequests::describeExtensions($fileRequest->allowed_extensions)];
        }
        if ($fileRequest->password_hash !== null) {
            $details[] = ['Password', 'Required, sent to you separately'];
        }

        $delivery = Deliveries::send(
            Postcards::fileRequest(
                $fileRequest->title,
                $fileRequest->creator?->name ?? Postcards::site(),
                $fileRequest->message,
                FileRequests::url($fileRequest),
                $fileRequest->recipient_name,
                $details,
            ),
            $fileRequest->recipient_email,
            $fileRequest,
            'fileRequest',
            immediate: true,
        );

        return $delivery === null || $delivery->status !== EmailDelivery::STATUS_FAILED;
    }
}
