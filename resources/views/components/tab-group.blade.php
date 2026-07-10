@props([
    'tabs' => null,
    'variant' => null,
    'size' => null,
    'activeIndex' => 0,
    'stretch' => false,
    'rounded' => false,
    'iconOnly' => false,
    'class' => '',
])

@php
    $preset = \App\Support\TabGroup::preset();
    $resolvedVariant = $variant ?? $preset['defaultVariant'] ?? 'underline';
    $resolvedSize = $size ?? $preset['defaultSize'] ?? 'medium';
    $resolvedTabs = \App\Support\TabGroup::normalizeTabs($tabs, (int) $activeIndex, (bool) $iconOnly);
    $tokens = \App\Support\TabGroup::sizeTokens($resolvedSize);
    $trackRadius = $rounded ? 80 : ($tokens['trackRadius'] ?? 20);
    $tabRadius = $rounded ? 80 : ($tokens['tabRadius'] ?? 12);
    $groupClasses = collect([
        'tma-tab-group',
        'tma-tab-group--' . $resolvedVariant,
        'tma-tab-group--' . $resolvedSize,
        $stretch ? 'tma-tab-group--stretch' : '',
        $rounded ? 'tma-tab-group--rounded' : '',
        $iconOnly ? 'tma-tab-group--icon-only' : '',
        $class,
    ])->filter()->implode(' ');
@endphp

<div
    {{ $attributes->merge(['class' => $groupClasses]) }}
    role="tablist"
    aria-label="Tabs"
    style="
        --tab-font-size: {{ $tokens['fontSize'] }}px;
        --tab-line-height: {{ $tokens['lineHeight'] }}px;
        --tab-track-padding: {{ $tokens['trackPadding'] }}px;
        --tab-track-gap: {{ $tokens['trackGap'] }}px;
        --tab-track-radius: {{ $trackRadius }}px;
        --tab-padding-x: {{ $tokens['tabPaddingX'] }}px;
        --tab-padding-y: {{ $tokens['tabPaddingY'] }}px;
        --tab-radius: {{ $tabRadius }}px;
        --tab-min-height: {{ $tokens['tabMinHeight'] }}px;
        --tab-underline-gap: {{ $tokens['underlineGap'] }}px;
        --tab-icon-size: {{ $tokens['iconSize'] ?? 24 }}px;
    "
>
    @foreach ($resolvedTabs as $index => $tab)
        @php
            $isActive = ! empty($tab['active']);
            $tabClass = 'tma-tab' . ($isActive ? ' is-active' : '');
            $showLabel = ! $tab['iconOnly'] && $tab['label'] !== '';
        @endphp
        @if (! empty($tab['href']))
            <a
                href="{{ $tab['href'] }}"
                class="{{ $tabClass }}"
                role="tab"
                aria-selected="{{ $isActive ? 'true' : 'false' }}"
                tabindex="{{ $isActive ? '0' : '-1' }}"
                data-tab-index="{{ $index }}"
                data-tab-key="{{ $tab['key'] }}"
            >
                @if (! empty($tab['iconPath']))
                    <img src="{{ $tab['iconPath'] }}" class="tma-tab__icon" alt="" aria-hidden="true" />
                @endif
                @if ($showLabel)
                    <span class="tma-tab__label">{{ $tab['label'] }}</span>
                @endif
                @if ($resolvedVariant === 'underline')
                    <span class="tma-tab__indicator" aria-hidden="true"></span>
                @endif
            </a>
        @else
            <button
                type="button"
                class="{{ $tabClass }}"
                role="tab"
                aria-selected="{{ $isActive ? 'true' : 'false' }}"
                tabindex="{{ $isActive ? '0' : '-1' }}"
                data-tab-index="{{ $index }}"
                data-tab-key="{{ $tab['key'] }}"
                @if ($tab['iconOnly'] && ! empty($tab['label']))
                    aria-label="{{ $tab['label'] }}"
                @endif
            >
                @if (! empty($tab['iconPath']))
                    <img src="{{ $tab['iconPath'] }}" class="tma-tab__icon" alt="" aria-hidden="true" />
                @endif
                @if ($showLabel)
                    <span class="tma-tab__label">{{ $tab['label'] }}</span>
                @endif
                @if ($resolvedVariant === 'underline')
                    <span class="tma-tab__indicator" aria-hidden="true"></span>
                @endif
            </button>
        @endif
    @endforeach
</div>
