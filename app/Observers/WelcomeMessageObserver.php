<?php

namespace App\Observers;

use App\Models\User;
use App\Support\Messaging\WelcomeMessage;
use WeakMap;

/**
 * Sends the welcome message when an account can first use the portal.
 *
 * On the model rather than in AdminUsersController for the reason
 * UserAccountObserver gives: status reaches "approved" from more places than
 * the approval screen (an accepted invitation creates the account already
 * approved, a denied account can be reactivated, `user:approve`). A welcome
 * that only went out through one of them would look like it works.
 *
 * Not muted under tests, unlike UserAccountObserver: WelcomeMessage::deliver
 * does nothing until an administrator switches the message on.
 */
class WelcomeMessageObserver
{
    /** Accounts this process marked welcomed on insert, until `created`. */
    private static ?WeakMap $claimed = null;

    /**
     * Created already approved: mark it in the insert itself, which no other
     * request can race, and send once the row exists.
     */
    public function creating(User $user): void
    {
        if ($user->status === User::STATUS_APPROVED && $user->welcomed_at === null) {
            $user->welcomed_at = now();
            self::claimed()[$user] = true;
        }
    }

    public function created(User $user): void
    {
        if (isset(self::claimed()[$user])) {
            unset(self::claimed()[$user]);
            WelcomeMessage::afterActivation($user);
        }
    }

    /**
     * Approved now, never welcomed before. The claim is a conditional
     * update, so a double-clicked Approve sends one message, not two.
     */
    public function updated(User $user): void
    {
        if (! $user->wasChanged('status') || $user->status !== User::STATUS_APPROVED) {
            return;
        }

        if ($user->getOriginal('welcomed_at') !== null) {
            return;
        }

        if (WelcomeMessage::claim($user)) {
            WelcomeMessage::afterActivation($user);
        }
    }

    private static function claimed(): WeakMap
    {
        return self::$claimed ??= new WeakMap;
    }
}
