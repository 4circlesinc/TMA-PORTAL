@props([
    'bars' => null,
    'yMax' => null,
    'solid' => null,
    'accent' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('vertical-08');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeSplitPinBars($preset, $bars);
    $solidColor = $solid ?? $preset['solid'] ?? '#000000';
    $accentColor = $accent ?? $preset['accent'] ?? '#adadfb';
    $chartHeight = (int) ($preset['height'] ?? 160);
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-vertical-08 ' . $class]) }}
        role="group"
        aria-label="Split pin vertical bar chart"
        style="--v08-solid: {{ $solidColor }}; --v08-accent: {{ $accentColor }}; --v08-chart-height: {{ $chartHeight }};"
    >
        <div class="tma-chart-vertical-08__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-vertical-08__bar"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-vertical-08__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <div
                        class="tma-chart-vertical-08__pin"
                        style="top: {{ round($bar['top'] / $chartHeight * 100, 3) }}%; height: {{ round(($bar['bottom'] - $bar['top']) / $chartHeight * 100, 3) }}%;"
                        aria-hidden="true"
                    >
                        <div
                            class="tma-chart-vertical-08__segment tma-chart-vertical-08__segment--solid"
                            style="flex: {{ $bar['solid'] }} 1 0;"
                        ></div>
                        <div
                            class="tma-chart-vertical-08__segment tma-chart-vertical-08__segment--accent"
                            style="flex: {{ $bar['accent'] }} 1 0;"
                        ></div>
                    </div>
                </div>
            @endforeach
        </div>
    </div>
</div>
