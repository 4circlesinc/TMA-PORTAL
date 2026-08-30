<?php

namespace App\Http\Controllers;

use App\Support\Cip\CipAccess;
use App\Support\Files\Workflow\Hub;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Work on the portal home: the Requests and Comments tiles, and the combined
 * latest-updates strip under the KPI row.
 *
 * All three read through {@see Hub} so a tile, the strip, and the page they
 * open onto can never disagree about what "yours" means. Nothing is authorized
 * here that is not already authorized there: Hub re-checks every row against
 * the file it belongs to.
 *
 * Accounts without the section get `enabled: false` rather than a 403, the
 * same bargain the presence board makes — the dashboard drops the chrome, and
 * a refused request would be indistinguishable from a broken one.
 */
class DashboardWorkController extends Controller
{
    /** Rows per tile, and the strip's cap. */
    private const LIMIT = 10;

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! CipAccess::canViewWorkflows($user)) {
            return response()->json([
                'enabled' => false,
                'requests' => [],
                'comments' => [],
                'feed' => [],
                'counts' => null,
            ]);
        }

        // A tile the reader turned off must not cost a query. Each list is a
        // page of rows plus a per-file access walk over it, so asking for both
        // when the board shows one is half the request wasted, every minute it
        // stays open. The strip reuses those same lists rather than walking
        // them a second time.
        $want = self::wanted($request);
        $wantFeed = in_array('feed', $want, true);
        $wantRequests = in_array('requests', $want, true);
        $wantComments = in_array('comments', $want, true);

        // The strip only keeps unread / still-waiting rows, so it asks for a
        // fuller page than a tile does — otherwise ten already-opened comments
        // would leave it empty while newer unread ones sat just off the page.
        $commentsLimit = $wantFeed ? 20 : self::LIMIT;

        $requests = ($wantRequests || $wantFeed)
            ? Hub::requests($user, ['scope' => Hub::SCOPE_INBOX, 'limit' => self::LIMIT])
            : null;
        $comments = ($wantComments || $wantFeed)
            ? Hub::comments($user, ['scope' => Hub::COMMENTS_MINE, 'limit' => $commentsLimit])
            : null;
        $updates = $wantFeed
            ? Hub::updates($user, ['limit' => self::LIMIT])
            : null;

        $commentItems = $comments['items'] ?? [];

        return response()->json([
            'enabled' => true,
            // Echoed back so the board can tell "nothing waiting on you" from
            // "this tile was switched on after the last request went out".
            'want' => $want,
            'requests' => $wantRequests ? ($requests['items'] ?? []) : [],
            'comments' => $wantComments ? array_values(array_slice($commentItems, 0, self::LIMIT)) : [],
            'feed' => $wantFeed ? self::feed(
                $requests['items'] ?? [],
                $commentItems,
                $updates['items'] ?? [],
            ) : [],
            // The same figures the sidebar badge carries, so the board can
            // hand them across rather than the shell asking a second time.
            'counts' => $requests['counts']
                ?? $comments['counts']
                ?? $updates['counts']
                ?? Hub::counts($user),
        ]);
    }

    /**
     * Unread / still-waiting rows from the three streams, newest first.
     *
     * A comment the reader has already opened, or a request that is no longer
     * on them, does not belong on the strip — that is what the tiles and the
     * Workflows pages are for.
     *
     * @param  list<array<string, mixed>>  $requests
     * @param  list<array<string, mixed>>  $comments
     * @param  list<array<string, mixed>>  $updates
     * @return list<array{kind:string,at:string,item:array<string, mixed>}>
     */
    private static function feed(array $requests, array $comments, array $updates): array
    {
        $entries = [];

        foreach ($requests as $item) {
            if (empty($item['onMe']) || empty($item['isOpen'])) {
                continue;
            }
            $entries[] = ['kind' => 'request', 'at' => (string) ($item['sentAt'] ?? ''), 'item' => $item];
        }
        foreach ($comments as $item) {
            if (($item['unread'] ?? true) === false || ! empty($item['resolved'])) {
                continue;
            }
            $entries[] = ['kind' => 'comment', 'at' => (string) ($item['createdAt'] ?? ''), 'item' => $item];
        }
        foreach ($updates as $item) {
            $entries[] = ['kind' => 'update', 'at' => (string) ($item['updatedAt'] ?? ''), 'item' => $item];
        }

        usort($entries, function (array $a, array $b): int {
            return strcmp($b['at'], $a['at']);
        });

        return array_values(array_slice($entries, 0, self::LIMIT));
    }

    /**
     * Which lists are on screen, defaulting to both tiles.
     *
     * The strip is opt-in (`feed`) so a caller that has not heard of it still
     * gets the two tiles it asked for, and nothing extra.
     *
     * @return list<string>
     */
    private static function wanted(Request $request): array
    {
        $raw = (string) $request->query('want', '');

        $want = array_values(array_intersect(
            ['requests', 'comments', 'feed'],
            array_map('trim', explode(',', $raw)),
        ));

        return $want ?: ['requests', 'comments'];
    }
}
