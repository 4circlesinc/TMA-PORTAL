@props([
    'strips' => null,
    'yMax' => null,
    'color' => null,
    'accentColor' => null,
    'mutedOpacity' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('vertical-09');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    if ($color !== null) {
        $preset['color'] = $color;
    }
    if ($accentColor !== null) {
        $preset['accentColor'] = $accentColor;
    }
    if ($mutedOpacity !== null) {
        $preset['mutedOpacity'] = (float) $mutedOpacity;
    }
    $resolvedStrips = \App\Support\ChartGraphic::normalizeStackedStrips($preset, $strips);
    $chartHeight = (int) ($preset['height'] ?? 212);
    $chartWidth = (int) ($preset['width'] ?? 1100);
@endphp

<div class="tma-chart-scroll tma-chart-scroll--wide">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-vertical-09 ' . $class]) }}
        role="group"
        aria-label="Stacked strip vertical bar chart"
        style="--v09-chart-width: {{ $chartWidth }}; --v09-chart-height: {{ $chartHeight }};"
    >
        <div class="tma-chart-vertical-09__plot">
            @foreach ($resolvedStrips as $index => $strip)
                <div
                    class="tma-chart-vertical-09__strip"
                    tabindex="0"
                    role="button"
                    aria-label="Strip {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($strip['value']) }}"
                    style="left: {{ $strip['leftPct'] }}%; width: {{ $strip['widthPct'] }}%;"
                >
                    <span class="tma-chart-vertical-09__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($strip['value']) }}
                    </span>
                    @foreach ($strip['segments'] as $segment)
                        <span
                            class="tma-chart-vertical-09__segment"
                            style="top: {{ $segment['topPct'] }}%; height: {{ $segment['heightPct'] }}%; background-color: {{ $segment['color'] }}; opacity: {{ $segment['opacity'] }};"
                        ></span>
                    @endforeach
                </div>
            @endforeach
        </div>
    </div>
</div>
