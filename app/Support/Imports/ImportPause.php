<?php

namespace App\Support\Imports;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Firm-wide kill switch for background file / document imports.
 *
 * When paused, SharePoint library sync, Smartsheet sheet sync and CBI
 * document import no-op (including their schedulers and "Sync now" /
 * Retry buttons). Personal mailbox and calendar sync keep running —
 * those are per-account connectors, not firm imports.
 *
 * Stored in `portal_settings` like {@see \App\Support\Clients\ClientHubSettings}.
 */
class ImportPause
{
    public const KEY = 'imports.pause';

    private static ?array $memo = null;

    public static function defaults(): array
    {
        return [
            'paused' => false,
        ];
    }

    public static function all(): array
    {
        if (self::$memo !== null) {
            return self::$memo;
        }

        $stored = self::stored();
        $defaults = self::defaults();

        return self::$memo = [
            'paused' => (bool) ($stored['paused'] ?? $defaults['paused']),
            'updatedAt' => $stored['updatedAt'] ?? null,
            'updatedBy' => isset($stored['updatedBy']) ? (int) $stored['updatedBy'] : null,
        ];
    }

    /** True when administrators have paused firm imports. */
    public static function active(): bool
    {
        return self::all()['paused'] === true;
    }

    public static function put(bool $paused, ?int $userId = null): void
    {
        $clean = [
            'paused' => $paused,
            'updatedAt' => now()->toIso8601String(),
            'updatedBy' => $userId,
        ];

        DB::table('portal_settings')->updateOrInsert(
            ['key' => self::KEY],
            ['value' => json_encode($clean), 'updated_at' => now(), 'updated_by' => $userId],
        );

        self::flush();
    }

    public static function flush(): void
    {
        self::$memo = null;
        Cache::forget('portal-settings.'.self::KEY);
    }

    private static function stored(): array
    {
        try {
            $stored = Cache::remember('portal-settings.'.self::KEY, 60, function () {
                $row = DB::table('portal_settings')->where('key', self::KEY)->first();

                return $row ? (json_decode($row->value, true) ?: []) : [];
            });

            return is_array($stored) ? $stored : [];
        } catch (Throwable) {
            return [];
        }
    }
}
