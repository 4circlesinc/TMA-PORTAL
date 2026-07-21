<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\User;

/**
 * Per-user messaging preferences, stored inside the existing users.preferences
 * JSON rather than a new table - the same store the rest of the portal's
 * personal settings already use (see PreferencesController).
 *
 * The privacy group here is enforced server-side. The client is told what it
 * is allowed to know, never told a truth it is then trusted to hide.
 */
class MessagingSettings
{
    public const KEY = 'messaging';

    /** Visibility choices, in decreasing order of exposure. */
    public const EVERYONE = 'everyone';

    public const CONTACTS = 'contacts';

    public const NOBODY = 'nobody';

    public const DEFAULTS = [
        // Privacy
        'onlineStatus' => self::EVERYONE,
        'lastSeen' => self::EVERYONE,
        'readReceipts' => true,
        'typingIndicator' => true,

        // Notifications
        'notificationSounds' => true,
        'desktopNotifications' => false,
        'notificationPreview' => true,

        // Composer
        'enterToSend' => true,

        // Media
        'mediaAutoDownload' => true,
        'voicePlaybackSpeed' => 1.0,
    ];

    /** This user's settings, with any missing key filled from the defaults. */
    public static function for(User $user): array
    {
        $stored = data_get($user->preferences, self::KEY, []);

        return array_merge(self::DEFAULTS, is_array($stored) ? $stored : []);
    }

    public static function get(User $user, string $key): mixed
    {
        return self::for($user)[$key] ?? null;
    }

    /**
     * Merge a partial update in. Unknown keys are dropped so the client cannot
     * grow the preferences blob with arbitrary content.
     */
    public static function update(User $user, array $changes): array
    {
        $clean = array_intersect_key($changes, self::DEFAULTS);

        foreach ($clean as $key => $value) {
            $clean[$key] = match (true) {
                is_bool(self::DEFAULTS[$key]) => (bool) $value,
                is_float(self::DEFAULTS[$key]) => max(0.5, min(2.0, (float) $value)),
                in_array($key, ['onlineStatus', 'lastSeen'], true) => in_array(
                    $value, [self::EVERYONE, self::CONTACTS, self::NOBODY], true
                ) ? $value : self::DEFAULTS[$key],
                default => $value,
            };
        }

        $preferences = $user->preferences ?? [];
        $preferences[self::KEY] = array_merge(self::for($user), $clean);
        $user->preferences = $preferences;
        $user->save();

        return $preferences[self::KEY];
    }

    /**
     * Whether $viewer may see $subject's presence detail.
     *
     * 'contacts' means the two share at least one conversation, which is the
     * closest thing the portal has to a contact list.
     */
    public static function allowsVisibility(User $subject, User $viewer, string $key): bool
    {
        if ($subject->id === $viewer->id) {
            return true;
        }

        return match (self::get($subject, $key)) {
            self::NOBODY => false,
            self::CONTACTS => self::shareConversation($subject, $viewer),
            default => true,
        };
    }

    private static function shareConversation(User $a, User $b): bool
    {
        return Conversation::query()
            ->forUser($a)
            ->whereHas('participants', fn ($q) => $q->where('user_id', $b->id)->whereNull('left_at'))
            ->exists();
    }
}
