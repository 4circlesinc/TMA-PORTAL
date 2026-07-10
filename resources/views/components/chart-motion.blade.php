@props([
    'bars' => null,
    'yMax' => null,
    'yStep' => null,
    'labels' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartMotion::preset('01');
    $resolvedYMax = (int) ($yMax ?? $preset['yMax']);
    $resolvedYStep = (int) ($yStep ?? $preset['yStep']);
    $resolvedBars = \App\Support\ChartMotion::normalizeBars($preset, $bars);
    $yTicks = \App\Support\ChartMotion::axisTicks($resolvedYMax, $resolvedYStep);
    $yTicks = array_reverse($yTicks);
@endphp

<div class="tma-chart-scroll">
    <div {{ $attributes->merge(['class' => 'tma-chart-motion ' . $class]) }} role="group" aria-label="Monthly bar chart">
        <div class="tma-chart-motion__y-axis" aria-hidden="true">
            @foreach ($yTicks as $tick)
                <span class="tma-chart-motion__y-label">{{ \App\Support\ChartMotion::formatAxisLabel($tick) }}</span>
            @endforeach
        </div>

        <div class="tma-chart-motion__plot">
            <div class="tma-chart-motion__grid" aria-hidden="true">
                @foreach ($yTicks as $tick)
                    <span @class([
                        'tma-chart-motion__grid-line',
                        'tma-chart-motion__grid-line--base' => $tick === 0,
                    ])></span>
                @endforeach
            </div>

            <div class="tma-chart-motion__bars">
                @foreach ($resolvedBars as $bar)
                    <div class="tma-chart-motion__bar" tabindex="0" role="button" aria-label="{{ $bar['label'] }}: {{ \App\Support\ChartMotion::formatBarValue($bar['value']) }}">
                        <div class="tma-chart-motion__bar-stack" style="height: {{ $bar['size'] }}%;">
                            <span class="tma-chart-motion__tooltip" aria-hidden="true">
                                {{ \App\Support\ChartMotion::formatBarValue($bar['value']) }}
                            </span>
                            <div
                                class="tma-chart-motion__bar-pill"
                                style="background-color: {{ $bar['color'] }};"
                            ></div>
                        </div>
                        <span class="tma-chart-motion__x-label">{{ $bar['label'] }}</span>
                    </div>
                @endforeach
            </div>
        </div>
    </div>
</div>
