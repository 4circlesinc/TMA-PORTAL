<?php

namespace App\Support;

use App\Models\User;

/**
 * The moment a person actually proved who they are (password, social, or a
 * second-factor code). Silent remember-cookie restores must not refresh this,
 * or a 7-day cap would never arrive.
 */
final class LoginSession
{
    public static function stamp(User $user): void
    {
        $user->forceFill(['last_authenticated_at' => now()])->save();
    }
}
