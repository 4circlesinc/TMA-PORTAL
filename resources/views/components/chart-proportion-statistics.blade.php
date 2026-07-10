@props([
    'sections' => null,
    'color' => null,
    'mutedOpacity' => null,
    'class' => '',
])

@php
    $preset = \App\Support\ChartGraphic::preset('proportion-statistics');
    $resolvedSections = \App\Support\ChartGraphic::normalizeProportionSections($preset, $sections);
    $barColor = $color ?? $preset['color'] ?? '#000000';
    $muted = $mutedOpacity ?? $preset['mutedOpacity'] ?? 0.4;
    $chartHeight = (int) ($preset['height'] ?? 200);
    $plotTop = (int) ($preset['plotTop'] ?? 101);
@endphp

<div class="tma-chart-scroll tma-chart-scroll--wide">
    <div
        {{ $attributes->merge(['class' => 'tma-chart-proportion ' . $class]) }}
        role="group"
        aria-label="Proportion statistics chart"
        style="--prop-color: {{ $barColor }}; --prop-muted-opacity: {{ $muted }}; --prop-chart-height: {{ $chartHeight }}; --prop-plot-top: {{ round($plotTop / $chartHeight * 100, 3) }}%;"
    >
        <div class="tma-chart-proportion__sections">
            @foreach ($resolvedSections as $index => $section)
                <div
                    class="tma-chart-proportion__section{{ $section['muted'] ? ' tma-chart-proportion__section--muted' : '' }}"
                    style="flex: {{ $section['weight'] }} 1 0;"
                    tabindex="0"
                    role="button"
                    aria-label="{{ $section['label'] }}: {{ \App\Support\ChartGraphic::formatPercent($section['value']) }}"
                >
                    <div class="tma-chart-proportion__header">
                        <span class="tma-chart-proportion__label">{{ $section['label'] }}</span>
                        <span class="tma-chart-proportion__value">{{ \App\Support\ChartGraphic::formatPercent($section['value']) }}</span>
                    </div>
                    <div class="tma-chart-proportion__plot" aria-hidden="true">
                        <div class="tma-chart-proportion__ticks">
                            @for ($i = 0; $i < $section['lineCount']; $i++)
                                <span class="tma-chart-proportion__tick"></span>
                            @endfor
                        </div>
                    </div>
                </div>
            @endforeach
        </div>
    </div>
</div>
