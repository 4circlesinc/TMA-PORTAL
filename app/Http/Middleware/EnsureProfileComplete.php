<?php

namespace App\Http\Middleware;

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
            return redirect()->route('profile-setup');
        }

        return $next($request);
    }
}
