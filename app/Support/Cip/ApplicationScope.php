<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Builder;

/**
 * Which CIP applications an account may see — the row-level gate the module's
 * capability checks cannot provide.
 *
 * Administrators and officers see every application. External accounts see
 * exactly their slice: a Service Provider contact (an active member of the
 * firm a provider is linked to) sees their firm's applications; a private
 * client sees the applications on their own client record. An employee with
 * no officer grant sees nothing — widen deliberately when the firm decides,
 * not by default.
 *
 * Use {@see self::query()} anywhere applications are listed, counted or
 * fetched; {@see self::findOrFail()} answers 404 — never 403 — so existence
 * never leaks (the ClientScope convention).
 */
class ApplicationScope
{
    /** An application query already narrowed to what this account may see. */
    public static function query(?User $user, ?Builder $base = null): Builder
    {
        $query = $base ?? CipApplication::query();

        // Module dark, or nobody signed in: no rows, not an error.
        if ($user === null || ! CipAccess::enabled()) {
            return $query->whereRaw('1 = 0');
        }

        if (Role::isAdmin($user)) {
            return $query;
        }

        /*
         * An officer sees the files they hold. Nothing else — not the
         * unassigned pool, and not even applications they filed themselves.
         *
         * §10 is the reason: the administrator assigns, and the assignment is
         * what starts the review — so a file nobody has been given is the
         * administrator's to see and nobody else's. A creator exception was
         * tried here and taken out on the firm's own instruction: an officer
         * who files an application hands it to the administrator like any
         * provider does, and it comes back into their view the moment it is
         * assigned to them.
         *
         * "Holds" is either assignment record — the client's list, which is
         * what the Assigned tab and §8's column read, or the application's own
         * workflow row; the picker writes both together, but a file must not
         * vanish from its officer because one half was written by an older
         * path.
         */
        if (CipAccess::isOfficer($user)) {
            return $query->where(function (Builder $q) use ($user) {
                $q->whereHas('assignments', fn ($a) => $a->live()->where('user_id', $user->id))
                    ->orWhereHas('client.assignments', fn ($a) => $a->live()->where('user_id', $user->id));
            });
        }

        if (Role::isStaff($user)) {
            return $query->whereRaw('1 = 0');
        }

        /*
         * External accounts: the provider-firm slice, plus their own record.
         *
         * Both columns are qualified. This scope is the base of every CIP
         * listing and a caller is free to join whatever it needs onto it —
         * client_assignments carries a client_id of its own, and an
         * unqualified one here made the whole query ambiguous the moment
         * somebody did.
         */
        return $query->where(function (Builder $q) use ($user) {
            $q->whereIn(
                'cip_applications.provider_id',
                CipProvider::query()
                    ->select('id')
                    ->whereIn(
                        'company_id',
                        CompanyMember::query()
                            ->select('company_id')
                            ->active()
                            ->where('user_id', $user->id)
                    )
            )->orWhereIn(
                'cip_applications.client_id',
                Client::query()->select('id')->where('user_id', $user->id)
            );
        });
    }

    /** Resolve one application by uuid within the viewer's slice, or 404. */
    public static function findOrFail(?User $user, string $uuid): CipApplication
    {
        return self::query($user)->where('uuid', $uuid)->firstOrFail();
    }
}
