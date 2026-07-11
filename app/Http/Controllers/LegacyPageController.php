<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class LegacyPageController extends Controller
{
    public const PAGES = [
        '404',
        'account',
        'account-info',
        'billing-details',
        'calendar',
        'choose-account-type',
        'classic',
        'coming-soon',
        'demo',
        'email',
        'forgot-password',
        'maintenance',
        'overview',
        'pricing',
        'projects',
        'settings',
        'setup-new-password',
        'sign-in',
        'sign-up',
        'two-step-verification',
        'users',
    ];

    public function __invoke(Request $request, string $page): BinaryFileResponse
    {
        abort_unless(in_array($page, self::PAGES, true), 404);

        $path = public_path($page.'/index.html');

        abort_unless(is_file($path), 404);

        return response()->file($path);
    }
}
