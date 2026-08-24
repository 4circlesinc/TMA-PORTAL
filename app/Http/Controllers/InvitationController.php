<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\Company;
use App\Models\Invitation;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Invitations\Invitations;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * The staff side of invitations: send one, chase it, withdraw it, and see what
 * happened to the email.
 *
 * Who may do what follows the existing capability matrix, inviting a client is
 * `clients.invite` (employees have it), inviting staff is `users.manage`
 * (administrators only), so this adds no new access model of its own.
 */
class InvitationController extends Controller
{
    /** The invitation management list. */
    public function index(Request $request): JsonResponse
    {
        Role::authorize($request->user(), 'clients.invite');

        $query = Invitation::query()->with(['client', 'company', 'inviter'])->latest('id');

        if ($status = $request->query('status')) {
            if ($status === 'live') {
                $query->whereIn('status', Invitation::LIVE_STATUSES);
            } else {
                $query->where('status', $status);
            }
        }

        if ($type = $request->query('type')) {
            $query->where('type', $type);
        }

        if ($search = trim((string) $request->query('q', ''))) {
            $query->where(function ($q) use ($search) {
                $q->where('email', 'like', '%'.$search.'%')
                    ->orWhere('name', 'like', '%'.$search.'%');
            });
        }

        $invitations = $query->limit(200)->get();

        return response()->json([
            'invitations' => $invitations->map(fn (Invitation $i) => Invitations::toRecord($i))->values(),
            'counts' => $this->counts(),
        ]);
    }

    /** Everything the management screen needs for its filter chips. */
    private function counts(): array
    {
        $rows = Invitation::query()
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status');

        return [
            'pending' => (int) ($rows['pending'] ?? 0) + (int) ($rows['sent'] ?? 0)
                + (int) ($rows['delivered'] ?? 0) + (int) ($rows['opened'] ?? 0),
            'accepted' => (int) ($rows['accepted'] ?? 0),
            'expired' => (int) ($rows['expired'] ?? 0),
            'failed' => (int) ($rows['failed'] ?? 0),
            'cancelled' => (int) ($rows['cancelled'] ?? 0),
        ];
    }

    /** Send a new invitation. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(Invitation::TYPES)],
            'email' => ['required', 'email', 'max:255'],
            'name' => ['nullable', 'string', 'max:255'],
            'clientUid' => ['nullable', 'string', 'max:96'],
            'companyUid' => ['nullable', 'string', 'max:96'],
            'role' => ['nullable', Rule::in(Role::ASSIGNABLE)],
            'jobTitle' => ['nullable', 'string', 'max:120'],
            'department' => ['nullable', 'string', 'max:120'],
            'companyRole' => ['nullable', 'string', 'max:64'],
        ]);

        $type = $data['type'];

        // Inviting somebody as staff hands out internal access, so it is held to
        // the same bar as creating a staff account outright.
        Role::authorize($request->user(), $type === Invitation::TYPE_STAFF ? 'users.manage' : 'clients.invite');

        $client = ! empty($data['clientUid'])
            ? Client::where('uid', $data['clientUid'])->firstOrFail()
            : null;
        $company = ! empty($data['companyUid'])
            ? Company::where('uid', $data['companyUid'])->firstOrFail()
            : null;

        if ($type === Invitation::TYPE_CLIENT || $type === Invitation::TYPE_COMPANY_MEMBER) {
            abort_unless($client, 422, 'Choose the client record this invitation is for.');
            abort_if($client->user_id !== null, 422, 'This client already has a portal account.');
        }

        $email = Str::lower(trim($data['email']));

        // A pre-existing account is fine, they accept by signing in, but a
        // second live invitation for the same person is not.
        $duplicate = Invitation::query()
            ->where('email', $email)
            ->whereIn('status', Invitation::LIVE_STATUSES)
            ->whereNull('accepted_at')
            ->whereNull('cancelled_at')
            ->where(function ($q) use ($client, $company) {
                $q->where('client_id', $client?->id)->where('company_id', $company?->id);
            })
            ->exists();

        abort_if($duplicate, 422, 'There is already a pending invitation for this address. Resend or cancel it instead.');

        // Staff invites default to the reviewing side. Employee is parked
        // and would only send the new person to the role-pending screen.
        $role = $data['role'] ?? ($type === Invitation::TYPE_STAFF ? Role::REVIEWING_OFFICER : Role::CLIENT);

        // Only an administrator may hand out administrator access.
        if ($role === Role::ADMINISTRATOR) {
            Role::authorizeAdmin($request->user());
        }

        [$invitation] = Invitations::issue([
            'type' => $type,
            'email' => $email,
            'name' => $data['name'] ?? $client?->name,
            'client_id' => $client?->id,
            'company_id' => $company?->id ?? $client?->company_id,
            'role' => $role,
            'access' => array_filter([
                'jobTitle' => $data['jobTitle'] ?? null,
                'department' => $data['department'] ?? null,
                'companyRole' => $data['companyRole'] ?? null,
            ]),
            'invited_by' => $request->user()->id,
        ]);

        Invitations::send($invitation);

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'client.invitation',
            'description' => $request->user()->name.' invited '.$email.' to '.Invitations::targetLabel($invitation),
            'subject' => $invitation,
            'client' => $client,
            'metadata' => ['invitationId' => $invitation->uuid, 'invitationType' => $type, 'action' => 'sent'],
        ]);

        return response()->json(['invitation' => Invitations::toRecord($invitation->fresh())]);
    }

    /** Send the invitation again. The previous link stops working. */
    public function resend(Request $request, string $uuid): JsonResponse
    {
        $invitation = $this->findFor($request, $uuid);

        abort_if(
            $invitation->accepted_at !== null,
            422,
            'This invitation has already been accepted.',
        );

        // Chasing a withdrawn or lapsed invitation revives it rather than
        // forcing staff to retype the whole thing.
        if ($invitation->cancelled_at !== null || $invitation->isExpired()) {
            $invitation->forceFill([
                'status' => Invitation::STATUS_PENDING,
                'cancelled_at' => null,
                'cancelled_by' => null,
                'expires_at' => now()->addDays(Invitations::EXPIRY_DAYS),
            ])->save();
        }

        $reminder = $invitation->send_count > 0;
        Invitations::send($invitation);

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'client.invitation',
            'description' => $request->user()->name.' resent the invitation to '.$invitation->email,
            'subject' => $invitation,
            'client' => $invitation->client,
            'metadata' => ['invitationId' => $invitation->uuid, 'action' => 'resent', 'reminder' => $reminder],
        ]);

        return response()->json(['invitation' => Invitations::toRecord($invitation->fresh())]);
    }

    /**
     * A fresh link for this invitation, for staff to pass on by hand.
     *
     * This mints a new token, the old link stops working, because the stored
     * digest cannot be turned back into the original. Handing out a link is
     * handing out the credential, so it is logged like a send.
     */
    public function link(Request $request, string $uuid): JsonResponse
    {
        $invitation = $this->findFor($request, $uuid);

        abort_unless($invitation->isAcceptable(), 422, 'This invitation is no longer valid.');

        $token = $invitation->issueToken();
        $invitation->save();

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'client.invitation',
            'description' => $request->user()->name.' copied the invitation link for '.$invitation->email,
            'subject' => $invitation,
            'client' => $invitation->client,
            // The token itself is deliberately absent. ActivityLogger redacts
            // it anyway, but it should never get as far as the logger.
            'metadata' => ['invitationId' => $invitation->uuid, 'action' => 'link_copied'],
        ]);

        return response()->json(['url' => $invitation->acceptUrl($token)]);
    }

    /** Withdraw an invitation. */
    public function cancel(Request $request, string $uuid): JsonResponse
    {
        $invitation = $this->findFor($request, $uuid);

        abort_if($invitation->accepted_at !== null, 422, 'This invitation has already been accepted.');

        Invitations::cancel($invitation, $request->user());

        return response()->json(['invitation' => Invitations::toRecord($invitation->fresh())]);
    }

    /** Correct a wrong address and send it again. */
    public function updateRecipient(Request $request, string $uuid): JsonResponse
    {
        $invitation = $this->findFor($request, $uuid);

        abort_if($invitation->accepted_at !== null, 422, 'This invitation has already been accepted.');

        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'name' => ['nullable', 'string', 'max:255'],
        ]);

        $old = $invitation->email;

        $invitation->forceFill([
            'email' => Str::lower(trim($data['email'])),
            'name' => $data['name'] ?? $invitation->name,
            'status' => Invitation::STATUS_PENDING,
            'cancelled_at' => null,
            'cancelled_by' => null,
            'expires_at' => now()->addDays(Invitations::EXPIRY_DAYS),
            'last_error' => null,
        ])->save();

        Invitations::send($invitation);

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'client.invitation',
            'description' => $request->user()->name.' changed the invitation recipient to '.$invitation->email,
            'subject' => $invitation,
            'client' => $invitation->client,
            'old' => ['email' => $old],
            'new' => ['email' => $invitation->email],
            'metadata' => ['invitationId' => $invitation->uuid, 'action' => 'recipient_changed'],
        ]);

        return response()->json(['invitation' => Invitations::toRecord($invitation->fresh())]);
    }

    /** Full detail for one invitation, including its delivery history. */
    public function show(Request $request, string $uuid): JsonResponse
    {
        $invitation = $this->findFor($request, $uuid);

        return response()->json([
            'invitation' => Invitations::toRecord($invitation),
            'deliveries' => $invitation->deliveries()->limit(20)->get()
                ->map(fn ($d) => $d->toRecord())->values(),
            'existingAccount' => $invitation->existingUser() !== null,
        ]);
    }

    /** Remove a dead invitation record. Live ones must be cancelled first. */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        Role::authorize($request->user(), 'users.manage');

        $invitation = Invitation::where('uuid', $uuid)->firstOrFail();
        $invitation->syncExpiry();

        abort_if(
            $invitation->isAcceptable(),
            422,
            'Cancel this invitation before deleting it.',
        );

        $email = $invitation->email;
        $invitation->delete();

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'client.invitation',
            'description' => $request->user()->name.' deleted the invitation record for '.$email,
            'metadata' => ['action' => 'deleted'],
        ]);

        return response()->json(['status' => 'ok']);
    }

    /** Load an invitation the caller is allowed to act on. */
    private function findFor(Request $request, string $uuid): Invitation
    {
        $invitation = Invitation::where('uuid', $uuid)->with(['client', 'company', 'inviter'])->firstOrFail();

        Role::authorize(
            $request->user(),
            $invitation->type === Invitation::TYPE_STAFF ? 'users.manage' : 'clients.invite',
        );

        return $invitation->syncExpiry();
    }
}
