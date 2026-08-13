<?php

namespace App\Support\Cip;

use App\Models\CipOfficerRole;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;

/**
 * Who may do what inside the CIP module.
 *
 * The account-type matrix (Role) cannot tell a CRO from any other employee —
 * capabilities there resolve per account type, and officer-ness is a per-user
 * fact. So officer grants live in cip_officer_roles and this class is the one
 * reader: Role answers the baseline (admins hold everything, subject to
 * FEATURE_CIP), the grant rows widen specific employees into officers.
 *
 * The precedent is CompanyAccess — a domain authority Role does not know
 * about. Ask this class, never the table.
 */
class CipAccess
{
    public const REVIEWING_OFFICER = 'reviewing_officer';

    public const COMPLIANCE_OFFICER = 'compliance_officer';

    /** role => label, the vocabulary the admin form offers. */
    public const ROLES = [
        self::REVIEWING_OFFICER => 'CRO / Reviewing Officer',
        self::COMPLIANCE_OFFICER => 'Compliance Officer',
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
     * Does this user hold the capability, counting officer grants? Role::can
     * already answers admins (and the FEATURE_CIP dark switch); this widens
     * the answer for employees holding an officer role.
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

    /** @return list<string> */
    public static function officerRoles(User $user): array
    {
        return self::$rolesByUser[$user->id] ??= CipOfficerRole::query()
            ->where('user_id', $user->id)
            ->pluck('role')
            ->all();
    }

    public static function grant(User $user, string $role, ?User $by = null): CipOfficerRole
    {
        if (! array_key_exists($role, self::ROLES)) {
            throw new \InvalidArgumentException('Unknown CIP officer role: '.$role);
        }

        if (! Role::isStaff($user)) {
            throw new \InvalidArgumentException('Only staff accounts can hold a CIP officer role.');
        }

        $grant = CipOfficerRole::firstOrCreate(
            ['user_id' => $user->id, 'role' => $role],
            ['granted_by' => $by?->id],
        );

        if ($grant->wasRecentlyCreated) {
            self::forget($user);
            ActivityLogger::log([
                'actor' => $by,
                'type' => 'cip.officer_granted',
                'module' => 'cip',
                'description' => $user->name.' was made '.self::ROLES[$role],
                'subject' => $user,
            ]);
        }

        return $grant;
    }

    public static function revoke(User $user, string $role, ?User $by = null): void
    {
        $removed = CipOfficerRole::query()
            ->where('user_id', $user->id)
            ->where('role', $role)
            ->delete();

        if ($removed > 0) {
            self::forget($user);
            ActivityLogger::log([
                'actor' => $by,
                'type' => 'cip.officer_revoked',
                'module' => 'cip',
                'description' => $user->name.' is no longer '.(self::ROLES[$role] ?? $role),
                'subject' => $user,
            ]);
        }
    }

    /** Drop the per-request memo after a grant change. */
    public static function forget(?User $user = null): void
    {
        if ($user === null) {
            self::$rolesByUser = [];
        } else {
            unset(self::$rolesByUser[$user->id]);
        }
    }
}
