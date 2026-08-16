<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Support\Cip\Buckets;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * §9's dashboard: the buckets this reader opens their day on, counted.
 *
 * Somebody the module is not for is told so — `cip: false` and an empty list —
 * rather than refused. The dashboard-metrics controller answers a client
 * asking for staff KPIs the same way, for the same reason: on a home screen a
 * 403 is indistinguishable from the numbers being broken, and a page that is
 * simply not offered a row can drop it without knowing why.
 *
 * Everything else is {@see Buckets}, deliberately. The controller does not
 * know what a bucket is, so the counts served here and the filter the
 * applications listing applies cannot become two definitions of the same word.
 *
 * There is no cache around this and there must not be — see the note in
 * {@see Buckets}. A work queue that lags a status change by five minutes reads
 * as broken.
 */
class CipDashboardController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        $dashboard = Buckets::setFor($user);

        if ($dashboard === null) {
            return response()->json(['cip' => false, 'buckets' => []]);
        }

        return response()->json([
            'cip' => true,
            // Which of §9's three dashboards this is. The counts alone do not
            // say whether they describe a firm's whole book or one officer's
            // desk, and a heading that got that wrong would be the difference
            // between a report and a to-do list.
            'dashboard' => $dashboard,
            'buckets' => Buckets::for($user),
        ]);
    }
}
