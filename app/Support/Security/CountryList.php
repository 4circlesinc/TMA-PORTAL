<?php

namespace App\Support\Security;

/**
 * ISO 3166-1 alpha-2 codes and their English names, for the geo picker.
 *
 * Separate from App\Support\Cip\Countries, which is keyed by *name* and
 * exists to derive a region for the government form. Geo-blocking works
 * in codes, because a code is what Cloudflare sends, and mapping one list
 * onto the other would mean a country rule silently missing whenever the two
 * spellings disagreed ("Turkiye" vs "Türkiye", "St. Lucia" vs "Saint Lucia").
 *
 * Names come from ICU through ext-intl rather than a table maintained here:
 * a hand-kept list of 250 countries is a list that goes stale, and the one
 * place it would be noticed is an administrator hunting for a country that
 * is spelled differently than they expect. If intl is ever unavailable the
 * code itself is shown, which is what the field accepted before this.
 */
final class CountryList
{
    /**
     * Every assignable alpha-2 code.
     *
     * Hard-coded rather than enumerated from ICU because ICU also carries
     * historical and macro-regions (AN, 001, QO…) that are not places anybody
     * signs in from. This is the current assignable set, which is what an
     * edge can actually report.
     *
     * @var list<string>
     */
    private const CODES = [
        'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
        'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
        'BT', 'BV', 'BW', 'BY', 'BZ',
        'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW',
        'CX', 'CY', 'CZ',
        'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
        'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
        'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
        'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT',
        'GU', 'GW', 'GY',
        'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
        'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
        'JE', 'JM', 'JO', 'JP',
        'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
        'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
        'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS',
        'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
        'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
        'OM',
        'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
        'QA',
        'RE', 'RO', 'RS', 'RU', 'RW',
        'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
        'ST', 'SV', 'SX', 'SY', 'SZ',
        'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
        'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
        'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
        'WF', 'WS',
        'YE', 'YT',
        'ZA', 'ZM', 'ZW',
    ];

    /**
     * Options for the picker: `[['code' => 'LC', 'name' => 'St. Lucia'], …]`,
     * sorted by name so the list reads the way somebody scans it.
     *
     * @return list<array{code: string, name: string}>
     */
    public static function options(): array
    {
        $options = [];

        foreach (self::CODES as $code) {
            $options[] = ['code' => $code, 'name' => self::name($code)];
        }

        usort($options, fn (array $a, array $b) => strcasecmp($a['name'], $b['name']));

        return $options;
    }

    /** The English name for a code, or the code itself when it cannot be resolved. */
    public static function name(string $code): string
    {
        $code = strtoupper(trim($code));

        if (! class_exists(\Locale::class)) {
            return $code;
        }

        $name = \Locale::getDisplayRegion('-'.$code, 'en');

        // ICU hands back the input for anything it does not recognise.
        return ($name === '' || $name === $code) ? $code : $name;
    }

    public static function isAssignable(string $code): bool
    {
        return in_array(strtoupper(trim($code)), self::CODES, true);
    }
}
