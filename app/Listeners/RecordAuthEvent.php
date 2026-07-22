<?php

namespace App\Listeners;

use App\Models\AuthEvent;
use App\Models\User;
use App\Support\Messaging\PresenceService;
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
    }

    public function handleVerified(Verified $event): void
    {
        $this->record('email_verified', $event->user->getAuthIdentifier());
    }

    public function handleLogin(Login $event): void
    {
        $this->record('login', $event->user->getAuthIdentifier());
    }

    public function handleLogout(Logout $event): void
    {
        if (! $event->user) {
            return;
        }

        $this->record('logout', $event->user->getAuthIdentifier());

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
