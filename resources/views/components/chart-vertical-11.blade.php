@props([
    'bars' => null,
    'yMax' => null,
    'color' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('vertical-11');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizePillBars($preset, $bars);
    $barColor = $color ?? $preset['color'] ?? '#000000';
    $chartHeight = (int) ($preset['height'] ?? 160);
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-vertical-11 ' . $class]) }}
        role="group"
        aria-label="Pill vertical bar chart"
        style="--v11-color: {{ $barColor }}; --v11-chart-height: {{ $chartHeight }};"
    >
        <div class="tma-chart-vertical-11__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-vertical-11__bar"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-vertical-11__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <div
                        class="tma-chart-vertical-11__pill"
                        style="top: {{ round($bar['top'] / $chartHeight * 100, 3) }}%; height: {{ round($bar['height'] / $chartHeight * 100, 3) }}%;"
                    ></div>
                </div>
            @endforeach
        </div>
    </div>
</div>
