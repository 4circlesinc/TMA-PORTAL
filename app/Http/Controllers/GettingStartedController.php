<?php

namespace App\Http\Controllers;

use App\Support\Access\Role;
use App\Support\Onboarding\AccountSetupFlow;
use App\Support\SecurityPolicies;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * The walkthrough after approval. Connects Microsoft / Google for sign-in.
 * Personal preferences, two-factor, notifications, and email are handled
 * in the account-setup flow that follows.
 */
class GettingStartedController extends Controller
{
    public function show(Request $request): View|RedirectResponse
    {
        $user = $request->user();

        if (Role::isClient($user)) {
            return redirect()->route('onboarding.index');
        }
        $policy = SecurityPolicies::get('sign-in');

        $google = $user->connectedAccount('google');
        $microsoft = $user->connectedAccount('microsoft');
        $hasProvider = $google || $microsoft;

        $microsoftConfigured = (bool) config('services.microsoft.sync')
            && (bool) config('services.microsoft.client_id');
        $googleConfigured = (bool) config('services.google.client_id');

        $requireMicrosoft = (bool) ($policy['requireMicrosoftConnect'] ?? false) && $microsoftConfigured;
        $requireGoogle = (bool) ($policy['requireGoogleConnect'] ?? false) && $googleConfigured;

        // The flags alone are not enough: every pipeline runs on the stored
        // refresh token, and a sign-in-only connect leaves the flags off AND
        // the token empty — but a half-granted consent can leave flags on
        // with nothing to sync with. Ticked means it will actually work.
        $hasToken = $microsoft && $microsoft->getRawOriginal('token') !== null;
        $features = [
            'email' => $hasToken && (bool) $microsoft->sync_email,
            'calendar' => $hasToken && (bool) $microsoft->sync_calendar,
            'onedrive' => $hasToken && (bool) $microsoft->sync_onedrive,
        ];
        $microsoftConnected = $features['email'] && $features['calendar'] && $features['onedrive'];
        $googleConnected = (bool) $google;

        $wizard = AccountSetupFlow::position(AccountSetupFlow::ACCOUNTS, $user);

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
            'features' => $features,
            'allConnected' => $microsoftConnected,
            'index' => $wizard['index'],
            'total' => $wizard['total'],
        ]);
    }

    public function finish(Request $request): RedirectResponse
    {
        $user = $request->user();

        if (Role::isClient($user)) {
            return redirect()->route('onboarding.index');
        }

        $policy = SecurityPolicies::get('sign-in');

        $microsoftConfigured = (bool) config('services.microsoft.sync')
            && (bool) config('services.microsoft.client_id');
        $googleConfigured = (bool) config('services.google.client_id');

        if (($policy['requireMicrosoftConnect'] ?? false) && $microsoftConfigured) {
            $microsoft = $user->connectedAccount('microsoft');
            $connected = $microsoft
                && $microsoft->getRawOriginal('token') !== null
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

        AccountSetupFlow::markAccountsPhaseComplete($user);
        AccountSetupFlow::begin($user->fresh());

        return redirect()->route('account-setup.show', [
            'step' => AccountSetupFlow::firstStep($user->fresh()),
        ]);
    }
}
