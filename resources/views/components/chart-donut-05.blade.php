@props([
    'segments' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('donut-05');
    $resolvedSegments = \App\Support\ChartGraphic::normalizeDonutSegments($preset, $segments);
    $chartWidth = (int) ($preset['width'] ?? 121);
    $chartHeight = (int) ($preset['height'] ?? 121);
    $chartId = 'donut-' . substr(md5(serialize($resolvedSegments)), 0, 8);
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-donut ' . $class]) }}
        role="group"
        aria-label="Donut chart"
        style="--donut-chart-width: {{ $chartWidth }}; --donut-chart-height: {{ $chartHeight }};"
    >
        <div class="tma-chart-donut__stage">
            <svg
                class="tma-chart-donut__svg"
                viewBox="0 0 {{ $chartWidth }} {{ $chartHeight }}"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
            >
                <defs>
                    @foreach ($resolvedSegments as $index => $segment)
                        @if (! empty($segment['gradient']))
                            <linearGradient
                                id="{{ $chartId }}-grad-{{ $index }}"
                                x1="{{ $segment['gradient']['x1'] }}"
                                y1="{{ $segment['gradient']['y1'] }}"
                                x2="{{ $segment['gradient']['x2'] }}"
                                y2="{{ $segment['gradient']['y2'] }}"
                                gradientUnits="userSpaceOnUse"
                            >
                                @foreach ($segment['gradient']['stops'] as $stop)
                                    <stop
                                        offset="{{ $stop['offset'] }}"
                                        stop-color="{{ $stop['color'] ?? '#000000' }}"
                                        @if (isset($stop['opacity'])) stop-opacity="{{ $stop['opacity'] }}" @endif
                                    />
                                @endforeach
                            </linearGradient>
                        @endif
                    @endforeach
                </defs>

                @foreach ($resolvedSegments as $index => $segment)
                    <g
                        class="tma-chart-donut__segment"
                        data-segment-index="{{ $index }}"
                        tabindex="0"
                        role="button"
                        aria-label="{{ $segment['key'] }}: {{ $segment['percent'] }}% ({{ \App\Support\ChartGraphic::formatBarValue($segment['value']) }})"
                    >
                        @if (! empty($segment['gradient']))
                            <path
                                class="tma-chart-donut__arc"
                                fill-rule="evenodd"
                                clip-rule="evenodd"
                                d="{{ $segment['path'] }}"
                                fill="url(#{{ $chartId }}-grad-{{ $index }})"
                            />
                            @if (! empty($segment['screenOverlay']))
                                <path
                                    class="tma-chart-donut__arc tma-chart-donut__arc--screen"
                                    fill-rule="evenodd"
                                    clip-rule="evenodd"
                                    d="{{ $segment['path'] }}"
                                    fill="#000000"
                                />
                            @endif
                        @else
                            <path
                                class="tma-chart-donut__arc"
                                fill-rule="evenodd"
                                clip-rule="evenodd"
                                d="{{ $segment['path'] }}"
                                fill="{{ $segment['color'] }}"
                                fill-opacity="{{ $segment['opacity'] }}"
                            />
                        @endif
                    </g>
                @endforeach
            </svg>

            @foreach ($resolvedSegments as $index => $segment)
                <span
                    class="tma-chart-donut__tooltip"
                    data-segment-index="{{ $index }}"
                    style="left: {{ $segment['tooltipLeftPct'] }}%; top: {{ $segment['tooltipTopPct'] }}%;"
                    aria-hidden="true"
                >
                    {{ $segment['percent'] }}%
                </span>
            @endforeach
        </div>
    </div>
</div>
