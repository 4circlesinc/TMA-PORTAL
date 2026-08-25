<?php

namespace App\Http\Middleware;

use App\Support\Access\Role;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * New accounts - registered by email or created through Google/Microsoft -
 * set up their profile before reaching the portal.
 */
class EnsureProfileComplete
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && $user->profile_completed_at === null) {
            // Clients fill their profile in inside guided onboarding, which
            // asks for everything profile-setup would and more. Sending them
            // to profile-setup first would ask the same questions twice.
            if (Role::isClient($user) && $user->onboarding_completed_at === null) {
                return redirect()->route('onboarding.index');
            }

            return redirect()->route('profile-setup');
        }

        return $next($request);
    }
}
