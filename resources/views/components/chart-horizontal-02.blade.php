@props([
    'bars' => null,
    'xMax' => null,
    'trackOpacity' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('horizontal-02');
    if ($xMax !== null) {
        $preset['xMax'] = (int) $xMax;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeLayeredHorizontalBars($preset, $bars);
    $barHeight = (int) ($preset['barHeight'] ?? 28);
    $trackOpacity = $trackOpacity ?? $preset['trackOpacity'] ?? 0.2;
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-horizontal-02 ' . $class]) }}
        role="group"
        aria-label="Layered horizontal bar chart"
        style="--h02-bar-height: {{ $barHeight }}px; --h02-track-opacity: {{ $trackOpacity }};"
    >
        <div class="tma-chart-horizontal-02__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-horizontal-02__bar"
                    style="top: {{ $bar['topPct'] }}%; height: {{ $bar['heightPct'] }}%;"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-horizontal-02__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <div
                        class="tma-chart-horizontal-02__track"
                        style="width: {{ $bar['trackSize'] }}%; background-color: {{ $bar['color'] }};"
                        aria-hidden="true"
                    ></div>
                    <div
                        class="tma-chart-horizontal-02__pill"
                        style="width: {{ $bar['size'] }}%; background-color: {{ $bar['color'] }};"
                    ></div>
                </div>
            @endforeach
        </div>
    </div>
</div>
