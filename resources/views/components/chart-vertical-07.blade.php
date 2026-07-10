@props([
    'bars' => null,
    'yMax' => null,
    'color' => null,
    'mutedOpacity' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('vertical-07');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizePinBars($preset, $bars);
    $barColor = $color ?? $preset['color'] ?? '#a0bce8';
    $muted = $mutedOpacity ?? $preset['mutedOpacity'] ?? 0.5;
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-vertical-07 ' . $class]) }}
        role="group"
        aria-label="Dual pin vertical bar chart"
        style="--v07-color: {{ $barColor }}; --v07-muted-opacity: {{ $muted }};"
    >
        <div class="tma-chart-vertical-07__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-vertical-07__bar"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-vertical-07__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <div class="tma-chart-vertical-07__pins" aria-hidden="true">
                        <div
                            class="tma-chart-vertical-07__pin tma-chart-vertical-07__pin--primary"
                            style="height: {{ $bar['primary'] }}%;"
                        ></div>
                        <div
                            class="tma-chart-vertical-07__pin tma-chart-vertical-07__pin--secondary"
                            style="height: {{ $bar['secondary'] }}%;"
                        ></div>
                    </div>
                </div>
            @endforeach
        </div>
    </div>
</div>
