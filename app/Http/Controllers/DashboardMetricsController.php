<?php

namespace App\Http\Controllers;

use App\Support\Dashboard\DashboardMetrics;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The KPI row on the portal home.
 *
 * The cards measure how well the firm serves its clients, so they are staff
 * only. A client asking for them gets an explicit `staff: false` rather than a
 * 403 — the dashboard simply drops the row for them, and a failed request
 * would be indistinguishable from the metrics being broken.
 */
class DashboardMetricsController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $metrics = new DashboardMetrics($request->user());

        if (! $metrics->isStaff()) {
            return response()->json(['staff' => false]);
        }

        return response()->json(['staff' => true] + $metrics->toArray());
    }
}
