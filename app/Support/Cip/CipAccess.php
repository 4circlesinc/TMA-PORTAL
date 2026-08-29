<?php

namespace App\Support\Cip;

use App\Models\CipProvider;
use App\Models\Client;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;

/**
 * Who may do what inside the CIP module.
 *
 * Officer-ness is the account type: "CRO / Reviewing officer" sits beside
 * Administrator in the Users page dropdown. Officers carry the full Employee
 * baseline everywhere in the portal, the type only decides what they may do
 * INSIDE the CIP module, and that mapping lives in Role::MATRIX:
 *
 *   CRO / Reviewing officer, cip.review (assess documents, issue comments,
 *                             request updates, approve documents) plus
 *                             cip.compliance + cip.decide (process submissions,
 *                             update statuses, record decisions)
 *
 * On a given application the Administrator still assigns a reviewing-officer
 * or compliance-officer *job*; both jobs are held by the same account type.
 *
 * This class is the module's one question-answering surface so callers never
 * compare account-type strings themselves.
 */
class CipAccess
{
    public const REVIEWING_OFFICER = 'reviewing_officer';

    public const COMPLIANCE_OFFICER = 'compliance_officer';

    /**
     * CIP assignment job => the account type that may hold it.
     *
     * Both jobs map to the one officer account type.
     */
    private const ROLE_ACCOUNT_TYPES = [
        self::REVIEWING_OFFICER => Role::REVIEWING_OFFICER,
        self::COMPLIANCE_OFFICER => Role::REVIEWING_OFFICER,
    ];

    public static function enabled(): bool
    {
        return (bool) config('services.cip.enabled');
    }

    /**
     * Does this user hold the capability? Role::can already answers
     * everything, the matrix rows carry the officer type, the baseline
     * fallback carries their employee reach, and the FEATURE_CIP check
     * darkens it all, this wrapper only spares callers the import.
     */
    public static function can(?User $user, string $capability): bool
    {
        return Role::can($user, $capability);
    }

    /**
     * May this account reach the module at all?
     *
     * Staff are answered by the capability matrix. External accounts never
     * hold a matrix capability, that is a portal-wide invariant, so the
     * brief's two external types are answered by what they ARE in the Client
     * Hub: a Service Provider contact is an active member of a firm that
     * carries a CIP code; a Private Client is somebody with a client record.
     * Both are promised "create and manage applications" and "view status",
     * so neither can be gated on a capability they are not allowed to hold.
     */
    public static function canReach(?User $user): bool
    {
        if ($user === null || ! self::enabled()) {
            return false;
        }

        if (Role::isStaff($user)) {
            // A parked Employee cannot reach the portal at all, so the module
            // must not claim otherwise.
            return Role::of($user) !== Role::EMPLOYEE && Role::can($user, 'cip.view');
        }

        return self::isProviderContact($user) || self::isPrivateClient($user);
    }

    /**
     * May this account start an application? Staff need the capability;
     * both external types are promised it by §1 of the brief.
     */
    public static function canCreate(?User $user): bool
    {
        if ($user === null || ! self::enabled()) {
            return false;
        }

        return Role::isStaff($user)
            ? Role::of($user) !== Role::EMPLOYEE && Role::can($user, 'cip.create')
            : self::canReach($user);
    }

    /** An active member of a firm registered as a CIP service provider. */
    public static function isProviderContact(User $user): bool
    {
        return CompanyMember::query()
            ->active()
            ->where('user_id', $user->id)
            ->whereIn('company_id', CipProvider::query()->select('company_id')->whereNotNull('company_id'))
            ->exists();
    }

    /** Somebody the firm holds a client record for. */
    public static function isPrivateClient(User $user): bool
    {
        return Client::query()->where('user_id', $user->id)->exists();
    }

    /** Is this user an officer at all, or of the given role specifically? */
    public static function isOfficer(?User $user, ?string $role = null): bool
    {
        if ($user === null || ! self::enabled()) {
            return false;
        }

        if ($role !== null) {
            return Role::of($user) === (self::ROLE_ACCOUNT_TYPES[$role] ?? null);
        }

        return Role::of($user) === Role::REVIEWING_OFFICER;
    }

    /**
     * May this account drive application workflow status changes?
     *
     * Administrators and CRO / Reviewing officers only. Service provider
     * contacts and private clients may create, edit, and upload documents,
     * but they must not move an application through the lifecycle.
     */
    public static function canChangeApplicationStatus(?User $user): bool
    {
        if ($user === null || ! self::enabled()) {
            return false;
        }

        return Role::isAdmin($user) || self::isOfficer($user);
    }

    /**
     * May this account pull a status backwards, or jump off the lifecycle map?
     *
     * Officers and other staff may only drive the next mapped step. Going
     * from Approved back to Assessment Feedback (or any other earlier
     * status) is an administrator override.
     */
    public static function canOverrideStatus(?User $user): bool
    {
        if ($user === null || ! self::enabled()) {
            return false;
        }

        return Role::isAdmin($user);
    }

    /**
     * The officer roles this user holds.
     *
     * @return list<string>
     */
    public static function officerRoles(User $user): array
    {
        if (! self::enabled() || Role::of($user) !== Role::REVIEWING_OFFICER) {
            return [];
        }

        return [self::REVIEWING_OFFICER, self::COMPLIANCE_OFFICER];
    }
}
