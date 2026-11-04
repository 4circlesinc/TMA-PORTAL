<?php

namespace App\Support\Access;

use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\CipAccess;
use App\Support\Companies\CompanyAccess;
use App\Support\Companies\CompanyMembers;
use App\Support\Companies\CompanyRoles;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

/**
 * An administrator opening the portal as a service-provider account.
 *
 * The session becomes that account, so every gate, query and screen answers
 * as they would for the person who actually works there. The administrator's
 * own id stays on the session so they can come back, and so the audit trail
 * can say who was really holding the mouse. It is not a second login: no
 * sign-in row, no new-device alert, no authenticator challenge for an
 * account whose password the administrator does not have.
 */
final class Impersonation
{
    /** The administrator who opened this session. Absent means a normal sign-in. */
    public const ACTOR = 'impersonator_id';

    /** Where to send them when they leave. A path on this portal, nothing else. */
    public const RETURN = 'impersonation_return';

    /**
     * Set when the administrator opened a firm, rather than one of its people.
     * The bar then names the service provider, not the login used to enter it.
     */
    public const FIRM = 'impersonation_firm';

    /**
     * Set only for the request that switches accounts, so the login listener
     * does not record a sign-in nobody performed.
     */
    public const SWITCHING = 'impersonation_switch';

    public static function isSwitching(): bool
    {
        return self::flag(self::SWITCHING) === true;
    }

    public static function isActive(): bool
    {
        return self::actorId() !== null;
    }

    public static function actorId(): ?int
    {
        $id = self::flag(self::ACTOR);

        return is_numeric($id) ? (int) $id : null;
    }

    public static function actor(): ?User
    {
        $id = self::actorId();

        return $id === null ? null : User::query()->find($id);
    }

    /**
     * What the shell and /me need to draw the bar. Null when this session
     * is the reader's own.
     *
     * @return array{actorName: string, name: ?string, asFirm: bool, returnUrl: string}|null
     */
    public static function payload(): ?array
    {
        $actor = self::actor();

        if ($actor === null) {
            return null;
        }

        $firm = self::flag(self::FIRM);
        $asFirm = is_string($firm) && $firm !== '';

        return [
            'actorName' => $actor->name,
            'name' => $asFirm ? $firm : (auth()->user() instanceof User ? auth()->user()->name : null),
            'asFirm' => $asFirm,
            'returnUrl' => self::returnPath(),
        ];
    }

    public static function returnPath(): string
    {
        $path = self::flag(self::RETURN);

        return is_string($path) && self::isSafePath($path) ? $path : '/users';
    }

    /**
     * Refuse unless an administrator may open the portal as this account.
     */
    public static function authorizeStart(?User $admin, User $target): void
    {
        if ($admin === null || ! Role::isAdmin($admin)) {
            abort(403, 'Administrators only.');
        }

        if (self::isActive()) {
            abort(422, 'Leave this account before signing in as someone else.');
        }

        if ($admin->is($target)) {
            abort(422, 'You cannot sign in as your own account.');
        }

        if (! $target->isApproved() || $target->email_verified_at === null) {
            abort(422, 'This account cannot sign in yet.');
        }

        if (! self::isServiceProviderAccount($target)) {
            abort(422, 'This account is not a service provider.');
        }
    }

    /**
     * The portal login an administrator enters when they open a firm.
     *
     * The firm's Service Provider admin, when one can sign in. Otherwise
     * the earliest active contact. Null when the firm has no portal account
     * yet — {@see self::ensureAccount} opens one.
     */
    public static function accountFor(Company $company): ?User
    {
        $isProvider = CipProvider::query()->where('company_id', $company->id)->exists();

        $members = CompanyMember::query()
            ->active()
            ->where('company_id', $company->id)
            ->orderBy('id')
            ->with('user')
            ->get();

        $contact = null;

        foreach ($members as $member) {
            $user = $member->user;

            if (! $user instanceof User || ! self::canBeOpened($user)) {
                continue;
            }

            if (Role::isServiceProviderAdmin($user)) {
                return $user;
            }

            if ($isProvider) {
                $contact ??= $user;
            }
        }

        return $contact;
    }

    /**
     * A portal login for this firm, creating the service provider admin when
     * the firm does not have one.
     *
     * A company has no password of its own. Opening it still has to land in
     * an account that belongs to the firm, including the first time, before
     * anyone there has been invited.
     */
    public static function ensureAccount(Company $company, User $by): User
    {
        $existing = self::accountFor($company);
        if ($existing instanceof User) {
            return $existing;
        }

        $email = self::standInEmail($company);
        $user = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();

        if (! $user instanceof User) {
            $firm = trim($company->name) !== '' ? trim($company->name) : 'Service provider';
            $user = new User([
                'first_name' => mb_substr($firm, 0, 100),
                'last_name' => 'Admin',
                'email' => $email,
                'password' => Str::random(40),
            ]);
            $user->syncDisplayName();
            $user->forceFill([
                'email_verified_at' => now(),
                'status' => User::STATUS_APPROVED,
                'account_type' => Role::SERVICE_PROVIDER_ADMIN,
                'approved_at' => now(),
                'approved_by' => $by->id,
                'profile_completed_at' => now(),
                'onboarding_completed_at' => now(),
                // Claimed up front so creating the login does not greet them.
                'welcomed_at' => now(),
            ])->save();
        }

        if (CompanyAccess::memberOf($user, $company) === null) {
            CompanyMembers::add($company, [
                'email' => $user->email,
                'name' => $user->name,
                'user_id' => $user->id,
                'role' => CompanyRoles::PRIMARY,
            ], $by, false);
        }

        return $user->fresh() ?? $user;
    }

    /**
     * Switch this session to the service provider. The caller has already
     * passed {@see self::authorizeStart}.
     *
     * Pass $asFirm when the administrator opened the firm itself. The portal
     * still runs as someone who can sign in there — a firm has no password
     * of its own — and the bar names the firm, not that person.
     */
    public static function start(Request $request, User $target, ?Company $asFirm = null): void
    {
        $admin = $request->user();
        self::authorizeStart($admin, $target);

        self::switchTo($request, $target);
        $request->session()->put(self::ACTOR, (int) $admin->id);
        $request->session()->put(self::RETURN, self::safeReturn($request->headers->get('referer')));
        if ($asFirm !== null) {
            $request->session()->put(self::FIRM, $asFirm->name);
        }

        $metadata = [
            'impersonator_id' => $admin->id,
            'target_id' => $target->id,
        ];
        if ($asFirm !== null) {
            $metadata['company'] = $asFirm->uid;
        }

        ActivityLogger::log([
            'actor' => $admin,
            'type' => 'account.impersonated',
            'description' => $admin->name.' opened the portal as '.($asFirm->name ?? $target->name),
            'subject' => $asFirm ?? $target,
            'metadata' => $metadata,
        ]);
    }

    /**
     * Come back to the administrator who opened the session.
     *
     * Returns the path they should land on. If that administrator can no
     * longer sign in, the session ends rather than being left as the
     * service provider with nobody able to leave it.
     */
    public static function stop(Request $request): string
    {
        $return = self::returnPath();
        $firmName = self::flag(self::FIRM);
        $admin = self::actor();
        $target = $request->user();

        if ($admin === null || ! Role::isAdmin($admin) || ! $admin->isApproved()) {
            Auth::logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
            abort(403, 'That administrator account can no longer be restored.');
        }

        self::switchTo($request, $admin);
        $request->session()->forget(self::ACTOR);
        $request->session()->forget(self::RETURN);
        $request->session()->forget(self::FIRM);

        $left = is_string($firmName) && $firmName !== ''
            ? $firmName
            : ($target instanceof User ? $target->name : 'a service provider')."'s account";

        ActivityLogger::log([
            'actor' => $admin,
            'type' => 'account.impersonation_ended',
            'description' => $admin->name.' returned from '.$left,
            'subject' => $target instanceof User ? $target : $admin,
            'metadata' => [
                'impersonator_id' => $admin->id,
                'target_id' => $target instanceof User ? $target->id : null,
            ],
        ]);

        return $return;
    }

    /** Where this account lands when the portal opens as them. */
    public static function landing(User $user, ?Company $opened = null): string
    {
        if (! CipAccess::enabled()) {
            return '/';
        }

        if (Role::isServiceProviderAdmin($user)) {
            // The firm the administrator opened, when this account belongs to
            // it. Otherwise the firm the account itself would land on.
            $company = $opened !== null && CompanyAccess::memberOf($user, $opened) !== null
                ? $opened
                : CompanyAccess::homeCompany($user);

            if ($company !== null) {
                return '/citizenship-applications/companies/'.$company->uid;
            }
        }

        if (CipAccess::canReach($user)) {
            return '/citizenship-applications';
        }

        return '/';
    }

    /**
     * An external account that works for a service provider: a contact of
     * a registered firm, or a Service Provider admin of one.
     */
    public static function isServiceProviderAccount(User $user): bool
    {
        return Role::isClient($user) && CipAccess::isProviderContact($user);
    }

    /** Stable address for the admin login a firm did not already have. */
    private static function standInEmail(Company $company): string
    {
        $uid = $company->uid !== '' ? $company->uid : 'company-'.$company->id;

        return 'admin.'.$uid.'@service-provider.invalid';
    }

    private static function canBeOpened(User $user): bool
    {
        return Role::isClient($user)
            && $user->isApproved()
            && $user->email_verified_at !== null;
    }

    private static function switchTo(Request $request, User $user): void
    {
        $request->session()->put(self::SWITCHING, true);

        try {
            Auth::login($user);
        } finally {
            $request->session()->forget(self::SWITCHING);
        }

        $request->session()->regenerate();
    }

    private static function safeReturn(mixed $candidate): string
    {
        if (! is_string($candidate) || $candidate === '') {
            return '/users';
        }

        $path = parse_url($candidate, PHP_URL_PATH);
        $query = parse_url($candidate, PHP_URL_QUERY);

        if (! is_string($path) || ! self::isSafePath($path)) {
            return '/users';
        }

        return $path.(is_string($query) && $query !== '' ? '?'.$query : '');
    }

    private static function isSafePath(string $path): bool
    {
        return str_starts_with($path, '/')
            && ! str_starts_with($path, '//')
            && ! str_contains($path, '\\')
            && ! str_starts_with($path, '/auth')
            && ! str_starts_with($path, '/impersonation');
    }

    private static function flag(string $key): mixed
    {
        // Queue workers and artisan have no browser session. Reading one
        // there would start an empty store and, worse, stamp a job's audit
        // row as if an administrator were signed in as someone else.
        if (app()->runningInConsole() && ! app()->runningUnitTests()) {
            return null;
        }

        try {
            return session($key);
        } catch (\Throwable) {
            return null;
        }
    }
}
