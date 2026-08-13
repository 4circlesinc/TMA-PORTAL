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
 * transaction — a row without a number, or a number without a row, cannot
 * exist even for a moment.
 */
class Applications
{
    public static function create(CipProvider $provider, User $creator, array $attributes = []): CipApplication
    {
        return DB::transaction(function () use ($provider, $creator, $attributes) {
            $application = new CipApplication($attributes);
            $application->status = Status::DRAFT;
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
