@props([
    'bars' => null,
    'yMax' => null,
    'color' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('vertical-06');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeGradientBars($preset, $bars);
    $barColor = $color ?? $preset['color'] ?? '#000000';
    $chartHeight = (int) ($preset['height'] ?? 160);
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-vertical-06 ' . $class]) }}
        role="group"
        aria-label="Gradient vertical bar chart"
        style="--v06-color: {{ $barColor }}; --v06-chart-height: {{ $chartHeight }};"
    >
        <div class="tma-chart-vertical-06__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-vertical-06__bar"
                    style="--stack-total: {{ $bar['stackTotal'] }}"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-vertical-06__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <div class="tma-chart-vertical-06__stack" aria-hidden="true">
                        @foreach ($bar['segments'] as $segment)
                            <div
                                class="tma-chart-vertical-06__segment"
                                style="--seg-height: {{ $segment['height'] }}; opacity: {{ $segment['opacity'] }};"
                            ></div>
                        @endforeach
                    </div>
                </div>
            @endforeach
        </div>
    </div>
</div>
