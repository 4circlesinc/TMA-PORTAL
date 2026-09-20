<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\AuthenticatorApp;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;
use Laravel\Fortify\Actions\ConfirmTwoFactorAuthentication;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use Laravel\Fortify\Actions\GenerateNewRecoveryCodes;

/**
 * The screen an account lands on once an authenticator is required of them and
 * they do not have one yet (section 16).
 *
 * Account settings was the wrong place to send them. It renders the whole
 * portal shell — sidebar, search, notifications — so the account looks usable
 * while every call behind it 403s, and the person is left reading a toast to
 * work out why the page is broken. This is a full-page stop with one thing on
 * it, built from the same panels as the onboarding step so it is a screen they
 * have seen before rather than a new one.
 *
 * It deliberately sits OUTSIDE the portal's 'mfa.enforced' group: it is the
 * screen that group redirects to, and gating it on itself would loop.
 */
class RequiredAuthenticatorController extends Controller
{
    public function show(Request $request): View|RedirectResponse
    {
        $user = $request->user();

        // Nothing to do here: either it is on, or nobody is asking for it.
        // Landing on this URL by hand should not trap anyone.
        if (! $this->applies($user)) {
            return redirect('/');
        }

        // Fortify's enable/confirm actions want a recent password confirmation.
        // The person has just signed in and cannot reach anything else, so a
        // second password prompt here only blocks the one action we want.
        $request->session()->put('auth.password_confirmed_at', time());

        return view('auth.required-authenticator', array_merge([
            'user' => $user,
            'authApps' => [
                AuthenticatorApp::meta('microsoft'),
                AuthenticatorApp::meta('google'),
            ],
        ], $this->panelData($request, $user)));
    }

    public function store(Request $request): RedirectResponse
    {
        $user = $request->user();

        if (! $this->applies($user)) {
            return redirect('/');
        }

        $data = $request->validate([
            'app' => ['required', Rule::in(AuthenticatorApp::KEYS)],
            'code' => ['required', 'string', 'size:6'],
        ]);

        $request->session()->put('auth.password_confirmed_at', time());

        $user->forceFill(['two_factor_app' => $data['app']])->save();

        if (! $user->two_factor_secret) {
            app(EnableTwoFactorAuthentication::class)($user);
            $user->refresh();
        }

        // A wrong code throws, which would bounce the person back to the app
        // picker and lose the secret they have already scanned. Keep them on
        // the confirm panel with the error instead.
        try {
            app(ConfirmTwoFactorAuthentication::class)($user, $data['code']);
        } catch (ValidationException $e) {
            throw ValidationException::withMessages([
                'code' => $e->validator->errors()->first() ?: 'That code is not right. Try the current one.',
            ])->redirectTo(route('required-authenticator.show', [
                'panel' => 'confirm',
                'app' => $data['app'],
            ]));
        }

        if ($user->two_factor_recovery_codes === null) {
            app(GenerateNewRecoveryCodes::class)($user);
        }

        ActivityLogger::log([
            'actor' => $user,
            'type' => 'security.two_factor_enabled',
            'module' => 'security',
            'description' => $user->name.' set up an authenticator app',
            'subject' => $user,
        ]);

        return redirect('/')->with('status', 'two-factor-enabled');
    }

    /**
     * Whether this screen has anything to say to this account: something
     * requires an authenticator of them, and they have not confirmed one.
     */
    private function applies(?User $user): bool
    {
        return $user
            && $user->two_factor_confirmed_at === null
            && $user->mustUseAuthenticator();
    }

    /**
     * Which of the three panels to draw, and the QR for the two that need it.
     *
     * @return array<string, mixed>
     */
    private function panelData(Request $request, User $user): array
    {
        $panel = $request->query('panel', 'app');
        if (! in_array($panel, ['app', 'scan', 'confirm'], true)) {
            $panel = 'app';
        }

        $chosenApp = $request->query('app', 'microsoft');
        if (! in_array($chosenApp, AuthenticatorApp::KEYS, true)) {
            $chosenApp = 'microsoft';
        }

        $qrSvg = null;
        $secretKey = null;

        if (in_array($panel, ['scan', 'confirm'], true)) {
            if (! $user->two_factor_secret) {
                app(EnableTwoFactorAuthentication::class)($user);
                $user->refresh();
            }
            $qrSvg = $user->twoFactorQrCodeSvg();
            $secretKey = decrypt($user->two_factor_secret);
        }

        return [
            'panel' => $panel,
            'chosenApp' => $chosenApp,
            'qrSvg' => $qrSvg,
            'secretKey' => $secretKey,
        ];
    }
}
