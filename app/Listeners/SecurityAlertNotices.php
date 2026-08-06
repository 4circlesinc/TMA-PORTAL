<?php

namespace App\Listeners;

use App\Models\User;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Notifications\Notifier;
use App\Support\Security\SecurityAlerts;
use Laravel\Fortify\Events\RecoveryCodesGenerated;
use Laravel\Fortify\Events\TwoFactorAuthenticationConfirmed;
use Laravel\Fortify\Events\TwoFactorAuthenticationDisabled;

/*
 * Turning two-factor authentication on or off is exactly the change an
 * attacker who already has the password would make, so the account owner
 * hears about it — in the bell and by email — unless they turned the
 * "Two-factor authentication changes" switch off.
 *
 * Registered by Laravel's event discovery from the type hints below; never
 * add a manual Event::listen for this class or every alert goes out twice.
 */
class SecurityAlertNotices
{
    public function handleConfirmed(TwoFactorAuthenticationConfirmed $event): void
    {
        $this->announce($event->user, 'turned on', 'Two-factor authentication was turned on');
    }

    public function handleDisabled(TwoFactorAuthenticationDisabled $event): void
    {
        $this->announce($event->user, 'turned off', 'Two-factor authentication was turned off');
    }

    /**
     * Fortify raises this while first enabling two-factor as well as when a
     * user asks for a fresh set. Only the second is news — the first is
     * already covered by the "turned on" alert.
     */
    public function handleRecoveryCodesGenerated(RecoveryCodesGenerated $event): void
    {
        if (! ($event->user instanceof User) || ! $event->user->two_factor_confirmed_at) {
            return;
        }

        $this->announce($event->user, 'regenerated recovery codes', 'New recovery codes were generated');
    }

    private function announce(mixed $user, string $action, string $title): void
    {
        if (! ($user instanceof User) || ! SecurityAlerts::enabled($user, 'two_factor_changed')) {
            return;
        }

        Notifier::send([
            'user' => $user,
            'type' => 'security.two_factor_changed',
            'title' => $title,
            'message' => 'If this was not you, secure your account immediately.',
            'action_url' => '/account-settings?settings-page=security',
            // The postcard below is this alert's email.
            'email' => false,
        ]);

        if (! $user->email) {
            return;
        }

        Deliveries::send(
            Postcards::twoFactorChanged($title, $action, url('/security-settings')),
            $user->email,
            $user,
            'twoFactorChanged',
        );
    }
}
