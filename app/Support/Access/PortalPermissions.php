<?php

namespace App\Support\Access;

use App\Support\Clients\ClientHubSettings;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Firm-wide sharing and visibility defaults.
 *
 * Account settings > Advanced Preferences > Permissions edits this. It is the
 * second administrator-editable overlay on {@see Role}, after
 * {@see ClientHubSettings}, and follows that class exactly — one
 * `portal_settings` row, a memo plus a short cache, and a flush that makes the
 * next capability check see the change.
 *
 * The two settings are deliberately different kinds of thing:
 *
 *  - `directoryForEmployees` grants a capability, so it resolves through
 *    Role::can() and moves the sidebar, the page gate, the API and the
 *    browser's capability list together.
 *  - `clientSharing` is not a capability — a client's right to re-share is a
 *    property of the item they hold, not of their account — so it is enforced
 *    at the one choke point every share decision already passes through,
 *    {@see \App\Support\Files\FileAccess::can()}.
 *
 * Both default to the behaviour the portal had before this screen existed, so
 * a firm that never opens it notices nothing.
 */
class PortalPermissions
{
    /** The portal_settings row everything here lives in. */
    public const KEY = 'portal.permissions';

    /**
     * Capabilities this screen may hand to employees.
     *
     * Only `directory.view` for now. Clients are never in play: the People
     * section is the firm's own directory, and a client enumerating the firm
     * is not what "show it to non-administrators" is asking for.
     */
    public const MANAGED = ['directory.view'];

    /** Resolved settings for this request. Cleared by self::flush(). */
    private static ?array $memo = null;

    /**
     * Everything not stored.
     *
     * The capability default comes from the matrix, so a matrix edit still
     * moves the baseline and a firm that never touches this screen behaves
     * exactly as it did. `clientSharing` defaults to false for the same
     * reason — clients could not re-share before this setting existed, and a
     * new setting must not quietly widen access on the day it ships.
     */
    public static function defaults(): array
    {
        return [
            'employee' => Role::baselineGrantsFor(self::MANAGED),
            'clientSharing' => false,
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
            'clientSharing' => (bool) ($stored['clientSharing'] ?? $defaults['clientSharing']),
        ];
    }

    /** Does the Employee role hold this managed capability? */
    public static function employeeHolds(string $capability): bool
    {
        return self::all()['employee'][$capability] ?? false;
    }

    /**
     * Whether a client account may share a file or folder onward.
     *
     * Read by FileAccess::can() for the `share` ability. Staff are never asked
     * about — this decides what clients may do with what has been shared with
     * them, which is the whole question the setting exists to answer.
     */
    public static function allowsClientSharing(): bool
    {
        return self::all()['clientSharing'];
    }

    /** Replace the firm's settings. Callers validate; this only sanitises. */
    public static function put(array $value, ?int $userId = null): void
    {
        $clean = [
            'employee' => array_map(
                fn (string $capability) => (bool) ($value['employee'][$capability] ?? false),
                array_combine(self::MANAGED, self::MANAGED),
            ),
            'clientSharing' => (bool) ($value['clientSharing'] ?? false),
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
     * Wrapped for the same reason ClientHubSettings::stored() is: Role::can()
     * runs during install and migrations, where `portal_settings` may not
     * exist yet. A missing table falls back to the matrix rather than taking
     * the portal down.
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
}
