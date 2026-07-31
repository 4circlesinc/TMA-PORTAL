<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\Invitation;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Invitations\Invitations;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * "Invite to portal" on a client record.
 *
 * This is a shortcut into the same machinery as InvitationController: the
 * client hub already knows the name, email and client record, so the button
 * only has to say which client. Everything else — the token, the email, the
 * delivery record, the audit entry — is the shared invitation flow.
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
