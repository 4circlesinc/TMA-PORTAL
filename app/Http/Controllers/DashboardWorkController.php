<?php

namespace App\Http\Controllers;

use App\Support\Access\Role;
use App\Support\Files\Workflow\Hub;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The two work tiles on the portal home: requests waiting on you, and the
 * latest discussion that concerns you.
 *
 * Both are the Workflows section's default tabs, read through {@see Hub} so a
 * tile and the page it opens onto can never disagree about what "yours" means.
 * Nothing is authorized here that is not already authorized there: Hub
 * re-checks every row against the file it belongs to.
 *
 * Accounts without the section get `enabled: false` rather than a 403, the
 * same bargain the presence board makes — the dashboard drops the tiles, and a
 * refused request would be indistinguishable from a broken one.
 */
class DashboardWorkController extends Controller
{
    /** Rows per tile. Ten is what the board has room for before it scrolls. */
    private const LIMIT = 10;

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! Role::can($user, 'workflows.view')) {
            return response()->json([
                'enabled' => false,
                'requests' => [],
                'comments' => [],
                'counts' => null,
            ]);
        }

        // A tile the reader turned off must not cost a query. Each list is a
        // page of rows plus a per-file access walk over it, so asking for both
        // when the board shows one is half the request wasted, every minute it
        // stays open.
        $want = self::wanted($request);

        $requests = in_array('requests', $want, true)
            ? Hub::requests($user, ['scope' => Hub::SCOPE_INBOX, 'limit' => self::LIMIT])
            : null;

        /*
         * markRead: false. The tile shows one line of each thread, which is
         * not the reading — and it refreshes on a timer, so a board left open
         * would empty the Workflows badge for threads nobody ever opened.
         */
        $comments = in_array('comments', $want, true)
            ? Hub::comments($user, ['scope' => Hub::COMMENTS_MINE, 'limit' => self::LIMIT], markRead: false)
            : null;

        return response()->json([
            'enabled' => true,
            // Echoed back so the board can tell "nothing waiting on you" from
            // "this tile was switched on after the last request went out".
            'want' => $want,
            'requests' => $requests['items'] ?? [],
            'comments' => $comments['items'] ?? [],
            // The same figures the sidebar badge carries, so the board can
            // hand them across rather than the shell asking a second time.
            'counts' => $requests['counts'] ?? $comments['counts'] ?? Hub::counts($user),
        ]);
    }

    /**
     * Which tiles are on screen, defaulting to both.
     *
     * @return list<string>
     */
    private static function wanted(Request $request): array
    {
        $raw = (string) $request->query('want', '');

        $want = array_values(array_intersect(
            ['requests', 'comments'],
            array_map('trim', explode(',', $raw)),
        ));

        return $want ?: ['requests', 'comments'];
    }
}
