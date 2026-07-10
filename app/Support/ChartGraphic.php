<?php

namespace App\Support;

class ChartGraphic
{
    private static array $presets = [];

    public static function preset(string $slug): array
    {
        if (! isset(self::$presets[$slug])) {
            $path = base_path("design/{$slug}.json");
            self::$presets[$slug] = json_decode(file_get_contents($path), true);
        }

        return self::$presets[$slug];
    }

    public static function resolveColor(array $preset, string $key): string
    {
        return $preset['colors'][$key] ?? $key;
    }

    public static function formatBarValue(int $value): string
    {
        return number_format($value);
    }

    public static function barSizePercent(int $value, int $max): float
    {
        if ($max <= 0) {
            return 0;
        }

        return round(min(100, ($value / $max) * 100), 3);
    }

    public static function normalizeBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $max = (int) ($preset['yMax'] ?? 100);

        return array_map(function (array $bar) use ($preset, $max) {
            $value = (int) ($bar['value'] ?? 0);
            $colorKey = $bar['color'] ?? 'cyan';
            $size = isset($bar['size'])
                ? (float) $bar['size']
                : self::barSizePercent($value, $max);

            return [
                'value' => $value,
                'color' => self::resolveColor($preset, $colorKey),
                'size' => max(2, min(100, $size)),
            ];
        }, $source);
    }

    public static function normalizeLayeredBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $max = (int) ($preset['yMax'] ?? 100);

        return array_map(function (array $bar) use ($preset, $max) {
            $value = (int) ($bar['value'] ?? 0);
            $colorKey = $bar['color'] ?? 'cyan';
            $size = isset($bar['size'])
                ? (float) $bar['size']
                : self::barSizePercent($value, $max);
            $size = max(2, min(100, $size));

            $trackSize = isset($bar['trackSize'])
                ? (float) $bar['trackSize']
                : min(100, max($size, round($size * 1.34, 3)));

            $trackSize = max($size, min(100, $trackSize));

            return [
                'value' => $value,
                'color' => self::resolveColor($preset, $colorKey),
                'size' => $size,
                'trackSize' => $trackSize,
            ];
        }, $source);
    }

    public static function segmentCount(int $value, int $max, int $maxSegments = 16): int
    {
        if ($max <= 0) {
            return 2;
        }

        $size = self::barSizePercent($value, $max);

        return max(2, min($maxSegments, (int) round($size / 100 * $maxSegments)));
    }

    public static function generateSegmentOpacities(int $count): array
    {
        if ($count <= 1) {
            return [1.0];
        }

        if ($count === 2) {
            return [1.0, 1.0];
        }

        $opacities = [1.0];

        for ($i = 1; $i < $count - 1; $i++) {
            $t = ($count - 1 - $i) / ($count - 2);
            $opacities[] = round(0.2 + 0.65 * $t, 2);
        }

        $opacities[] = 1.0;

        return $opacities;
    }

    public static function normalizeSegmentedBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $max = (int) ($preset['yMax'] ?? 100);
        $maxSegments = (int) ($preset['maxSegments'] ?? 16);

        return array_map(function (array $bar) use ($preset, $max, $maxSegments) {
            $value = (int) ($bar['value'] ?? 0);
            $colorKey = $bar['color'] ?? 'cyan';
            $segments = $bar['segments'] ?? null;

            if ($segments === null) {
                $count = self::segmentCount($value, $max, $maxSegments);
                $segments = self::generateSegmentOpacities($count);
            }

            return [
                'value' => $value,
                'color' => self::resolveColor($preset, $colorKey),
                'segments' => array_map('floatval', $segments),
            ];
        }, $source);
    }

    public static function resolveAccent(array $preset, string $key): string
    {
        $accents = $preset['accents'] ?? [];

        return $accents[$key] ?? self::resolveColor($preset, $key);
    }

    public static function blockCount(int $value, int $max, float $blockSize = 12.5): int
    {
        if ($max <= 0) {
            return 2;
        }

        $size = self::barSizePercent($value, $max);

        return max(2, min(8, (int) round($size / $blockSize)));
    }

    public static function generateBlocks(int $count): array
    {
        if ($count <= 2) {
            return ['cap-bottom', 'cap-top'];
        }

        $middle = $count - 2;
        $accentCount = $middle >= 1 ? min(2, max(1, $middle - 1)) : 0;
        $darkCount = max(0, $middle - $accentCount);

        $blocks = ['cap-bottom'];

        for ($i = 0; $i < $darkCount; $i++) {
            $blocks[] = 'dark';
        }

        for ($i = 0; $i < $accentCount; $i++) {
            $blocks[] = 'accent';
        }

        $blocks[] = 'cap-top';

        return $blocks;
    }

    public static function normalizeBlockBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $max = (int) ($preset['yMax'] ?? 100);
        $blockSize = (float) ($preset['blockSize'] ?? 12.5);

        return array_map(function (array $bar) use ($max, $blockSize) {
            $value = (int) ($bar['value'] ?? 0);
            $blocks = $bar['blocks'] ?? null;

            if ($blocks === null) {
                $count = self::blockCount($value, $max, $blockSize);
                $blocks = self::generateBlocks($count);
            }

            return [
                'value' => $value,
                'blocks' => $blocks,
            ];
        }, $source);
    }

    public static function generateOpacityBlocks(int $count): array
    {
        if ($count <= 1) {
            return ['accent'];
        }

        $muted = min(2, max(1, $count - 2));
        $accent = max(1, $count - 1 - $muted);
        $blocks = array_fill(0, $accent, 'accent');

        for ($i = 0; $i < $muted; $i++) {
            $blocks[] = 'muted';
        }

        $blocks[] = 'solid';

        return $blocks;
    }

    public static function normalizeOpacityBlockBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $max = (int) ($preset['yMax'] ?? 100);
        $blockSize = (float) ($preset['blockSize'] ?? 12.5);

        return array_map(function (array $bar) use ($max, $blockSize) {
            $value = (int) ($bar['value'] ?? 0);
            $blocks = $bar['blocks'] ?? null;

            if ($blocks === null) {
                $count = self::blockCount($value, $max, $blockSize);
                $blocks = self::generateOpacityBlocks($count);
            }

            return [
                'value' => $value,
                'blocks' => $blocks,
            ];
        }, $source);
    }

    public static function stackTotalPx(array $segments, int $gap = 2): int
    {
        $heights = array_sum(array_map(fn (array $segment) => (float) ($segment['height'] ?? 0), $segments));

        return (int) round($heights + max(0, count($segments) - 1) * $gap);
    }

    public static function generateGradientSegments(int $value, int $max, int $chartHeight = 160, int $gap = 2): array
    {
        $size = self::barSizePercent($value, $max);
        $stackPx = (int) round($size / 100 * $chartHeight);
        $thin = 8;
        $gaps = $gap * 3;
        $variable = max(8, $stackPx - ($thin * 2) - $gaps);
        $tier3 = (int) round($variable * (20 / 56));
        $tier4 = max(8, $variable - $tier3);

        return [
            ['height' => $tier4, 'opacity' => 1],
            ['height' => $tier3, 'opacity' => 0.4],
            ['height' => $thin, 'opacity' => 0.2],
            ['height' => $thin, 'opacity' => 0.1],
        ];
    }

    public static function normalizeGradientBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $max = (int) ($preset['yMax'] ?? 100);
        $chartHeight = (int) ($preset['height'] ?? 160);
        $gap = (int) ($preset['segmentGap'] ?? 2);

        return array_map(function (array $bar) use ($max, $chartHeight, $gap) {
            $value = (int) ($bar['value'] ?? 0);
            $segments = $bar['segments'] ?? null;

            if ($segments === null) {
                $segments = self::generateGradientSegments($value, $max, $chartHeight, $gap);
            }

            return [
                'value' => $value,
                'segments' => $segments,
                'stackTotal' => self::stackTotalPx($segments, $gap),
            ];
        }, $source);
    }

    public static function generatePinHeights(int $value, int $max, int $chartHeight = 160): array
    {
        $size = self::barSizePercent($value, $max);
        $primaryPx = (int) round($size / 100 * $chartHeight);
        $offset = max(3, (int) round($primaryPx * 0.065));
        $secondaryPx = max(8, $primaryPx - $offset);

        return [
            'primary' => round($primaryPx / $chartHeight * 100, 3),
            'secondary' => round($secondaryPx / $chartHeight * 100, 3),
        ];
    }

    public static function normalizePinBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $max = (int) ($preset['yMax'] ?? 100);
        $chartHeight = (int) ($preset['height'] ?? 160);

        return array_map(function (array $bar) use ($max, $chartHeight) {
            $value = (int) ($bar['value'] ?? 0);
            $heights = isset($bar['primary'], $bar['secondary'])
                ? ['primary' => (float) $bar['primary'], 'secondary' => (float) $bar['secondary']]
                : ($bar['heights'] ?? null);

            if ($heights === null) {
                $heights = self::generatePinHeights($value, $max, $chartHeight);
            }

            return [
                'value' => $value,
                'primary' => $heights['primary'],
                'secondary' => $heights['secondary'],
            ];
        }, $source);
    }

    public static function generateSplitPinBounds(int $value, int $max, int $chartHeight = 160, int $split = 80): array
    {
        $size = self::barSizePercent($value, $max);
        $maxTotal = (int) round($chartHeight * 0.825);
        $totalPx = max(16, (int) round($size / 100 * $maxTotal));
        $segmentPx = (int) round($totalPx / 2);

        return [
            'top' => max(0, $split - $segmentPx),
            'bottom' => min($chartHeight, $split + $segmentPx),
        ];
    }

    public static function normalizeSplitPinBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $max = (int) ($preset['yMax'] ?? 100);
        $chartHeight = (int) ($preset['height'] ?? 160);
        $split = (int) ($preset['split'] ?? 80);

        return array_map(function (array $bar) use ($max, $chartHeight, $split) {
            $value = (int) ($bar['value'] ?? 0);

            if (isset($bar['top'], $bar['bottom'])) {
                $top = (float) $bar['top'];
                $bottom = (float) $bar['bottom'];
            } else {
                $bounds = self::generateSplitPinBounds($value, $max, $chartHeight, $split);
                $top = $bounds['top'];
                $bottom = $bounds['bottom'];
            }

            $solid = $split - $top;
            $accent = $bottom - $split;

            return [
                'value' => $value,
                'top' => $top,
                'bottom' => $bottom,
                'solid' => $solid,
                'accent' => $accent,
            ];
        }, $source);
    }

    public static function generateLayeredPillBounds(int $value, int $max, int $chartHeight = 160): array
    {
        $size = self::barSizePercent($value, $max);
        $trackHeight = max(24, (int) round($size / 100 * 145));
        $trackTop = $chartHeight - $trackHeight;
        $offset = max(12, (int) round($trackHeight * 0.16));
        $fgHeight = max(16, $trackHeight - $offset);
        $fgTop = $chartHeight - $fgHeight;

        if ($fgTop < $trackTop) {
            $fgTop = $trackTop + min(12, (int) round($trackHeight * 0.12));
            $fgHeight = $chartHeight - $fgTop;
        }

        return [
            'trackTop' => $trackTop,
            'fgTop' => $fgTop,
            'trackHeight' => $trackHeight,
            'fgHeight' => $fgHeight,
        ];
    }

    public static function normalizeLayeredPillBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $max = (int) ($preset['yMax'] ?? 100);
        $chartHeight = (int) ($preset['height'] ?? 160);

        return array_map(function (array $bar) use ($max, $chartHeight) {
            $value = (int) ($bar['value'] ?? 0);

            if (isset($bar['trackTop'], $bar['fgTop'])) {
                $trackTop = (float) $bar['trackTop'];
                $fgTop = (float) $bar['fgTop'];
            } else {
                $bounds = self::generateLayeredPillBounds($value, $max, $chartHeight);
                $trackTop = $bounds['trackTop'];
                $fgTop = $bounds['fgTop'];
            }

            return [
                'value' => $value,
                'trackTop' => $trackTop,
                'fgTop' => $fgTop,
                'trackHeight' => $chartHeight - $trackTop,
                'fgHeight' => $chartHeight - $fgTop,
            ];
        }, $source);
    }

    public static function generatePillBounds(int $value, int $max, int $chartHeight = 160): array
    {
        $size = self::barSizePercent($value, $max);
        $height = max(16, (int) round($size / 100 * 145));
        $top = $chartHeight - $height;

        return [
            'top' => $top,
            'height' => $height,
        ];
    }

    public static function normalizePillBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $max = (int) ($preset['yMax'] ?? 100);
        $chartHeight = (int) ($preset['height'] ?? 160);

        return array_map(function (array $bar) use ($max, $chartHeight) {
            $value = (int) ($bar['value'] ?? 0);

            if (isset($bar['top'])) {
                $top = (float) $bar['top'];
                $height = $chartHeight - $top;
            } else {
                $bounds = self::generatePillBounds($value, $max, $chartHeight);
                $top = $bounds['top'];
                $height = $bounds['height'];
            }

            return [
                'value' => $value,
                'top' => $top,
                'height' => $height,
            ];
        }, $source);
    }

    public static function formatPercent(int $value): string
    {
        return number_format($value).'%';
    }

    public static function normalizeProportionSections(array $preset, ?array $sections = null): array
    {
        $source = $sections ?? $preset['sections'];

        return array_map(function (array $section) {
            return [
                'key' => $section['key'] ?? 'section',
                'label' => $section['label'] ?? '',
                'value' => (int) ($section['value'] ?? 0),
                'lineCount' => (int) ($section['lineCount'] ?? 20),
                'muted' => (bool) ($section['muted'] ?? false),
                'weight' => (float) ($section['weight'] ?? 1),
            ];
        }, $source);
    }

    public static function normalizeStripBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $max = (int) ($preset['yMax'] ?? 6000);
        $chartHeight = (int) ($preset['height'] ?? 138);
        $chartWidth = (int) ($preset['width'] ?? 440);
        $plotTop = (float) ($preset['plotTop'] ?? 35);
        $plotBottom = (float) ($preset['plotBottom'] ?? 129);
        $maxHeight = (float) ($preset['maxBarHeight'] ?? ($plotBottom - $plotTop));
        $defaultColor = $preset['color'] ?? '#000000';
        $accentColor = $preset['accentColor'] ?? '#ADADFB';
        $defaultWidth = (float) ($preset['barWidth'] ?? 3);

        return array_map(function (array $bar) use ($max, $chartHeight, $chartWidth, $maxHeight, $defaultColor, $accentColor, $defaultWidth, $plotTop, $plotBottom) {
            $width = (float) ($bar['width'] ?? $defaultWidth);
            $x = (float) ($bar['x'] ?? 0);
            $top = (float) ($bar['top'] ?? $plotTop);
            $height = (float) ($bar['height'] ?? ($plotBottom - $top));
            $color = $bar['color'] ?? $defaultColor;
            if (strcasecmp($color, $accentColor) === 0) {
                $color = $accentColor;
            }
            $value = isset($bar['value'])
                ? (int) $bar['value']
                : (int) round($height / $maxHeight * $max);

            return [
                'value' => $value,
                'x' => $x,
                'width' => $width,
                'top' => $top,
                'height' => $height,
                'color' => $color,
                'leftPct' => round(($x - $width / 2) / $chartWidth * 100, 4),
                'widthPct' => round($width / $chartWidth * 100, 4),
                'topPct' => round($top / $chartHeight * 100, 4),
                'heightPct' => round($height / $chartHeight * 100, 4),
            ];
        }, $source);
    }

    public static function normalizeHorizontalBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $chartHeight = (int) ($preset['height'] ?? 240);
        $barHeight = (float) ($preset['barHeight'] ?? 28);
        $mapped = $preset;
        $mapped['yMax'] = (int) ($preset['xMax'] ?? $preset['yMax'] ?? 100);
        $resolved = self::normalizeBars($mapped, $source);

        return array_map(function (array $bar, int $index) use ($preset, $chartHeight, $barHeight, $source) {
            $row = $source[$index] ?? [];
            $top = isset($row['top'])
                ? (float) $row['top']
                : (float) ($preset['barTops'][$index] ?? ($index * 40 + 6));

            return array_merge($bar, [
                'top' => $top,
                'topPct' => round($top / $chartHeight * 100, 4),
                'heightPct' => round($barHeight / $chartHeight * 100, 4),
            ]);
        }, $resolved, array_keys($resolved));
    }

    public static function normalizeHorizontalBlockBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $chartWidth = (int) ($preset['width'] ?? 160);
        $chartHeight = (int) ($preset['height'] ?? 240);
        $max = (int) ($preset['xMax'] ?? $preset['yMax'] ?? 6000);
        $gap = (float) ($preset['blockGap'] ?? 2);
        $blockHeight = (float) ($preset['blockHeight'] ?? 2);
        $blockSize = (float) ($preset['blockSize'] ?? 12.5);
        $color = $preset['color'] ?? '#000000';

        return array_map(function (array $bar, int $index) use ($chartWidth, $chartHeight, $max, $gap, $blockHeight, $blockSize, $color) {
            $value = (int) ($bar['value'] ?? 0);
            $blocks = $bar['blocks'] ?? null;
            $top = (float) ($bar['top'] ?? ($index * 40 + 19));
            $isGeometry = is_array($blocks) && isset($blocks[0]) && is_array($blocks[0]) && array_key_exists('left', $blocks[0]);

            if ($blocks === null || ! $isGeometry) {
                $count = is_array($blocks) ? count($blocks) : self::blockCount($value, $max, $blockSize);
                $totalWidth = self::barSizePercent($value, $max) / 100 * $chartWidth;
                $blockWidth = max(4, ($totalWidth - max(0, $count - 1) * $gap) / max(1, $count));
                $left = 0.0;
                $blocks = [];

                for ($i = 0; $i < $count; $i++) {
                    $type = is_array($bar['blocks'] ?? null) && isset($bar['blocks'][$i]) && is_string($bar['blocks'][$i])
                        ? $bar['blocks'][$i]
                        : 'block';
                    $blocks[] = [
                        'left' => round($left, 3),
                        'width' => round($blockWidth, 3),
                        'top' => $top,
                        'height' => $blockHeight,
                        'type' => $type,
                    ];
                    $left += $blockWidth + $gap;
                }
            }

            $height = (float) ($bar['height'] ?? ($blocks[0]['height'] ?? $blockHeight));

            return [
                'value' => $value,
                'color' => $color,
                'topPct' => round($top / $chartHeight * 100, 4),
                'heightPct' => round($height / $chartHeight * 100, 4),
                'blocks' => array_map(function (array $block) use ($chartWidth) {
                    return [
                        'leftPct' => round(($block['left'] ?? 0) / $chartWidth * 100, 4),
                        'widthPct' => round(($block['width'] ?? 0) / $chartWidth * 100, 4),
                        'type' => $block['type'] ?? 'block',
                    ];
                }, $blocks),
            ];
        }, $source, array_keys($source));
    }

    public static function normalizeHorizontalSegmentedBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $chartWidth = (int) ($preset['width'] ?? 160);
        $chartHeight = (int) ($preset['height'] ?? 240);
        $max = (int) ($preset['xMax'] ?? $preset['yMax'] ?? 6000);
        $gap = (float) ($preset['segmentGap'] ?? 2);
        $opacities = $preset['segmentOpacities'] ?? [1, 0.4, 0.1];
        $defaultColor = $preset['color'] ?? '#000000';

        return array_map(function (array $bar) use ($preset, $chartWidth, $chartHeight, $max, $gap, $opacities, $defaultColor) {
            $colorKey = $bar['color'] ?? 'black';
            $color = is_string($colorKey) && str_starts_with($colorKey, '#')
                ? $colorKey
                : self::resolveColor($preset, $colorKey);
            $value = (int) ($bar['value'] ?? 0);
            $segments = $bar['segments'] ?? null;

            if ($segments === null) {
                $count = count($opacities);
                $totalWidth = self::barSizePercent($value, $max) / 100 * $chartWidth;
                $segmentWidth = max(4, ($totalWidth - ($count - 1) * $gap) / $count);
                $top = (float) ($bar['top'] ?? 16);
                $height = (float) ($bar['height'] ?? 8);
                $left = 0.0;
                $segments = [];

                foreach ($opacities as $opacity) {
                    $segments[] = [
                        'left' => round($left, 3),
                        'width' => round($segmentWidth, 3),
                        'top' => $top,
                        'height' => $height,
                        'opacity' => (float) $opacity,
                    ];
                    $left += $segmentWidth + $gap;
                }
            }

            $top = (float) ($bar['top'] ?? ($segments[0]['top'] ?? 16));
            $height = (float) ($bar['height'] ?? ($segments[0]['height'] ?? 8));

            return [
                'value' => $value,
                'color' => $color,
                'topPct' => round($top / $chartHeight * 100, 4),
                'heightPct' => round($height / $chartHeight * 100, 4),
                'segments' => array_map(function (array $segment) use ($chartWidth) {
                    return [
                        'leftPct' => round(($segment['left'] ?? 0) / $chartWidth * 100, 4),
                        'widthPct' => round(($segment['width'] ?? 0) / $chartWidth * 100, 4),
                        'opacity' => (float) ($segment['opacity'] ?? 1),
                    ];
                }, $segments),
            ];
        }, $source);
    }

    public static function normalizeLayeredHorizontalBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $chartHeight = (int) ($preset['height'] ?? 240);
        $barHeight = (float) ($preset['barHeight'] ?? 28);
        $mapped = $preset;
        $mapped['yMax'] = (int) ($preset['xMax'] ?? $preset['yMax'] ?? 100);
        $resolved = self::normalizeLayeredBars($mapped, $source);

        return array_map(function (array $bar, int $index) use ($preset, $chartHeight, $barHeight, $source) {
            $row = $source[$index] ?? [];
            $top = isset($row['top'])
                ? (float) $row['top']
                : (float) ($preset['barTops'][$index] ?? ($index * 40 + 6));

            return array_merge($bar, [
                'top' => $top,
                'topPct' => round($top / $chartHeight * 100, 4),
                'heightPct' => round($barHeight / $chartHeight * 100, 4),
            ]);
        }, $resolved, array_keys($resolved));
    }

    public static function normalizeStackedStrips(array $preset, ?array $strips = null): array
    {
        $source = $strips ?? $preset['strips'];
        $max = (int) ($preset['yMax'] ?? 6000);
        $chartHeight = (int) ($preset['height'] ?? 212);
        $chartWidth = (int) ($preset['width'] ?? 1100);
        $plotTop = (float) ($preset['plotTop'] ?? 32);
        $plotBottom = (float) ($preset['plotBottom'] ?? 212);
        $maxStack = $plotBottom - $plotTop;
        $defaultWidth = (float) ($preset['stripWidth'] ?? 2);
        $defaultColor = $preset['color'] ?? '#000000';
        $accentColor = $preset['accentColor'] ?? '#ADADFB';
        $mutedOpacity = (float) ($preset['mutedOpacity'] ?? 0.4);

        return array_map(function (array $strip) use ($max, $chartHeight, $chartWidth, $maxStack, $defaultWidth, $defaultColor, $accentColor, $mutedOpacity) {
            $width = (float) ($strip['width'] ?? $defaultWidth);
            $x = (float) ($strip['x'] ?? 0);
            $segments = array_map(function (array $segment) use ($chartHeight, $defaultColor, $accentColor, $mutedOpacity) {
                $color = $segment['color'] ?? $defaultColor;
                $opacity = isset($segment['opacity'])
                    ? (float) $segment['opacity']
                    : (strcasecmp($color, $accentColor) === 0 ? 1.0 : $mutedOpacity);

                return [
                    'top' => (float) ($segment['top'] ?? 0),
                    'height' => (float) ($segment['height'] ?? 0),
                    'color' => strcasecmp($color, $accentColor) === 0 ? $accentColor : $defaultColor,
                    'opacity' => $opacity,
                    'topPct' => round(($segment['top'] ?? 0) / $chartHeight * 100, 4),
                    'heightPct' => round(($segment['height'] ?? 0) / $chartHeight * 100, 4),
                ];
            }, $strip['segments'] ?? []);

            $stackHeight = array_sum(array_column($segments, 'height'));
            $value = isset($strip['value'])
                ? (int) $strip['value']
                : (int) round($stackHeight / $maxStack * $max);

            return [
                'value' => $value,
                'x' => $x,
                'width' => $width,
                'leftPct' => round(($x - $width / 2) / $chartWidth * 100, 4),
                'widthPct' => round($width / $chartWidth * 100, 4),
                'segments' => $segments,
            ];
        }, $source);
    }

    public static function normalizeSemicircleSegments(array $preset, ?array $segments = null): array
    {
        return self::normalizePathSegments($preset, $segments);
    }

    public static function normalizeDonutSegments(array $preset, ?array $segments = null): array
    {
        return self::normalizePathSegments($preset, $segments, includeGradient: true);
    }

    private static function normalizePathSegments(array $preset, ?array $segments = null, bool $includeGradient = false): array
    {
        $source = $segments ?? $preset['segments'];
        $chartWidth = (int) ($preset['width'] ?? 120);
        $chartHeight = (int) ($preset['height'] ?? 120);
        $total = array_sum(array_map(fn (array $segment) => (int) ($segment['value'] ?? 0), $source));

        return array_map(function (array $segment) use ($chartWidth, $chartHeight, $total, $includeGradient) {
            $value = (int) ($segment['value'] ?? 0);
            $anchor = $segment['tooltipAnchor'] ?? ['x' => 50, 'y' => 50];

            $resolved = [
                'key' => $segment['key'] ?? 'segment',
                'value' => $value,
                'path' => $segment['path'] ?? '',
                'color' => $segment['color'] ?? '#000000',
                'opacity' => (float) ($segment['opacity'] ?? 1),
                'percent' => $total > 0 ? (int) round($value / $total * 100) : 0,
                'tooltipLeftPct' => round(($anchor['x'] ?? 50) / $chartWidth * 100, 4),
                'tooltipTopPct' => round(($anchor['y'] ?? 50) / $chartHeight * 100, 4),
            ];

            if ($includeGradient) {
                $resolved['gradient'] = $segment['gradient'] ?? null;
                $resolved['screenOverlay'] = (bool) ($segment['screenOverlay'] ?? false);
            }

            return $resolved;
        }, $source);
    }
}
