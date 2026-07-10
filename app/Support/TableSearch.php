<?php

namespace App\Support;

class TableSearch
{
    private static ?array $preset = null;

    public static function preset(): array
    {
        if (self::$preset === null) {
            self::$preset = json_decode(
                file_get_contents(base_path('design/table-search.json')),
                true
            );
        }

        return self::$preset;
    }

    public static function rows(): array
    {
        return TableA::rows();
    }

    public static function searchResultsRows(): array
    {
        return array_slice(self::rows(), 0, 10);
    }

    public static function iconUrl(string $key): string
    {
        $sources = self::preset()['iconSources'] ?? [];

        return asset($sources[$key] ?? '');
    }

    public static function interactionRules(): array
    {
        return self::preset()['searchInteraction'] ?? [];
    }
}
