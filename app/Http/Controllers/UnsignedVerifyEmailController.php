<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\SafeIntended;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Laravel\Fortify\Fortify;

/**
 * Confirm an email from the signed link without requiring an active session.
 *
 * Opening the link on another phone / laptop used to fail because Fortify's
 * verify route demanded auth and matched the signed-in user. The link itself
 * is already signed and bound to the user id + email hash.
 */
class UnsignedVerifyEmailController extends Controller
{
    public function __invoke(Request $request, string $id, string $hash): RedirectResponse
    {
        if (! $request->hasValidSignature()) {
            return redirect()->route('verification.notice')
                ->with('social_error', 'That confirmation link has expired. Request a new one.');
        }

        $user = User::query()->find($id);

        if ($user === null) {
            return redirect()->route('login')
                ->with('social_error', 'That confirmation link is no longer valid.');
        }

        if (! hash_equals(sha1($user->getEmailForVerification()), (string) $hash)) {
            return redirect()->route('login')
                ->with('social_error', 'That confirmation link is no longer valid.');
        }

        if (! $user->hasVerifiedEmail()) {
            $user->markEmailAsVerified();
            event(new Verified($user));
        }

        SafeIntended::scrub();

        $next = Fortify::redirects('email-verification', '/auth/profile-setup');

        // Same browser session as registration: continue onboarding.
        if (Auth::check() && (int) Auth::id() === (int) $user->id) {
            return redirect()->to($next.'?verified=1');
        }

        // Other device / signed out: log them in so setup can continue, or
        // send them to sign-in if the account cannot start a session yet.
        Auth::login($user, false);
        $request->session()->regenerate();

        return redirect()->to($next.'?verified=1');
    }
}
