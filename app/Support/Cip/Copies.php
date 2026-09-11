<?php

namespace App\Support\Cip;

use App\Models\User;
use App\Support\Access\Role;

/**
 * The copy a staff member gets of a notice written to the service provider.
 *
 * Section 22 sends every notice to four classes at once, and three of them
 * are the firm's own people: administrators hear about every application,
 * an officer about the files they hold, the distribution group about
 * whatever the firm put it on. The provider side is the addressee; the rest
 * are copies, and a copy is the one part of the list a person may decline.
 * Settings › Notifications carries the switch, and this is its one reader.
 *
 * The bell is not a copy. Somebody who has turned their copies off still
 * sees the change in the portal; what stops is the email.
 */
final class Copies
{
    /** The key on users.preferences, written through /me/preferences. */
    public const PREFERENCE = 'notifyProviderCopies';

    /**
     * Does this mailbox want the email copy of a service-provider notice?
     *
     * A mailbox with no account, and a provider-side account, is being
     * written to rather than copied, so the switch does not apply to them:
     * a firm's contact cannot silence the notices the firm is owed.
     */
    public static function wanted(?User $user): bool
    {
        if ($user === null || ! Role::isStaff($user)) {
            return true;
        }

        return (bool) data_get($user->preferences, self::PREFERENCE, true);
    }
}
