<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Recording a Unit query (§18), the Query received date, and the automatic
 * move to Non-compliant.
 *
 * The generic status endpoint refuses NON-COMPLIANT on purpose: a bare
 * transition would leave `query_received_at` empty, and every later report
 * that measures from the query would be looking at a date that never landed.
 * This is the door that writes the day and then asks {@see Engine} to move
 * the row.
 *
 * The status change goes through the engine, not around it: permission is
 * still `cip.compliance`, and the date is written before the row moves.
 * Response documents land in Additional Documents (§17), which stays writable
 * after the original package is frozen.
 */
class NonCompliance
{
    /**
     * Record it: the day the Unit asked, and the move to Non-compliant.
     *
     * Idempotent when the file already stands at Non-compliant: a second
     * press updates the date rather than sending a second notice for the
     * same episode.
     *
     * @throws \InvalidArgumentException the application is not somewhere a Unit query can land
     * @throws AuthorizationException
     */
    public static function record(
        CipApplication $application,
        User $actor,
        ?Carbon $queryReceivedAt = null,
        bool $override = false,
        ?string $note = null,
    ): CipApplication {
        $queryReceivedAt ??= Carbon::now();
        $already = $application->status === Status::NON_COMPLIANT;
        $edge = $already || Engine::canTransition($application, Status::NON_COMPLIANT);

        /*
         * The same door BackgroundCheck::record opens: off the map, an
         * administrator who typed the confirmation drives it through
         * Engine::set (admin gate, reason demanded); everyone else keeps
         * the explanation.
         */
        if (! $edge && ! $override) {
            throw new \InvalidArgumentException(
                'A query can only be recorded on an application the Unit already holds.',
            );
        }

        $application = DB::transaction(function () use ($application, $actor, $queryReceivedAt, $already, $edge, $note) {
            Tree::provisionAdditionalDrawers($application, $actor);
            $application->refresh();

            $application->forceFill(['query_received_at' => $queryReceivedAt])->save();

            $meta = ['queryReceivedAt' => $queryReceivedAt->toDateString()];

            if (! $already) {
                if ($edge) {
                    Engine::apply($application, Status::NON_COMPLIANT, $actor, $meta);
                } else {
                    Engine::set($application, Status::NON_COMPLIANT, $actor, $meta + ['note' => (string) $note]);
                }
            }

            Engine::record($application, CipEvent::ACTION_QUERY_RECEIVED, $actor, $meta);

            return $application->refresh();
        });

        return $application;
    }
}
