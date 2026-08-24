<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\AuthEvent;
use App\Models\Client;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\DeviceName;
use App\Support\Invitations\Invitations;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * "Invite to portal" on a client record.
 *
 * This is a shortcut into the same machinery as InvitationController: the
 * client hub already knows the name, email and client record, so the button
 * only has to say which client. Everything else, the token, the email, the
 * delivery record, the audit entry, is the shared invitation flow.
 */
class ClientInviteController extends Controller
{
    /** Create (or chase) the invitation for a client and email it. */
    public function send(Request $request, string $uid): JsonResponse
    {
        Role::authorize($request->user(), 'clients.invite');

        $client = Client::where('uid', $uid)->firstOrFail();

        abort_if($client->user_id !== null, 422, 'This client already has a portal account.');

        $email = Str::lower(trim((string) ($request->input('email') ?: $client->email)));
        abort_if($email === '', 422, 'Add an email to this client before inviting them.');

        $existing = Invitation::query()
            ->where('client_id', $client->id)
            ->whereIn('status', Invitation::LIVE_STATUSES)
            ->whereNull('accepted_at')
            ->whereNull('cancelled_at')
            ->first();

        // A second press of the same button is a reminder, not a fresh ask.
        $reminder = $existing !== null && $existing->send_count > 0;

        [$invitation] = Invitations::issue([
            'type' => $client->company_id ? Invitation::TYPE_COMPANY_MEMBER : Invitation::TYPE_CLIENT,
            'email' => $email,
            'name' => $client->name,
            'client_id' => $client->id,
            'company_id' => $client->company_id,
            'role' => Role::CLIENT,
            'invited_by' => $request->user()->id,
        ]);

        Invitations::send($invitation, $reminder);

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'client.invitation',
            'description' => $request->user()->name.($reminder ? ' resent the invitation to ' : ' invited ').$email
                .($reminder ? '' : ' to the portal'),
            'subject' => $invitation,
            'client' => $client,
            'metadata' => [
                'invitationId' => $invitation->uuid,
                'action' => $reminder ? 'resent' : 'sent',
            ],
        ]);

        $fresh = $invitation->fresh();

        return response()->json([
            'status' => 'ok',
            'reminder' => $reminder,
            'invitation' => Invitations::toRecord($fresh),
        ]);
    }

    /**
     * Everything the Portal access tab shows: whether they can sign in, the
     * invitation if they cannot, and, once they can, their sign-in history
     * and account activity.
     *
     * The two halves are deliberately exclusive. Before an account exists the
     * only useful thing is the invitation; afterwards the invitation is history
     * and what staff want is "when did they last get in".
     */
    public function access(Request $request, string $uid): JsonResponse
    {
        Role::authorize($request->user(), 'clients.view');

        $client = Client::where('uid', $uid)->firstOrFail();
        $account = $client->user;

        $invitation = Invitation::query()
            ->where('client_id', $client->id)
            ->with(['client', 'company', 'inviter'])
            ->latest('id')
            ->first();

        return response()->json([
            'hasAccount' => $account !== null,
            'account' => $account ? [
                'name' => $account->name,
                'email' => $account->email,
                'status' => $account->status,
                'accountType' => $account->account_type,
                'avatar' => $account->photoUrl(),
                'createdAt' => $account->created_at?->toIso8601String(),
                'onboardedAt' => $account->onboarding_completed_at?->toIso8601String(),
                'twoFactor' => $account->hasTwoFactorEnabled(),
            ] : null,
            'invitation' => $invitation ? Invitations::toRecord($invitation) : null,
            'logins' => $account ? $this->loginHistory($account) : [],
            'activity' => $account ? $this->accountActivity($client, $account) : [],
        ]);
    }

    /** Recent sign-ins for a linked account. */
    private function loginHistory(User $account): array
    {
        return AuthEvent::where('user_id', $account->id)
            ->whereIn('event', ['login', 'logout', 'login_failed', 'lockout'])
            ->orderByDesc('created_at')
            ->limit(20)
            ->get()
            ->map(fn (AuthEvent $event) => [
                'event' => $event->event,
                'atIso' => $event->created_at?->toIso8601String(),
                'when' => $event->created_at?->diffForHumans(),
                'ip' => $event->ip,
                'device' => DeviceName::describe((string) $event->user_agent),
            ])->values()->all();
    }

    /** What has happened on this client record and its account. */
    private function accountActivity(Client $client, User $account): array
    {
        return ActivityLog::query()
            ->where(fn ($q) => $q->where('client_id', $client->id)->orWhere('actor_id', $account->id))
            ->orderByDesc('created_at')
            ->limit(20)
            ->get()
            ->map(fn (ActivityLog $log) => [
                'type' => $log->activity_type,
                'description' => $log->description,
                'atIso' => $log->created_at?->toIso8601String(),
                'when' => $log->created_at?->diffForHumans(),
            ])->values()->all();
    }

    /** The live invitation for a client, for the client hub to show its state. */
    public function status(Request $request, string $uid): JsonResponse
    {
        Role::authorize($request->user(), 'clients.view');

        $client = Client::where('uid', $uid)->firstOrFail();

        $invitation = Invitation::query()
            ->where('client_id', $client->id)
            ->with(['client', 'company', 'inviter'])
            ->latest('id')
            ->first();

        return response()->json([
            'hasAccount' => $client->user_id !== null,
            'invitation' => $invitation ? Invitations::toRecord($invitation) : null,
        ]);
    }
}
