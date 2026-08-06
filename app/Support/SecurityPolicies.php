<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Org-wide security policies, stored in portal_settings and edited from
 * Account settings > Security by administrators.
 */
class SecurityPolicies
{
    public const SECTIONS = ['sign-in', 'security', 'device', 'alerts'];

    public const DEFAULTS = [
        'sign-in' => [
            'minLength' => 10,
            'numbersRequired' => 0,
            'specialRequired' => 0,
            'requireMfa' => false,
        ],
        'security' => [
            'trustedDomains' => '',
            'autoRemediation' => [
                'impossibleTravel' => true,
                'downloadTrend' => true,
                'ipCountChange' => false,
                'failedSignIns' => true,
                'suspiciousIp' => true,
            ],
        ],
        'device' => [
            'defaultMode' => 'standard',
            'selfDestruct' => 'After 7 days offline',
        ],
        /*
         * Who is told when something happens to an account, beyond the person
         * it happened to. See App\Support\Security\SecurityAlertPolicy for what
         * each event means and why the list is only two long.
         *
         * Administrators are not notified by default: on a small firm every
         * new laptop would page them, and an alert nobody reads is worse than
         * no alert. Alternate contacts default to none.
         */
        'alerts' => [
            'newDevice' => ['admins' => false],
            'failedSignIns' => ['admins' => true],
            'failedSignInThreshold' => 5,
            'alternateContacts' => '',
        ],
    ];

    public static function get(string $section): array
    {
        $stored = Cache::remember("portal-settings.{$section}", 60, function () use ($section) {
            $row = DB::table('portal_settings')->where('key', "security.{$section}")->first();

            return $row ? json_decode($row->value, true) : [];
        });

        return array_replace_recursive(self::DEFAULTS[$section], $stored ?: []);
    }

    public static function put(string $section, array $value, ?int $userId = null): void
    {
        DB::table('portal_settings')->updateOrInsert(
            ['key' => "security.{$section}"],
            ['value' => json_encode($value), 'updated_at' => now(), 'updated_by' => $userId],
        );

        Cache::forget("portal-settings.{$section}");
    }
}
