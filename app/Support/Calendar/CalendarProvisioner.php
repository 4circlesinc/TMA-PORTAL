<?php

namespace App\Support\Calendar;

use App\Models\Calendar;
use App\Models\CalendarSubscription;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * Creates the calendars a user is expected to already have, and keeps the
 * "which calendars are in my sidebar" list in step.
 *
 * Only the personal calendar is provisioned: every user needs somewhere for a
 * new event to land, so it is created on first visit and marked `is_system`
 * (undeletable). A Work calendar, team calendars, and the rest are left to
 * the Add Calendar action rather than pre-filling the sidebar with empty
 * calendars nobody asked for.
 */
class CalendarProvisioner
{
    /**
     * The user's personal calendar, created on first call.
     *
     * Also the default destination for a new event when the UI doesn't name
     * a calendar.
     */
    public static function personalFor(User $user): Calendar
    {
        $calendar = Calendar::where('owner_id', $user->id)
            ->where('calendar_type', Calendar::TYPE_PERSONAL)
            ->where('is_system', true)
            ->first();

        if (! $calendar) {
            $calendar = Calendar::create([
                'uuid' => (string) Str::uuid(),
                'name' => 'Personal',
                'description' => 'Your personal calendar.',
                'colour' => 'blue',
                'calendar_type' => Calendar::TYPE_PERSONAL,
                'owner_id' => $user->id,
                'timezone' => self::defaultTimezone($user),
                'visibility' => 'private',
                'default_role' => CalendarAccess::ROLE_AVAILABILITY,
                'source' => Calendar::SOURCE_LOCAL,
                'is_system' => true,
                'created_by' => $user->id,
            ]);
        }

        self::subscribe($user, $calendar);

        return $calendar;
    }

    /**
     * Put a calendar in the user's sidebar list. Idempotent, and never
     * downgrades an existing subscription — re-adding a calendar the user has
     * hidden must not silently re-show it.
     */
    public static function subscribe(User $user, Calendar $calendar, bool $visible = true): CalendarSubscription
    {
        $existing = CalendarSubscription::where('user_id', $user->id)
            ->where('calendar_id', $calendar->id)
            ->first();

        if ($existing) {
            return $existing;
        }

        return CalendarSubscription::create([
            'user_id' => $user->id,
            'calendar_id' => $calendar->id,
            'is_visible' => $visible,
            'sort_order' => (int) CalendarSubscription::where('user_id', $user->id)->max('sort_order') + 1,
        ]);
    }

    /**
     * The user's stored timezone preference, falling back to the app default.
     * Preferences are a free-form JSON blob, so the value is validated before
     * it reaches a calendar row.
     */
    public static function defaultTimezone(User $user): string
    {
        $prefs = $user->preferences ?? [];
        $tz = data_get($prefs, 'calendar.timezone') ?? data_get($prefs, 'timezone');

        if (is_string($tz) && in_array($tz, timezone_identifiers_list(), true)) {
            return $tz;
        }

        return config('app.timezone') ?: 'UTC';
    }
}
