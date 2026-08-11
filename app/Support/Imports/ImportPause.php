<?php

namespace App\Support\Imports;

use App\Models\SharePointConnection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Per-import pause switches for firm background imports.
 *
 * Administrators pause one source at a time — Smartsheet document import,
 * personal OneDrive sync, or a single SharePoint library — rather than one
 * kill switch for everything. Mailbox and calendar sync are untouched.
 *
 * Stored in `portal_settings` like {@see \App\Support\Clients\ClientHubSettings}.
 */
class ImportPause
{
    public const KEY = 'imports.pause';

    public const TARGET_SMARTSHEET = 'smartsheet';

    public const TARGET_ONEDRIVE = 'onedrive';

    private static ?array $memo = null;

    public static function defaults(): array
    {
        return [
            'services' => [
                self::TARGET_SMARTSHEET => false,
                self::TARGET_ONEDRIVE => false,
            ],
            'libraries' => [],
        ];
    }

    public static function all(): array
    {
        if (self::$memo !== null) {
            return self::$memo;
        }

        $stored = self::normalise(self::stored());
        $defaults = self::defaults();

        $libraries = [];
        foreach (($stored['libraries'] ?? []) as $uuid => $paused) {
            $uuid = (string) $uuid;
            if ($uuid === '') {
                continue;
            }
            $libraries[$uuid] = (bool) $paused;
        }

        return self::$memo = [
            'services' => [
                self::TARGET_SMARTSHEET => (bool) ($stored['services'][self::TARGET_SMARTSHEET]
                    ?? $defaults['services'][self::TARGET_SMARTSHEET]),
                self::TARGET_ONEDRIVE => (bool) ($stored['services'][self::TARGET_ONEDRIVE]
                    ?? $defaults['services'][self::TARGET_ONEDRIVE]),
            ],
            'libraries' => $libraries,
            'updatedAt' => $stored['updatedAt'] ?? null,
            'updatedBy' => isset($stored['updatedBy']) ? (int) $stored['updatedBy'] : null,
        ];
    }

    /** True when Smartsheet → client-folder document import is paused. */
    public static function smartsheet(): bool
    {
        return self::all()['services'][self::TARGET_SMARTSHEET] === true;
    }

    /** True when personal OneDrive sync is paused. */
    public static function onedrive(): bool
    {
        return self::all()['services'][self::TARGET_ONEDRIVE] === true;
    }

    /** True when this SharePoint library connection is paused. */
    public static function library(string $uuid): bool
    {
        return (self::all()['libraries'][$uuid] ?? false) === true;
    }

    /**
     * True when this connection should not sync — OneDrive uses the service
     * switch; site libraries use their own uuid entry.
     */
    public static function connection(SharePointConnection $connection): bool
    {
        if ($connection->drive_kind === 'onedrive') {
            return self::onedrive();
        }

        return self::library((string) $connection->uuid);
    }

    /** Any import source currently paused (for coarse status badges). */
    public static function any(): bool
    {
        $all = self::all();
        if ($all['services'][self::TARGET_SMARTSHEET] || $all['services'][self::TARGET_ONEDRIVE]) {
            return true;
        }

        foreach ($all['libraries'] as $paused) {
            if ($paused) {
                return true;
            }
        }

        return false;
    }

    /**
     * @deprecated Use smartsheet() / onedrive() / connection() — kept so
     *   older call sites that meant “everything” still compile during the
     *   split. Prefer the specific helpers.
     */
    public static function active(): bool
    {
        return self::any();
    }

    /**
     * Pause or resume one target.
     *
     * @param  string  $target  smartsheet | onedrive | library:{uuid}
     */
    public static function putTarget(string $target, bool $paused, ?int $userId = null): void
    {
        $all = self::all();

        if ($target === self::TARGET_SMARTSHEET || $target === self::TARGET_ONEDRIVE) {
            $all['services'][$target] = $paused;
        } elseif (str_starts_with($target, 'library:')) {
            $uuid = substr($target, strlen('library:'));
            if ($uuid === '') {
                throw new \InvalidArgumentException('Library pause needs a connection id.');
            }
            if ($paused) {
                $all['libraries'][$uuid] = true;
            } else {
                unset($all['libraries'][$uuid]);
            }
        } else {
            throw new \InvalidArgumentException('Unknown import pause target.');
        }

        self::persist($all, $userId);
    }

    public static function flush(): void
    {
        self::$memo = null;
        Cache::forget('portal-settings.'.self::KEY);
    }

    /**
     * Rows for the Background Operations page — one switch per import source.
     *
     * @return list<array{id: string, kind: string, name: string, detail: string, paused: bool}>
     */
    public static function catalogue(): array
    {
        $rows = [];

        if (config('services.smartsheet.cbi_enabled')) {
            $rows[] = [
                'id' => self::TARGET_SMARTSHEET,
                'kind' => 'smartsheet',
                'name' => 'Smartsheet documents',
                'detail' => 'Copy Smartsheet attachments into client folders (CBI).',
                'paused' => self::smartsheet(),
            ];
        }

        $rows[] = [
            'id' => self::TARGET_ONEDRIVE,
            'kind' => 'onedrive',
            'name' => 'OneDrive',
            'detail' => 'Personal OneDrive sync for staff who connected Microsoft.',
            'paused' => self::onedrive(),
        ];

        $libraries = SharePointConnection::query()
            ->with('folder:id,uuid,name')
            ->where('drive_kind', '!=', 'onedrive')
            ->orderBy('id')
            ->get();

        foreach ($libraries as $connection) {
            $name = $connection->folder?->name
                ?: ($connection->site_name ?: $connection->drive_name)
                ?: 'SharePoint library';

            $rows[] = [
                'id' => 'library:'.$connection->uuid,
                'kind' => 'library',
                'name' => $name,
                'detail' => trim(($connection->site_name ?: '').' · '.($connection->drive_name ?: 'Documents'), ' ·'),
                'paused' => self::library((string) $connection->uuid),
            ];
        }

        return $rows;
    }

    private static function persist(array $all, ?int $userId): void
    {
        $clean = [
            'services' => [
                self::TARGET_SMARTSHEET => (bool) ($all['services'][self::TARGET_SMARTSHEET] ?? false),
                self::TARGET_ONEDRIVE => (bool) ($all['services'][self::TARGET_ONEDRIVE] ?? false),
            ],
            'libraries' => array_map('boolval', $all['libraries'] ?? []),
            'updatedAt' => now()->toIso8601String(),
            'updatedBy' => $userId,
        ];

        // Drop resumed libraries so the JSON stays small.
        $clean['libraries'] = array_filter(
            $clean['libraries'],
            fn (bool $paused) => $paused
        );

        DB::table('portal_settings')->updateOrInsert(
            ['key' => self::KEY],
            ['value' => json_encode($clean), 'updated_at' => now(), 'updated_by' => $userId],
        );

        self::flush();
    }

    /** Accept the old single-boolean shape from the first pause release. */
    private static function normalise(array $stored): array
    {
        if (array_key_exists('paused', $stored) && ! isset($stored['services'])) {
            $all = (bool) $stored['paused'];

            return [
                'services' => [
                    self::TARGET_SMARTSHEET => $all,
                    self::TARGET_ONEDRIVE => $all,
                ],
                'libraries' => [],
                'updatedAt' => $stored['updatedAt'] ?? null,
                'updatedBy' => $stored['updatedBy'] ?? null,
                '_legacyAll' => $all,
            ];
        }

        return $stored;
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
