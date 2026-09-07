<?php

namespace App\Support\Signatures;

use DateTimeInterface;

/**
 * The date formats a "Date signed" field may use.
 *
 * Deliberately a fixed list keyed by name rather than a PHP format string
 * carried on the field: the value is chosen in the editor, stored, and then
 * handed to date formatting at signing time. A stored format string would be
 * an instruction from a request - `format()` would run whatever it was given,
 * happily leaking e.g. the server's timezone or full timestamp into a signed
 * document.
 */
class DateFormat
{
    /** What a field with no explicit choice uses - the original behaviour. */
    public const DEFAULT = 'd_mon_y';

    /** key => [PHP format, human label] */
    private const FORMATS = [
        'd_mon_y' => ['j M Y', '7 Sep 2026'],
        'dmy_slash' => ['d/m/Y', '07/09/2026'],
        'mdy_slash' => ['m/d/Y', '09/07/2026'],
        'iso' => ['Y-m-d', '2026-09-07'],
        'long_dmy' => ['j F Y', '7 September 2026'],
        'long_mdy' => ['F j, Y', 'September 7, 2026'],
    ];

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::FORMATS);
    }

    public static function isValid(?string $key): bool
    {
        return $key !== null && array_key_exists($key, self::FORMATS);
    }

    /** The PHP format for a key, falling back to the default. */
    public static function pattern(?string $key): string
    {
        return self::FORMATS[$key ?? self::DEFAULT][0] ?? self::FORMATS[self::DEFAULT][0];
    }

    /** A worked example, for the editor's picker. */
    public static function label(string $key): string
    {
        return self::FORMATS[$key][1] ?? $key;
    }

    /**
     * The options the editor offers, each labelled with the date it produces
     * so the author picks by what they will see, not by a format code.
     *
     * @return list<array{key: string, label: string}>
     */
    public static function options(?DateTimeInterface $on = null): array
    {
        $when = $on ?? now();

        return array_map(fn (string $key) => [
            'key' => $key,
            'label' => $when->format(self::pattern($key)),
        ], self::keys());
    }

    public static function format(?string $key, ?DateTimeInterface $on = null): string
    {
        return ($on ?? now())->format(self::pattern($key));
    }
}
