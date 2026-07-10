<?php

namespace App\Support;

class GlobalSearch
{
    private static ?array $preset = null;

    public static function preset(): array
    {
        if (self::$preset === null) {
            self::$preset = json_decode(
                file_get_contents(base_path('design/global-search.json')),
                true
            );
        }

        return self::$preset;
    }

    public static function searchIndex(): array
    {
        return self::preset()['searchIndex'] ?? [];
    }

    public static function rules(): array
    {
        return self::preset()['rules'] ?? [];
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
