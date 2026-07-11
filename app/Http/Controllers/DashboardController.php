<?php

namespace App\Http\Controllers;

use Symfony\Component\HttpFoundation\BinaryFileResponse;

class DashboardController extends Controller
{
    public function __invoke(): BinaryFileResponse
    {
        return response()->file(resource_path('views/pages/dashboard.html'));
    }
}
