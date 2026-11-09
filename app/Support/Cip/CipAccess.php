<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
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
     * both external types are promised it by section 1 of the brief.
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

    /**
     * May this account edit the people on a post-approval file?
     *
     * Wider than {@see canCreate} on purpose. Filing an application is a
     * considered act and stays with the officers who own the lifecycle; a
     * post-approval file is one the firm is working through together, and
     * correcting a name or a date of birth on it is ordinary work that should
     * not wait for whoever happens to hold cip.create. So the whole firm may
     * do it — administrators, officers, and employees.
     *
     * The service provider side may not, and that is the point of the rule
     * rather than an omission: they filed the application, the firm carries it
     * from the decision onward, and a field changing under the firm without
     * their knowing is exactly what this keeps from happening. They still
     * edit their own pre-approval work through {@see canCreate}.
     */
    public static function canEditPostApprovalPeople(?User $user): bool
    {
        if ($user === null || ! self::enabled()) {
            return false;
        }

        return Role::isStaff($user);
    }

    /**
     * May this account save the intake form for this application?
     *
     * A draft is still being filed, so whoever may create one may keep
     * typing it. A filed pre-approval application stays with them too.
     * A filed post-approval file is the firm's working file: staff may
     * edit it (an administrator fully, everyone else except identity),
     * and the service provider side may not.
     */
    public static function canEditApplication(?User $user, CipApplication $application): bool
    {
        if ($user === null || ! self::enabled()) {
            return false;
        }

        if ($application->status === Status::DRAFT) {
            return self::canCreate($user);
        }

        if (($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL) {
            return self::canEditPostApprovalPeople($user);
        }

        return self::canCreate($user);
    }

    /** An active member of a firm registered as a CIP service provider. */
    public static function isProviderContact(User $user): bool
    {
        $companyIds = CompanyMember::query()
            ->active()
            ->where('user_id', $user->id)
            ->pluck('company_id');

        if ($companyIds->isEmpty()) {
            return false;
        }

        if (CipProvider::query()->whereIn('company_id', $companyIds)->whereNotNull('company_id')->exists()) {
            return true;
        }

        // A Service Provider admin still reaches CIP when their firm has no
        // provider row yet — they land on the company page, not an application.
        return Role::isServiceProviderAdmin($user);
    }

    /**
     * May this account open the Workflows section?
     *
     * The matrix grants it to staff. Service-provider contacts reach the same
     * inbox — requests and comments on the client files their firm filed —
     * without holding `workflows.view`, which would also open it to every
     * other Client account.
     */
    public static function canViewWorkflows(?User $user): bool
    {
        if ($user === null) {
            return false;
        }

        return Role::can($user, 'workflows.view') || self::isProviderContact($user);
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
     * May this account take an application off the caseload?
     *
     * A draft is unfinished work the person typing it — or staff looking at
     * the table — may throw away. A numbered application is a file: only
     * staff who can create applications may remove one they can see, and the
     * client it belongs to stays. Provider contacts and private clients
     * file and upload; they do not delete a filed file.
     */
    public static function canDelete(?User $user, CipApplication $application): bool
    {
        if ($user === null || ! self::enabled()) {
            return false;
        }

        // Administrators see every file and may take any of them off the
        // caseload. Asked on every table row, so this must not become a
        // capability lookup per application.
        if (Role::isAdmin($user)) {
            return true;
        }

        if (! self::canCreate($user)) {
            return false;
        }

        // A draft is the work of whoever started it. Colleagues may open and
        // edit it, but only its creator (or an administrator, above) may
        // throw it away. A filed application is the firm's record: only an
        // administrator deletes it, and everyone else asks one to
        // (see canRequestDeletion).
        if ($application->status === Status::DRAFT) {
            return (int) $application->created_by === (int) $user->id;
        }

        return false;
    }

    /**
     * May this account ask an administrator to delete a filed application?
     *
     * Staff and the provider side, on a file they can see (the caller checks
     * reach through ApplicationScope; a provider may ask about a
     * post-approval file even though they may not edit it). Not an
     * administrator, who deletes it instead, and never a draft, which its
     * creator deletes without asking.
     */
    public static function canRequestDeletion(?User $user, CipApplication $application): bool
    {
        if ($user === null || ! self::enabled() || Role::isAdmin($user)) {
            return false;
        }
        if ($application->trashed() || $application->status === Status::DRAFT) {
            return false;
        }

        return self::canCreate($user);
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
     * Administrators only, in both lanes — the application's status and each
     * person's post-approval status. CRO / Reviewing officers drive the next
     * mapped step like everyone who may change status, and see the rest of
     * the lifecycle locked; moving a file anywhere else is an administrator's
     * call, logged as an override. Assigning who holds the file is
     * administrators' too.
     */
    public static function canOverrideStatus(?User $user): bool
    {
        if ($user === null || ! self::enabled()) {
            return false;
        }

        return Role::isAdmin($user);
    }

    /**
     * May this account read a document warning and carry on past it?
     *
     * Carrying a file past an unfinished checklist is an override, so it is
     * the administrators' alone, like every other override: they are shown
     * what is missing and may continue; everyone else is told to finish the
     * documents first.
     */
    public static function canAcknowledgeBlockers(?User $user, string $to): bool
    {
        return self::canOverrideStatus($user);
    }

    /**
     * May this account type in or replace the Unit's CIP number at any stage?
     *
     * The number normally arrives with the submission verb. An administrator
     * may enter it whenever it turns up — before the file reached Pending
     * Review, on a file brought in from elsewhere, on one whose submission
     * was recorded without it. Correcting a number that is already on the
     * file stays with the compliance officers who record submissions.
     */
    public static function canAssignCipNumber(?User $user): bool
    {
        if ($user === null || ! self::enabled()) {
            return false;
        }

        return Role::isAdmin($user);
    }

    /**
     * May this account hand a filed application to a different service provider?
     *
     * Administrators only. The move reparents the client folder and cuts the
     * outgoing firm off the file and its papers — not a day-to-day action.
     */
    public static function canTransferProvider(?User $user): bool
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
