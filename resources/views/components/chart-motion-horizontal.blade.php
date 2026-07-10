@props([
    'bars' => null,
    'xMax' => null,
    'xStep' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartMotion::preset('02');
    $resolvedXMax = (int) ($xMax ?? $preset['xMax']);
    $resolvedXStep = (int) ($xStep ?? $preset['xStep']);
    $resolvedBars = \App\Support\ChartMotion::normalizeBars($preset, $bars);
    $xTicks = \App\Support\ChartMotion::axisTicks($resolvedXMax, $resolvedXStep);
@endphp

<div class="tma-chart-scroll">
    <div {{ $attributes->merge(['class' => 'tma-chart-motion-horizontal ' . $class]) }} role="group" aria-label="Monthly horizontal bar chart">
        <div class="tma-chart-motion-horizontal__y-axis" aria-hidden="true">
            @foreach ($resolvedBars as $bar)
                <span class="tma-chart-motion-horizontal__y-label">{{ $bar['label'] }}</span>
            @endforeach
        </div>

        <div class="tma-chart-motion-horizontal__plot">
            <div class="tma-chart-motion-horizontal__grid" aria-hidden="true">
                @foreach ($xTicks as $tick)
                    <span @class([
                        'tma-chart-motion-horizontal__grid-line',
                        'tma-chart-motion-horizontal__grid-line--base' => $tick === 0,
                    ])></span>
                @endforeach
            </div>

            <div class="tma-chart-motion-horizontal__bars">
                @foreach ($resolvedBars as $bar)
                    <div class="tma-chart-motion-horizontal__bar" tabindex="0" role="button" aria-label="{{ $bar['label'] }}: {{ \App\Support\ChartMotion::formatBarValue($bar['value']) }}">
                        <div class="tma-chart-motion-horizontal__bar-stack" style="width: {{ $bar['size'] }}%;">
                            <span class="tma-chart-motion-horizontal__tooltip" aria-hidden="true">
                                {{ \App\Support\ChartMotion::formatBarValue($bar['value']) }}
                            </span>
                            <div
                                class="tma-chart-motion-horizontal__bar-pill"
                                style="background-color: {{ $bar['color'] }};"
                            ></div>
                        </div>
                    </div>
                @endforeach
            </div>

            <div class="tma-chart-motion-horizontal__x-axis" aria-hidden="true">
                @foreach ($xTicks as $tick)
                    <span class="tma-chart-motion-horizontal__x-label">{{ \App\Support\ChartMotion::formatAxisLabel($tick) }}</span>
                @endforeach
            </div>
        </div>
    </div>
</div>
