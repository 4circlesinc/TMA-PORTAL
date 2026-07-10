@props([
    'text' => null,
    'title' => null,
    'shortcut' => null,
    'variant' => null,
    'position' => null,
    'visible' => false,
    'id' => null,
    'class' => '',
])

@php
    $preset = \App\Support\Tooltip::preset();
    $resolvedVariant = $variant ?? $preset['defaultVariant'] ?? 'compact';
    $resolvedPosition = $position ?? $preset['defaultPosition'] ?? 'top';
    $tokens = \App\Support\Tooltip::variantTokens($resolvedVariant);
    $isRich = $resolvedVariant === 'rich';
    $isMultiline = $resolvedVariant === 'multiline';
    $bodyText = trim($text ?? '');
    $lines = $isMultiline && $bodyText !== '' ? preg_split('/\r\n|\r|\n/', $bodyText) : [];
    $tooltipId = $id ?? 'tooltip-' . uniqid();
    $groupClasses = collect([
        'tma-tooltip',
        'tma-tooltip--' . $resolvedVariant,
        'tma-tooltip--' . $resolvedPosition,
        $visible ? 'is-visible tma-tooltip--static' : '',
        $class,
    ])->filter()->implode(' ');
@endphp

<div
    {{ $attributes->merge(['class' => $groupClasses, 'id' => $tooltipId]) }}
    role="tooltip"
    @if ($visible) aria-hidden="false" @else aria-hidden="true" @endif
    style="
        --tooltip-font-size: {{ $tokens['fontSize'] ?? 12 }}px;
        --tooltip-line-height: {{ $tokens['lineHeight'] ?? 16 }}px;
        --tooltip-padding-x: {{ $tokens['paddingX'] ?? 8 }}px;
        --tooltip-padding-y: {{ $tokens['paddingY'] ?? 4 }}px;
        --tooltip-radius: {{ $tokens['radius'] ?? 12 }}px;
        --tooltip-max-width: {{ $tokens['maxWidth'] ?? 255 }}px;
        --tooltip-title-size: {{ $tokens['titleSize'] ?? 14 }}px;
        --tooltip-title-line-height: {{ $tokens['titleLineHeight'] ?? 20 }}px;
        --tooltip-body-size: {{ $tokens['bodySize'] ?? 12 }}px;
        --tooltip-body-line-height: {{ $tokens['bodyLineHeight'] ?? 16 }}px;
    "
>
    <div class="tma-tooltip__surface">
        @if ($isRich)
            <div class="tma-tooltip__content tma-tooltip__content--rich">
                @if ($title)
                    <p class="tma-tooltip__title">{{ $title }}</p>
                @endif
                @if ($bodyText !== '')
                    <p class="tma-tooltip__body">{{ $bodyText }}</p>
                @endif
            </div>
        @elseif ($isMultiline && count($lines) > 1)
            <div class="tma-tooltip__content tma-tooltip__content--multiline">
                @foreach ($lines as $line)
                    <p class="tma-tooltip__line">{{ $line }}</p>
                @endforeach
            </div>
        @else
            <div class="tma-tooltip__content tma-tooltip__content--inline">
                @if ($bodyText !== '')
                    <span class="tma-tooltip__text">{{ $bodyText }}</span>
                @endif
                @if ($shortcut)
                    <span class="tma-tooltip__shortcut">{{ $shortcut }}</span>
                @endif
            </div>
        @endif
    </div>
    <span class="tma-tooltip__arrow" aria-hidden="true"></span>
</div>
