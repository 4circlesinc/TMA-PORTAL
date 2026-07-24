<?php

namespace App\Support\Notifications;

use App\Models\User;

/**
 * Per-user notification toast preferences (position, duration, sound, …).
 *
 * Stored under users.preferences['toasts'] — the same JSON column the rest of
 * personal settings already use. Only whitelisted keys are accepted.
 */
class ToastSettings
{
    public const KEY = 'toasts';

    public const POSITION_BOTTOM_RIGHT = 'bottom-right';

    public const POSITION_TOP_RIGHT = 'top-right';

    public const POSITION_BOTTOM_LEFT = 'bottom-left';

    public const POSITIONS = [
        self::POSITION_BOTTOM_RIGHT,
        self::POSITION_TOP_RIGHT,
        self::POSITION_BOTTOM_LEFT,
    ];

    public const DURATIONS = [3, 5, 8, 10];

    public const DEFAULTS = [
        'enabled' => true,
        'position' => self::POSITION_BOTTOM_RIGHT,
        'durationSec' => 10,
        'stickyImportant' => false,
        'sound' => false,
        'previewText' => true,
        'groupSimilar' => false,
    ];

    /** @return array<string, mixed> */
    public static function for(User $user): array
    {
        $stored = data_get($user->preferences, self::KEY, []);

        return self::normalize(is_array($stored) ? $stored : []);
    }

    /**
     * Merge a partial update. Unknown keys are dropped.
     *
     * @param  array<string, mixed>  $changes
     * @return array<string, mixed>
     */
    public static function update(User $user, array $changes): array
    {
        $preferences = $user->preferences ?? [];
        $preferences[self::KEY] = self::normalize(array_merge(self::for($user), $changes));
        $user->preferences = $preferences;
        $user->save();

        return $preferences[self::KEY];
    }

    /**
     * @param  array<string, mixed>  $raw
     * @return array<string, mixed>
     */
    public static function normalize(array $raw): array
    {
        $out = self::DEFAULTS;

        if (array_key_exists('enabled', $raw)) {
            $out['enabled'] = (bool) $raw['enabled'];
        }
        if (array_key_exists('stickyImportant', $raw)) {
            $out['stickyImportant'] = (bool) $raw['stickyImportant'];
        }
        if (array_key_exists('sound', $raw)) {
            $out['sound'] = (bool) $raw['sound'];
        }
        if (array_key_exists('previewText', $raw)) {
            $out['previewText'] = (bool) $raw['previewText'];
        }
        if (array_key_exists('groupSimilar', $raw)) {
            $out['groupSimilar'] = (bool) $raw['groupSimilar'];
        }

        $position = (string) ($raw['position'] ?? $out['position']);
        $out['position'] = in_array($position, self::POSITIONS, true)
            ? $position
            : self::POSITION_BOTTOM_RIGHT;

        $duration = (int) ($raw['durationSec'] ?? $out['durationSec']);
        $out['durationSec'] = in_array($duration, self::DURATIONS, true)
            ? $duration
            : 10;

        return $out;
    }
}
