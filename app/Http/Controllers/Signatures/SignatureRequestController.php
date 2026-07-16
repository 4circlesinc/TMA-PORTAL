<?php

namespace App\Http\Controllers\Signatures;

use App\Http\Controllers\Controller;
use App\Mail\SignatureReminder;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Files\FileAccess;
use App\Support\Signatures\Activity;
use App\Support\Signatures\Presenter;
use App\Support\Signatures\Sender;
use App\Support\Signatures\SendValidationException;
use App\Support\Signatures\Signable;
use App\Support\Signatures\SigningFlow;
use App\Support\Signatures\SigningToken;
use App\Support\Signatures\Status;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * Signature requests, addressed by public uuid.
 *
 * Every action re-derives what the caller may do from the record itself - the
 * client's hidden buttons are never trusted, and a status that forbids an
 * action here forbids it regardless of what the UI offered.
 */
class SignatureRequestController extends Controller
{
    /** The list page: search, status filter, and the admin-wide toggle. */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:191'],
            'status' => ['nullable', 'string', 'in:all,'.implode(',', Status::ALL)],
            'scope' => ['nullable', 'in:mine,all'],
            'perPage' => ['nullable', 'integer', 'min:1', 'max:200'],
        ]);

        $user = $request->user();
        $wantsAll = ($data['scope'] ?? 'mine') === 'all';
        // "Admin View" is a request to see other people's work; only an actual
        // administrator gets it, whatever the checkbox says.
        $adminScope = $wantsAll && FileAccess::isAdmin($user);

        $query = SignatureRequest::query()
            ->with(['recipients', 'file', 'signedFile', 'folder', 'creator'])
            ->when(! $adminScope, fn ($q) => $q->where('created_by', $user->id))
            ->when(
                ($data['status'] ?? 'all') !== 'all',
                fn ($q) => $q->where('status', $data['status']),
            )
            ->when($data['search'] ?? null, function ($q, $search) {
                // LOWER(..) LIKE rather than ILIKE: production is Postgres but
                // the test suite runs SQLite, which has no ILIKE.
                $like = '%'.mb_strtolower($search).'%';
                $q->where(function ($inner) use ($like) {
                    $inner->whereRaw('LOWER(title) LIKE ?', [$like])
                        ->orWhereHas('recipients', fn ($r) => $r
                            ->whereRaw('LOWER(name) LIKE ?', [$like])
                            ->orWhereRaw('LOWER(email) LIKE ?', [$like]));
                });
            })
            ->latest('created_at');

        $requests = $query->limit($data['perPage'] ?? 100)->get();
        $presenter = new Presenter($user);

        return response()->json([
            'requests' => $presenter->collection($requests->all()),
            'canAdminView' => FileAccess::isAdmin($user),
        ]);
    }

    /**
     * Library files this user may send for signature. Phase 2 replaces this
     * with the full File Library picker; the filter rules stay the same.
     */
    public function documents(Request $request): JsonResponse
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:191'],
        ]);

        $user = $request->user();

        $files = FileItem::query()
            ->with('folder')
            ->whereIn('extension', Signable::extensions())
            ->when(! FileAccess::isAdmin($user), fn ($q) => $q->where('owner_id', $user->id))
            ->when($data['search'] ?? null, function ($q, $search) {
                $q->whereRaw('LOWER(name) LIKE ?', ['%'.mb_strtolower($search).'%']);
            })
            ->latest('created_at')
            ->limit(100)
            ->get();

        return response()->json([
            'files' => $files->map(fn (FileItem $f) => [
                'id' => $f->uuid,
                'name' => $f->name,
                'extension' => $f->extension,
                'folder' => $f->folder?->name,
            ])->all(),
            'accepts' => Signable::extensions(),
        ]);
    }

    /**
     * People already in the portal, for picking a recipient instead of typing
     * their details.
     *
     * Only approved accounts: an unapproved or pending user isn't someone you
     * should be sending contracts to yet. Returns name/email/type only — never
     * phone, notes, or anything else on the profile, because this is reachable
     * by any signed-in user rather than just administrators.
     */
    public function people(Request $request): JsonResponse
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:191'],
        ]);

        $user = $request->user();

        $people = User::query()
            ->where('status', 'approved')
            ->whereNotNull('email')
            ->when($data['search'] ?? null, function ($q, $search) {
                $like = '%'.mb_strtolower($search).'%';
                $q->where(fn ($w) => $w
                    ->whereRaw('LOWER(name) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(email) LIKE ?', [$like]));
            })
            ->orderBy('name')
            ->limit(50)
            ->get();

        return response()->json([
            // No id: a recipient is stored as a name and an email, not as a
            // link to a user, so there's nothing to key on and no reason to
            // hand out internal ids.
            'people' => $people->map(fn (User $p) => [
                'name' => $p->name,
                'email' => $p->email,
                'accountType' => $p->account_type,
                'avatar' => $p->avatar_url,
                'initials' => Presenter::initials($p->name ?: $p->email),
                'isYou' => $p->id === $user->id,
            ])->all(),
        ]);
    }

    /** One request, with its recipients and full audit trail. */
    public function show(Request $request, string $uuid): JsonResponse
    {
        $signatureRequest = $this->findOwned($request, $uuid);

        return response()->json([
            'request' => (new Presenter($request->user()))->request($signatureRequest, true),
        ]);
    }

    /** Start a draft from a library file. Nothing is sent until Phase 4. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'fileId' => ['required', 'string'],
            'title' => ['nullable', 'string', 'max:191'],
            'subject' => ['nullable', 'string', 'max:191'],
            'message' => ['nullable', 'string', 'max:5000'],
        ]);

        $user = $request->user();
        $file = FileItem::query()->where('uuid', $data['fileId'])->first();
        abort_unless($file, 404, 'That file no longer exists.');

        // Selecting a file you can't even open must not leak its name.
        FileAccess::authorize($user, 'view', $file);
        abort_unless(Signable::isSignable($file), 422, Signable::rejectionReason($file));

        $signatureRequest = SignatureRequest::create([
            'uuid' => (string) Str::uuid(),
            'file_id' => $file->id,
            'folder_id' => $file->folder_id,
            'created_by' => $user->id,
            'title' => ($data['title'] ?? null) ?: $file->name,
            'subject' => $data['subject'] ?? null,
            'message' => $data['message'] ?? null,
            'status' => Status::DRAFT,
        ]);

        Activity::log($signatureRequest, Activity::CREATED, $user->id, [
            'file' => $file->name,
        ]);

        $signatureRequest->load(['recipients', 'file', 'signedFile', 'folder', 'creator']);

        return response()->json([
            'request' => (new Presenter($user))->request($signatureRequest),
        ], 201);
    }

    /** Rename a draft, adjust its subject/message, or set its recipients. */
    public function update(Request $request, string $uuid): JsonResponse
    {
        $data = $request->validate([
            'title' => ['sometimes', 'string', 'max:191'],
            'subject' => ['sometimes', 'nullable', 'string', 'max:191'],
            'message' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'folderId' => ['sometimes', 'nullable', 'string'],
            'recipients' => ['sometimes', 'array', 'max:25'],
            'recipients.*.name' => ['required', 'string', 'max:191'],
            'recipients.*.email' => ['required', 'email:filter', 'max:191'],
            'recipients.*.role' => ['nullable', 'in:signer,approver,cc'],
            'recipients.*.order' => ['nullable', 'integer', 'min:1', 'max:25'],
        ]);

        $signatureRequest = $this->findOwned($request, $uuid);
        abort_unless(
            $signatureRequest->status === Status::DRAFT,
            422,
            'Only a draft can be edited.',
        );

        $signatureRequest->fill(array_intersect_key(
            $data,
            array_flip(['title', 'subject', 'message']),
        ));

        // The signed copy's destination. Checked for write access now rather
        // than at completion time, when the recipient is long gone.
        if (array_key_exists('folderId', $data)) {
            $folder = null;
            if ($data['folderId']) {
                $folder = Folder::query()->where('uuid', $data['folderId'])->first();
                abort_unless($folder, 404, 'That folder no longer exists.');
                FileAccess::authorize($request->user(), 'upload', $folder);
            }
            $signatureRequest->folder_id = $folder?->id;
        }

        $signatureRequest->save();

        if (array_key_exists('recipients', $data)) {
            $this->syncRecipients($signatureRequest, $data['recipients']);
        }

        $signatureRequest->load(['recipients', 'file', 'signedFile', 'folder', 'creator']);

        return response()->json([
            'request' => (new Presenter($request->user()))->request($signatureRequest),
        ]);
    }

    /**
     * Set a draft's recipient list, matching existing rows on email.
     *
     * Deleting and recreating the list would be simpler but destructive:
     * `signature_fields.signature_recipient_id` cascades on delete, so a
     * wholesale replace would silently discard every field already placed for
     * a recipient just because their name was edited. Matching on email keeps
     * each row's id and uuid stable, which is what placed fields point at.
     */
    private function syncRecipients(SignatureRequest $signatureRequest, array $recipients): void
    {
        $wanted = [];
        foreach ($recipients as $recipient) {
            // One person can't hold two slots in the same request - it would
            // make the signing order and per-recipient tokens ambiguous.
            $email = mb_strtolower(trim($recipient['email']));
            abort_if(
                isset($wanted[$email]),
                422,
                'Each recipient needs a different email address.',
            );
            $wanted[$email] = $recipient;
        }

        $existing = $signatureRequest->recipients()->get()->keyBy(
            fn ($r) => mb_strtolower($r->email)
        );

        // Drop only the people actually removed; their fields go with them.
        $signatureRequest->recipients()
            ->whereNotIn('email', array_keys($wanted))
            ->delete();

        $index = 0;
        foreach ($wanted as $email => $recipient) {
            $index++;
            $attributes = [
                'name' => trim($recipient['name']),
                'role' => $recipient['role'] ?? 'signer',
                'signing_order' => $recipient['order'] ?? $index,
            ];

            if ($row = $existing->get($email)) {
                $row->fill($attributes)->save();

                continue;
            }

            $signatureRequest->recipients()->create($attributes + [
                'uuid' => (string) Str::uuid(),
                'email' => $email,
                'status' => 'pending',
            ]);
        }
    }

    /** Delete a draft. Anything already sent is cancelled, never erased. */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $signatureRequest = $this->findOwned($request, $uuid);

        abort_unless(
            Status::isDeletable($signatureRequest->status),
            422,
            'Only a draft can be deleted. Cancel this request instead.',
        );

        $signatureRequest->delete();

        return response()->json(['deleted' => true]);
    }

    /** Send a draft out for signature. */
    public function send(Request $request, string $uuid): JsonResponse
    {
        $data = $request->validate([
            'expiresInDays' => ['nullable', 'integer', 'min:1', 'max:365'],
        ]);

        $signatureRequest = $this->findOwned($request, $uuid);

        try {
            Sender::send($signatureRequest, $request->user()->id, $data['expiresInDays'] ?? null);
        } catch (SendValidationException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $signatureRequest->refresh()->load(['recipients', 'file', 'signedFile', 'folder', 'creator']);

        return response()->json([
            'request' => (new Presenter($request->user()))->request($signatureRequest),
        ]);
    }

    /** Nudge whoever the request is currently waiting on. */
    public function remind(Request $request, string $uuid): JsonResponse
    {
        $signatureRequest = $this->findOwned($request, $uuid);

        abort_unless(
            $signatureRequest->isPending(),
            422,
            'Only a request that is still out for signature can be reminded.',
        );

        // Reminding people who can't act yet would just confuse them.
        $group = SigningFlow::currentGroup($signatureRequest);
        abort_unless($group, 422, 'There is nobody waiting to sign.');

        $sent = 0;
        foreach ($group as $recipient) {
            $raw = SigningToken::reveal($recipient);
            if (! $raw) {
                continue;
            }
            Mail::to($recipient->email)->send(
                new SignatureReminder($signatureRequest, $recipient, SigningToken::url($raw))
            );
            $recipient->forceFill(['reminded_at' => now()])->save();
            $sent++;
        }

        abort_unless($sent > 0, 422, 'Those signing links have expired. Send the request again.');

        Activity::log($signatureRequest, Activity::REMINDED, $request->user()->id, ['recipients' => $sent]);

        return response()->json(['reminded' => $sent]);
    }

    /**
     * The signing links for a request, for "copy link".
     *
     * Recoverable because the token is encrypted at rest rather than only
     * hashed - see SigningToken. Owner-only, and never included in the list or
     * show payloads, so a link can't leak through a casual read of the API.
     */
    public function links(Request $request, string $uuid): JsonResponse
    {
        $signatureRequest = $this->findOwned($request, $uuid);

        $links = [];
        foreach ($signatureRequest->recipients()->get() as $recipient) {
            $raw = SigningToken::reveal($recipient);
            $links[] = [
                'recipient' => $recipient->uuid,
                'name' => $recipient->name,
                'email' => $recipient->email,
                'status' => $recipient->status,
                'canSign' => SigningFlow::isTurn($recipient),
                'url' => $raw ? SigningToken::url($raw) : null,
            ];
        }

        return response()->json(['links' => $links]);
    }

    /** Call back an in-flight request; its signing links stop working. */
    public function cancel(Request $request, string $uuid): JsonResponse
    {
        $data = $request->validate([
            'reason' => ['nullable', 'string', 'max:191'],
        ]);

        $signatureRequest = $this->findOwned($request, $uuid);

        abort_unless(
            Status::isCancellable($signatureRequest->status),
            422,
            'Only a request that is still out for signature can be cancelled.',
        );

        $signatureRequest->forceFill([
            'status' => Status::CANCELLED,
            'cancelled_at' => now(),
        ])->save();

        // Recipients hold bearer links; expiring the tokens is what actually
        // revokes access. Status alone would leave the links live.
        $signatureRequest->recipients()->update([
            'token_hash' => null,
            'token_expires_at' => now(),
        ]);

        Activity::log($signatureRequest, Activity::CANCELLED, $request->user()->id, array_filter([
            'reason' => $data['reason'] ?? null,
        ]));

        $signatureRequest->load(['recipients', 'file', 'signedFile', 'folder', 'creator']);

        return response()->json([
            'request' => (new Presenter($request->user()))->request($signatureRequest),
        ]);
    }

    /**
     * Find a request the caller may act on. Administrators may act on any;
     * everyone else only on their own.
     */
    private function findOwned(Request $request, string $uuid): SignatureRequest
    {
        $signatureRequest = SignatureRequest::query()->where('uuid', $uuid)->first();
        abort_unless($signatureRequest, 404, 'That signature request no longer exists.');

        $user = $request->user();
        abort_unless(
            $signatureRequest->created_by === $user->id || FileAccess::isAdmin($user),
            403,
            'You do not have access to this signature request.',
        );

        return $signatureRequest;
    }
}
