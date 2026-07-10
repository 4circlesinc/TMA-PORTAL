<?php

namespace App\Support;

class TableA
{
    private static ?array $preset = null;

    public static function preset(): array
    {
        if (self::$preset === null) {
            self::$preset = json_decode(
                file_get_contents(base_path('design/table-a.json')),
                true
            );
        }

        return self::$preset;
    }

    public static function variantTokens(string $variant): array
    {
        $preset = self::preset();
        $variants = $preset['variants'] ?? [];

        return $variants[$variant] ?? $variants['default'] ?? [];
    }

    public static function iconPath(string $name): string
    {
        $preset = self::preset();
        $sources = $preset['iconSources'] ?? [];

        if (isset($sources[$name])) {
            $set = $sources[$name]['set'];
            $file = $sources[$name]['file'];

            return asset('images/icons/' . $set . '/' . $file);
        }

        return asset('images/icons/tma/' . $name . '.svg');
    }

    public static function rows(): array
    {
        return self::preset()['rows'] ?? [];
    }

    public static function statusVariant(string $status): string
    {
        $map = self::preset()['statusVariants'] ?? [];

        return $map[$status] ?? 'dot-muted';
    }

    public static function borderVariant(array $row): string
    {
        $variant = $row['rowVariant'] ?? $row['state'] ?? 'default';

        return $variant === 'section-end' ? 'section-end' : 'default';
    }

    public static function isRowChecked(array $row): bool
    {
        return (bool) ($row['checked'] ?? (($row['state'] ?? '') === 'selected'));
    }
}
