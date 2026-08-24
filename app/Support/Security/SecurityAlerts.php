<?php

namespace App\Support\Security;

use App\Models\User;

/**
 * The "Security notifications" switches on Account settings → Security,
 * persisted in the existing `users.preferences` JSON under `security_alerts`
 * so they ride along with every other personal setting.
 *
 * These are deliberately separate from NotificationPreferences: that store
 * decides which *channels* a whole module may use, while these are the
 * individual account-safety emails a person can opt out of one at a time.
 *
 * New-device sign-in alerts can never be switched off, that is the one alert
 * that tells somebody their account has been taken over, so the UI locks the
 * switch and the server re-asserts it here regardless of what was posted.
 */
final class SecurityAlerts
{
    /** Every switch and the value a user who never touched them gets. */
    public const DEFAULTS = [
        'new_device' => true,
        'password_changed' => true,
        'two_factor_changed' => true,
        'monthly_summary' => false,
    ];

    /** Alerts that stay on no matter what is posted. */
    public const LOCKED = ['new_device'];

    /** @return array<string, bool> the full, defaults-filled switch map */
    public static function forUser(User $user): array
    {
        $stored = $user->preferences['security_alerts'] ?? [];
        $stored = is_array($stored) ? $stored : [];

        $out = [];
        foreach (self::DEFAULTS as $key => $default) {
            $out[$key] = array_key_exists($key, $stored) ? (bool) $stored[$key] : $default;
        }

        foreach (self::LOCKED as $key) {
            $out[$key] = true;
        }

        return $out;
    }

    /** Whether a single alert should be sent to this user. */
    public static function enabled(User $user, string $key): bool
    {
        return self::forUser($user)[$key] ?? false;
    }

    /**
     * Merge-save a partial switch map. Unknown keys are ignored so a stale
     * client can't write junk into the preferences blob.
     *
     * @param  array<string, mixed>  $input
     * @return array<string, bool> the full merged map
     */
    public static function update(User $user, array $input): array
    {
        $prefs = $user->preferences ?? [];
        $stored = is_array($prefs['security_alerts'] ?? null) ? $prefs['security_alerts'] : [];

        foreach ($input as $key => $value) {
            if (! array_key_exists($key, self::DEFAULTS) || in_array($key, self::LOCKED, true)) {
                continue;
            }
            $stored[$key] = (bool) $value;
        }

        $prefs['security_alerts'] = $stored;
        $user->forceFill(['preferences' => $prefs])->save();

        return self::forUser($user);
    }
}
