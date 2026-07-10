<?php

namespace App\Support;

class Tooltip
{
    private static ?array $preset = null;

    public static function preset(): array
    {
        if (self::$preset === null) {
            self::$preset = json_decode(
                file_get_contents(base_path('design/tooltip.json')),
                true
            );
        }

        return self::$preset;
    }

    public static function variantTokens(string $variant): array
    {
        $preset = self::preset();
        $variants = $preset['variants'] ?? [];

        return $variants[$variant] ?? $variants['compact'];
    }

    public static function iconPath(string $name): string
    {
        $tma = base_path('public/images/icons/tma/' . $name . '.svg');
        if (file_exists($tma)) {
            return asset('images/icons/tma/' . $name . '.svg');
        }

        $phosphor = base_path('public/images/icons/phosphor/' . $name . '.svg');
        if (file_exists($phosphor)) {
            return asset('images/icons/phosphor/' . $name . '.svg');
        }

        return asset('images/icons/tma/DefaultIcon.svg');
    }

    public static function behavior(): array
    {
        $preset = self::preset();

        return $preset['behavior'] ?? [
            'initialDelayMs' => 1500,
            'rehoverDelayMs' => 500,
            'rehoverWindowMs' => 30000,
        ];
    }
}
