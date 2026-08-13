<?php

namespace App\Support\Cip;

use App\Models\User;
use App\Support\Access\Role;

/**
 * Who may do what inside the CIP module.
 *
 * Officer-ness is the account type: "Reviewing Officer" (the brief's CRO /
 * Reviewing Officer) and "Compliance Officer" sit beside Employee in the
 * Users page dropdown. Both carry the full Employee baseline everywhere in
 * the portal — the officer types only decide what they may do INSIDE the
 * CIP module, and that mapping lives in Role::MATRIX:
 *
 *   Reviewing Officer  — cip.review (assess documents, issue comments,
 *                        request updates, approve documents for submission)
 *   Compliance Officer — cip.compliance + cip.decide (process submissions,
 *                        update statuses, record decisions)
 *
 * This class is the module's one question-answering surface so callers never
 * compare account-type strings themselves.
 */
class CipAccess
{
    public const REVIEWING_OFFICER = 'reviewing_officer';

    public const COMPLIANCE_OFFICER = 'compliance_officer';

    /** officer role => the account type that carries it. */
    private const ROLE_ACCOUNT_TYPES = [
        self::REVIEWING_OFFICER => Role::REVIEWING_OFFICER,
        self::COMPLIANCE_OFFICER => Role::COMPLIANCE_OFFICER,
    ];

    public static function enabled(): bool
    {
        return (bool) config('services.cip.enabled');
    }

    /**
     * Does this user hold the capability? Role::can already answers
     * everything — the matrix rows carry the officer types, the baseline
     * fallback carries their employee reach, and the FEATURE_CIP check
     * darkens it all — this wrapper only spares callers the import.
     */
    public static function can(?User $user, string $capability): bool
    {
        return Role::can($user, $capability);
    }

    /** Is this user an officer at all — or of the given role specifically? */
    public static function isOfficer(?User $user, ?string $role = null): bool
    {
        if ($user === null || ! self::enabled()) {
            return false;
        }

        if ($role !== null) {
            return Role::of($user) === (self::ROLE_ACCOUNT_TYPES[$role] ?? null);
        }

        return in_array(Role::of($user), self::ROLE_ACCOUNT_TYPES, true);
    }

    /**
     * The officer roles this user holds.
     *
     * @return list<string>
     */
    public static function officerRoles(User $user): array
    {
        if (! self::enabled()) {
            return [];
        }

        $roles = array_keys(self::ROLE_ACCOUNT_TYPES, Role::of($user), true);

        return array_values($roles);
    }
}
