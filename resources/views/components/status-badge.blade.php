@props([
    'variant' => 'dot-purple',
    'label' => null,
    'class' => '',
])

@php
    $preset = \App\Support\StatusBadge::preset();
    $tokens = $preset['tokens'] ?? [];
    $variantTokens = \App\Support\StatusBadge::variantTokens($variant);
    $style = $variantTokens['style'] ?? 'dot';
    $colorKey = $variantTokens['color'] ?? 'purple';
    $color = \App\Support\StatusBadge::colorValue($colorKey);
    $text = $label ?? ($preset['defaultLabel'] ?? 'Label');
    $hasSurface = (bool) ($variantTokens['surface'] ?? false);
    $classes = collect([
        'tma-status-badge',
        'tma-status-badge--' . $style,
        'tma-status-badge--' . $colorKey,
        $class,
    ])->filter()->implode(' ');
@endphp

<span
    {{ $attributes->merge(['class' => $classes]) }}
    style="
        --status-badge-color: {{ $color }};
        --status-badge-font-size: {{ $tokens['fontSize'] ?? 12 }}px;
        --status-badge-line-height: {{ $tokens['lineHeight'] ?? 16 }}px;
        --status-badge-dot-min-height: {{ $tokens['dotMinHeight'] ?? 16 }}px;
        --status-badge-pill-min-height: {{ $tokens['pillMinHeight'] ?? 20 }}px;
        --status-badge-pill-padding-x: {{ $tokens['pillPaddingX'] ?? 4 }}px;
        --status-badge-pill-padding-y: {{ $tokens['pillPaddingY'] ?? 2 }}px;
        --status-badge-pill-radius: {{ $tokens['pillRadius'] ?? 4 }}px;
        --status-badge-pill-shape-radius: {{ $tokens['pillShapeRadius'] ?? 80 }}px;
        --status-badge-pill-background-opacity: {{ $tokens['pillBackgroundOpacity'] ?? 0.1 }};
        --status-badge-pill-border-opacity: {{ $tokens['pillBorderOpacity'] ?? 0.2 }};
        --status-badge-pill-border-width: {{ $tokens['pillBorderWidth'] ?? 0.5 }}px;
        --status-badge-dot-size: {{ $tokens['dotSize'] ?? 12 }}px;
        --status-badge-dot-inset: {{ $tokens['dotInset'] ?? 31.25 }}%;
        @if ($hasSurface) --status-badge-pill-surface: {{ $tokens['mutedPillSurface'] ?? 'rgba(0, 0, 0, 0.04)' }}; @endif
    "
>
    @if ($style === 'dot')
        <span class="tma-status-badge__dot" aria-hidden="true"></span>
    @endif
    <span class="tma-status-badge__label">{{ $text }}</span>
</span>
