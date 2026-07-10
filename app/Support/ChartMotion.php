<?php

namespace App\Support;

class ChartMotion
{
    private static array $presets = [];

    public static function preset(string $variant = '01'): array
    {
        if (! isset(self::$presets[$variant])) {
            $path = base_path("design/chart-motion-{$variant}.json");
            self::$presets[$variant] = json_decode(file_get_contents($path), true);
        }

        return self::$presets[$variant];
    }

    public static function colors(array $preset): array
    {
        return $preset['colors'];
    }

    public static function resolveColor(array $preset, string $key): string
    {
        return self::colors($preset)[$key] ?? $key;
    }

    public static function formatAxisLabel(int $value): string
    {
        if ($value === 0) {
            return '0';
        }

        if ($value % 1000 === 0) {
            return ($value / 1000) . 'K';
        }

        return number_format($value);
    }

    public static function formatBarValue(int $value): string
    {
        return number_format($value);
    }

    public static function barSizePercent(int $value, int $max): float
    {
        return round(($value / $max) * 100, 3);
    }

    public static function axisTicks(int $max, int $step): array
    {
        $ticks = [];
        for ($v = 0; $v <= $max; $v += $step) {
            $ticks[] = $v;
        }

        return $ticks;
    }

    public static function normalizeBars(array $preset, ?array $bars = null): array
    {
        $source = $bars ?? $preset['bars'];
        $max = $preset['xMax'] ?? $preset['yMax'];

        return array_map(function (array $bar, int $index) use ($preset, $max) {
            $colorKey = $bar['color'] ?? 'cyan';
            $labels = $preset['labels'] ?? [];

            return [
                'label' => $bar['label'] ?? ($labels[$index] ?? ''),
                'value' => (int) ($bar['value'] ?? 0),
                'color' => self::resolveColor($preset, $colorKey),
                'size' => self::barSizePercent((int) ($bar['value'] ?? 0), $max),
            ];
        }, $source, array_keys($source));
    }

    public static function plotBounds(array $preset): array
    {
        return $preset['plot'] ?? ['x' => 0, 'y' => 0, 'width' => 100, 'height' => 100];
    }

    public static function normalizePoints(array $preset, ?array $points = null): array
    {
        $source = $points ?? $preset['points'];
        $labels = $preset['labels'] ?? [];

        return array_map(function (array $point, int $index) use ($labels) {
            $normalized = [
                'label' => $point['label'] ?? ($labels[$index] ?? ''),
                'value' => (int) ($point['value'] ?? 0),
            ];

            if (isset($point['x'], $point['y'])) {
                $normalized['x'] = (float) $point['x'];
                $normalized['y'] = (float) $point['y'];
            }

            return $normalized;
        }, $source, array_keys($source));
    }

    public static function coordsInPlot(array $points, int $max, array $plot): array
    {
        $count = count($points);

        return array_map(function (array $point, int $index) use ($count, $max, $plot) {
            $x = $plot['x'] + ($count > 1 ? ($index / ($count - 1)) * $plot['width'] : $plot['width'] / 2);
            $y = $plot['y'] + $plot['height'] - (($point['value'] / $max) * $plot['height']);

            return [
                'x' => round($x, 3),
                'y' => round($y, 3),
                'label' => $point['label'],
                'value' => $point['value'],
            ];
        }, $points, array_keys($points));
    }

    public static function pointPercents(array $point, array $plot): array
    {
        return [
            'left' => round((($point['x'] - $plot['x']) / $plot['width']) * 100, 3),
            'top' => round((($point['y'] - $plot['y']) / $plot['height']) * 100, 3),
        ];
    }

    public static function resolveLineChart(array $preset, ?array $points = null): array
    {
        $plot = self::plotBounds($preset);
        $max = (int) $preset['yMax'];
        $useFigmaPaths = $points === null && ! empty($preset['linePath']) && ! empty($preset['areaPath']);

        if ($useFigmaPaths) {
            $resolvedPoints = self::normalizePoints($preset, null);

            return [
                'plot' => $plot,
                'linePath' => $preset['linePath'],
                'areaPath' => $preset['areaPath'],
                'points' => array_map(function (array $point) use ($plot) {
                    return array_merge($point, self::pointPercents($point, $plot));
                }, $resolvedPoints),
            ];
        }

        $resolvedPoints = self::normalizePoints($preset, $points);
        $coords = self::coordsInPlot($resolvedPoints, $max, $plot);
        $linePath = self::smoothLinePath($coords);
        $baseline = $plot['y'] + $plot['height'];

        return [
            'plot' => $plot,
            'linePath' => $linePath,
            'areaPath' => self::areaPath($linePath, $baseline),
            'points' => array_map(function (array $coord) use ($plot) {
                return array_merge($coord, self::pointPercents($coord, $plot));
            }, $coords),
        ];
    }

    public static function smoothLinePath(array $coords): string
    {
        if (count($coords) === 0) {
            return '';
        }

        if (count($coords) === 1) {
            return 'M ' . $coords[0]['x'] . ' ' . $coords[0]['y'];
        }

        $path = 'M ' . $coords[0]['x'] . ' ' . $coords[0]['y'];

        for ($i = 0; $i < count($coords) - 1; $i++) {
            $p0 = $coords[max(0, $i - 1)];
            $p1 = $coords[$i];
            $p2 = $coords[$i + 1];
            $p3 = $coords[min(count($coords) - 1, $i + 2)];

            $cp1x = round($p1['x'] + ($p2['x'] - $p0['x']) / 6, 3);
            $cp1y = round($p1['y'] + ($p2['y'] - $p0['y']) / 6, 3);
            $cp2x = round($p2['x'] - ($p3['x'] - $p1['x']) / 6, 3);
            $cp2y = round($p2['y'] - ($p3['y'] - $p1['y']) / 6, 3);

            $path .= " C {$cp1x} {$cp1y}, {$cp2x} {$cp2y}, {$p2['x']} {$p2['y']}";
        }

        return $path;
    }

    public static function areaPath(string $linePath, float $baseline = 100): string
    {
        if ($linePath === '') {
            return '';
        }

        if (! preg_match('/M\s*([\d.]+)\s+([\d.]+)/', $linePath, $start)) {
            return $linePath;
        }

        if (! preg_match('/([\d.]+)\s+([\d.]+)\s*$/', $linePath, $end)) {
            return $linePath;
        }

        return $linePath
            . ' L ' . $end[1] . ' ' . $baseline
            . ' L ' . $start[1] . ' ' . $baseline
            . ' Z';
    }
}
