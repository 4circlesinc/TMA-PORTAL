<?php

namespace App\Support\Cbi;

/**
 * Reading people's and firms' names out of Smartsheet free text.
 *
 * Every name in the caseload was typed by hand into a spreadsheet cell, so the
 * same person or company arrives shouted, padded, abbreviated, and sometimes
 * with an address stapled on. These are the two decisions that keeps being
 * made about that text, in one place so the client importer and the assignee
 * matcher cannot drift apart on it.
 */
class Names
{
    /** Values that mean "nobody", not somebody called that. */
    private const EMPTY_MARKERS = ['', 'na', 'n/a', 'none', '-', '--', 'tbd', 'unassigned'];

    /** Case and whitespace folded away, and nothing else. */
    public static function normalise(string $value): string
    {
        return mb_strtolower(self::tidy($value));
    }

    public static function tidy(string $value): string
    {
        return trim(preg_replace('/\s+/', ' ', $value) ?? '');
    }

    private static function tokenCount(string $value): int
    {
        $tidied = self::tidy($value);

        return $tidied === '' ? 0 : count(explode(' ', $tidied));
    }

    public static function isEmptyMarker(string $value): bool
    {
        return in_array(self::normalise($value), self::EMPTY_MARKERS, true);
    }

    /**
     * Split "Mayella Dupres <mdupres@example.com>" into its two halves.
     *
     * @return array{name: string, email: ?string}
     */
    public static function splitEmail(string $value): array
    {
        $value = self::tidy($value);

        if (preg_match('/^(.*?)\s*<\s*([^>]+?)\s*>$/', $value, $m)) {
            return ['name' => self::tidy($m[1]), 'email' => mb_strtolower(self::tidy($m[2]))];
        }

        // A bare address in the cell is an address, not a name.
        if (filter_var($value, FILTER_VALIDATE_EMAIL)) {
            return ['name' => '', 'email' => mb_strtolower($value)];
        }

        return ['name' => $value, 'email' => null];
    }

    /**
     * Which spelling of a name to show, given every spelling seen and how
     * often.
     *
     * Prefer one somebody typed in mixed case: it differs from both its
     * shouted and its whispered form, so it was a choice rather than a stuck
     * key. Failing that, title-case an all-lower one — no acronym is written
     * that way — but leave an all-upper one alone, because GCC and RIF are as
     * likely as a stuck caps lock and mangling those is the worse error.
     *
     * @param  array<int, array{name: string, n: int}>  $variants
     */
    public static function display(array $variants): string
    {
        /*
         * Fullest spelling first, then commonest. Frequency alone picks the
         * wrong one for people: "Carlos" is typed far more often than "Carlos
         * Labadie", but it is the abbreviation, not the name. Company groups
         * only ever hold one token count, so this changes nothing for them.
         */
        usort($variants, function ($a, $b) {
            $tokens = self::tokenCount($b['name']) <=> self::tokenCount($a['name']);

            return $tokens !== 0 ? $tokens : ($b['n'] <=> $a['n']);
        });

        $fullest = self::tokenCount($variants[0]['name']);
        $variants = array_values(array_filter(
            $variants,
            fn ($v) => self::tokenCount($v['name']) === $fullest
        ));

        foreach ($variants as $variant) {
            $name = self::tidy($variant['name']);
            if ($name !== '' && $name !== mb_strtoupper($name) && $name !== mb_strtolower($name)) {
                return $name;
            }
        }

        $fallback = self::tidy($variants[0]['name']);

        return $fallback === mb_strtolower($fallback)
            ? mb_convert_case($fallback, MB_CASE_TITLE, 'UTF-8')
            : $fallback;
    }
}
