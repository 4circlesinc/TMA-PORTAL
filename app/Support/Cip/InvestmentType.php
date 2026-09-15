<?php

namespace App\Support\Cip;

/**
 * The investment options an application is filed under (section 3).
 *
 * Exactly one is chosen, and choosing "Other" makes the free-text
 * specification required, an application whose route the firm cannot name
 * is one nobody can price, template or report on later (section 23 keeps a separate
 * decision template per option, so "Other" without the detail has no
 * template to resolve). Choosing Enterprise Project requires one of its
 * three categories; those live in investment_type_other so the letter
 * template stays on the parent type.
 */
class InvestmentType
{
    public const REAL_ESTATE = 'real_estate';

    public const NATIONAL_ACTION_BONDS = 'national_action_bonds';

    public const NATIONAL_ECONOMIC_FUND = 'national_economic_fund';

    public const ENTERPRISE_PROJECT = 'enterprise_project';

    public const OTHER = 'other';

    public const ENTERPRISE_MARKETING = 'marketing';

    public const ENTERPRISE_INFRASTRUCTURE = 'infrastructure';

    public const ENTERPRISE_HOUSING = 'housing';

    /** value => the label the government form uses. */
    public const ALL = [
        self::REAL_ESTATE => 'Real Estate Project',
        self::NATIONAL_ACTION_BONDS => 'National Action Bonds',
        self::NATIONAL_ECONOMIC_FUND => 'National Economic Fund (Donation)',
        self::ENTERPRISE_PROJECT => 'Enterprise Project',
        self::OTHER => 'Other',
    ];

    /** Enterprise Project categories, stored in investment_type_other. */
    public const ENTERPRISE_CATEGORIES = [
        self::ENTERPRISE_MARKETING => 'Marketing',
        self::ENTERPRISE_INFRASTRUCTURE => 'Infrastructure',
        self::ENTERPRISE_HOUSING => 'Housing',
    ];

    public static function isValid(?string $value): bool
    {
        return $value !== null && array_key_exists($value, self::ALL);
    }

    public static function isEnterpriseCategory(?string $value): bool
    {
        return $value !== null && array_key_exists($value, self::ENTERPRISE_CATEGORIES);
    }

    public static function label(?string $value): string
    {
        return self::ALL[$value] ?? '';
    }

    public static function enterpriseCategoryLabel(?string $value): string
    {
        return self::ENTERPRISE_CATEGORIES[$value] ?? '';
    }

    /** The label to print, with the free text standing in for "Other". */
    public static function display(?string $value, ?string $other = null): string
    {
        if ($value === self::OTHER) {
            return trim((string) $other) !== '' ? trim((string) $other) : 'Other';
        }

        if ($value === self::ENTERPRISE_PROJECT) {
            $category = self::enterpriseCategoryLabel($other);
            $base = self::label($value);

            return $category !== '' ? $base.' — '.$category : $base;
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

    /** @return list<array{value: string, label: string}> */
    public static function enterpriseOptions(): array
    {
        return array_map(
            fn (string $value, string $label) => ['value' => $value, 'label' => $label],
            array_keys(self::ENTERPRISE_CATEGORIES),
            array_values(self::ENTERPRISE_CATEGORIES),
        );
    }

    /**
     * Detail stored beside the investment type: free text for Other, a
     * category value for Enterprise Project, nothing otherwise.
     */
    public static function otherFor(?string $type, mixed $other): ?string
    {
        $trimmed = trim((string) ($other ?? ''));

        if ($type === self::OTHER) {
            return $trimmed !== '' ? $trimmed : null;
        }

        if ($type === self::ENTERPRISE_PROJECT) {
            return self::isEnterpriseCategory($trimmed) ? $trimmed : null;
        }

        return null;
    }
}
