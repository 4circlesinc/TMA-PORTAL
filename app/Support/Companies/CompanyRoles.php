<?php

namespace App\Support\Companies;

/**
 * What each company role may do, by default.
 *
 * The spec's warning — "do not assume every company member should have full
 * access" — is the whole point of this class. A role is a starting point, not
 * the answer: it seeds the `can_*` flags on a company_members row, and from
 * then on the flags are what get checked. That means one finance contact can be
 * given contract-signing rights without inventing a new role, and nobody
 * silently inherits more because their role was edited later.
 */
final class CompanyRoles
{
    public const PRIMARY = 'primary';

    public const FINANCE = 'finance';

    public const EVENT = 'event';

    public const SIGNATORY = 'signatory';

    public const VIEWER = 'viewer';

    public const MEMBER = 'member';

    public const LABELS = [
        self::PRIMARY => 'Primary contact',
        self::FINANCE => 'Finance contact',
        self::EVENT => 'Event contact',
        self::SIGNATORY => 'Contract signatory',
        self::VIEWER => 'Viewer',
        self::MEMBER => 'Company member',
    ];

    /** Every permission flag a member row carries. */
    public const ABILITIES = [
        'can_view_bookings',
        'can_manage_bookings',
        'can_view_files',
        'can_upload_files',
        'can_view_invoices',
        'can_view_contracts',
        'can_sign_contracts',
        'can_invite_others',
    ];

    /**
     * The default flags for each role.
     *
     * Read these as "what would this person be surprised *not* to have". A
     * finance contact who cannot open an invoice is useless; a viewer who can
     * upload is a mistake waiting to happen.
     */
    private const DEFAULTS = [
        self::PRIMARY => [
            'can_view_bookings' => true,
            'can_manage_bookings' => true,
            'can_view_files' => true,
            'can_upload_files' => true,
            'can_view_invoices' => true,
            'can_view_contracts' => true,
            'can_sign_contracts' => true,
            'can_invite_others' => true,
        ],
        self::FINANCE => [
            'can_view_files' => true,
            'can_view_invoices' => true,
            // Deliberately no contracts and no bookings: the finance contact
            // is here for the money, and internal notes on a booking are not
            // theirs to read.
        ],
        self::EVENT => [
            'can_view_bookings' => true,
            'can_manage_bookings' => true,
            'can_view_files' => true,
            'can_upload_files' => true,
        ],
        self::SIGNATORY => [
            'can_view_files' => true,
            'can_view_contracts' => true,
            'can_sign_contracts' => true,
        ],
        self::VIEWER => [
            'can_view_files' => true,
        ],
        self::MEMBER => [
            'can_view_files' => true,
        ],
    ];

    public static function exists(string $role): bool
    {
        return array_key_exists($role, self::LABELS);
    }

    public static function label(string $role): string
    {
        return self::LABELS[$role] ?? self::LABELS[self::MEMBER];
    }

    /** @return array<int, string> */
    public static function all(): array
    {
        return array_keys(self::LABELS);
    }

    /**
     * The full flag set for a role — every ability present, so a caller never
     * has to guess whether a missing key means false.
     *
     * @return array<string, bool>
     */
    public static function defaults(string $role): array
    {
        $set = self::DEFAULTS[$role] ?? self::DEFAULTS[self::MEMBER];

        return collect(self::ABILITIES)
            ->mapWithKeys(fn (string $ability) => [$ability => (bool) ($set[$ability] ?? false)])
            ->all();
    }

    /**
     * Apply a role's defaults, then any explicit overrides on top.
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, bool>
     */
    public static function resolve(string $role, array $overrides = []): array
    {
        $flags = self::defaults($role);

        foreach (self::ABILITIES as $ability) {
            if (array_key_exists($ability, $overrides)) {
                $flags[$ability] = (bool) $overrides[$ability];
            }
        }

        return $flags;
    }

    /** @return array<int, array<string, string>> */
    public static function options(): array
    {
        return collect(self::LABELS)
            ->map(fn (string $label, string $value) => ['value' => $value, 'label' => $label])
            ->values()->all();
    }
}
