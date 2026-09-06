<?php

namespace App\Http\Middleware;

use App\Support\SecurityPolicies;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Browser security headers: CSP (including frame-ancestors from the
 * Trusted domains setting), HSTS on HTTPS, and Permissions-Policy.
 *
 * Inline scripts and styles are allowed because the portal ships a large
 * amount of Blade-inline JS. Tightening that is a separate pass.
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

        $csp = implode('; ', array_filter([
            "default-src 'self'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
            "frame-ancestors {$ancestors}",
            "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' data: https://fonts.gstatic.com",
            "img-src 'self' data: blob: https:",
            "media-src 'self' blob:",
            "connect-src 'self' https: wss: ws: blob:",
            "frame-src 'self' https://challenges.cloudflare.com https://accounts.google.com https://login.microsoftonline.com https://*.microsoftonline.com",
            "worker-src 'self' blob:",
            $this->secure($request) ? 'upgrade-insecure-requests' : null,
        ]));

        $response->headers->set('Content-Security-Policy', $csp);
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set('X-Frame-Options', 'SAMEORIGIN');
        $response->headers->set(
            'Permissions-Policy',
            'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()'
        );

        if ($this->secure($request)) {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $response;
    }

    private function secure(Request $request): bool
    {
        return $request->isSecure()
            || app()->environment('production')
            || str_starts_with((string) config('app.url'), 'https://');
    }
}
