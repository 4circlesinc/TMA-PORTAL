<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class GettingStartedController extends Controller
{
    public function show(Request $request): View
    {
        $user = $request->user();

        $google = $user->connectedAccount('google');
        $microsoft = $user->connectedAccount('microsoft');
        $hasProvider = $google || $microsoft;

        // Email is verified by the time anyone reaches this screen.
        $steps = 3;
        $done = 1 + ($hasProvider ? 1 : 0) + ($user->hasTwoFactorEnabled() ? 1 : 0);

        return view('auth.getting-started', [
            'user' => $user,
            'google' => $google,
            'microsoft' => $microsoft,
            'hasProvider' => $hasProvider,
            'twoFactorOn' => $user->hasTwoFactorEnabled(),
            'done' => $done,
            'total' => $steps,
        ]);
    }

    public function finish(Request $request): RedirectResponse
    {
        $request->user()->forceFill(['onboarding_completed_at' => now()])->save();

        return redirect('/');
    }
}
