<?php

namespace App\Http\Middleware;

use App\Support\Onboarding\AccountSetupFlow;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Walks new members through account connections, then personal setup
 * (preferences, two-factor, notifications, email) before the portal.
 */
class EnsureOnboarded
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || AccountSetupFlow::isComplete($user)) {
            return $next($request);
        }

        if ($this->isOnboardingRoute($request)) {
            return $next($request);
        }

        if (! AccountSetupFlow::accountsPhaseComplete($user)) {
            return AccountSetupFlow::usesClientWizard($user)
                ? redirect()->route('onboarding.index')
                : redirect()->route('getting-started');
        }

        $setupUrl = AccountSetupFlow::redirectFor($user);

        if ($setupUrl) {
            return redirect($setupUrl);
        }

        return $next($request);
    }

    private function isOnboardingRoute(Request $request): bool
    {
        return $request->routeIs(
            'getting-started',
            'getting-started.finish',
            'onboarding.*',
            'onboarding.complete',
            'account-setup.*',
            'social.*',
            'security-settings*',
        ) || $request->is('settings', 'account-settings');
    }
}
