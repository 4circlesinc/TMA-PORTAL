<?php

namespace App\Support\Access;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

/**
 * Which client records a given account may see.
 *
 * `clients.viewAll` existed in the matrix from the start with a comment saying
 * that moving it to `[]` would scope employees to their own assignments. That
 * was not true: nothing read the capability, so every query listed every
 * client and flipping the row would have changed nothing while looking like it
 * had. This is the enforcement that comment promised.
 *
 * Holders of `clients.viewAll` (administrators) see everything. Everyone else
 * sees the clients they hold a *live* assignment on — the same rows that
 * already drive folder access, so what an employee can open and what they can
 * find now agree.
 *
 * Use {@see self::query()} rather than `Client::query()` anywhere a person is
 * choosing, browsing or being shown clients.
 */
class ClientScope
{
    /** A client query already narrowed to what this account may see. */
    public static function query(?User $user, ?Builder $base = null): Builder
    {
        $query = $base ?? Client::query();

        if (self::seesEveryClient($user)) {
            return $query;
        }

        if ($user === null) {
            return $query->whereRaw('1 = 0');
        }

        // whereIn + subquery rather than whereHas: the planner can use the
        // assignment index directly, and eleven-thousand-row directories stop
        // paying for a correlated EXISTS per candidate row.
        return $query->whereIn(
            $query->getModel()->getQualifiedKeyName(),
            ClientAssignment::query()
                ->select('client_id')
                ->live()
                ->where('user_id', $user->id)
        );
    }

    /** Does this account see the whole client list rather than its own slice? */
    public static function seesEveryClient(?User $user): bool
    {
        return Role::can($user, 'clients.viewAll');
    }

    /**
     * Resolve one client by uid, or fail — 404 rather than 403, so an employee
     * cannot use the error to learn that a client they may not see exists.
     */
    public static function findOrFail(?User $user, string $uid): Client
    {
        return self::query($user)->where('uid', $uid)->firstOrFail();
    }
}
