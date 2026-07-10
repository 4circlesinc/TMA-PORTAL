<?php

namespace App\Support;

class TableFilterSort
{
    private static ?array $preset = null;

    public static function preset(): array
    {
        if (self::$preset === null) {
            self::$preset = json_decode(
                file_get_contents(base_path('design/table-filter-sort.json')),
                true
            );
        }

        return self::$preset;
    }

    public static function filterFields(): array
    {
        return self::preset()['filterFields'] ?? [];
    }

    public static function operators(): array
    {
        return self::preset()['operators'] ?? [];
    }

    public static function statusOptions(): array
    {
        return self::preset()['statusOptions'] ?? [];
    }

    public static function iconUrl(string $key): string
    {
        $sources = self::preset()['iconSources'] ?? [];

        return asset($sources[$key] ?? '');
    }

    public static function tokens(): array
    {
        return self::preset()['tokens'] ?? [];
    }
}
