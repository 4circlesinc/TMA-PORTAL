<?php

namespace App\Support\Clients;

use App\Support\Access\Role;
use App\Support\SecurityPolicies;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * How the client hub is shaped, for the whole firm.
 *
 * Account settings > Client hub management > Client hub access edits this, and
 * it is the only administrator-editable overlay on {@see Role}. The five
 * capabilities below were fixed in the matrix, so "who may reach the client
 * hub" — the question the section's own name asks — could only be answered by
 * editing PHP. They are now stored per firm and read back through Role::can(),
 * which means the sidebar, the page gate, the API and the browser's capability
 * list all move together the moment a toggle is saved.
 *
 * Administrators are unaffected: Role::can() short-circuits for them before it
 * ever reaches here, so an administrator cannot revoke their own way back into
 * this screen.
 *
 * Stored in `portal_settings` under one key, next to the security policies —
 * see {@see SecurityPolicies}, whose shape this follows.
 */
class ClientHubSettings
{
    /** The portal_settings row everything here lives in. */
    public const KEY = 'clienthub.access';

    /**
     * The capabilities an administrator may hand to (or take from) employees
     * on this screen, in the order the screen lists them.
     *
     * Only Employee is ever in play. Clients hold none of these in the matrix
     * and must not be able to acquire one — the client hub is the firm's view
     * of its clients, not a client's view of the firm.
     */
    public const MANAGED = [
        'clients.view',
        'clients.viewAll',
        'clients.manage',
        'clients.invite',
        'clients.assign',
    ];

    /** How long a client invitation link may be made to last. */
    public const EXPIRY_CHOICES = [1, 3, 7, 14, 30, 60];

    /**
     * The resolved settings for this request.
     *
     * Role::can() consults these on every capability check and
     * Role::capabilities() asks about all five in one breath, so the 60-second
     * cache below is still one round trip too many. Cleared by self::flush().
     */
    private static ?array $memo = null;

    /**
     * Everything not stored. The capability defaults come from the matrix, so
     * a firm that never opens this screen behaves exactly as it did before it
     * existed, and a matrix edit still moves the baseline.
     *
     * `allowSelfRegistration` defaults to true for the same reason: creating
     * an account from an invitation link is what the flow already did.
     */
    public static function defaults(): array
    {
        return [
            'employee' => Role::baselineEmployeeGrants(),
            'allowSelfRegistration' => true,
            'inviteExpiryDays' => 7,
        ];
    }

    /** The firm's settings, defaults filled in. */
    public static function all(): array
    {
        if (self::$memo !== null) {
            return self::$memo;
        }

        $stored = self::stored();
        $defaults = self::defaults();

        return self::$memo = [
            // Only the managed capabilities survive the merge, so a stale key
            // left by an older release cannot grant anything.
            'employee' => array_map(
                fn (string $capability) => (bool) ($stored['employee'][$capability] ?? $defaults['employee'][$capability]),
                array_combine(self::MANAGED, self::MANAGED),
            ),
            'allowSelfRegistration' => (bool) ($stored['allowSelfRegistration'] ?? $defaults['allowSelfRegistration']),
            'inviteExpiryDays' => self::sanitiseExpiry($stored['inviteExpiryDays'] ?? $defaults['inviteExpiryDays']),
        ];
    }

    /** Does the Employee role hold this client-hub capability? */
    public static function employeeHolds(string $capability): bool
    {
        return self::all()['employee'][$capability] ?? false;
    }

    /** Whether an invited person may create a brand-new account themselves. */
    public static function allowsSelfRegistration(): bool
    {
        return self::all()['allowSelfRegistration'];
    }

    /** How many days a client-facing invitation link stays valid. */
    public static function inviteExpiryDays(): int
    {
        return self::all()['inviteExpiryDays'];
    }

    /** Replace the firm's settings. Callers validate; this only sanitises. */
    public static function put(array $value, ?int $userId = null): void
    {
        $clean = [
            'employee' => array_map(
                fn (string $capability) => (bool) ($value['employee'][$capability] ?? false),
                array_combine(self::MANAGED, self::MANAGED),
            ),
            'allowSelfRegistration' => (bool) ($value['allowSelfRegistration'] ?? true),
            'inviteExpiryDays' => self::sanitiseExpiry($value['inviteExpiryDays'] ?? 7),
        ];

        DB::table('portal_settings')->updateOrInsert(
            ['key' => self::KEY],
            ['value' => json_encode($clean), 'updated_at' => now(), 'updated_by' => $userId],
        );

        self::flush();
    }

    /** Drop the caches, so the next capability check sees the new grants. */
    public static function flush(): void
    {
        self::$memo = null;
        Cache::forget('portal-settings.'.self::KEY);
    }

    /**
     * The raw stored row, or an empty array.
     *
     * Wrapped because Role::can() runs everywhere, including during install
     * and migrations where `portal_settings` may not exist yet. A missing
     * table must fall back to the matrix, never take the portal down.
     */
    private static function stored(): array
    {
        try {
            $stored = Cache::remember('portal-settings.'.self::KEY, 60, function () {
                $row = DB::table('portal_settings')->where('key', self::KEY)->first();

                return $row ? (json_decode($row->value, true) ?: []) : [];
            });
        } catch (Throwable) {
            return [];
        }

        return is_array($stored) ? $stored : [];
    }

    private static function sanitiseExpiry(mixed $days): int
    {
        $days = (int) $days;

        return in_array($days, self::EXPIRY_CHOICES, true) ? $days : 7;
    }
}
