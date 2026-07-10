@props([
    'label' => 'Title',
    'variant' => 'muted',
    'checked' => false,
    'class' => '',
])

@php
    $preset = \App\Support\TableTitle::preset();
    $tokens = $preset['tokens'] ?? [];
    $variantTokens = \App\Support\TableTitle::variantTokens($variant);
    $icons = $variantTokens['icons'] ?? [];
    $showCheckbox = (bool) ($variantTokens['checkbox'] ?? false);
    $paddingX = $variantTokens['paddingX'] ?? ($tokens['paddingX'] ?? 12);
    $width = $variantTokens['width'] ?? null;
    $classes = collect([
        'tma-table-title',
        'tma-table-title--' . $variant,
        $class,
    ])->filter()->implode(' ');
@endphp

<div
    {{ $attributes->merge(['class' => $classes]) }}
    style="
        --table-title-font-size: {{ $tokens['fontSize'] ?? 12 }}px;
        --table-title-line-height: {{ $tokens['lineHeight'] ?? 16 }}px;
        --table-title-padding-x: {{ $paddingX }}px;
        @if ($width) --table-title-width: {{ $width }}px; @endif
        --table-title-min-height: {{ $tokens['minHeight'] ?? 40 }}px;
        --table-title-border-color: {{ $tokens['borderColor'] ?? 'rgba(0, 0, 0, 0.2)' }};
        --table-title-color: {{ $variantTokens['color'] ?? 'rgba(0, 0, 0, 0.4)' }};
        --table-title-icon-size: {{ $tokens['iconSize'] ?? 16 }}px;
        --table-title-gap: {{ $tokens['gap'] ?? 8 }}px;
    "
>
    @if ($showCheckbox)
        <input
            type="checkbox"
            class="tma-table-title__checkbox"
            aria-label="Select all"
            @checked($checked)
        />
    @else
        @if (count($icons) > 0)
            <span class="tma-table-title__icons" aria-hidden="true">
                @foreach ($icons as $icon)
                    <img
                        src="{{ \App\Support\TableTitle::iconPath($icon) }}"
                        class="tma-table-title__icon"
                        alt=""
                    />
                @endforeach
            </span>
        @endif
        <span class="tma-table-title__label">{{ $label }}</span>
    @endif
</div>
