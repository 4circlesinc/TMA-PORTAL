<?php

namespace App\Observers;

use App\Models\User;
use App\Support\Realtime\Live;

/**
 * Account-type and status changes, told to the two audiences that care.
 *
 * Hung off the model rather than AdminUsersController because account_type is
 * written from more places than the admin screen: invitation acceptance,
 * onboarding, approval and denial, company membership, and the occasional
 * tinker. A promotion that only refreshes when it happened to go through one
 * particular controller is worse than one that never refreshes, because it
 * looks like it works.
 *
 * Two separate signals, deliberately:
 *
 *  - the person themselves, on their own private channel, because their whole
 *    capability set just changed; and
 *  - staff, so any open Users table shows the new type.
 */
class UserAccountObserver
{
    /** Fields that change what someone may see or do. */
    private const ACCESS_FIELDS = ['account_type', 'status'];

    public function created(User $user): void
    {
        $this->staff();
    }

    public function updated(User $user): void
    {
        if ($this->muted()) {
            return;
        }

        $this->staff();

        // wasChanged, not isDirty: this runs after the save, when isDirty has
        // already been cleared and would report nothing ever changed.
        if ($user->wasChanged(self::ACCESS_FIELDS)) {
            Live::user(Live::IDENTITY, $user->id);
        }
    }

    public function deleted(User $user): void
    {
        $this->staff();
    }

    public function restored(User $user): void
    {
        $this->staff();
    }

    private function staff(): void
    {
        if ($this->muted()) {
            return;
        }

        Live::staff(Live::USERS);
    }

    /** The suite writes users constantly; none of it has an audience. */
    private function muted(): bool
    {
        return app()->runningUnitTests();
    }
}
