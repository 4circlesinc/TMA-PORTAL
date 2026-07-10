@props([
    'bars' => null,
    'yMax' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('vertical-01');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeBars($preset, $bars);
@endphp

<div class="tma-chart-scroll">
    <div {{ $attributes->merge(['class' => 'tma-chart-vertical-01 ' . $class]) }} role="group" aria-label="Vertical bar chart">
        <div class="tma-chart-vertical-01__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-vertical-01__bar"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-vertical-01__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <div
                        class="tma-chart-vertical-01__pill"
                        style="height: {{ $bar['size'] }}%; background-color: {{ $bar['color'] }};"
                    ></div>
                </div>
            @endforeach
        </div>
    </div>
</div>
