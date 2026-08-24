<?php

namespace App\Support\Companies;

use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\CompanyStaffAssignment;
use App\Models\User;
use App\Support\Access\Role;

/**
 * The single answer to "what may this person do for this company?".
 *
 * Two very different people reach a company account and they must not be
 * conflated:
 *
 *  - the firm's own staff, whose reach comes from a CompanyStaffAssignment (or
 *    from being an administrator), and
 *  - the client's people, whose reach comes from a CompanyMember row and the
 *    `can_*` flags on it.
 *
 * Everything server-side asks this class, so "why can they see that?" has one
 * place to look, and the spec's rule that a company member is *not*
 * automatically a full-access user is enforced in exactly one spot.
 */
final class CompanyAccess
{
    /** This user's live membership of the company, if they have one. */
    public static function memberOf(User $user, Company $company): ?CompanyMember
    {
        return CompanyMember::active()
            ->where('company_id', $company->id)
            ->where('user_id', $user->id)
            ->first();
    }

    /** Every company this user is an active member of. */
    public static function companiesFor(User $user): array
    {
        return CompanyMember::active()
            ->where('user_id', $user->id)
            ->pluck('company_id')
            ->all();
    }

    /** This staff member's live assignment to the company, if any. */
    public static function staffAssignment(User $user, Company $company): ?CompanyStaffAssignment
    {
        if (! Role::isStaff($user)) {
            return null;
        }

        return CompanyStaffAssignment::live()
            ->where('company_id', $company->id)
            ->where('user_id', $user->id)
            ->first();
    }

    /** May this user see the company account at all? */
    public static function canView(User $user, Company $company): bool
    {
        if (Role::isAdmin($user)) {
            return true;
        }

        // Employees can reach the client hub, and the hub lists companies.
        if (Role::can($user, 'clients.viewAll')) {
            return true;
        }

        if (self::staffAssignment($user, $company) !== null) {
            return true;
        }

        return self::memberOf($user, $company) !== null;
    }

    /**
     * Does this user hold a company ability. `can_view_invoices` and friends?
     *
     * Staff are answered by their assignment rather than by member flags: they
     * are not members of the client's company, they look after it.
     */
    public static function can(User $user, Company $company, string $ability): bool
    {
        if (Role::isAdmin($user)) {
            return true;
        }

        if (Role::isStaff($user)) {
            $assignment = self::staffAssignment($user, $company);

            if ($assignment === null) {
                // An employee who can see every client can read the company,
                // but reading is as far as an unassigned person gets.
                return Role::can($user, 'clients.viewAll') && self::isReadOnly($ability);
            }

            // Signing is personal, an assignment never confers it.
            if ($ability === 'can_sign_contracts') {
                return false;
            }

            return self::staffLevelAllows($assignment->permission_level, $ability);
        }

        return self::memberOf($user, $company)?->can($ability) ?? false;
    }

    /** Refuse the request unless the user holds the company ability. */
    public static function authorize(User $user, Company $company, string $ability): void
    {
        abort_unless(self::can($user, $company, $ability), 403, 'You do not have access to this.');
    }

    /** Abilities that only read. */
    private static function isReadOnly(string $ability): bool
    {
        return in_array($ability, [
            'can_view_bookings', 'can_view_files', 'can_view_invoices', 'can_view_contracts',
        ], true);
    }

    /**
     * What a staff permission level lets someone do on the company record.
     * Mirrors the File Library ladder so a "view files" assignment cannot
     * quietly manage bookings.
     */
    private static function staffLevelAllows(string $level, string $ability): bool
    {
        $rank = ['view_only' => 1, 'view_files' => 2, 'contributor' => 3, 'editor' => 4, 'manager' => 5, 'full' => 6];
        $needed = [
            'can_view_bookings' => 2,
            'can_view_files' => 2,
            'can_view_invoices' => 2,
            'can_view_contracts' => 2,
            'can_upload_files' => 3,
            'can_manage_bookings' => 4,
            'can_invite_others' => 5,
        ];

        return ($rank[$level] ?? 0) >= ($needed[$ability] ?? 99);
    }

    /**
     * Every user id that should receive something addressed to a company role
     *, invoice recipients, contract signatories, booking updates.
     *
     * @return array<int, int>
     */
    public static function recipientsFor(Company $company, string $ability): array
    {
        return CompanyMember::active()
            ->where('company_id', $company->id)
            ->where($ability, true)
            ->pluck('user_id')
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    /**
     * The clients a staff member reaches through company assignments.
     *
     * `existing` and `existing_future` differ only in when they are evaluated:
     * a future-scoped assignment resolves against the company's contacts every
     * time it is asked, so a client added tomorrow is covered without anything
     * having to run. An `existing` assignment is pinned to the contacts that
     * were there when it was made.
     *
     * @return array<int, int> client ids
     */
    public static function clientIdsThroughCompanies(User $user): array
    {
        if (! Role::isStaff($user)) {
            return [];
        }

        $assignments = CompanyStaffAssignment::live()
            ->where('user_id', $user->id)
            ->get()
            ->filter(fn (CompanyStaffAssignment $a) => $a->reachesClients());

        $ids = [];

        foreach ($assignments as $assignment) {
            $query = Client::where('company_id', $assignment->company_id);

            if (! $assignment->reachesFutureClients()) {
                // Pinned: only the contacts that existed when it was made.
                $query->where('created_at', '<=', $assignment->created_at);
            }

            $ids = array_merge($ids, $query->pluck('id')->all());
        }

        return array_values(array_unique($ids));
    }

    /**
     * What would happen if this assignment were made, the preview the spec
     * insists an administrator sees before broad access is granted.
     *
     * @return array<string, mixed>
     */
    public static function previewReach(Company $company, string $appliesTo): array
    {
        $contacts = Client::where('company_id', $company->id)->count();
        $withLogins = Client::where('company_id', $company->id)->whereNotNull('user_id')->count();

        return [
            'appliesToClients' => $appliesTo,
            'label' => CompanyStaffAssignment::SCOPES[$appliesTo] ?? '',
            'companyName' => $company->name,
            'contactsCovered' => $appliesTo === CompanyStaffAssignment::SCOPE_COMPANY_ONLY ? 0 : $contacts,
            'contactsWithLogins' => $appliesTo === CompanyStaffAssignment::SCOPE_COMPANY_ONLY ? 0 : $withLogins,
            'includesFuture' => $appliesTo === CompanyStaffAssignment::SCOPE_EXISTING_FUTURE,
            'memberCount' => CompanyMember::current()->where('company_id', $company->id)->count(),
        ];
    }
}
