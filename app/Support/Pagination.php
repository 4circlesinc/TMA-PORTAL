<?php

namespace App\Support;

class Pagination
{
    private static ?array $preset = null;

    public static function preset(): array
    {
        if (self::$preset === null) {
            self::$preset = json_decode(
                file_get_contents(base_path('design/pagination.json')),
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

    public static function resultsLabel(string $variant, int $totalResults): ?string
    {
        $variantTokens = self::variantTokens($variant);
        $template = $variantTokens['resultsLabel'] ?? null;

        if ($template === null) {
            return null;
        }

        return str_replace('{count}', (string) $totalResults, $template);
    }
}
