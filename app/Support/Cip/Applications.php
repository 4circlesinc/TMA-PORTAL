<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipProvider;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Creating applications. One method so the invariant cannot be skipped: an
 * application, its internal number and its first audit row are born in one
 * transaction, a row without a number, or a number without a row, cannot
 * exist even for a moment.
 */
class Applications
{
    /**
     * @param  string  $status  Where the application is born. NEW for a filing;
     *                          DRAFT for one the intake wizard is still being
     *                          typed into, which becomes NEW when it is filed.
     */
    public static function create(
        CipProvider $provider,
        User $creator,
        array $attributes = [],
        string $status = Status::NEW,
    ): CipApplication {
        return DB::transaction(function () use ($provider, $creator, $attributes, $status) {
            $application = new CipApplication($attributes);
            $application->status = $status;
            $application->provider_id = $provider->id;
            $application->created_by = $creator->id;
            $application->internal_number = Numbering::next($provider);
            $application->save();

            Engine::record($application, CipEvent::ACTION_CREATED, $creator, [
                'internalNumber' => $application->internal_number,
            ]);

            return $application;
        });
    }
}
