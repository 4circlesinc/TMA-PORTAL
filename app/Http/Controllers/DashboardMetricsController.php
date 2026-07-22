<?php

namespace App\Http\Controllers;

use App\Support\Dashboard\DashboardMetrics;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

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
    /**
     * How long a computed row stays warm.
     *
     * The cards measure rolling multi-week windows, so a few minutes of lag is
     * invisible in the numbers but removes roughly ten queries — including
     * timeline scans over messages and mail — from every visit to the
     * dashboard. Deliberately short: this is a staleness budget, not a cache
     * that needs invalidating on write.
     */
    private const TTL_SECONDS = 300;

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        $metrics = new DashboardMetrics($user);

        if (! $metrics->isStaff()) {
            return response()->json(['staff' => false]);
        }

        // Keyed per user: an administrator sees organization scope and everyone
        // else sees their own, so one shared entry would show the wrong numbers.
        $payload = Cache::remember(
            "dashboard-metrics.{$user->id}",
            self::TTL_SECONDS,
            fn () => $metrics->toArray(),
        );

        return response()->json(['staff' => true] + $payload);
    }
}
