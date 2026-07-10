@props([
    'bars' => null,
    'xMax' => null,
    'color' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('horizontal-04');
    if ($xMax !== null) {
        $preset['xMax'] = (int) $xMax;
    }
    if ($color !== null) {
        $preset['color'] = $color;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeHorizontalBlockBars($preset, $bars);
    $barColor = $color ?? $preset['color'] ?? '#000000';
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-horizontal-04 ' . $class]) }}
        role="group"
        aria-label="Block horizontal bar chart"
        style="--h04-color: {{ $barColor }};"
    >
        <div class="tma-chart-horizontal-04__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-horizontal-04__bar"
                    style="top: {{ $bar['topPct'] }}%; height: {{ $bar['heightPct'] }}%;"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-horizontal-04__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    @foreach ($bar['blocks'] as $block)
                        <span
                            class="tma-chart-horizontal-04__block tma-chart-horizontal-04__block--{{ $block['type'] }}"
                            style="left: {{ $block['leftPct'] }}%; width: {{ $block['widthPct'] }}%;"
                        ></span>
                    @endforeach
                </div>
            @endforeach
        </div>
    </div>
</div>
