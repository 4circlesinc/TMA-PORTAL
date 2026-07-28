<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\ClientInvite;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Mail\Postcards;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\View\View;

/**
 * The client-connect flow: a staff member invites an existing client (who has
 * no login) to create a portal account, and the client accepts through a public
 * link that creates the account and links it to their client record + files.
 */
class ClientInviteController extends Controller
{
    private const STAFF = ['Administrator', 'Employee'];

    private const EXPIRES_DAYS = 14;

    /** Staff: create (or refresh) an invite for a client and email it. */
    public function send(Request $request, string $uid): JsonResponse
    {
        abort_unless(Role::can($request->user(), 'clients.invite'), 403, 'Staff only.');

        $client = Client::where('uid', $uid)->firstOrFail();

        abort_if($client->user_id !== null, 422, 'This client already has a portal account.');
        abort_if(! $client->email, 422, 'Add an email to this client before inviting them.');

        $invite = ClientInvite::firstOrNew([
            'client_id' => $client->id,
            'accepted_at' => null,
        ]);
        // A second send of an existing invite is a reminder, not a first ask.
        $isReminder = $invite->exists;

        $invite->fill([
            'email' => Str::lower($client->email),
            'token' => $invite->token ?: ClientInvite::freshToken(),
            'expires_at' => now()->addDays(self::EXPIRES_DAYS),
            'last_sent_at' => now(),
            'created_by' => $request->user()->id,
        ])->save();

        $postcard = $isReminder
            ? Postcards::clientInviteReminder($client->name, $this->url($invite))
            : Postcards::clientInvite($client->name, $this->url($invite), $request->user()->name);

        Mail::to($invite->email)->queue($postcard);

        return response()->json(['status' => 'ok']);
    }

    /** Public: the create-account page for a pending invite. */
    public function show(string $token): View|RedirectResponse
    {
        $invite = ClientInvite::where('token', $token)->with('client')->first();

        if (! $invite || ! $invite->isPending()) {
            return redirect('/auth/login')->with('notice', 'invite-invalid');
        }

        return view('client-invite', [
            'invite' => $invite,
            'name' => $invite->client?->name,
            'email' => $invite->email,
        ]);
    }

    /** Public: accept the invite — create the account and link the client. */
    public function store(Request $request, string $token): RedirectResponse
    {
        $invite = ClientInvite::where('token', $token)->with('client')->first();

        if (! $invite || ! $invite->isPending() || ! $invite->client) {
            return redirect('/auth/login')->with('notice', 'invite-invalid');
        }

        $data = $request->validate([
            'password' => ['required', 'confirmed', 'min:8'],
        ]);

        // A client may not already have an account, and the email must be free.
        if ($invite->client->user_id || User::where('email', $invite->email)->exists()) {
            return redirect('/auth/login')->with('notice', 'invite-invalid');
        }

        $name = $invite->client->name ?: $invite->email;
        $parts = preg_split('/\s+/', trim($name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $first = array_shift($parts) ?: $name;
        $last = count($parts) ? array_pop($parts) : null;

        $user = new User([
            'name' => $name,
            'first_name' => $first,
            'middle_name' => count($parts) ? implode(' ', $parts) : null,
            'last_name' => $last,
            'email' => $invite->email,
            'password' => $data['password'],
        ]);
        $user->forceFill([
            'email_verified_at' => now(),
            'status' => 'approved',
            'account_type' => 'Client',
            'approved_at' => now(),
        ])->save();

        $invite->client->forceFill(['user_id' => $user->id])->save();
        $invite->forceFill(['accepted_at' => now()])->save();

        Auth::login($user);
        $request->session()->regenerate();

        return redirect('/');
    }

    private function url(ClientInvite $invite): string
    {
        return url('/client-invite/'.$invite->token);
    }
}
