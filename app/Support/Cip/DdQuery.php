<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Recording a due-diligence query: the date the Unit asked, and the automatic
 * move to DD Query.
 *
 * The file has already passed compliance. During Background check the Unit
 * can still ask for more paper, and that is not a second Non-compliant —
 * Non-compliant is the compliance query, and mixing the two would send the
 * provider side to the wrong drawer. Responses land in DD Query Responses
 * inside Additional Documents, which stays writable after the original
 * package is frozen.
 *
 * The generic status endpoint refuses DD QUERY on purpose: a bare transition
 * would leave `dd_query_received_at` empty. This is the door that writes the
 * day and then asks {@see Engine} to move the row.
 */
class DdQuery
{
    /**
     * Record it: the day the Unit asked, and the move to DD Query.
     *
     * Idempotent when the file already stands at DD Query: a second press
     * updates the date rather than sending a second notice for the same
     * episode.
     *
     * @throws \InvalidArgumentException the application is not somewhere a DD query can land
     * @throws AuthorizationException
     */
    public static function record(
        CipApplication $application,
        User $actor,
        ?Carbon $queryReceivedAt = null,
        bool $override = false,
        ?string $note = null,
        ?string $message = null,
    ): CipApplication {
        $queryReceivedAt ??= Carbon::now();
        $already = $application->status === Status::DD_QUERY;
        $edge = $already || Engine::canTransition($application, Status::DD_QUERY);

        if (! $edge && ! $override) {
            throw new \InvalidArgumentException(
                'A DD query can only be recorded once the Unit has accepted the file for processing.',
            );
        }

        $message = trim((string) $message) ?: null;

        $application = DB::transaction(function () use ($application, $actor, $queryReceivedAt, $already, $edge, $note, $message) {
            Tree::provisionAdditionalDrawers($application, $actor);
            $application->refresh();

            $application->forceFill(['dd_query_received_at' => $queryReceivedAt])->save();

            $meta = ['ddQueryReceivedAt' => $queryReceivedAt->toDateString()];
            $notice = $message !== null ? ['message' => $message] : [];

            if (! $already) {
                if ($edge) {
                    Engine::apply($application, Status::DD_QUERY, $actor, $meta + $notice);
                } else {
                    Engine::set($application, Status::DD_QUERY, $actor, $meta + $notice + ['note' => (string) $note]);
                }
            }

            Engine::record($application, CipEvent::ACTION_DD_QUERY_RECEIVED, $actor, $meta);

            Threads::record($application, $actor, $message);

            return $application->refresh();
        });

        return $application;
    }
}
