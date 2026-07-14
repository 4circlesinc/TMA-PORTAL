<?php

namespace App\Http\Middleware;

use App\Support\SecurityPolicies;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Emits the "Trusted domains" security policy as real headers: only the
 * portal itself and the listed domains may embed the app in an iframe.
 */
class ApplySecurityPolicyHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $domains = collect(explode(',', SecurityPolicies::get('security')['trustedDomains']))
            ->map(fn (string $domain) => trim($domain))
            ->filter(fn (string $domain) => $domain !== '' && preg_match('/^[a-z0-9.*-]+$/i', $domain))
            ->map(fn (string $domain) => "https://{$domain}");

        $ancestors = trim("'self' ".$domains->implode(' '));
        $response->headers->set('Content-Security-Policy', "frame-ancestors {$ancestors}");

        return $response;
    }
}
