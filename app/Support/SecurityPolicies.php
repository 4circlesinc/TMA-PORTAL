<?php

namespace App\Support;

use Illuminate\Support\Carbon;
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
            // Authenticator app can be required from Sign-in policy. Off by
            // default: email codes already confirm unusual sign-ins, and
            // onboarding still recommends the app (Set later stays available).
            'requireMfa' => false,
            // Getting-started checklist: firm can require provider connects.
            'requireMicrosoftConnect' => false,
            'requireGoogleConnect' => false,
            'requireAuthenticatorApp' => false,
            // Absolute sign-in lifetime in days (Stay signed in, trusted
            // devices, and the session cap). Email codes for unusual sign-ins
            // are always on and are not a stored switch.
            'sessionDays' => 7,
        ],
        'security' => [
            'trustedDomains' => '',
            'callRecordingRetentionDays' => 2555,
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
            'impossibleTravel' => ['admins' => true],
            'downloadTrend' => ['admins' => true],
            'ipCountChange' => ['admins' => false],
            'suspiciousIp' => ['admins' => true],
            'malwareDetected' => ['admins' => true],
            'failedSignInThreshold' => 5,
            'alternateContacts' => '',
        ],
    ];

    public static function get(string $section): array
    {
        $stored = Cache::remember("portal-settings.{$section}", 60, function () use ($section) {
            try {
                $row = DB::table('portal_settings')->where('key', "security.{$section}")->first();
            } catch (\Throwable) {
                return [];
            }

            return $row ? json_decode($row->value, true) : [];
        });

        return array_replace_recursive(self::DEFAULTS[$section] ?? [], $stored ?: []);
    }

    public static function put(string $section, array $value, ?int $userId = null): void
    {
        DB::table('portal_settings')->updateOrInsert(
            ['key' => "security.{$section}"],
            ['value' => json_encode($value), 'updated_at' => now(), 'updated_by' => $userId],
        );

        Cache::forget("portal-settings.{$section}");
    }

    /**
     * Onboarding hides "Set later" and the portal is blocked until an
     * authenticator app is confirmed. Off unless an administrator turns it
     * on in Sign-in policy. Email codes for unusual sign-ins are always on
     * and do not use this flag.
     */
    public static function authenticatorRequired(): bool
    {
        $policy = self::get('sign-in');

        return (bool) ($policy['requireAuthenticatorApp'] ?? false)
            || (bool) ($policy['requireMfa'] ?? false);
    }

    /**
     * Turn off the authenticator gate. Email verification codes stay on.
     */
    public static function disableRequiredAuthenticator(): void
    {
        $policy = self::get('sign-in');
        $policy['requireMfa'] = false;
        $policy['requireAuthenticatorApp'] = false;
        self::put('sign-in', $policy);
    }

    /**
     * Sessions stamped before this instant must sign in again. Null means
     * no extra cutoff beyond the usual sign-in lifetime.
     */
    public static function forceReauthAfter(): ?Carbon
    {
        $stored = Cache::remember('portal-settings.auth.reauth-after', 60, function () {
            try {
                $row = DB::table('portal_settings')->where('key', 'auth.reauth_after')->first();
            } catch (\Throwable) {
                return null;
            }

            if (! $row) {
                return null;
            }

            $raw = $row->value;
            if (is_string($raw)) {
                $decoded = json_decode($raw, true);
                if (is_string($decoded) && $decoded !== '') {
                    $raw = $decoded;
                }
            }

            return is_string($raw) && $raw !== '' ? $raw : null;
        });

        return $stored ? Carbon::parse($stored) : null;
    }

    public static function setForceReauthAfter(Carbon $at): void
    {
        DB::table('portal_settings')->updateOrInsert(
            ['key' => 'auth.reauth_after'],
            [
                'value' => json_encode($at->toIso8601String()),
                'updated_at' => now(),
            ],
        );

        Cache::forget('portal-settings.auth.reauth-after');
    }

    public static function sessionDays(): int
    {
        $days = (int) (self::get('sign-in')['sessionDays'] ?? 7);

        return max(1, min(30, $days));
    }

    /** Days to keep call recordings that are not on legal hold. */
    public static function callRecordingRetentionDays(): int
    {
        $days = (int) (self::get('security')['callRecordingRetentionDays'] ?? 2555);

        return max(30, min(3650, $days));
    }
}
