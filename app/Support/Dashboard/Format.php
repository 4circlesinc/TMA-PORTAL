<?php

namespace App\Support\Dashboard;

/**
 * How KPI values read on the card. The cards are narrow and the value sits in
 * a large type size, so everything here is built to stay short: two units at
 * most for a duration, one decimal on a percentage.
 */
class Format
{
    /** "3h 24m", "2d 4h", "45m", "under a minute". */
    public static function duration(int $seconds): string
    {
        if ($seconds < 60) {
            return '<1m';
        }

        $minutes = intdiv($seconds, 60);
        $hours = intdiv($minutes, 60);
        $days = intdiv($hours, 24);

        if ($days > 0) {
            $remainingHours = $hours % 24;

            return $remainingHours > 0 ? $days.'d '.$remainingHours.'h' : $days.'d';
        }

        if ($hours > 0) {
            $remainingMinutes = $minutes % 60;

            return $remainingMinutes > 0 ? $hours.'h '.$remainingMinutes.'m' : $hours.'h';
        }

        return $minutes.'m';
    }

    /** Thousands separated, so 1,204 doesn't read as 1204. */
    public static function count(int $value): string
    {
        return number_format($value);
    }

    /**
     * Change against the previous window. A null or zero baseline has no
     * percentage to give — saying "+100%" against nothing would be inventing a
     * trend, so those read as "New" or "—" instead.
     */
    public static function change(int|float $current, int|float|null $prior): string
    {
        if ($prior === null || $prior == 0) {
            return $current > 0 ? 'New' : '—';
        }

        $percent = (($current - $prior) / $prior) * 100;

        if (abs($percent) < 0.05) {
            return 'No change';
        }

        return ($percent > 0 ? '+' : '−').number_format(abs($percent), 1).'%';
    }

    /** "1 client has" / "4 clients have". */
    public static function plural(int $count, string $singular, string $plural): string
    {
        return $count.' '.($count === 1 ? $singular : $plural);
    }
}
