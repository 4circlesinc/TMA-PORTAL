<?php

namespace App\Support\Cip;

/**
 * The investment options an application is filed under (§3).
 *
 * Exactly one is chosen, and choosing "Other" makes the free-text
 * specification required, an application whose route the firm cannot name
 * is one nobody can price, template or report on later (§23 keeps a separate
 * decision template per option, so "Other" without the detail has no
 * template to resolve).
 */
class InvestmentType
{
    public const REAL_ESTATE = 'real_estate';

    public const NATIONAL_ACTION_BONDS = 'national_action_bonds';

    public const NATIONAL_ECONOMIC_FUND = 'national_economic_fund';

    public const ENTERPRISE_PROJECT = 'enterprise_project';

    public const OTHER = 'other';

    /** value => the label the government form uses. */
    public const ALL = [
        self::REAL_ESTATE => 'Real Estate Project',
        self::NATIONAL_ACTION_BONDS => 'National Action Bonds',
        self::NATIONAL_ECONOMIC_FUND => 'National Economic Fund (Donation)',
        self::ENTERPRISE_PROJECT => 'Enterprise Project',
        self::OTHER => 'Other',
    ];

    public static function isValid(?string $value): bool
    {
        return $value !== null && array_key_exists($value, self::ALL);
    }

    public static function label(?string $value): string
    {
        return self::ALL[$value] ?? '';
    }

    /** The label to print, with the free text standing in for "Other". */
    public static function display(?string $value, ?string $other = null): string
    {
        if ($value === self::OTHER) {
            return trim((string) $other) !== '' ? trim((string) $other) : 'Other';
        }

        return self::label($value);
    }

    /** @return list<array{value: string, label: string}> */
    public static function options(): array
    {
        return array_map(
            fn (string $value, string $label) => ['value' => $value, 'label' => $label],
            array_keys(self::ALL),
            array_values(self::ALL),
        );
    }
}
