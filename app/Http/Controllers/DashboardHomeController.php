<?php

namespace App\Http\Controllers;

use App\Support\Dashboard\HomeBoard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The portal home's widgets, in one round trip.
 *
 * See {@see HomeBoard}. Individual tile endpoints remain for Overview,
 * Email, and live refetch.
 */
class DashboardHomeController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $parts = array_values(array_filter(array_map(
            'trim',
            explode(',', (string) $request->query('parts', '')),
        )));

        return response()->json(HomeBoard::payload($request, $parts));
    }
}
