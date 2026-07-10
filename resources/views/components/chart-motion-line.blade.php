@props([
    'points' => null,
    'yMax' => null,
    'yStep' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartMotion::preset('03');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    if ($yStep !== null) {
        $preset['yStep'] = (int) $yStep;
    }
    $chart = \App\Support\ChartMotion::resolveLineChart($preset, $points);
    $plot = $chart['plot'];
    $viewBox = $plot['x'] . ' 0 ' . $plot['width'] . ' 400';
    $yTicks = \App\Support\ChartMotion::axisTicks((int) $preset['yMax'], (int) $preset['yStep']);
    $yTicks = array_reverse($yTicks);
    $gradientId = 'cm-line-' . substr(md5($chart['linePath']), 0, 8);
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-motion-line ' . $class]) }}
        role="group"
        aria-label="Monthly line chart"
        data-plot="{{ json_encode($plot) }}"
        data-ymax="{{ (int) $preset['yMax'] }}"
    >
        <div class="tma-chart-motion-line__y-axis" aria-hidden="true">
            @foreach ($yTicks as $tick)
                <span class="tma-chart-motion-line__y-label">{{ \App\Support\ChartMotion::formatAxisLabel($tick) }}</span>
            @endforeach
        </div>

        <div class="tma-chart-motion-line__plot">
            <div class="tma-chart-motion-line__grid" aria-hidden="true">
                @foreach ($yTicks as $tick)
                    <span @class([
                        'tma-chart-motion-line__grid-line',
                        'tma-chart-motion-line__grid-line--base' => $tick === 0,
                    ])></span>
                @endforeach
            </div>

            <svg class="tma-chart-motion-line__svg" viewBox="{{ $viewBox }}" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                    <radialGradient id="{{ $gradientId }}-area" cx="422.499" cy="106.13" r="1" gradientUnits="userSpaceOnUse" gradientTransform="rotate(90) scale(246.37 377.499)">
                        <stop offset="0%" stop-color="#000" stop-opacity="0.1" />
                        <stop offset="100%" stop-color="#000" stop-opacity="0" />
                    </radialGradient>
                    <linearGradient id="{{ $gradientId }}-line" x1="48.559" y1="331.205" x2="800" y2="331.205" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stop-color="#000" stop-opacity="0.4" />
                        <stop offset="100%" stop-color="#000" stop-opacity="1" />
                    </linearGradient>
                </defs>
                <path class="tma-chart-motion-line__area" d="{{ $chart['areaPath'] }}" fill="url(#{{ $gradientId }}-area)" />
                <path class="tma-chart-motion-line__stroke" d="{{ $chart['linePath'] }}" fill="none" stroke="url(#{{ $gradientId }}-line)" vector-effect="non-scaling-stroke" />
                <path class="tma-chart-motion-line__stroke-glow" d="{{ $chart['linePath'] }}" fill="none" vector-effect="non-scaling-stroke" />
            </svg>

            <div class="tma-chart-motion-line__hover" aria-hidden="true">
                <div class="tma-chart-motion-line__cursor">
                    <span class="tma-chart-motion-line__dot"></span>
                    <span class="tma-chart-motion-line__tooltip"></span>
                </div>
            </div>

            <div class="tma-chart-motion-line__x-axis" aria-hidden="true">
                @foreach ($chart['points'] as $point)
                    <span class="tma-chart-motion-line__x-label">{{ $point['label'] }}</span>
                @endforeach
            </div>
        </div>
    </div>
</div>
