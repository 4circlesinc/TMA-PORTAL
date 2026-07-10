@props([
    'bars' => null,
    'yMax' => null,
    'color' => null,
    'accentColor' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('vertical-10');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    if ($color !== null) {
        $preset['color'] = $color;
    }
    if ($accentColor !== null) {
        $preset['accentColor'] = $accentColor;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeStripBars($preset, $bars);
    $chartHeight = (int) ($preset['height'] ?? 138);
    $chartWidth = (int) ($preset['width'] ?? 440);
@endphp

<div class="tma-chart-scroll tma-chart-scroll--wide">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-vertical-10 ' . $class]) }}
        role="group"
        aria-label="Strip vertical bar chart"
        style="--v10-chart-width: {{ $chartWidth }}; --v10-chart-height: {{ $chartHeight }};"
    >
        <div class="tma-chart-vertical-10__plot">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-vertical-10__bar{{ strcasecmp($bar['color'], $preset['accentColor'] ?? '#ADADFB') === 0 ? ' tma-chart-vertical-10__bar--accent' : '' }}"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                    style="left: {{ $bar['leftPct'] }}%; width: {{ $bar['widthPct'] }}%; top: {{ $bar['topPct'] }}%; height: {{ $bar['heightPct'] }}%; --v10-bar-color: {{ $bar['color'] }};"
                >
                    <span class="tma-chart-vertical-10__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <span class="tma-chart-vertical-10__strip"></span>
                </div>
            @endforeach
        </div>
    </div>
</div>
