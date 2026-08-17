<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Support\Access\Role;
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
 * `staff` is the same courtesy asked a second question, because the module IS
 * for the external side and the home screen's CIP card is not. A provider
 * contact and a private client both reach the module, and both are told so; the
 * card that summarises the firm's book on a staff home screen is not theirs.
 * The dashboard name cannot decide it — {@see Buckets::setFor} hands the
 * applicant-facing six to both external kinds, so `service_provider` describes
 * the slice a reader sees rather than which side of the firm they sit on. This
 * answers with {@see Role::isStaff}, the portal's one definition, so the
 * browser never infers staffhood from a set name.
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
            /*
             * Which side of the firm this reader is on.
             *
             * An administrator, a Compliance Officer and a Reviewing Officer
             * are the people the home card is for; a Service Provider contact
             * and a Private Client reach the module through their own
             * applications and get nothing on their home screen. A parked
             * Employee is staff by this predicate and never arrives here at
             * all, because CipAccess::canReach turns them away before the
             * dashboard exists.
             */
            'staff' => Role::isStaff($user),
            // Which of §9's three dashboards this is. The counts alone do not
            // say whether they describe a firm's whole book or one officer's
            // desk, and a heading that got that wrong would be the difference
            // between a report and a to-do list.
            'dashboard' => $dashboard,
            'buckets' => Buckets::for($user),
        ]);
    }
}
