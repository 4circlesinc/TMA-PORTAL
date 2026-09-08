<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Recording acceptance for processing (section 19), the Accepted for processing
 * date, and the automatic move to Background check.
 *
 * The generic status endpoint refuses BACKGROUND CHECK on purpose: a bare
 * transition would leave `accepted_at` empty, and the 180-day delay clock
 * (section 20) would have nothing to measure from. This is the door that writes the
 * day and then asks {@see Engine} to move the row.
 *
 * The status change goes through the engine, not around it: permission is
 * still `cip.compliance`, and the date is written before the row moves.
 */
class BackgroundCheck
{
    /**
     * Record it: the day the Unit accepted the file, and the move to
     * Background check.
     *
     * Idempotent when the file already stands at Background check: a second
     * press updates the date rather than walking the lifecycle again.
     *
     * @throws \InvalidArgumentException the application is not somewhere the Unit can accept it
     * @throws AuthorizationException
     */
    public static function record(
        CipApplication $application,
        User $actor,
        ?Carbon $acceptedAt = null,
        bool $override = false,
        ?string $note = null,
        ?string $message = null,
    ): CipApplication {
        $acceptedAt ??= Carbon::now();
        $already = $application->status === Status::BACKGROUND_CHECK;
        $edge = $already || Engine::canTransition($application, Status::BACKGROUND_CHECK);

        /*
         * Off the lifecycle map, this is not a flat refusal any more: an
         * administrator who typed the confirmation may drive it anyway,
         * through Engine::set, which holds the admin gate and demands the
         * reason. Everyone else keeps the explanation.
         */
        if (! $edge && ! $override) {
            throw new \InvalidArgumentException(
                'Acceptance for processing can only be recorded on an application the Unit already holds.',
            );
        }

        $message = trim((string) $message) ?: null;

        return DB::transaction(function () use ($application, $actor, $acceptedAt, $already, $edge, $note, $message) {
            $application->forceFill(['accepted_at' => $acceptedAt])->save();

            $meta = ['acceptedAt' => $acceptedAt->toDateString()];

            // Carried to the notice, which is sent from Engine::write once
            // the row has landed. Kept out of the event payload below: the
            // covering note is the letter's, not the timeline's.
            $notice = $message !== null ? ['message' => $message] : [];

            if (! $already) {
                if ($edge) {
                    Engine::apply($application, Status::BACKGROUND_CHECK, $actor, $meta + $notice);
                } else {
                    Engine::set($application, Status::BACKGROUND_CHECK, $actor, $meta + $notice + ['note' => (string) $note]);
                }
            }

            Engine::record($application, CipEvent::ACTION_ACCEPTED_FOR_PROCESSING, $actor, $meta);

            // The covering note is also the firm talking to the provider side
            // about this file, so it belongs in the thread. Recorded, not
            // announced: the status notice above already carries it.
            Threads::record($application, $actor, $message);

            return $application->refresh();
        });
    }
}
