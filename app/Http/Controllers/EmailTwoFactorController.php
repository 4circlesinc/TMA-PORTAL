<?php

namespace App\Http\Controllers;

use App\Support\EmailLoginCode;
use App\Support\EmailTwoFactor;
use App\Support\LoginChallenge;
use App\Support\LoginSession;
use App\Support\StaySignedIn;
use App\Support\TrustedDevices;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\View\View;
use Laravel\Fortify\Fortify;

class EmailTwoFactorController extends Controller
{
    public function show(Request $request): View|RedirectResponse
    {
        $user = EmailTwoFactor::user($request);

        if (! $user) {
            return redirect()->route('login');
        }

        $reason = (string) $request->session()->get('login.challenge_reason', 'new-device');

        return view('auth.login-code', [
            'maskedEmail' => LoginChallenge::maskEmail($user->email),
            'reason' => $reason === 'new-location' ? 'new-location' : 'new-device',
            'trustDays' => TrustedDevices::days(),
            'canResend' => EmailLoginCode::canResend($user),
            'resendIn' => EmailLoginCode::resendAvailableIn($user),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $user = EmailTwoFactor::user($request);

        if (! $user) {
            return redirect()->route('login');
        }

        $data = $request->validate([
            'code' => ['required', 'string', 'size:6'],
        ]);

        if (! EmailLoginCode::check($user, $request, $data['code'])) {
            return redirect()->route('login-code.show')->withErrors([
                'code' => 'That code is incorrect or has expired.',
            ]);
        }

        return $this->complete($request, $user);
    }

    public function resend(Request $request): RedirectResponse
    {
        $user = EmailTwoFactor::user($request);

        if (! $user) {
            return redirect()->route('login');
        }

        if (! EmailLoginCode::canResend($user)) {
            return redirect()->route('login-code.show')->withErrors([
                'code' => 'Wait a moment before sending another code.',
            ]);
        }

        EmailLoginCode::send($user, $request);

        return redirect()->route('login-code.show')->with('status', 'code-sent');
    }

    /**
     * Switch from the authenticator challenge to an email code.
     */
    public function fromApp(Request $request): RedirectResponse
    {
        $user = EmailTwoFactor::user($request);

        if (! $user) {
            return redirect()->route('login');
        }

        $request->session()->put([
            'login.challenge' => 'email',
            'login.challenge_reason' => LoginChallenge::emailReason($user, $request),
        ]);

        if (EmailLoginCode::canResend($user)) {
            EmailLoginCode::send($user, $request);
        }

        return redirect()->route('login-code.show');
    }

    private function complete(Request $request, $user): RedirectResponse
    {
        $remember = (bool) $request->session()->pull('login.remember');

        Auth::login($user, $remember);
        $request->session()->regenerate();
        $request->session()->forget(['login.id', 'login.challenge', 'login.challenge_reason']);

        LoginSession::stamp($user);

        if ($redirect = StaySignedIn::afterAuthenticated($request)) {
            return $redirect;
        }

        return redirect()->intended(Fortify::redirects('login'));
    }
}
