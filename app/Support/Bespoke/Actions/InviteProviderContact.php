<?php

namespace App\Support\Bespoke\Actions;

use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Companies\CompanyAccess;
use App\Support\Companies\CompanyMembers;
use App\Support\Companies\CompanyRoles;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * A Service Provider admin inviting someone at their own firm. Same path as
 * the Access card: existing accounts are linked, new addresses get an
 * invitation. They arrive as a service provider contact, never as staff or
 * as another Service Provider admin.
 */
final class InviteProviderContact
{
    public static function firm(User $user): ?Company
    {
        if (! Role::isServiceProviderAdmin($user)) {
            return null;
        }

        $company = CompanyAccess::homeCompany($user);

        return $company && CompanyAccess::isProviderAdminOf($user, $company)
            ? $company
            : null;
    }

    /**
     * Whether this address can be invited, without sending anything.
     *
     * @return array<string, mixed>
     */
    public static function inspect(User $actor, string $email, ?string $name = null): array
    {
        $company = self::firm($actor);
        if ($company === null) {
            return ['error' => 'Only a Service Provider admin at their own firm can invite people from here. Do not say this is a Users-page task. A regular contact should ask their Service Provider admin. Staff invite from the provider Access card.'];
        }

        $email = Str::lower(trim($email));
        $name = trim((string) $name);
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return ['error' => 'Give a valid email address to invite.'];
        }

        if (Str::lower((string) $actor->email) === $email) {
            return ['error' => 'This reader already has access at '.$company->name.'. They cannot invite themselves.'];
        }

        if (User::onlyTrashed()->where('email', $email)->exists()) {
            return ['error' => 'This address belongs to a deleted account. Only a TMA administrator can restore it from the Recycle Bin. Offer to draft them a message.'];
        }

        $existing = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();
        if ($existing && Role::isStaff($existing)) {
            return ['error' => 'That address belongs to a staff account. A Service Provider admin cannot add staff.'];
        }

        $member = self::currentMember($company, $email, $existing);
        if ($member && $member->hasLiveAccount()) {
            $who = $existing?->name ?: $email;

            return ['error' => $who.' already has portal access at '.$company->name.'. Say so. Do not invite them again.'];
        }

        return [
            'ok' => true,
            'email' => $email,
            'name' => $name !== '' ? $name : (string) ($existing?->name ?: $member?->name ?: ''),
            'company' => ['id' => $company->uid, 'name' => $company->name],
            'url' => '/citizenship-applications/companies/'.$company->uid,
            'existingAccount' => $existing !== null,
            'willResend' => $member !== null && ! $member->hasLiveAccount(),
        ];
    }

    /**
     * Add or invite, after the reader confirms. Reach is checked again here.
     *
     * @return array{
     *     email: string,
     *     name: string,
     *     company: array{id: string, name: string},
     *     url: string,
     *     existingAccount: bool,
     *     invited: bool
     * }
     */
    public static function run(User $actor, string $email, ?string $name = null): array
    {
        $prepared = self::inspect($actor, $email, $name);
        if (isset($prepared['error'])) {
            throw ValidationException::withMessages(['email' => $prepared['error']]);
        }

        $company = self::firm($actor);
        if ($company === null) {
            throw ValidationException::withMessages(['email' => 'You cannot invite people at a service provider from here.']);
        }

        try {
            CompanyMembers::assertInvitable($prepared['email']);
            $member = CompanyMembers::add($company, [
                'name' => $prepared['name'] !== '' ? $prepared['name'] : null,
                'email' => $prepared['email'],
                'role' => CompanyRoles::MEMBER,
                'is_primary' => false,
            ], $actor, notify: false);

            $invitation = null;
            if (! $member->hasLiveAccount()) {
                $invitation = CompanyMembers::invite($company, $member, $actor);
            } else {
                CompanyMembers::notifyProviderContactAdded($company, $member, $actor);
            }
        } catch (HttpException $e) {
            throw ValidationException::withMessages([
                'email' => $e->getMessage() !== '' ? $e->getMessage() : 'The invitation could not be sent.',
            ]);
        }

        return [
            'email' => $prepared['email'],
            'name' => $member->displayName(),
            'company' => $prepared['company'],
            'url' => $prepared['url'],
            'existingAccount' => $prepared['existingAccount'],
            'invited' => $invitation instanceof Invitation
                && $invitation->status !== Invitation::STATUS_FAILED,
        ];
    }

    private static function currentMember(Company $company, string $email, ?User $existing): ?CompanyMember
    {
        return CompanyMember::query()
            ->current()
            ->where('company_id', $company->id)
            ->where(function ($q) use ($email, $existing) {
                if ($existing) {
                    $q->orWhere('user_id', $existing->id);
                }
                $q->orWhereRaw('LOWER(email) = ?', [$email]);
            })
            ->latest('id')
            ->first();
    }
}
