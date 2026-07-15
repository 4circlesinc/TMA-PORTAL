<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Once an administrator approves an account, the member is walked through
 * the security checklist before entering the portal. Security settings stay
 * reachable so they can finish a step (two-factor) and come back.
 */
class EnsureOnboarded
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (
            $user
            && $user->onboarding_completed_at === null
            && ! $request->routeIs('security-settings*')
            && ! $request->is('settings', 'account-settings')
            && ! $request->routeIs('social.*')
        ) {
            return redirect()->route('getting-started');
        }

        return $next($request);
    }
}
