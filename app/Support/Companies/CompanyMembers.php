<?php

namespace App\Support\Companies;

use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\Pages;
use App\Support\Invitations\Invitations;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Messaging\ClientConversations;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Str;

/**
 * Adding people to a company account, inviting them, and taking access away.
 *
 * A member row is created first and the invitation second, so the company can
 * be set up in full before anyone is emailed, and so an administrator can see
 * who is *meant* to have access, not only who has accepted.
 */
final class CompanyMembers
{
    /**
     * Add someone to a company. Links an existing account when the address
     * already has one, so nobody ends up with two.
     *
     * @param  array<string, mixed>  $attrs
     */
    public static function add(Company $company, array $attrs, User $by, bool $notify = true): CompanyMember
    {
        $email = isset($attrs['email']) ? Str::lower(trim($attrs['email'])) : null;
        $role = $attrs['role'] ?? CompanyRoles::MEMBER;

        $existingUser = $email ? User::where('email', $email)->first() : null;

        // Re-adding somebody who was removed revives their row rather than
        // stacking a second membership.
        $member = CompanyMember::where('company_id', $company->id)
            ->where(function ($q) use ($email, $existingUser) {
                if ($existingUser) {
                    $q->orWhere('user_id', $existingUser->id);
                }
                if ($email) {
                    $q->orWhereRaw('LOWER(email) = ?', [$email]);
                }
            })
            ->latest('id')
            ->first() ?? new CompanyMember;

        $userId = self::liveUserId($existingUser, $member);

        $member->forceFill(array_merge([
            'company_id' => $company->id,
            'user_id' => $userId,
            'client_id' => $attrs['client_id'] ?? $member->client_id,
            'name' => $attrs['name'] ?? $member->name,
            'email' => $email ?? $member->email,
            'job_title' => $attrs['job_title'] ?? $member->job_title,
            'role' => $role,
            'is_primary' => (bool) ($attrs['is_primary'] ?? $member->is_primary ?? false),
            // An account that already exists is active straight away; anyone
            // else stays `invited` until they accept. A Recycle Bin or purged
            // login is not an account.
            'status' => $userId
                ? CompanyMember::STATUS_ACTIVE
                : CompanyMember::STATUS_INVITED,
            'added_by' => $member->added_by ?? $by->id,
            'removed_at' => null,
            'removed_by' => null,
        ], CompanyRoles::resolve($role, $attrs)))->save();

        if ($member->is_primary) {
            self::makePrimary($company, $member);
        }

        if ($userId && ($linked = User::find($userId))) {
            ContactIdentity::relink($member, $linked);
        }

        ActivityLogger::log([
            'actor' => $by,
            'type' => 'company.member_added',
            'module' => 'clients',
            'description' => $by->name.' added '.$member->displayName().' to '.$company->name
                .' as '.$member->roleLabel(),
            'subject' => $company,
            'metadata' => ['companyUid' => $company->uid, 'role' => $member->role],
        ]);

        $member->unsetRelation('user');
        if ($member->user) {
            if ($notify) {
                self::mailAdded($company, $member, $by);
            }
            ClientConversations::attachLogin($member->user);
        }

        return $member->fresh();
    }

    /**
     * Whether this address can receive a company invitation.
     *
     * A Recycle Bin account still occupies `users.email`, so a new signup
     * cannot take it. Sending an invite that cannot be accepted looks like
     * the mail never arrived.
     */
    public static function assertInvitable(?string $email): void
    {
        $email = $email ? Str::lower(trim($email)) : '';
        abort_if($email === '', 422, 'Add an email address before inviting them.');

        abort_if(
            User::onlyTrashed()->where('email', $email)->exists(),
            422,
            'This address belongs to a deleted account. Restore it from the Recycle Bin first.',
        );
    }

    /**
     * Invite a member who has no account yet.
     */
    public static function invite(Company $company, CompanyMember $member, User $by): Invitation
    {
        $email = $member->displayEmail();
        abort_if(! $email, 422, 'Add an email address before inviting them.');
        abort_if($member->hasLiveAccount(), 422, 'This person already has portal access.');
        self::assertInvitable($email);

        [$invitation] = Invitations::issue([
            'type' => Invitation::TYPE_COMPANY_MEMBER,
            'email' => $email,
            'name' => $member->name,
            'client_id' => $member->client_id,
            'company_id' => $company->id,
            'role' => 'Client',
            'access' => [
                'companyRole' => $member->roleLabel(),
                'companyMemberUuid' => $member->uuid,
            ],
            'invited_by' => $by->id,
        ]);

        Invitations::send($invitation);
        $invitation = $invitation->fresh() ?? $invitation;

        abort_if(
            $invitation->status === Invitation::STATUS_FAILED,
            422,
            $invitation->last_error ?: 'The invitation email could not be sent.',
        );

        ActivityLogger::log([
            'actor' => $by,
            'type' => 'company.member_invited',
            'module' => 'clients',
            'description' => $by->name.' invited '.$email.' to '.$company->name,
            'subject' => $company,
            'metadata' => ['companyUid' => $company->uid, 'invitationId' => $invitation->uuid],
        ]);

        return $invitation;
    }

    /**
     * Attach an accepted invitation to its company membership. Called from the
     * invitation flow, which is the only thing that knows the account is real.
     */
    public static function linkAcceptedUser(Invitation $invitation, User $user): void
    {
        if ($invitation->type !== Invitation::TYPE_COMPANY_MEMBER || ! $invitation->company_id) {
            return;
        }

        $member = CompanyMember::where('company_id', $invitation->company_id)
            ->where(function ($q) use ($invitation) {
                $q->where('uuid', $invitation->access['companyMemberUuid'] ?? '')
                    ->orWhereRaw('LOWER(email) = ?', [Str::lower($invitation->email)]);
            })
            ->first();

        if (! $member) {
            return;
        }

        $member->forceFill([
            'user_id' => $user->id,
            'status' => CompanyMember::STATUS_ACTIVE,
            'name' => $user->name ?: $member->name,
        ])->save();

        ContactIdentity::relink($member, $user);

        ClientConversations::attachLogin($user);
    }

    /** Change a member's role, reseeding their permissions from it. */
    public static function changeRole(Company $company, CompanyMember $member, string $role, User $by, array $overrides = []): CompanyMember
    {
        $was = $member->role;

        $member->forceFill(array_merge(
            ['role' => $role],
            CompanyRoles::resolve($role, $overrides),
        ))->save();

        ActivityLogger::log([
            'actor' => $by,
            'type' => 'company.role_changed',
            'module' => 'clients',
            'description' => $by->name.' changed '.$member->displayName().' at '.$company->name
                .' to '.$member->roleLabel(),
            'subject' => $company,
            'old' => ['role' => $was],
            'new' => ['role' => $role],
        ]);

        if ($member->user) {
            Notifier::send([
                'user' => $member->user,
                'actor' => $by,
                'type' => 'company.role_changed',
                'title' => 'Your role at '.$company->name.' changed',
                'message' => 'You are now '.$member->roleLabel().'.',
                'subject' => $company,
            ]);
        }

        return $member->fresh();
    }

    /**
     * Take a member's access away.
     *
     * A member who held an account keeps their row as a record — provider
     * history binds to it. An invite that never became an account has no
     * history worth keeping: the row goes entirely and its invitation is
     * cancelled, so re-entering the same address later starts clean instead
     * of reviving a stale name.
     */
    public static function remove(Company $company, CompanyMember $member, User $by, bool $notify = true): CompanyMember
    {
        if (! $member->user_id) {
            Invitation::query()
                ->where('type', Invitation::TYPE_COMPANY_MEMBER)
                ->where('company_id', $company->id)
                ->whereRaw('LOWER(email) = ?', [Str::lower((string) $member->displayEmail())])
                ->whereIn('status', Invitation::LIVE_STATUSES)
                ->get()
                ->each(fn (Invitation $invitation) => Invitations::cancel($invitation, $by));

            ActivityLogger::log([
                'actor' => $by,
                'type' => 'company.member_removed',
                'module' => 'clients',
                'description' => $by->name.' removed '.$member->displayName().' from '.$company->name,
                'subject' => $company,
                'metadata' => ['companyUid' => $company->uid],
            ]);

            $member->delete();

            return $member;
        }

        $member->forceFill([
            'status' => CompanyMember::STATUS_REMOVED,
            'is_primary' => false,
            'removed_at' => now(),
            'removed_by' => $by->id,
        ])->save();

        ActivityLogger::log([
            'actor' => $by,
            'type' => 'company.member_removed',
            'module' => 'clients',
            'description' => $by->name.' removed '.$member->displayName().' from '.$company->name,
            'subject' => $company,
            'metadata' => ['companyUid' => $company->uid],
        ]);

        if ($member->user && $notify) {
            self::mailRemoved($company, $member, $by);
        }

        return $member->fresh();
    }

    /**
     * Place an existing account at a CIP service provider firm.
     *
     * One firm at a time: they leave any other provider firm without the
     * generic removed notice, and the dedicated added or switched postcard
     * is what they receive — never the company-member copy, and never a
     * combined "added or switched" letter.
     */
    public static function assignToProvider(Company $company, User $user, User $by, bool $asAdmin): void
    {
        $previous = CompanyMember::query()
            ->active()
            ->where('user_id', $user->id)
            ->whereHas(
                'company.cipProvider',
                fn ($q) => $q->where('active', true)->whereNotNull('company_id'),
            )
            ->with('company:id,uid,name')
            ->get();

        $alreadyHere = $previous->first(fn (CompanyMember $member) => $member->company_id === $company->id);
        $leaving = $previous->filter(fn (CompanyMember $member) => $member->company_id !== $company->id);

        foreach ($leaving as $member) {
            $from = $member->company ?? Company::query()->find($member->company_id);
            if ($from) {
                self::remove($from, $member, $by, notify: false);
            }
        }

        if (! $alreadyHere) {
            self::add($company, [
                'email' => $user->email,
                'name' => $user->name,
                'role' => CompanyRoles::MEMBER,
            ], $by, notify: false);
        }

        $switched = $leaving->isNotEmpty();
        if (! $switched && $alreadyHere) {
            return;
        }

        $previousCompany = $leaving
            ->map(fn (CompanyMember $member) => $member->company?->name)
            ->filter()
            ->unique()
            ->values()
            ->implode(', ');

        self::mailProviderAssigned(
            $company,
            $user,
            $by,
            $asAdmin,
            $switched,
            $previousCompany !== '' ? $previousCompany : null,
        );
    }

    /**
     * A Service Provider admin adding an existing portal account at their
     * firm. Same added-as-contact letter as the Users-page assignment, never
     * the generic company-member copy.
     */
    public static function notifyProviderContactAdded(Company $company, CompanyMember $member, User $by): void
    {
        $user = $member->user;
        if (! $user) {
            return;
        }

        self::mailProviderAssigned($company, $user, $by, asAdmin: false, switched: false, previousCompany: null);
    }

    /** Exactly one primary contact per company. */
    public static function makePrimary(Company $company, CompanyMember $member): void
    {
        CompanyMember::where('company_id', $company->id)
            ->where('id', '!=', $member->id)
            ->update(['is_primary' => false]);

        if (! $member->is_primary) {
            $member->forceFill(['is_primary' => true])->save();
        }
    }

    /**
     * Turn a client-hub contact into a company member, so staff do not retype
     * details the client record already holds.
     */
    public static function fromClient(Company $company, Client $client, string $role, User $by): CompanyMember
    {
        return self::add($company, [
            'client_id' => $client->id,
            'name' => $client->name,
            'email' => $client->email,
            'role' => $role,
        ], $by);
    }

    /**
     * Keep the Access row when a login is purged. The membership used to
     * cascade away with the user, so staff had to retype the address to invite
     * them as a new account.
     *
     * What it must not do is hand the company back. Access that had already
     * been taken away — including the removal `AccessSync` performs when the
     * account is moved to the Recycle Bin — stays taken away, so emptying the
     * bin cannot resurrect somebody in the Access list as freshly invited.
     */
    public static function parkForPurgedLogin(User $user): void
    {
        CompanyMember::where('user_id', $user->id)->get()->each(function (CompanyMember $member) use ($user) {
            $member->forceFill([
                'user_id' => null,
                'status' => $member->isRemoved()
                    ? CompanyMember::STATUS_REMOVED
                    : CompanyMember::STATUS_INVITED,
                'email' => $member->email ?: $user->email,
                'name' => $member->name ?: $user->name,
            ])->save();
        });
    }

    /**
     * A live login to attach, never a Recycle Bin row or a pointer at a user
     * who has already been purged.
     */
    private static function liveUserId(?User $existingUser, CompanyMember $member): ?int
    {
        if ($existingUser) {
            return $existingUser->id;
        }

        if (! $member->exists || ! $member->user_id) {
            return null;
        }

        return User::whereKey($member->user_id)->exists() ? $member->user_id : null;
    }

    /**
     * Bell + postcard when an existing account is added. The dedicated
     * postcard is the email: access changes must arrive even if the person is
     * online, and the generic notification twin was only a greeting and a
     * one-line stub.
     */
    private static function mailAdded(Company $company, CompanyMember $member, User $by): void
    {
        $user = $member->user;
        $provider = self::isProvider($company);
        $role = $member->roleLabel();

        Notifier::send([
            'user' => $user,
            'actor' => $by,
            'type' => 'company.member_added',
            'title' => 'You were added to '.$company->name,
            'message' => $provider
                ? 'You now have access to '.$company->name.'’s applications as '.$role.'.'
                : 'You now have access to '.$company->name.' as '.$role.'.',
            'subject' => $company,
            // "Open company" means this company, not the applications list.
            'action_url' => Pages::company($company->uid),
            'email' => false,
        ]);

        if (! $user->email) {
            return;
        }

        Deliveries::send(
            Postcards::companyMemberAdded(
                $user->name ?: $member->displayName(),
                $company->name,
                self::portalUrl($company),
                $role,
                $by->name,
                $provider,
            ),
            $user->email,
            $company,
            'companyMemberAdded',
            immediate: true,
        );
    }

    /** Bell + postcard when company access is taken away. */
    private static function mailRemoved(Company $company, CompanyMember $member, User $by): void
    {
        $user = $member->user;
        $provider = self::isProvider($company);

        Notifier::send([
            'user' => $user,
            'actor' => $by,
            'type' => 'company.member_removed',
            'title' => 'Your access to '.$company->name.' was removed',
            'message' => $provider
                ? 'You no longer have access to '.$company->name.'’s applications through the portal.'
                : 'You no longer have access to '.$company->name.' through the portal.',
            'subject' => $company,
            'email' => false,
        ]);

        if (! $user->email) {
            return;
        }

        Deliveries::send(
            Postcards::companyMemberRemoved(
                $user->name ?: $member->displayName(),
                $company->name,
                url('/'),
                $by->name,
                $provider,
            ),
            $user->email,
            $company,
            'companyMemberRemoved',
            immediate: true,
        );
    }

    /**
     * Bell + postcard when someone is placed at a service provider — from
     * the Users page, or when a Service Provider admin adds an existing
     * contact. Added and switched each have their own admin and contact
     * templates.
     */
    private static function mailProviderAssigned(
        Company $company,
        User $user,
        User $by,
        bool $asAdmin,
        bool $switched,
        ?string $previousCompany,
    ): void {
        $role = $asAdmin ? 'Service Provider admin' : 'service provider contact';

        Notifier::send([
            'user' => $user,
            'actor' => $by,
            'type' => $switched ? 'company.role_changed' : 'company.member_added',
            'title' => $switched
                ? 'Your service provider was switched to '.$company->name
                : 'You were added to '.$company->name,
            'message' => $switched
                ? 'Your service provider has been switched to '.$company->name.'. You are a '.$role.' there.'
                : 'You have been added to '.$company->name.' as a '.$role.'.',
            'subject' => $company,
            'action_url' => Pages::company($company->uid),
            'email' => false,
        ]);

        if (! $user->email) {
            return;
        }

        Deliveries::send(
            Postcards::serviceProviderAssigned(
                $asAdmin,
                $switched,
                $user->first_name ?: $user->name,
                $company->name,
                self::portalUrl($company),
                $by->name,
                $previousCompany,
            ),
            $user->email,
            $company,
            $switched
                ? ($asAdmin ? 'serviceProviderAdminSwitched' : 'serviceProviderContactSwitched')
                : ($asAdmin ? 'serviceProviderAdminAdded' : 'serviceProviderContactAdded'),
            immediate: true,
        );
    }

    private static function isProvider(Company $company): bool
    {
        $company->loadMissing('cipProvider');

        return $company->cipProvider !== null;
    }

    private static function portalUrl(Company $company): string
    {
        return url(self::isProvider($company) ? Pages::HOME : '/');
    }
}
