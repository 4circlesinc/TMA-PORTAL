@props([
    'bars' => null,
    'yMax' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('vertical-02');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeLayeredBars($preset, $bars);
@endphp

<div class="tma-chart-scroll">
    <div {{ $attributes->merge(['class' => 'tma-chart-vertical-02 ' . $class]) }} role="group" aria-label="Layered vertical bar chart">
        <div class="tma-chart-vertical-02__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-vertical-02__bar"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-vertical-02__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <div
                        class="tma-chart-vertical-02__track"
                        style="height: {{ $bar['trackSize'] }}%; background-color: {{ $bar['color'] }};"
                        aria-hidden="true"
                    ></div>
                    <div
                        class="tma-chart-vertical-02__pill"
                        style="height: {{ $bar['size'] }}%; background-color: {{ $bar['color'] }};"
                    ></div>
                </div>
            @endforeach
        </div>
    </div>
</div>
