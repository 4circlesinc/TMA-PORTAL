<?php

namespace App\Http\Middleware;

use App\Support\Access\Role;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route-level capability gate: `->middleware('capability:mail.use')`.
 *
 * Prefer this over a per-method check inside the controller when a whole
 * route group shares one requirement — it keeps the requirement visible in
 * routes/web.php, where you can see what a role can reach without opening
 * every controller.
 *
 * Several capabilities may be listed; the user needs any one of them.
 */
class EnsureCapability
{
    public function handle(Request $request, Closure $next, string ...$capabilities): Response
    {
        $user = $request->user();

        foreach ($capabilities as $capability) {
            if (Role::can($user, $capability)) {
                return $next($request);
            }
        }

        abort(403, 'You do not have access to this.');
    }
}
