<?php

namespace App\Support;

class FilterAndSort
{
    private static ?array $preset = null;

    public static function preset(): array
    {
        if (self::$preset === null) {
            self::$preset = json_decode(
                file_get_contents(base_path('design/filter-and-sort.json')),
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

        $tma = base_path('public/images/icons/tma/' . $name . '.svg');
        if (file_exists($tma)) {
            return asset('images/icons/tma/' . $name . '.svg');
        }

        return asset('images/icons/phosphor/' . $name . '.svg');
    }

    public static function defaultTags(): array
    {
        return self::preset()['tags'] ?? [];
    }
}
