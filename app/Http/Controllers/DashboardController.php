<?php

namespace App\Http\Controllers;

use Symfony\Component\HttpFoundation\BinaryFileResponse;

class DashboardController extends Controller
{
    public function __invoke(): BinaryFileResponse
    {
        return response()->file(resource_path('views/pages/dashboard.html'), [
            // The SPA shell embeds the menu. Browsers must never keep an old
            // copy after deploy — that is what made the menu "never change".
            'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma' => 'no-cache',
            'Expires' => '0',
        ]);
    }
}
