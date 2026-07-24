<?php

namespace App\Listeners;

use App\Models\AuthEvent;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Messaging\PresenceService;
use App\Support\Notifications\Notifier;
use Illuminate\Auth\Events\Failed;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Auth\Events\Login;
use Illuminate\Auth\Events\Logout;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Auth\Events\Registered;
use Illuminate\Auth\Events\Verified;

/*
 * Registered automatically by Laravel's event discovery: each public
 * handle* method below is bound to the event it type-hints. Never add a
 * manual Event::subscribe() for this class - that records everything twice.
 */
class RecordAuthEvent
{
    public function handleRegistered(Registered $event): void
    {
        $this->record('registered', $event->user->getAuthIdentifier());

        // A self-registered account starts pending. Tell the administrators it
        // needs review, and drop it into the audit trail (§16).
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

        // A device is "known" if this user has signed in from this IP or agent
        // before. Notify only when a returning user signs in somewhere new — a
        // first-ever login is expected, and every-login alerts are just noise.
        $priorLogins = AuthEvent::where('user_id', $userId)->where('event', 'login')->count();
        $knownDevice = AuthEvent::where('user_id', $userId)->where('event', 'login')
            ->where(fn ($q) => $q->where('ip', $ip)->orWhere('user_agent', $ua))
            ->exists();

        $this->record('login', $userId);

        // Sign-ins feed the Activities panel too — without them a user who
        // hasn't touched clients/files yet sees an empty audit trail.
        if ($event->user instanceof User) {
            ActivityLogger::log([
                'actor' => $event->user,
                'type' => 'security.login',
                'description' => $event->user->name.' signed in',
                'subject' => $event->user,
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
        $this->record('login_failed', $event->user?->getAuthIdentifier());
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
            ]);
        }
    }

    public function handleLockout(Lockout $event): void
    {
        $this->record('lockout', null);
    }

    private function record(string $event, int|string|null $userId): void
    {
        AuthEvent::create([
            'user_id' => $userId,
            'event' => $event,
            'ip' => request()->ip(),
            'user_agent' => (string) request()->userAgent(),
            'created_at' => now(),
        ]);
    }
}
