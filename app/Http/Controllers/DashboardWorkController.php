<?php

namespace App\Http\Controllers;

use App\Support\Cip\CipAccess;
use App\Support\Files\FileAccess;
use App\Support\Files\Workflow\Hub;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Work on the portal home: the Requests and Comments tiles, and the combined
 * unread strip above the KPI row.
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
        // stays open. The strip asks for unread threads on their own — a page
        // of already-opened comments would otherwise hide the ones the badge
        // is counting.
        $want = self::wanted($request);
        $wantFeed = in_array('feed', $want, true);
        $wantRequests = in_array('requests', $want, true);
        $wantComments = in_array('comments', $want, true);

        $requests = ($wantRequests || $wantFeed)
            ? Hub::requests($user, ['scope' => Hub::SCOPE_INBOX, 'limit' => self::LIMIT])
            : null;
        $comments = $wantComments
            ? Hub::comments($user, ['scope' => Hub::COMMENTS_MINE, 'limit' => self::LIMIT])
            : null;
        $feedComments = $wantFeed
            ? Hub::comments($user, [
                'scope' => Hub::COMMENTS_MINE,
                'unread' => true,
                'limit' => self::LIMIT,
            ])
            : null;
        // Staff see CIP documents waiting on an update — that is the number
        // on their Workflows badge. Provider contacts share a firm-wide list
        // of those documents, which is why they were flooding every contact
        // dashboard; theirs stay on the Updates required page.
        $updates = ($wantFeed && FileAccess::isStaff($user))
            ? Hub::updates($user, ['limit' => self::LIMIT])
            : null;

        return response()->json([
            'enabled' => true,
            // Echoed back so the board can tell "nothing waiting on you" from
            // "this tile was switched on after the last request went out".
            'want' => $want,
            'requests' => $wantRequests ? ($requests['items'] ?? []) : [],
            'comments' => $wantComments ? ($comments['items'] ?? []) : [],
            'feed' => $wantFeed ? self::feed(
                $requests['items'] ?? [],
                $feedComments['items'] ?? [],
                $updates['items'] ?? [],
            ) : [],
            // The same figures the sidebar badge carries, so the board can
            // hand them across rather than the shell asking a second time.
            'counts' => $requests['counts']
                ?? $comments['counts']
                ?? $feedComments['counts']
                ?? $updates['counts']
                ?? Hub::counts($user),
        ]);
    }

    /**
     * Unread unresolved comments, requests still waiting on you, and — for
     * staff — CIP documents marked Update required, newest first.
     *
     * A comment the reader has already opened, a resolved thread, or a
     * request that is no longer on them, belong on the tiles.
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
