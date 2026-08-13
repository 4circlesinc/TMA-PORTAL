<?php

namespace App\Support\Cip;

use App\Models\CompanyStaffAssignment;
use App\Models\User;
use App\Support\Access\Role;

/**
 * Who may do what inside the CIP module.
 *
 * The account-type matrix (Role) cannot tell a CRO from any other employee —
 * capabilities there resolve per account type, and officer-ness is a per-user
 * fact. Officer-ness lives where the rest of the portal already keeps access:
 * a live staff assignment on a service provider (a company record) carrying
 * one of the officer roles from ClientAssignment::ROLES. Assign Krishna to
 * Galaxy as "CRO / Reviewing officer" on the provider page and she is an
 * officer; end the assignment and she is not. There is no separate grant
 * store, no separate screen, and suspension settles it through AccessSync
 * like every other assignment.
 *
 * Ask this class, never the tables.
 */
class CipAccess
{
    public const REVIEWING_OFFICER = 'reviewing_officer';

    public const COMPLIANCE_OFFICER = 'compliance_officer';

    /** role => label, as offered by the assignment dialogs. */
    public const ROLES = [
        self::REVIEWING_OFFICER => 'CRO / Reviewing officer',
        self::COMPLIANCE_OFFICER => 'Compliance officer',
    ];

    /** What each officer role adds on top of the employee baseline. */
    private const ROLE_CAPABILITIES = [
        self::REVIEWING_OFFICER => ['cip.review'],
        self::COMPLIANCE_OFFICER => ['cip.compliance', 'cip.decide'],
    ];

    /** Per-request memo so a page render asks the table once per user. */
    private static array $rolesByUser = [];

    public static function enabled(): bool
    {
        return (bool) config('services.cip.enabled');
    }

    /**
     * Does this user hold the capability, counting officer assignments?
     * Role::can already answers admins (and the FEATURE_CIP dark switch);
     * this widens the answer for staff holding a live officer assignment.
     */
    public static function can(?User $user, string $capability): bool
    {
        if ($user === null || ! self::enabled()) {
            return false;
        }

        if (Role::can($user, $capability)) {
            return true;
        }

        if (! Role::isStaff($user)) {
            return false;
        }

        foreach (self::officerRoles($user) as $role) {
            if (in_array($capability, self::ROLE_CAPABILITIES[$role] ?? [], true)) {
                return true;
            }
        }

        return false;
    }

    /** Is this user an officer at all — or of the given role specifically? */
    public static function isOfficer(?User $user, ?string $role = null): bool
    {
        if ($user === null || ! self::enabled() || ! Role::isStaff($user)) {
            return false;
        }

        $roles = self::officerRoles($user);

        return $role === null ? $roles !== [] : in_array($role, $roles, true);
    }

    /**
     * The officer roles this user holds right now — distinct roles across
     * every live service-provider assignment.
     *
     * @return list<string>
     */
    public static function officerRoles(User $user): array
    {
        return self::$rolesByUser[$user->id] ??= CompanyStaffAssignment::query()
            ->live()
            ->where('user_id', $user->id)
            ->whereIn('role', array_keys(self::ROLES))
            ->distinct()
            ->pluck('role')
            ->all();
    }

    /** Drop the per-request memo after an assignment change. */
    public static function forget(?User $user = null): void
    {
        if ($user === null) {
            self::$rolesByUser = [];
        } else {
            unset(self::$rolesByUser[$user->id]);
        }
    }
}
