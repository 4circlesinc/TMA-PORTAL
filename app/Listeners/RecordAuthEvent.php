<?php

namespace App\Listeners;

use App\Models\AuthEvent;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Messaging\PresenceService;
use App\Support\Notifications\Notifier;
use App\Support\Security\Detectors;
use App\Support\Security\IpLocation;
use App\Support\Security\SecurityAlertPolicy;
use App\Support\Security\SecurityAudit;
use Illuminate\Auth\Events\Failed;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Auth\Events\Login;
use Illuminate\Auth\Events\Logout;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Auth\Events\Registered;
use Illuminate\Auth\Events\Verified;
use Illuminate\Support\Facades\Log;
use Throwable;

/*
 * Registered automatically by Laravel's event discovery: each public
 * handle* method below is bound to the event it type-hints. Never add a
 * manual Event::subscribe() for this class - that records everything twice.
 */
class RecordAuthEvent
{
    /**
     * How long after a sign-in a second Login event is treated as the same
     * sign-in rather than a new one. See handleLogin().
     */
    private const DUPLICATE_LOGIN_SECONDS = 10;

    public function handleRegistered(Registered $event): void
    {
        $this->record('registered', $event->user->getAuthIdentifier());

        // A self-registered account starts pending. Tell the administrators it
        // needs review, and drop it into the audit trail (section 16).
        $user = $event->user;
        if ($user instanceof User && $user->status === User::STATUS_PENDING) {
            ActivityLogger::log([
                'actor' => $user,
                'type' => 'account.registered',
                'module' => 'account',
                'status' => 'pending',
                'description' => $user->name.' registered and is awaiting approval',
                'subject' => $user,
            ]);
            Notifier::notifyAdmins([
                'actor' => $user,
                'type' => 'account.pending',
                'title' => $user->name.' requested access',
                'message' => $user->email,
                'subject' => $user,
                'action_url' => '/users',
                'dedupe_key' => 'account.pending:'.$user->id,
            ]);
            // …and tell the person who registered. They can't sign in yet, so
            // nothing in the portal can reach them; without this they hear
            // nothing between signing up and being approved.
            //
            // Deliveries::send already records a refused transport on the
            // delivery row rather than throwing — this catch is for the case
            // where it couldn't even write that row. The account exists by now,
            // so a mail problem must not turn into a failed registration.
            try {
                Deliveries::send(
                    Postcards::accountPending($user->email, $user->first_name ?: null),
                    $user->email,
                    $user,
                    'accountPending',
                    immediate: true,
                );
            } catch (Throwable $e) {
                Log::warning('Could not email the pending-approval notice: '.$e->getMessage());
            }
        }
    }

    public function handleVerified(Verified $event): void
    {
        $this->record('email_verified', $event->user->getAuthIdentifier());
    }

    public function handleLogin(Login $event): void
    {
        $userId = $event->user->getAuthIdentifier();
        $ip = request()->ip();
        $ua = (string) request()->userAgent();

        // One sign-in, one row. Laravel fires Login again whenever the guard
        // re-authenticates the same person in the same request cycle — the
        // remember-me re-login in StaySignedIn::applyRemember, and again on
        // the two-factor path — which wrote the same sign-in two or three
        // times and filled the audit trail with sign-ins nobody performed.
        //
        // Deliberately not a unique index: a genuine second sign-in seconds
        // later (another tab, another device) is legitimate and must still be
        // recorded. Only a repeat of the same address and agent inside the
        // window is treated as an echo of the one we already wrote.
        if ($this->alreadyRecordedLogin($userId, $ip, $ua)) {
            return;
        }

        // A device is "known" if this user has signed in from this IP or agent
        // before. Notify only when a returning user signs in somewhere new — a
        // first-ever login is expected, and every-login alerts are just noise.
        $priorLogins = AuthEvent::where('user_id', $userId)->where('event', 'login')->count();
        $knownDevice = AuthEvent::where('user_id', $userId)->where('event', 'login')
            ->where(fn ($q) => $q->where('ip', $ip)->orWhere('user_agent', $ua))
            ->exists();

        $this->record('login', $userId);

        if ($event->user instanceof User) {
            Detectors::onLogin(
                $event->user,
                Detectors::countryFromRequest(),
                (string) $ip,
            );
            SecurityAudit::record('auth.login', [
                'user_id' => $userId,
                'email' => $event->user->email,
            ]);
        }

        // Sign-ins feed the Activities panel too — without them a user who
        // hasn't touched clients/files yet sees an empty audit trail.
        if ($event->user instanceof User) {
            ActivityLogger::log([
                'actor' => $event->user,
                'type' => 'security.login',
                'description' => $event->user->name.' signed in',
                'subject' => $event->user,
                // record() resolved this a moment ago and the lookup is
                // cached per address, so this reuses the answer rather than
                // asking again.
                'location' => IpLocation::lookup($ip) ?? [
                    'country' => Detectors::countryFromRequest(),
                    'city' => null, 'region' => null, 'postal' => null,
                    'latitude' => null, 'longitude' => null,
                ],
            ]);
        }

        if ($priorLogins > 0 && ! $knownDevice && $event->user instanceof User) {
            Notifier::send([
                'user' => $event->user,
                'type' => 'security.new_login',
                'title' => 'New sign-in to your account',
                'message' => trim(($ua ?: 'A new device').' · '.($ip ?: '')),
                'action_url' => '/account-settings?settings-page=security',
            ]);

            // And whoever else the firm asked to be told — off by default, so
            // this is silent until an administrator turns it on.
            SecurityAlertPolicy::fanOut(
                'newDevice',
                $event->user,
                'New sign-in on '.$event->user->name.'’s account',
                trim(($ua ?: 'A new device').' · '.($ip ?: '')),
            );
        }
    }

    public function handleLogout(Logout $event): void
    {
        if (! $event->user) {
            return;
        }

        $this->record('logout', $event->user->getAuthIdentifier());

        if ($event->user instanceof User) {
            ActivityLogger::log([
                'actor' => $event->user,
                'type' => 'security.logout',
                'description' => $event->user->name.' signed out',
                'subject' => $event->user,
            ]);
        }

        // Signing out is the one moment we *know* somebody is gone, rather
        // than inferring it from a heartbeat that stopped arriving. Without
        // this they stay "Online" to everyone else until the presence TTL
        // expires, which is a lie we can easily avoid telling.
        if ($event->user instanceof User) {
            PresenceService::release($event->user);
        }
    }

    public function handleFailed(Failed $event): void
    {
        $userId = $event->user?->getAuthIdentifier();

        $this->record('login_failed', $userId);

        SecurityAudit::record('auth.login_failed', [
            'user_id' => $userId,
            'guard' => $event->guard,
        ]);

        // Recorded first, so this attempt counts towards the threshold — the
        // check reads auth_events rather than keeping its own tally.
        if ($event->user instanceof User && SecurityAlertPolicy::crossedFailureThreshold((int) $userId)) {
            SecurityAlertPolicy::fanOut(
                'failedSignIns',
                $event->user,
                'Repeated failed sign-ins on '.$event->user->name.'’s account',
                SecurityAlertPolicy::failureThreshold().' failed attempts in the last hour, most recently from '
                    .(request()->ip() ?: 'an unknown address').'.',
            );
        }
    }

    public function handlePasswordReset(PasswordReset $event): void
    {
        $this->record('password_reset', $event->user->getAuthIdentifier());

        if ($event->user instanceof User) {
            Notifier::send([
                'user' => $event->user,
                'type' => 'security.password_changed',
                'title' => 'Your password was changed',
                'message' => 'If this was not you, secure your account immediately.',
                'action_url' => '/account-settings?settings-page=security',
                // Fortify's actions mail passwordChangedFor separately.
                'email' => false,
            ]);
        }
    }

    public function handleLockout(Lockout $event): void
    {
        $this->record('lockout', null);
    }

    /**
     * Has this exact sign-in already been written moments ago?
     *
     * The re-login paths all land in the same request or the one right after
     * it, so a few seconds is wide enough to catch every echo and far too
     * narrow to swallow a real second sign-in.
     */
    private function alreadyRecordedLogin(int|string|null $userId, ?string $ip, string $ua): bool
    {
        if ($userId === null) {
            return false;
        }

        return AuthEvent::where('user_id', $userId)
            ->where('event', 'login')
            ->where('created_at', '>=', now()->subSeconds(self::DUPLICATE_LOGIN_SECONDS))
            ->where(fn ($q) => $q->where('ip', $ip)->orWhereNull('ip'))
            ->where(fn ($q) => $q->where('user_agent', $ua)->orWhereNull('user_agent'))
            ->exists();
    }

    private function record(string $event, int|string|null $userId): void
    {
        $ip = request()->ip();

        // The edge header is authoritative for country when it is there; the
        // lookup fills in the rest, and the country too when there is no edge
        // in front of us. Both may be null, and a null location is recorded
        // as null rather than guessed at.
        $location = IpLocation::lookup($ip);

        AuthEvent::create([
            'user_id' => $userId,
            'event' => $event,
            'ip' => $ip,
            'user_agent' => (string) request()->userAgent(),
            'country' => Detectors::countryFromRequest() ?? ($location['country'] ?? null),
            'city' => $location['city'] ?? null,
            'region' => $location['region'] ?? null,
            'postal' => $location['postal'] ?? null,
            'latitude' => $location['latitude'] ?? null,
            'longitude' => $location['longitude'] ?? null,
            'created_at' => now(),
        ]);
    }
}
