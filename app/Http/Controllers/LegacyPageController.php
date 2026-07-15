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
    ];

    /**
     * Portal pages - static prototypes served from resources/portal-pages/
     * so they can only be reached through the authenticated route.
     */
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
        'social/feed',
        'social/messages',
        'users',
        'users/new',
    ];

    public function __invoke(Request $request, string $page): BinaryFileResponse
    {
        if (in_array($page, self::PUBLIC_PAGES, true)) {
            $path = public_path($page.'/index.html');
        } elseif (in_array($page, self::PORTAL_PAGES, true)) {
            // Account settings is the same shell as Settings; the sidebar's
            // data-view="admin" link decides which view opens.
            $shell = $page === 'account-settings' ? 'settings' : $page;
            $path = resource_path('portal-pages/'.$shell.'/index.html');
        } else {
            abort(404);
        }

        abort_unless(is_file($path), 404);

        return response()->file($path);
    }
}
