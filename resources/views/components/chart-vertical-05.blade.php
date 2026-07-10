@props([
    'bars' => null,
    'yMax' => null,
    'solid' => null,
    'accent' => null,
    'mutedOpacity' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('vertical-05');
    if ($yMax !== null) {
        $preset['yMax'] = (int) $yMax;
    }
    $resolvedBars = \App\Support\ChartGraphic::normalizeOpacityBlockBars($preset, $bars);
    $solidColor = $solid ?? $preset['solid'] ?? '#000000';
    $accentColor = $accent ?? $preset['accent'] ?? '#adadfb';
    $muted = $mutedOpacity ?? $preset['mutedOpacity'] ?? 0.4;
@endphp

<div class="tma-chart-scroll">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-vertical-05 ' . $class]) }}
        role="group"
        aria-label="Opacity block vertical bar chart"
        style="--v05-solid: {{ $solidColor }}; --v05-accent: {{ $accentColor }}; --v05-muted-opacity: {{ $muted }};"
    >
        <div class="tma-chart-vertical-05__bars">
            @foreach ($resolvedBars as $index => $bar)
                <div
                    class="tma-chart-vertical-05__bar"
                    style="--block-count: {{ count($bar['blocks']) }}"
                    tabindex="0"
                    role="button"
                    aria-label="Bar {{ $index + 1 }}: {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}"
                >
                    <span class="tma-chart-vertical-05__tooltip" aria-hidden="true">
                        {{ \App\Support\ChartGraphic::formatBarValue($bar['value']) }}
                    </span>
                    <div class="tma-chart-vertical-05__stack" aria-hidden="true">
                        @foreach ($bar['blocks'] as $type)
                            <div class="tma-chart-vertical-05__block tma-chart-vertical-05__block--{{ $type }}"></div>
                        @endforeach
                    </div>
                </div>
            @endforeach
        </div>
    </div>
</div>
