<?php

namespace App\Support\Calendar;

/**
 * The approved calendar colour palette.
 *
 * Mirrors App\Support\Files\FolderColours in shape, and every hue resolves to
 * an existing design token rather than a new one — blue/green/pink/red come
 * straight from the folder palette and teal is the chart mint.
 *
 * The `purple` key is historical: the calendar has always named this tone
 * "purple", but the design system has no purple (--color-violet is aliased to
 * the brand blue, --color-purple is a do-not-use legacy alias). It therefore
 * maps to --color-primary-dark, the deep brand blue, so it is actually
 * distinguishable from `blue` in the picker. Keep in sync with
 * public/js/calendar-colours.js.
 */
class CalendarColours
{
    public const PALETTE = [
        'blue' => ['token' => '--color-blue', 'hex' => '#7dbbff', 'label' => 'Blue'],
        'purple' => ['token' => '--color-primary-dark', 'hex' => '#136da0', 'label' => 'Deep blue'],
        'green' => ['token' => '--color-green', 'hex' => '#71dd8c', 'label' => 'Green'],
        'teal' => ['token' => '--color-mint', 'hex' => '#6be6d3', 'label' => 'Teal'],
        'pink' => ['token' => '--color-pink', 'hex' => '#ff90e8', 'label' => 'Pink'],
        'red' => ['token' => '--color-red', 'hex' => '#ff4747', 'label' => 'Red'],
    ];

    public const DEFAULT = 'blue';

    /** @return array<int, string> */
    public static function keys(): array
    {
        return array_keys(self::PALETTE);
    }

    public static function isValid(?string $colour): bool
    {
        return $colour !== null && array_key_exists($colour, self::PALETTE);
    }

    /** Coerce anything unrecognised to the default rather than storing it. */
    public static function normalise(?string $colour): string
    {
        return self::isValid($colour) ? $colour : self::DEFAULT;
    }
}
