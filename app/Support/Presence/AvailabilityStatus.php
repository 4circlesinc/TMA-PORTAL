<?php

namespace App\Support\Presence;

/**
 * Registry of availability statuses. Add new slugs here, priority and labels
 * follow from this single list.
 */
final class AvailabilityStatus
{
    public const ONLINE = 'online';

    public const OFFLINE = 'offline';

    public const ON_CALL = 'on_call';

    public const AT_MEETING = 'at_meeting';

    public const DO_NOT_DISTURB = 'do_not_disturb';

    public const IN_OFFICE = 'in_office';

    public const WORKING_REMOTE = 'working_remote';

    public const AWAY = 'away';

    /** Extensible future statuses, registered but not yet surfaced in UI. */
    public const AVAILABLE = 'available';

    public const BE_RIGHT_BACK = 'be_right_back';

    public const ON_VACATION = 'on_vacation';

    public const OUT_SICK = 'out_sick';

    public const FOCUS_TIME = 'focus_time';

    public const WORKING = 'working';

    public const NOTIFICATIONS_MUTED = 'notifications_muted';

    public const CUSTOM = 'custom';

    /** Highest priority first. */
    public const PRIORITY = [
        self::ON_CALL,
        self::DO_NOT_DISTURB,
        self::AT_MEETING,
        self::AWAY,
        self::IN_OFFICE,
        self::WORKING_REMOTE,
        self::AVAILABLE,
        self::ONLINE,
        self::OFFLINE,
    ];

    public const LABELS = [
        self::ONLINE => 'Online',
        self::OFFLINE => 'Offline',
        self::ON_CALL => 'On a Call',
        self::AT_MEETING => 'At a Meeting',
        self::DO_NOT_DISTURB => 'Do Not Disturb',
        self::IN_OFFICE => 'In Office',
        self::WORKING_REMOTE => 'Working Remote',
        self::AWAY => 'Away',
        self::AVAILABLE => 'Available',
        self::BE_RIGHT_BACK => 'Be Right Back',
        self::ON_VACATION => 'On Vacation',
        self::OUT_SICK => 'Out Sick',
        self::FOCUS_TIME => 'Focus Time',
        self::WORKING => 'Working',
        self::NOTIFICATIONS_MUTED => 'Notifications Muted',
        self::CUSTOM => 'Custom Status',
    ];

    public const ICONS = [
        self::ONLINE => 'green',
        self::OFFLINE => 'gray',
        self::ON_CALL => 'red',
        self::AT_MEETING => 'calendar',
        self::DO_NOT_DISTURB => 'dnd',
        self::IN_OFFICE => 'office',
        self::WORKING_REMOTE => 'home',
        self::AWAY => 'away',
        self::AVAILABLE => 'green',
        self::BE_RIGHT_BACK => 'brb',
        self::ON_VACATION => 'vacation',
        self::OUT_SICK => 'sick',
        self::FOCUS_TIME => 'focus',
        self::WORKING => 'working',
        self::NOTIFICATIONS_MUTED => 'muted',
        self::CUSTOM => 'custom',
    ];

    /** Statuses a user may pick from the header dropdown. */
    public const MANUAL_PICKS = [
        self::AVAILABLE,
        self::ON_CALL,
        self::AT_MEETING,
        self::DO_NOT_DISTURB,
        self::IN_OFFICE,
        self::WORKING_REMOTE,
        self::AWAY,
    ];

    public const SOURCE_AUTOMATIC = 'automatic';

    public const SOURCE_MANUAL = 'manual';

    public const SOURCE_SCHEDULED = 'scheduled';

    public const SOURCE_LOCATION = 'location';

    public const SOURCE_CALL = 'call';

    public const SOURCE_SYSTEM = 'system';

    public static function label(string $status): string
    {
        return self::LABELS[$status] ?? ucfirst(str_replace('_', ' ', $status));
    }

    public static function isValid(string $status): bool
    {
        return isset(self::LABELS[$status]);
    }

    public static function priorityOf(string $status): int
    {
        $idx = array_search($status, self::PRIORITY, true);

        return $idx === false ? 999 : $idx;
    }
}
