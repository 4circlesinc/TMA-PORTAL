<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class LegacyPageController extends Controller
{
    /** Publicly reachable static pages (stay in public/). */
    public const PUBLIC_PAGES = [
        '404',
        'coming-soon',
        'maintenance',
        'pricing',
        'privacy-policy',
        'terms-of-service',
    ];

    /**
     * Portal routes that use the single SPA shell
     * ({@see resource_path('views/pages/dashboard.html')}).
     *
     * Hard-refreshing /email, /overview, etc. must never load a stale
     * duplicate sidebar from resources/portal-pages — that was the source of
     * the "menu keeps reverting to an old order" bug.
     */
    public const SPA_PAGES = [
        'account',
        'account-settings',
        'calendar',
        'clients',
        'email',
        'email/templates',
        'overview',
        'projects',
        'settings',
        'settings/change-email',
        'signatures',
        'social/feed',
        'social/messages',
        'users',
        'users/new',
    ];

    /**
     * Standalone portal HTML (not the main SPA shell). Intentionally separate
     * layouts — classic design, onboarding, billing wizards.
     */
    public const STANDALONE_PAGES = [
        'account-info',
        'billing-details',
        'billing-details/card',
        'choose-account-type',
        'classic',
    ];

    /** @deprecated Use SPA_PAGES + STANDALONE_PAGES. Kept for route registration. */
    public const PORTAL_PAGES = [
        'account',
        'account-settings',
        'account-info',
        'billing-details',
        'billing-details/card',
        'calendar',
        'choose-account-type',
        'classic',
        'clients',
        'email',
        'email/templates',
        'overview',
        'projects',
        'settings',
        'settings/change-email',
        'signatures',
        'social/feed',
        'social/messages',
        'users',
        'users/new',
    ];

    /** One approved shell — menu order lives only here. */
    public static function spaShellPath(): string
    {
        return resource_path('views/pages/dashboard.html');
    }

    public function __invoke(Request $request, string $page): BinaryFileResponse
    {
        if (in_array($page, self::PUBLIC_PAGES, true)) {
            $path = public_path($page.'/index.html');
        } elseif (in_array($page, self::SPA_PAGES, true)) {
            $path = self::spaShellPath();
        } elseif (in_array($page, self::STANDALONE_PAGES, true)) {
            $path = resource_path('portal-pages/'.$page.'/index.html');
        } else {
            abort(404);
        }

        abort_unless(is_file($path), 404);

        $headers = [];
        if (in_array($page, self::SPA_PAGES, true)) {
            $headers = [
                'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0',
                'Pragma' => 'no-cache',
                'Expires' => '0',
            ];
        }

        return response()->file($path, $headers);
    }
}
