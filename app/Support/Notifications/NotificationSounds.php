<?php

namespace App\Support\Notifications;

use App\Models\User;

/**
 * The sound notifications make in the iPhone app (Settings → Notifications,
 * shown only in the iPhone app), stored in users.preferences so it follows
 * the person to every phone.
 *
 * The TM tone (the portal's chime, bundled in the app as tma-chime.caf) is the
 * default. The Apple tone is the phone's default alert sound, the one set in
 * iPhone Settings → Sounds & Haptics → Default Alerts. iOS gives apps no way to
 * use the Text Tone, which belongs to Messages, so Default Alerts is the Apple
 * sound an app can follow. The Mac and the other apps use their own defaults.
 */
final class NotificationSounds
{
    public const KEY = 'notificationSounds';

    /** The values the iPhone app understands (NotificationSound.swift). */
    public const TM = 'chime';

    public const APPLE = 'default';

    public const IPHONE = [self::TM, self::APPLE];

    public const IPHONE_FILES = [self::TM => 'tma-chime.caf'];

    public const DEFAULTS = ['iphone' => self::TM];

    /** @return array{iphone: string} */
    public static function for(User $user): array
    {
        $stored = data_get($user->preferences, self::KEY.'.iphone');

        return ['iphone' => in_array($stored, self::IPHONE, true) ? $stored : self::DEFAULTS['iphone']];
    }

    /**
     * @param  array<string, mixed>  $changes
     * @return array{iphone: string}
     */
    public static function update(User $user, array $changes): array
    {
        $next = self::for($user);
        if (in_array($changes['iphone'] ?? null, self::IPHONE, true)) {
            $next['iphone'] = $changes['iphone'];
        }

        $preferences = $user->preferences ?? [];
        $preferences[self::KEY] = $next;
        $user->preferences = $preferences;
        $user->save();

        return $next;
    }

    /** aps.sound for this person's pushes: the bundled TM tone, or "default". */
    public static function apnsSound(User $user): string
    {
        return self::IPHONE_FILES[self::for($user)['iphone']] ?? self::APPLE;
    }
}
