<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Carbon;

/**
 * The time zone a person reads the portal in (Settings → Time and language).
 *
 * Storage stays UTC and model casting is untouched, only *display* moves.
 * Shifting the application time zone per request would re-interpret every
 * stored timestamp instead of re-presenting it, which silently moves real
 * data; this converts a UTC instant to the reader's wall clock at the moment
 * it is printed, and nowhere else.
 *
 * Anything fanned out to several people at once (a broadcast message) must
 * NOT be formatted here, one string cannot be right for two zones. Those
 * carry an ISO timestamp and are formatted by the browser.
 */
final class UserTime
{
    /** The reader's IANA zone, falling back to the app's. */
    public static function zone(?User $user): string
    {
        $prefs = $user?->preferences ?? [];
        $tz = data_get($prefs, 'calendar.timezone') ?? data_get($prefs, 'timezone');

        // The settings picker's manual ids are utc±N offsets; PHP's Etc/GMT
        // zones express the same thing, with POSIX's inverted sign.
        if (is_string($tz) && preg_match('/^utc([+-])(\d{1,2})$/i', $tz, $m)) {
            $n = (int) $m[2];
            $tz = $n === 0 ? 'Etc/GMT' : 'Etc/GMT'.($m[1] === '-' ? '+' : '-').$n;
        }

        if (is_string($tz) && $tz !== '') {
            try {
                new \DateTimeZone($tz);

                return $tz;
            } catch (\Exception) {
                // fall through to the app default
            }
        }

        return config('app.timezone') ?: 'UTC';
    }

    /** The same instant, on the reader's wall clock. */
    public static function for(?Carbon $at, ?User $user): ?Carbon
    {
        return $at?->copy()->setTimezone(self::zone($user));
    }

    /** Format an instant in the reader's zone. */
    public static function format(?Carbon $at, ?User $user, string $format): string
    {
        return self::for($at, $user)?->format($format) ?? '';
    }
}
