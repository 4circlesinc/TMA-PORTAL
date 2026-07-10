@props([
    'bars' => null,
    'xMax' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('horizontal-01');
    if ($xMax !== null) {
        $preset['xMax'] = (int) $xMax;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeHorizontalBars($preset, $bars);
    $barHeight = (int) ($preset['barHeight'] ?? 28);
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-horizontal-01 ' . $class]) }}
        role="group"
        aria-label="Horizontal bar chart"
        style="--h01-bar-height: {{ $barHeight }}px;"
    >
        <div class="tma-chart-horizontal-01__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-horizontal-01__bar"
                    style="top: {{ $bar['topPct'] }}%; height: {{ $bar['heightPct'] }}%;"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-horizontal-01__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <div
                        class="tma-chart-horizontal-01__pill"
                        style="width: {{ $bar['size'] }}%; background-color: {{ $bar['color'] }};"
                    ></div>
                </div>
            @endforeach
        </div>
    </div>
</div>
