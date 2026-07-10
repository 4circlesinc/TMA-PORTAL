@props([
    'variant' => 'default',
    'selectedCount' => 2,
    'searchPlaceholder' => null,
    'class' => '',
])

@php
    $preset = \App\Support\FunctionBar::preset();
    $tokens = $preset['tokens'] ?? [];
    $search = $preset['search'] ?? [];
    $variantTokens = \App\Support\FunctionBar::variantTokens($variant);
    $actions = $variantTokens['actions'] ?? [];
    $bulkActions = $variantTokens['bulkActions'] ?? [];
    $selectionDivider = $variantTokens['selectionDivider'] ?? null;
    $selectionLabel = \App\Support\FunctionBar::selectionLabel($variant, (int) $selectedCount);
    $placeholder = $searchPlaceholder ?? ($search['placeholder'] ?? 'Search');
    $shortcut = $search['shortcut'] ?? '/';
    $classes = collect([
        'tma-function-bar',
        'tma-function-bar--' . $variant,
        $class,
    ])->filter()->implode(' ');
@endphp

<div
    {{ $attributes->merge(['class' => $classes]) }}
    style="
        --function-bar-width: {{ $tokens['width'] ?? 892 }}px;
        --function-bar-min-height: {{ $tokens['minHeight'] ?? 44 }}px;
        --function-bar-padding: {{ $tokens['padding'] ?? 8 }}px;
        --function-bar-radius: {{ $tokens['radius'] ?? 12 }}px;
        --function-bar-background: {{ $tokens['background'] ?? '#f9f9fa' }};
        --function-bar-gap: {{ $tokens['gap'] ?? 16 }}px;
        --function-bar-actions-gap: {{ $tokens['actionsGap'] ?? 8 }}px;
        --function-bar-icon-size: {{ $tokens['iconSize'] ?? 16 }}px;
        --function-bar-action-size: {{ $tokens['actionSize'] ?? 24 }}px;
        --function-bar-action-padding: {{ $tokens['actionPadding'] ?? 4 }}px;
        --function-bar-search-radius: {{ $tokens['searchRadius'] ?? 16 }}px;
        --function-bar-search-padding-x: {{ $tokens['searchPaddingX'] ?? 8 }}px;
        --function-bar-search-padding-y: {{ $tokens['searchPaddingY'] ?? 4 }}px;
        --function-bar-search-background: {{ $tokens['searchBackground'] ?? 'rgba(255, 255, 255, 0.8)' }};
        --function-bar-search-border-color: {{ $tokens['searchBorderColor'] ?? 'rgba(0, 0, 0, 0.2)' }};
        --function-bar-search-placeholder-color: {{ $tokens['searchPlaceholderColor'] ?? 'rgba(0, 0, 0, 0.2)' }};
        --function-bar-search-font-size: {{ $tokens['searchFontSize'] ?? 14 }}px;
        --function-bar-search-line-height: {{ $tokens['searchLineHeight'] ?? 20 }}px;
        --function-bar-search-field-width: {{ $tokens['searchFieldWidth'] ?? 116 }}px;
        --function-bar-kbd-width: {{ $tokens['kbdWidth'] ?? 20 }}px;
        --function-bar-kbd-font-size: {{ $tokens['kbdFontSize'] ?? 12 }}px;
        --function-bar-kbd-line-height: {{ $tokens['kbdLineHeight'] ?? 16 }}px;
        --function-bar-kbd-border-color: {{ $tokens['kbdBorderColor'] ?? 'rgba(0, 0, 0, 0.1)' }};
        --function-bar-selection-font-size: {{ $tokens['selectionFontSize'] ?? 12 }}px;
        --function-bar-selection-line-height: {{ $tokens['selectionLineHeight'] ?? 16 }}px;
    "
>
    <div class="tma-function-bar__actions">
        @foreach ($actions as $icon)
            <button type="button" class="tma-function-bar__action" aria-label="{{ $icon }}">
                <img
                    src="{{ \App\Support\FunctionBar::iconPath($icon) }}"
                    class="tma-function-bar__icon"
                    width="16"
                    height="16"
                    alt=""
                />
            </button>
        @endforeach

        @if ($selectionLabel)
            <div class="tma-function-bar__selection">
                @if ($selectionDivider)
                    <img
                        src="{{ \App\Support\FunctionBar::iconPath($selectionDivider) }}"
                        class="tma-function-bar__icon tma-function-bar__icon--divider"
                        width="16"
                        height="16"
                        alt=""
                        aria-hidden="true"
                    />
                @endif
                <span class="tma-function-bar__selection-label">{{ $selectionLabel }}</span>
            </div>
        @endif

        @foreach ($bulkActions as $icon)
            <button type="button" class="tma-function-bar__action" aria-label="{{ $icon }}">
                <img
                    src="{{ \App\Support\FunctionBar::iconPath($icon) }}"
                    class="tma-function-bar__icon"
                    width="16"
                    height="16"
                    alt=""
                />
            </button>
        @endforeach
    </div>

    <div class="tma-function-bar__search" role="search">
        <label class="tma-function-bar__search-field">
            <img
                src="{{ \App\Support\FunctionBar::iconPath('Search') }}"
                class="tma-function-bar__icon"
                width="16"
                height="16"
                alt=""
                aria-hidden="true"
            />
            <input
                type="search"
                class="tma-function-bar__search-input"
                placeholder="{{ $placeholder }}"
                aria-label="{{ $placeholder }}"
                autocomplete="off"
                spellcheck="false"
            />
        </label>
        <button
            type="button"
            class="tma-function-bar__search-clear"
            data-search-clear
            aria-label="Clear search"
        >
            <img
                src="{{ asset('images/icons/tma/Xcircle.svg') }}"
                class="tma-function-bar__search-clear-icon"
                width="16"
                height="16"
                alt=""
            />
        </button>
        <span class="tma-function-bar__search-spinner" aria-hidden="true">
            <img src="{{ asset('images/icons/tma/Loading-16.svg') }}" width="20" height="20" alt="">
        </span>
        <button
            type="button"
            class="tma-function-bar__kbd"
            aria-label="Focus search"
            data-shortcut="{{ $shortcut }}"
        >{{ $shortcut }}</button>
    </div>
</div>
