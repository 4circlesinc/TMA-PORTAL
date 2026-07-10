<?php

namespace App\Support;

class TableAddData
{
    private static ?array $preset = null;

    public static function preset(): array
    {
        if (self::$preset === null) {
            self::$preset = json_decode(
                file_get_contents(base_path('design/table-add-data.json')),
                true
            );
        }

        return self::$preset;
    }

    public static function interactionRules(): array
    {
        return self::preset()['addInteraction'] ?? [];
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
