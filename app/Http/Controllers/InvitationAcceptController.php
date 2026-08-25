<?php

namespace App\Http\Controllers;

use App\Models\Invitation;
use App\Support\Clients\ClientHubSettings;
use App\Support\Invitations\Invitations;
use App\Support\Mail\Postcards;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\View\View;

/**
 * The public end of an invitation: the screen the emailed link opens.
 *
 * No login is required to reach it, that is the whole point, so the token is
 * the only credential, and every action re-reads it and re-checks that the
 * invitation is still live. The previous version of this flow redirected every
 * failure to /auth/login with a session key nothing read, which is why an
 * expired or already-used link looked like a broken portal. Each outcome now
 * has its own state on the page.
 */
class InvitationAcceptController extends Controller
{
    /** The invitation screen, in whatever state the invitation is in. */
    public function show(Request $request, string $token): View
    {
        $invitation = Invitation::findByToken($token);

        if (! $invitation) {
            return $this->screen(null, $token, 'invalid');
        }

        $invitation->syncExpiry();

        if ($reason = $invitation->blockedReason()) {
            return $this->screen($invitation, $token, $reason);
        }

        // First time the link is opened, worth knowing when chasing a client
        // who says they never received it.
        if ($invitation->opened_at === null) {
            $invitation->forceFill([
                'opened_at' => now(),
                'status' => Invitation::STATUS_OPENED,
            ])->save();
        }

        $existing = $invitation->existingUser();
        $current = $request->user();

        if ($existing === null) {
            return $this->screen($invitation, $token, $this->mayRegister($invitation) ? 'register' : 'registration-closed');
        }

        // The address already has a login, so nothing new may be created.
        if ($current === null) {
            return $this->screen($invitation, $token, 'signin');
        }

        if ($current->id !== $existing->id) {
            return $this->screen($invitation, $token, 'wrong-account');
        }

        return $this->screen($invitation, $token, 'accept');
    }

    /** Create a brand-new account from the invitation. */
    public function register(Request $request, string $token): RedirectResponse
    {
        $invitation = Invitation::findByToken($token);

        if (! $invitation || ! $invitation->isAcceptable()) {
            return redirect('/invite/'.$token);
        }

        // An account created between the page loading and this submit must not
        // be duplicated, send them down the sign-in path instead.
        if ($invitation->existingUser() !== null) {
            return redirect('/invite/'.$token);
        }

        // Self-registration can be switched off between the page rendering and
        // this submit, and the form is a plain POST anyone can replay. Checked
        // again here, because the screen state is not the gate.
        if (! $this->mayRegister($invitation)) {
            return redirect('/invite/'.$token);
        }

        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:100'],
            'middle_name' => ['nullable', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
            'password' => ['required', 'confirmed', 'min:8'],
            'terms' => ['accepted'],
        ], [
            'terms.accepted' => 'Please accept the Terms and Privacy Policy to continue.',
        ]);

        $user = Invitations::acceptAsNewUser($invitation, $data['password'], [
            'first_name' => $data['first_name'],
            'middle_name' => $data['middle_name'] ?? null,
            'last_name' => $data['last_name'],
        ]);

        Auth::login($user);
        $request->session()->regenerate();

        // Profile setup and onboarding are enforced by middleware from here.
        return redirect('/');
    }

    /** Accept onto the account that is already signed in. */
    public function accept(Request $request, string $token): RedirectResponse
    {
        $invitation = Invitation::findByToken($token);
        $user = $request->user();

        if (! $invitation || ! $user || ! $invitation->isAcceptable()) {
            return redirect('/invite/'.$token);
        }

        // Only the invited address may accept onto an existing account.
        if (strcasecmp($user->email, $invitation->email) !== 0) {
            return redirect('/invite/'.$token);
        }

        Invitations::acceptAs($invitation, $user);

        return redirect('/');
    }

    /** Turn the invitation down. */
    public function decline(Request $request, string $token): View
    {
        $invitation = Invitation::findByToken($token);

        if ($invitation && $invitation->isAcceptable()) {
            Invitations::cancel($invitation, $request->user());
        }

        return $this->screen($invitation, $token, 'declined');
    }

    /**
     * Park the invitation and send the visitor to sign in. The intended URL
     * brings them back here afterwards, so accepting is one click once they are
     * in, without it they land on the dashboard and the invitation is lost.
     */
    public function signin(Request $request, string $token): RedirectResponse
    {
        $request->session()->put('url.intended', url('/invite/'.$token));

        return redirect()->route('login');
    }

    /**
     * May this invitation mint a brand-new account?
     *
     * Only the client-facing invitations are the client hub's to govern. A
     * staff invitation still creates its account whatever the hub says —
     * turning that off would leave an administrator unable to onboard anyone.
     */
    private function mayRegister(Invitation $invitation): bool
    {
        $clientFacing = in_array(
            $invitation->type,
            [Invitation::TYPE_CLIENT, Invitation::TYPE_COMPANY_MEMBER],
            true,
        );

        return ! $clientFacing || ClientHubSettings::allowsSelfRegistration();
    }

    private function screen(?Invitation $invitation, string $token, string $state): View
    {
        return view('invite', [
            'invitation' => $invitation,
            'token' => $token,
            'state' => $state,
            'name' => $invitation?->name ?: $invitation?->client?->name,
            'nameParts' => Invitations::splitName($invitation?->name ?: $invitation?->client?->name),
            'email' => $invitation?->email,
            'inviter' => $invitation?->inviter?->name,
            'organisation' => Postcards::site(),
            'lead' => $invitation
                ? Invitations::screenLead($invitation, $invitation->inviter?->name, Postcards::site())
                : null,
            'expiresAt' => $invitation?->expires_at,
        ]);
    }
}
