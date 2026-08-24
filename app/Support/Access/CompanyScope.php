<?php

namespace App\Support\Access;

use App\Models\Company;
use App\Models\CompanyStaffAssignment;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

/**
 * Which company records, service providers, a staff account may see.
 *
 * Clients have been assignment-scoped since ClientScope existed, but the
 * companies listing served the whole directory to every staff account from
 * one cache. Now that companies are the service providers of the CIP
 * practice, the same rule applies to them: holders of `clients.viewAll`
 * (administrators) see everything, everyone else sees the providers they
 * hold a *live* staff assignment on, the same rows that drive what they may
 * do on the provider page, so what they can open and what they can find
 * agree.
 *
 * Use {@see self::query()} anywhere a person is browsing or being shown
 * companies; {@see self::findOrFail()} answers 404, never 403, so an
 * employee cannot use the error to learn that a provider exists.
 */
class CompanyScope
{
    /** A company query already narrowed to what this account may see. */
    public static function query(?User $user, ?Builder $base = null): Builder
    {
        $query = $base ?? Company::query();

        if (self::seesEveryCompany($user)) {
            return $query;
        }

        if ($user === null) {
            return $query->whereRaw('1 = 0');
        }

        return $query->whereIn(
            $query->getModel()->getQualifiedKeyName(),
            CompanyStaffAssignment::query()
                ->select('company_id')
                ->live()
                ->where('user_id', $user->id)
        );
    }

    /** Does this account see the whole directory rather than its own slice? */
    public static function seesEveryCompany(?User $user): bool
    {
        return Role::can($user, 'clients.viewAll');
    }

    /** Resolve one company by uid within the viewer's slice, or 404. */
    public static function findOrFail(?User $user, string $uid): Company
    {
        return self::query($user)->where('uid', $uid)->firstOrFail();
    }
}
