<?php

namespace App\Support;

class TableB
{
    private static ?array $preset = null;

    public static function preset(): array
    {
        if (self::$preset === null) {
            self::$preset = json_decode(
                file_get_contents(base_path('design/table-b.json')),
                true
            );
        }

        return self::$preset;
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

    public static function avatarUrl(string $key): string
    {
        return Avatars::url($key);
    }
}
