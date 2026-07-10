@props([
    'bars' => null,
    'yMax' => null,
    'color' => null,
    'trackOpacity' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('vertical-12');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeLayeredPillBars($preset, $bars);
    $barColor = $color ?? $preset['color'] ?? '#000000';
    $trackAlpha = $trackOpacity ?? $preset['trackOpacity'] ?? 0.1;
    $chartHeight = (int) ($preset['height'] ?? 160);
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-vertical-12 ' . $class]) }}
        role="group"
        aria-label="Layered pill vertical bar chart"
        style="--v12-color: {{ $barColor }}; --v12-track-opacity: {{ $trackAlpha }}; --v12-chart-height: {{ $chartHeight }};"
    >
        <div class="tma-chart-vertical-12__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-vertical-12__bar"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-vertical-12__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <div
                        class="tma-chart-vertical-12__pill tma-chart-vertical-12__pill--track"
                        style="top: {{ round($bar['trackTop'] / $chartHeight * 100, 3) }}%; height: {{ round($bar['trackHeight'] / $chartHeight * 100, 3) }}%;"
                        aria-hidden="true"
                    ></div>
                    <div
                        class="tma-chart-vertical-12__pill tma-chart-vertical-12__pill--foreground"
                        style="top: {{ round($bar['fgTop'] / $chartHeight * 100, 3) }}%; height: {{ round($bar['fgHeight'] / $chartHeight * 100, 3) }}%;"
                    ></div>
                </div>
            @endforeach
        </div>
    </div>
</div>
