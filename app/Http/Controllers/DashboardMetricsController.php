<?php

namespace App\Http\Controllers;

use App\Support\Dashboard\DashboardMetrics;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * The KPI row on the portal home.
 *
 * Staff cards measure how the firm serves its clients. Service-provider
 * contacts get a CIP-and-inbox row instead. Anyone else asking for the
 * numbers gets an explicit `staff: false` rather than a 403, the dashboard
 * simply drops the row for them, and a failed request would be
 * indistinguishable from the metrics being broken.
 */
class DashboardMetricsController extends Controller
{
    /**
     * How long a computed staff row stays warm.
     *
     * The staff cards measure rolling multi-week windows, so a few minutes of
     * lag is invisible in the numbers but removes roughly ten queries,
     * including timeline scans over messages and mail, from every visit to the
     * dashboard. Deliberately short: this is a staleness budget, not a cache
     * that needs invalidating on write.
     *
     * The provider row is a live inbox (unread messages, open comments,
     * updates required) and is not cached: a queue that lags a status change
     * by five minutes reads as broken.
     */
    private const TTL_SECONDS = 300;

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        $metrics = new DashboardMetrics($user);

        if ($metrics->isStaff()) {
            // Keyed per user: an administrator sees organization scope and everyone
            // else sees their own, so one shared entry would show the wrong numbers.
            $payload = Cache::remember(
                "dashboard-metrics.{$user->id}",
                self::TTL_SECONDS,
                fn () => $metrics->toArray(),
            );

            return response()->json(['staff' => true] + $payload);
        }

        if ($metrics->isProviderContact()) {
            return response()->json(['staff' => false, 'provider' => true] + $metrics->providerToArray());
        }

        return response()->json(['staff' => false]);
    }
}
