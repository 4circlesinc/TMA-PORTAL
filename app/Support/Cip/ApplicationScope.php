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
 * Which CIP applications an account may see, the row-level gate the module's
 * capability checks cannot provide.
 *
 * Administrators and officers see every application — the firm's book is
 * shared, assignment names who is working a file and fills their queue, it
 * does not hide the rest of the caseload. External accounts see exactly their
 * slice: a Service Provider contact (an active member of the firm a provider
 * is linked to) sees their firm's applications; a private client sees the
 * applications on their own client record. A parked Employee cannot reach the
 * portal and sees nothing here either.
 *
 * Use {@see self::query()} anywhere applications are listed, counted or
 * fetched; {@see self::findOrFail()} answers 404, never 403, so existence
 * never leaks (the ClientScope convention).
 */
class ApplicationScope
{
    /** @var array<int, list<int>> */
    private static array $visibleClientIds = [];

    /** An application query already narrowed to what this account may see. */
    public static function query(?User $user, ?Builder $base = null): Builder
    {
        $query = $base ?? CipApplication::query();

        // Module dark, or nobody signed in: no rows, not an error.
        if ($user === null || ! CipAccess::enabled()) {
            return $query->whereRaw('1 = 0');
        }

        /*
         * The people who work here. Administrators already held the book;
         * officers now read it too, assigned or not. Section 10 still has the
         * administrator hand a file to an officer to start the review, and
         * the dashboard queues still count only what that officer holds.
         * Seeing the rest of the firm is a separate question, and the firm
         * asked to share it.
         */
        if (Role::isAdmin($user) || CipAccess::isOfficer($user)) {
            return $query;
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

    /**
     * Client ids sitting on applications this account may see.
     *
     * The citizenship file is the application, but opening it still loads the
     * hub record and the client's document folder. Those surfaces used to
     * ask ClientScope / assignment, which hid a colleague's filing the
     * officer could already see on the caseload. One query, memoised: folder
     * access asks this per folder, and four queries on every Documents tab
     * would be the same cost FolderAccess already refused.
     *
     * @return list<int>
     */
    public static function visibleClientIds(?User $user): array
    {
        if ($user === null) {
            return [];
        }

        $uid = (int) $user->id;
        if (array_key_exists($uid, self::$visibleClientIds)) {
            return self::$visibleClientIds[$uid];
        }

        return self::$visibleClientIds[$uid] = self::query($user)
            ->whereNotNull('cip_applications.client_id')
            ->pluck('cip_applications.client_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
    }

    public static function forget(): void
    {
        self::$visibleClientIds = [];
    }

    /** Resolve one application by uuid within the viewer's slice, or 404. */
    public static function findOrFail(?User $user, string $uuid): CipApplication
    {
        return self::query($user)->where('uuid', $uuid)->firstOrFail();
    }
}
