@props([
    'bars' => null,
    'yMax' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('vertical-03');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeSegmentedBars($preset, $bars);
@endphp

<div class="tma-chart-scroll">
    <div {{ $attributes->merge(['class' => 'tma-chart-vertical-03 ' . $class]) }} role="group" aria-label="Segmented vertical bar chart">
        <div class="tma-chart-vertical-03__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-vertical-03__bar"
                    style="--segment-count: {{ count($bar['segments']) }}"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-vertical-03__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <div class="tma-chart-vertical-03__stack" aria-hidden="true">
                        @foreach ($bar['segments'] as $opacity)
                            <div
                                class="tma-chart-vertical-03__segment"
                                style="background-color: {{ $bar['color'] }}; opacity: {{ $opacity }};"
                            ></div>
                        @endforeach
                    </div>
                </div>
            @endforeach
        </div>
    </div>
</div>
