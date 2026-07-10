@props([
    'segments' => null,
    'center' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('semicircle-chart');
    $resolvedSegments = \App\Support\ChartGraphic::normalizeSemicircleSegments($preset, $segments);
    $centerLabels = $center ?? $preset['center'] ?? [];
    $chartWidth = (int) ($preset['width'] ?? 250);
    $chartHeight = (int) ($preset['height'] ?? 126);
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-semicircle ' . $class]) }}
        role="group"
        aria-label="Semicircle chart"
        style="--sc-chart-width: {{ $chartWidth }}; --sc-chart-height: {{ $chartHeight }};"
    >
        <div class="tma-chart-semicircle__stage">
            <svg
                class="tma-chart-semicircle__svg"
                viewBox="0 0 {{ $chartWidth }} {{ $chartHeight }}"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
            >
                @foreach ($resolvedSegments as $index => $segment)
                    <g
                        class="tma-chart-semicircle__segment"
                        data-segment-index="{{ $index }}"
                        tabindex="0"
                        role="button"
                        aria-label="{{ $segment['key'] }}: {{ $segment['percent'] }}% ({{ \App\Support\ChartGraphic::formatBarValue($segment['value']) }})"
                    >
                        <path
                            class="tma-chart-semicircle__arc"
                            fill-rule="evenodd"
                            clip-rule="evenodd"
                            d="{{ $segment['path'] }}"
                            fill="{{ $segment['color'] }}"
                            fill-opacity="{{ $segment['opacity'] }}"
                        />
                    </g>
                @endforeach
            </svg>

            @foreach ($resolvedSegments as $index => $segment)
                <span
                    class="tma-chart-semicircle__tooltip"
                    data-segment-index="{{ $index }}"
                    style="left: {{ $segment['tooltipLeftPct'] }}%; top: {{ $segment['tooltipTopPct'] }}%;"
                    aria-hidden="true"
                >
                    {{ $segment['percent'] }}%
                </span>
            @endforeach

            @if (! empty($centerLabels))
                <div class="tma-chart-semicircle__center" aria-hidden="true">
                @if (! empty($centerLabels['primary']))
                    <span class="tma-chart-semicircle__center-primary">{{ $centerLabels['primary'] }}</span>
                @endif
                @if (! empty($centerLabels['secondary']))
                    <span class="tma-chart-semicircle__center-secondary">{{ $centerLabels['secondary'] }}</span>
                @endif
                @if (! empty($centerLabels['tertiary']))
                    <span class="tma-chart-semicircle__center-tertiary">{{ $centerLabels['tertiary'] }}</span>
                @endif
                </div>
            @endif
        </div>
    </div>
</div>
