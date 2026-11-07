<?php

namespace App\Support\Notifications;

use App\Models\User;

/**
 * The sound a notification makes in the Mac and iPhone apps (Settings →
 * Notifications → Notification sound), stored in users.preferences beside
 * the person's other settings so it follows them to every device.
 *
 * The two lists differ because the platforms do. macOS plays its own alert
 * sounds by name (/System/Library/Sounds), so the Mac app offers all of them.
 * iOS lets an app use only the phone's default alert tone or sounds the app
 * ships itself; Apple's other tones are not available to apps, and copying
 * them into the app is not ours to do. So the iPhone offers its default (the
 * tone chosen in iPhone Settings → Sounds & Haptics) and the portal's own two
 * tones, which the app carries (ios/TMAPortal/Sounds).
 */
final class NotificationSounds
{
    public const KEY = 'notificationSounds';

    public const DEFAULT = 'default';

    public const SILENT = 'none';

    /** macOS's alert sounds, as named in /System/Library/Sounds. */
    public const MAC = [self::DEFAULT, 'Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero', 'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink', self::SILENT];

    public const IPHONE = [self::DEFAULT, 'chime', 'notification', self::SILENT];

    /** The file each portal tone plays on an iPhone, bundled in the app. */
    public const IPHONE_FILES = [
        'chime' => 'tma-chime.caf',
        'notification' => 'tma-notification.caf',
    ];

    public const DEFAULTS = ['mac' => self::DEFAULT, 'iphone' => self::DEFAULT];

    /** @return array{mac: string, iphone: string} */
    public static function for(User $user): array
    {
        $stored = data_get($user->preferences, self::KEY, []);
        $stored = is_array($stored) ? $stored : [];

        return [
            'mac' => in_array($stored['mac'] ?? null, self::MAC, true) ? $stored['mac'] : self::DEFAULTS['mac'],
            'iphone' => in_array($stored['iphone'] ?? null, self::IPHONE, true) ? $stored['iphone'] : self::DEFAULTS['iphone'],
        ];
    }

    /**
     * Apply the choices that are on the lists and ignore anything else.
     *
     * @param  array<string, mixed>  $changes
     * @return array{mac: string, iphone: string}
     */
    public static function update(User $user, array $changes): array
    {
        $next = self::for($user);
        if (in_array($changes['mac'] ?? null, self::MAC, true)) {
            $next['mac'] = $changes['mac'];
        }
        if (in_array($changes['iphone'] ?? null, self::IPHONE, true)) {
            $next['iphone'] = $changes['iphone'];
        }

        $preferences = $user->preferences ?? [];
        $preferences[self::KEY] = $next;
        $user->preferences = $preferences;
        $user->save();

        return $next;
    }

    /**
     * What an iPhone push's aps.sound should be: a bundled file, "default",
     * or '' for no sound at all.
     */
    public static function apnsSound(User $user): string
    {
        $choice = self::for($user)['iphone'];

        return match (true) {
            $choice === self::SILENT => '',
            isset(self::IPHONE_FILES[$choice]) => self::IPHONE_FILES[$choice],
            default => self::DEFAULT,
        };
    }
}
