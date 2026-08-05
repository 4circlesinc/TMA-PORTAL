<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * The staff walkthrough after approval. When Microsoft sync is configured the
 * centrepiece is one required connect step — Outlook mail, Calendar and
 * OneDrive all link through a single consent (sync_all), so one click covers
 * all three rows. Without Microsoft sync (local dev, unconfigured tenant) it
 * falls back to the old optional provider connect.
 */
class GettingStartedController extends Controller
{
    public function show(Request $request): View
    {
        $user = $request->user();

        $google = $user->connectedAccount('google');
        $microsoft = $user->connectedAccount('microsoft');
        $hasProvider = $google || $microsoft;

        $microsoftReady = (bool) config('services.microsoft.sync')
            && (bool) config('services.microsoft.client_id');

        $features = [
            'email' => (bool) ($microsoft?->sync_email),
            'calendar' => (bool) ($microsoft?->sync_calendar),
            'onedrive' => (bool) ($microsoft?->sync_onedrive),
        ];
        $allConnected = $features['email'] && $features['calendar'] && $features['onedrive'];

        // Email is verified by the time anyone reaches this screen.
        if ($microsoftReady) {
            $steps = 5;
            $done = 1 + count(array_filter($features)) + ($user->hasTwoFactorEnabled() ? 1 : 0);
        } else {
            $steps = 3;
            $done = 1 + ($hasProvider ? 1 : 0) + ($user->hasTwoFactorEnabled() ? 1 : 0);
        }

        return view('auth.getting-started', [
            'user' => $user,
            'google' => $google,
            'microsoft' => $microsoft,
            'hasProvider' => $hasProvider,
            'microsoftReady' => $microsoftReady,
            'features' => $features,
            'allConnected' => $allConnected,
            'twoFactorOn' => $user->hasTwoFactorEnabled(),
            'done' => $done,
            'total' => $steps,
        ]);
    }

    public function finish(Request $request): RedirectResponse
    {
        $user = $request->user();

        $microsoftReady = (bool) config('services.microsoft.sync')
            && (bool) config('services.microsoft.client_id');

        // Connecting is required for staff whenever the firm's Microsoft
        // integration is on — the portal's mail, calendar and file library
        // all depend on it.
        if ($microsoftReady) {
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

        $user->forceFill(['onboarding_completed_at' => now()])->save();

        return redirect('/');
    }
}
