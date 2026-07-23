<?php

namespace App\Support\Notifications;

use App\Models\User;

/**
 * A user's per-module notification preferences (§21), persisted in the existing
 * `users.preferences` JSON under the `notifications` key so it rides along with
 * every other personal setting.
 *
 * Shape:  preferences['notifications'] = [
 *     'email'    => ['portal' => true, 'email' => false, 'desktop' => false, 'sound' => false],
 *     'security' => ['portal' => true, 'email' => true,  ...],
 *     ...
 * ]
 *
 * Portal delivery of the security and approvals groups can never be switched
 * off — those are administrator-required alerts (§21). The UI reflects that by
 * locking those toggles; the server enforces it here regardless of input.
 */
final class NotificationPreferences
{
    public const CHANNELS = ['portal', 'email', 'desktop', 'sound'];

    /**
     * Per-group defaults. Portal is on everywhere. Email is on only for the
     * things a user genuinely needs to hear about away from the portal —
     * emailing every chat message or file touch would be noise (and depends on
     * a running queue worker), so those default off.
     */
    private static function groupDefault(string $group): array
    {
        $emailOn = in_array($group, ['security', 'approvals', 'signatures', 'clients', 'calendar'], true);

        return [
            'portal' => true,
            'email' => $emailOn,
            'desktop' => false,
            'sound' => false,
        ];
    }

    /** The full, defaults-filled preference map for a user. */
    public static function forUser(User $user): array
    {
        $stored = $user->preferences['notifications'] ?? [];
        $out = [];

        foreach (NotificationType::PREFERENCE_GROUPS as $group) {
            $groupStored = is_array($stored[$group] ?? null) ? $stored[$group] : [];
            $defaults = self::groupDefault($group);
            $merged = [];
            foreach (self::CHANNELS as $channel) {
                $merged[$channel] = array_key_exists($channel, $groupStored)
                    ? (bool) $groupStored[$channel]
                    : $defaults[$channel];
            }
            // Enforce the non-silenceable rule at read time too, so a stale or
            // hand-edited preference can never suppress a security alert.
            if (in_array($group, NotificationType::NON_SILENCEABLE, true)) {
                $merged['portal'] = true;
            }
            $out[$group] = $merged;
        }

        return $out;
    }

    /** Whether a portal (in-app) notification for this type should be created. */
    public static function portalEnabled(User $user, string $type): bool
    {
        $group = NotificationType::preferenceGroup($type);

        if (in_array($group, NotificationType::NON_SILENCEABLE, true)) {
            return true;
        }

        return self::forUser($user)[$group]['portal'] ?? true;
    }

    /** Whether a given delivery channel is enabled for a type's group. */
    public static function channelEnabled(User $user, string $type, string $channel): bool
    {
        if (! in_array($channel, self::CHANNELS, true)) {
            return false;
        }
        $group = NotificationType::preferenceGroup($type);

        return self::forUser($user)[$group][$channel] ?? false;
    }

    /**
     * Merge-save a partial preference map, coercing everything to booleans and
     * re-asserting the non-silenceable rule. Returns the full merged map.
     *
     * @param  array<string, array<string, mixed>>  $input
     */
    public static function update(User $user, array $input): array
    {
        $current = $user->preferences ?? [];
        $stored = is_array($current['notifications'] ?? null) ? $current['notifications'] : [];

        foreach ($input as $group => $channels) {
            if (! in_array($group, NotificationType::PREFERENCE_GROUPS, true) || ! is_array($channels)) {
                continue;
            }
            foreach ($channels as $channel => $value) {
                if (! in_array($channel, self::CHANNELS, true)) {
                    continue;
                }
                $stored[$group][$channel] = (bool) $value;
            }
            if (in_array($group, NotificationType::NON_SILENCEABLE, true)) {
                $stored[$group]['portal'] = true;
            }
        }

        $current['notifications'] = $stored;
        $user->forceFill(['preferences' => $current])->save();

        return self::forUser($user);
    }
}
