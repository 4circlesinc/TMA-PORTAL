<?php

namespace App\Support;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Support\Carbon;
use App\Support\Cache\SoftCache;
use Illuminate\Support\Facades\DB;

/**
 * Org-wide security policies, stored in portal_settings and edited from
 * Account settings > Security by administrators.
 */
class SecurityPolicies
{
    public const SECTIONS = ['sign-in', 'security', 'device', 'alerts', 'geo'];

    /**
     * Account types an administrator may require an authenticator for from
     * Sign-in policy. Canonical Role values only (aliases resolve at check time).
     *
     * The four types the firm actually issues. Role::EMPLOYEE is deliberately
     * absent: it is parked, never granted by the Users page or an invitation
     * (see AdminUsersController::ACCOUNT_TYPES), so offering it here was a
     * fifth checkbox for a type nobody can be.
     *
     * This list is also the filter in {@see normalizeAuthenticatorAccountTypes()},
     * so dropping a type here stops any *stored* requirement for it applying
     * as well. That is the intended reading — a parked type cannot be required
     * — but it means removing a LIVE type from this list would quietly switch
     * off its requirement rather than merely hide the checkbox. There are no
     * Employee accounts for it to affect; if one is ever created, the type has
     * been unparked and belongs back in this list.
     *
     * @var list<string>
     */
    public const AUTHENTICATOR_ACCOUNT_TYPES = [
        Role::ADMINISTRATOR,
        Role::REVIEWING_OFFICER,
        Role::SERVICE_PROVIDER_ADMIN,
        Role::CLIENT,
    ];

    /**
     * Labels for the Sign-in policy checkboxes.
     *
     * @var array<string, string>
     */
    public const AUTHENTICATOR_ACCOUNT_TYPE_LABELS = [
        Role::ADMINISTRATOR => 'Administrators',
        Role::REVIEWING_OFFICER => 'CRO / Reviewing officers',
        Role::SERVICE_PROVIDER_ADMIN => 'Service Provider admins',
        Role::CLIENT => 'Clients',
    ];

    public const DEFAULTS = [
        'sign-in' => [
            'minLength' => 10,
            'numbersRequired' => 0,
            'specialRequired' => 0,
            // Authenticator app can be required from Sign-in policy. Off by
            // default: email codes already confirm a new browser, and
            // onboarding still recommends the app (Set later stays available).
            'requireMfa' => false,
            // Getting-started checklist: firm can require provider connects.
            'requireMicrosoftConnect' => false,
            'requireGoogleConnect' => false,
            'requireAuthenticatorApp' => false,
            // Per account-type requirements. Empty means none. Legacy rows
            // that only set requireAuthenticatorApp/requireMfa still mean
            // every account type until an administrator saves the new UI.
            'requireAuthenticatorForAccountTypes' => [],
            // Absolute sign-in lifetime in days (Stay signed in, trusted
            // devices, and the session cap). Email codes for a new browser
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
        /*
         * Geographic restrictions. Off by default and deliberately so: a
         * country list is a legal/compliance decision for the firm, not
         * something a deploy should start enforcing on its own.
         *
         * `mode` is 'off', 'allow' (only these countries may in) or 'block'
         * (these may not). `countries` is a list of ISO 3166-1 alpha-2 codes.
         *
         * `blockUnknown` refuses a request whose country the edge did not
         * report. It is the strict setting the firm asked for, and it is the
         * one that can strand people, so {@see \App\Support\Security\GeoAccess}
         * never applies it where there is no edge to report a country at all.
         */
        'geo' => [
            'mode' => 'off',
            'countries' => [],
            'blockUnknown' => false,
            'message' => 'The portal is not available from your location.',
            // Refuse VPNs, proxies and Tor. Independent of `mode`: the firm
            // may want no anonymisers without restricting countries at all.
            // See App\Support\Security\Anonymiser for what this can and
            // cannot actually see.
            'blockVpn' => false,
            'vpnMessage' => 'Turn off your VPN or proxy to use the portal.',
        ],
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
        $stored = SoftCache::remember("portal-settings.{$section}", 60, function () use ($section) {
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

        SoftCache::forget("portal-settings.{$section}");
    }

    /**
     * Account types the sign-in policy currently requires an authenticator for.
     *
     * Legacy `requireAuthenticatorApp` / `requireMfa` alone still means every
     * type. Once an administrator saves the per-type list, that list wins and
     * the legacy flags stay in sync (true only when every type is selected).
     *
     * @return list<string>
     */
    public static function authenticatorRequiredAccountTypes(): array
    {
        $policy = self::get('sign-in');

        // Legacy everyone toggle still means every type, even if a partial
        // list was left behind in an older row.
        if ((bool) ($policy['requireAuthenticatorApp'] ?? false)
            || (bool) ($policy['requireMfa'] ?? false)) {
            return self::AUTHENTICATOR_ACCOUNT_TYPES;
        }

        return self::normalizeAuthenticatorAccountTypes(
            $policy['requireAuthenticatorForAccountTypes'] ?? []
        );
    }

    /**
     * Does the sign-in policy require an authenticator for this person?
     *
     * With no user, true when any account type (or the legacy everyone flag)
     * is required — used by tests and "is the org requiring anything?" checks.
     * Email codes for a new browser are always on and do not use this.
     */
    public static function authenticatorRequired(?User $user = null): bool
    {
        $types = self::authenticatorRequiredAccountTypes();

        if ($user === null) {
            return $types !== [];
        }

        $accountType = Role::of($user);

        return $accountType !== null && in_array($accountType, $types, true);
    }

    /**
     * Keep the legacy everyone flags and the per-type list in agreement before
     * writing Sign-in policy.
     *
     * @param  array<string, mixed>  $policy
     * @return array<string, mixed>
     */
    public static function syncAuthenticatorRequirement(array $policy): array
    {
        $types = self::normalizeAuthenticatorAccountTypes(
            $policy['requireAuthenticatorForAccountTypes'] ?? []
        );

        // Older clients still POST only the boolean. Treat that as every type
        // when the list was omitted or empty and the toggle is on.
        $legacyOn = (bool) ($policy['requireAuthenticatorApp'] ?? false)
            || (bool) ($policy['requireMfa'] ?? false);
        if ($types === [] && $legacyOn) {
            $types = self::AUTHENTICATOR_ACCOUNT_TYPES;
        }

        $everyone = $types !== []
            && count($types) === count(self::AUTHENTICATOR_ACCOUNT_TYPES);

        $policy['requireAuthenticatorForAccountTypes'] = $types;
        $policy['requireAuthenticatorApp'] = $everyone;
        $policy['requireMfa'] = $everyone;

        return $policy;
    }

    /**
     * @param  mixed  $types
     * @return list<string>
     */
    public static function normalizeAuthenticatorAccountTypes(mixed $types): array
    {
        if (! is_array($types)) {
            return [];
        }

        $aliases = [
            'Reviewing Officer' => Role::REVIEWING_OFFICER,
            'Compliance Officer' => Role::REVIEWING_OFFICER,
        ];

        $normalized = [];
        foreach ($types as $type) {
            if (! is_string($type) || $type === '') {
                continue;
            }
            $canonical = $aliases[$type] ?? $type;
            if (in_array($canonical, self::AUTHENTICATOR_ACCOUNT_TYPES, true)) {
                $normalized[] = $canonical;
            }
        }

        return array_values(array_unique($normalized));
    }

    /**
     * Turn off the authenticator gate. Email verification codes stay on.
     */
    public static function disableRequiredAuthenticator(): void
    {
        $policy = self::get('sign-in');
        $policy['requireMfa'] = false;
        $policy['requireAuthenticatorApp'] = false;
        $policy['requireAuthenticatorForAccountTypes'] = [];
        self::put('sign-in', $policy);
    }

    /**
     * Sessions stamped before this instant must sign in again. Null means
     * no extra cutoff beyond the usual sign-in lifetime.
     */
    public static function forceReauthAfter(): ?Carbon
    {
        $stored = SoftCache::remember('portal-settings.auth.reauth-after', 60, function () {
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

        SoftCache::forget('portal-settings.auth.reauth-after');
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
