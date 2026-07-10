@props([
    'bars' => null,
    'yMax' => null,
    'primary' => null,
    'accent' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('vertical-04');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeBlockBars($preset, $bars);
    $primaryColor = $primary ?? $preset['primary'] ?? '#b899eb';
    $accentColor = $accent ?? $preset['accent'] ?? '#adadfb';
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-vertical-04 ' . $class]) }}
        role="group"
        aria-label="Block stack vertical bar chart"
        style="--v04-primary: {{ $primaryColor }}; --v04-accent: {{ $accentColor }};"
    >
        <div class="tma-chart-vertical-04__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-vertical-04__bar"
                    style="--block-count: {{ count($bar['blocks']) }}"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-vertical-04__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <div class="tma-chart-vertical-04__stack" aria-hidden="true">
                        @foreach ($bar['blocks'] as $type)
                            <div class="tma-chart-vertical-04__block tma-chart-vertical-04__block--{{ $type }}"></div>
                        @endforeach
                    </div>
                </div>
            @endforeach
        </div>
    </div>
</div>
