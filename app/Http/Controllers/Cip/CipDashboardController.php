<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Support\Access\Role;
use App\Support\Cip\Buckets;
use App\Support\Cip\CipAccess;
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
 * `card` is whether the home screen draws this payload as the CIP Applications
 * tile. Staff get it, and so does a Service Provider contact — §9's six are
 * their day-opening view. A private client reaches the module through their
 * own application and is not offered a summary of a book; they share the
 * service-provider *set* with the contact, so the dashboard name cannot decide
 * this and the contact-ness check has to.
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
             * are staff; a Service Provider contact and a Private Client reach
             * the module through their own applications. A parked Employee is
             * staff by this predicate and never arrives here at all, because
             * CipAccess::canReach turns them away before the dashboard exists.
             */
            'staff' => Role::isStaff($user),
            /*
             * Whether the home screen should draw the CIP Applications card.
             *
             * Staff, and the Service Provider contact whose six buckets are
             * that card's other view. Not a private client: they share the
             * service-provider set, and inferring the card from the set name
             * would hang a firm's summary on an applicant's home screen.
             */
            'card' => Role::isStaff($user) || CipAccess::isProviderContact($user),
            // Which of §9's three dashboards this is. The counts alone do not
            // say whether they describe a firm's whole book or one officer's
            // desk, and a heading that got that wrong would be the difference
            // between a report and a to-do list.
            'dashboard' => $dashboard,
            'buckets' => Buckets::for($user),
        ]);
    }
}
