<?php

namespace App\Support;

class StatusBadge
{
    private static ?array $preset = null;

    public static function preset(): array
    {
        if (self::$preset === null) {
            self::$preset = json_decode(
                file_get_contents(base_path('design/status-badge.json')),
                true
            );
        }

        return self::$preset;
    }

    public static function variantTokens(string $variant): array
    {
        $preset = self::preset();
        $variants = $preset['variants'] ?? [];

        return $variants[$variant] ?? $variants['dot-purple'];
    }

    public static function colorValue(string $color): string
    {
        $colors = self::preset()['colors'] ?? [];

        return $colors[$color] ?? $colors['purple'];
    }
}
