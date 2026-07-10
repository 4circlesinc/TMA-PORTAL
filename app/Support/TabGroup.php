<?php

namespace App\Support;

class TabGroup
{
    private static ?array $preset = null;

    public static function preset(): array
    {
        if (self::$preset === null) {
            self::$preset = json_decode(
                file_get_contents(base_path('design/tab-segmented.json')),
                true
            );
        }

        return self::$preset;
    }

    public static function iconPath(string $name): string
    {
        $tma = base_path('public/images/icons/tma/' . $name . '.svg');
        if (file_exists($tma)) {
            return asset('images/icons/tma/' . $name . '.svg');
        }

        return asset('images/icons/phosphor/' . $name . '.svg');
    }

    public static function normalizeTabs(?array $tabs, int $activeIndex = 0, bool $groupIconOnly = false): array
    {
        $preset = self::preset();
        $source = $tabs ?? array_map(
            fn (array $tab, int $index) => array_merge($tab, ['active' => $index === 0]),
            $preset['demoTabs'] ?? [],
            array_keys($preset['demoTabs'] ?? [])
        );

        $hasExplicitActive = collect($source)->contains(fn (array $tab) => ! empty($tab['active']));

        return array_map(function (array $tab, int $index) use ($hasExplicitActive, $activeIndex, $groupIconOnly) {
            $active = $hasExplicitActive
                ? ! empty($tab['active'])
                : $index === $activeIndex;

            $iconOnly = $groupIconOnly || ! empty($tab['iconOnly']);

            return [
                'key' => $tab['key'] ?? 'tab-' . ($index + 1),
                'label' => $tab['label'] ?? ($iconOnly ? '' : 'Tab'),
                'href' => $tab['href'] ?? null,
                'icon' => $tab['icon'] ?? null,
                'iconPath' => ! empty($tab['icon']) ? self::iconPath($tab['icon']) : null,
                'iconOnly' => $iconOnly,
                'active' => $active,
            ];
        }, $source, array_keys($source));
    }

    public static function sizeTokens(string $size): array
    {
        $preset = self::preset();
        $sizes = $preset['sizes'] ?? [];

        return $sizes[$size] ?? $sizes['medium'];
    }
}
