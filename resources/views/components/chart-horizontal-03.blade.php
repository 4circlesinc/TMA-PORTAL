@props([
    'bars' => null,
    'xMax' => null,
    'color' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('horizontal-03');
    if ($xMax !== null) {
        $preset['xMax'] = (int) $xMax;
    }
    if ($color !== null) {
        $preset['color'] = $color;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeHorizontalSegmentedBars($preset, $bars);
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-horizontal-03 ' . $class]) }}
        role="group"
        aria-label="Segmented horizontal bar chart"
    >
        <div class="tma-chart-horizontal-03__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-horizontal-03__bar"
                    style="top: {{ $bar['topPct'] }}%; height: {{ $bar['heightPct'] }}%;"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-horizontal-03__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    @foreach ($bar['segments'] as $segment)
                        <span
                            class="tma-chart-horizontal-03__segment"
                            style="left: {{ $segment['leftPct'] }}%; width: {{ $segment['widthPct'] }}%; background-color: {{ $bar['color'] }}; opacity: {{ $segment['opacity'] }};"
                        ></span>
                    @endforeach
                </div>
            @endforeach
        </div>
    </div>
</div>
