<?php

namespace App\Http\Controllers;

use App\Support\SecurityPolicies;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * The walkthrough after approval. Steps that are required vs optional come
 * from Account settings > Sign in policy so the firm can turn Microsoft /
 * Google / authenticator requirements on or off without a deploy.
 */
class GettingStartedController extends Controller
{
    public function show(Request $request): View
    {
        $user = $request->user();
        $policy = SecurityPolicies::get('sign-in');

        $google = $user->connectedAccount('google');
        $microsoft = $user->connectedAccount('microsoft');
        $hasProvider = $google || $microsoft;

        $microsoftConfigured = (bool) config('services.microsoft.sync')
            && (bool) config('services.microsoft.client_id');
        $googleConfigured = (bool) config('services.google.client_id');

        $requireMicrosoft = (bool) ($policy['requireMicrosoftConnect'] ?? false) && $microsoftConfigured;
        $requireGoogle = (bool) ($policy['requireGoogleConnect'] ?? false) && $googleConfigured;
        $requireAuthenticator = (bool) ($policy['requireAuthenticatorApp'] ?? false)
            || (bool) ($policy['requireMfa'] ?? false);

        $features = [
            'email' => (bool) ($microsoft?->sync_email),
            'calendar' => (bool) ($microsoft?->sync_calendar),
            'onedrive' => (bool) ($microsoft?->sync_onedrive),
        ];
        $microsoftConnected = $features['email'] && $features['calendar'] && $features['onedrive'];
        $googleConnected = (bool) $google;
        $twoFactorOn = $user->hasTwoFactorEnabled();

        // Email is always done by the time anyone reaches this screen.
        $steps = [
            ['key' => 'email', 'done' => true, 'required' => true],
            ['key' => 'microsoft', 'done' => $microsoftConnected, 'required' => $requireMicrosoft],
            ['key' => 'google', 'done' => $googleConnected, 'required' => $requireGoogle],
            ['key' => 'authenticator', 'done' => $twoFactorOn, 'required' => $requireAuthenticator],
        ];

        // When Microsoft sync is on and required, the three sync rows count as
        // the Microsoft step (one consent). Otherwise show optional connects.
        $visible = array_values(array_filter($steps, function (array $step) use ($microsoftConfigured, $googleConfigured) {
            if ($step['key'] === 'microsoft') {
                return $microsoftConfigured;
            }
            if ($step['key'] === 'google') {
                return $googleConfigured || $step['required'];
            }

            return true;
        }));

        $done = count(array_filter($visible, fn (array $s) => $s['done']));
        $total = max(count($visible), 1);

        return view('auth.getting-started', [
            'user' => $user,
            'google' => $google,
            'microsoft' => $microsoft,
            'hasProvider' => $hasProvider,
            'microsoftReady' => $microsoftConfigured,
            'microsoftConfigured' => $microsoftConfigured,
            'googleConfigured' => $googleConfigured,
            'requireMicrosoft' => $requireMicrosoft,
            'requireGoogle' => $requireGoogle,
            'requireAuthenticator' => $requireAuthenticator,
            'features' => $features,
            'allConnected' => $microsoftConnected,
            'twoFactorOn' => $twoFactorOn,
            'done' => $done,
            'total' => $total,
        ]);
    }

    public function finish(Request $request): RedirectResponse
    {
        $user = $request->user();
        $policy = SecurityPolicies::get('sign-in');

        $microsoftConfigured = (bool) config('services.microsoft.sync')
            && (bool) config('services.microsoft.client_id');
        $googleConfigured = (bool) config('services.google.client_id');

        if (($policy['requireMicrosoftConnect'] ?? false) && $microsoftConfigured) {
            $microsoft = $user->connectedAccount('microsoft');
            $connected = $microsoft
                && $microsoft->sync_email
                && $microsoft->sync_calendar
                && $microsoft->sync_onedrive;

            if (! $connected) {
                return redirect()->route('getting-started')
                    ->with('social_error', 'Connect your Microsoft account to continue.');
            }
        }

        if (($policy['requireGoogleConnect'] ?? false) && $googleConfigured) {
            if (! $user->connectedAccount('google')) {
                return redirect()->route('getting-started')
                    ->with('social_error', 'Connect your Google account to continue.');
            }
        }

        $requireAuthenticator = (bool) ($policy['requireAuthenticatorApp'] ?? false)
            || (bool) ($policy['requireMfa'] ?? false);

        if ($requireAuthenticator && ! $user->hasTwoFactorEnabled()) {
            return redirect()->route('getting-started')
                ->with('social_error', 'Set up an authenticator app to continue.');
        }

        $user->forceFill(['onboarding_completed_at' => now()])->save();

        return redirect('/');
    }
}
