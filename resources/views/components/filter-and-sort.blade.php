@props([
    'variant' => 'default',
    'tags' => null,
    'resetLabel' => null,
    'class' => '',
])

@php
    $preset = \App\Support\FilterAndSort::preset();
    $tokens = $preset['tokens'] ?? [];
    $items = $tags ?? \App\Support\FilterAndSort::defaultTags();
    $reset = $resetLabel ?? ($preset['resetLabel'] ?? 'Reset');
    $classes = collect([
        'tma-filter-and-sort',
        'tma-filter-and-sort--' . $variant,
        $class,
    ])->filter()->implode(' ');
@endphp

<div
    {{ $attributes->merge(['class' => $classes]) }}
    style="
        --filter-sort-width: {{ $tokens['width'] ?? 888 }}px;
        --filter-sort-min-height: {{ $tokens['minHeight'] ?? 24 }}px;
        --filter-sort-radius: {{ $tokens['radius'] ?? 12 }}px;
        --filter-sort-tags-gap: {{ $tokens['tagsGap'] ?? 8 }}px;
        --filter-sort-tag-gap: {{ $tokens['tagGap'] ?? 4 }}px;
        --filter-sort-tag-padding-x: {{ $tokens['tagPaddingX'] ?? 4 }}px;
        --filter-sort-tag-padding-y: {{ $tokens['tagPaddingY'] ?? 2 }}px;
        --filter-sort-tag-radius: {{ $tokens['tagRadius'] ?? 8 }}px;
        --filter-sort-tag-background: {{ $tokens['tagBackground'] ?? 'rgba(0, 0, 0, 0.04)' }};
        --filter-sort-font-size: {{ $tokens['fontSize'] ?? 12 }}px;
        --filter-sort-line-height: {{ $tokens['lineHeight'] ?? 16 }}px;
        --filter-sort-text-color: {{ $tokens['textColor'] ?? '#000000' }};
        --filter-sort-reset-color: {{ $tokens['resetColor'] ?? 'rgba(0, 0, 0, 0.4)' }};
        --filter-sort-reset-padding-x: {{ $tokens['resetPaddingX'] ?? 12 }}px;
        --filter-sort-reset-padding-y: {{ $tokens['resetPaddingY'] ?? 4 }}px;
        --filter-sort-reset-min-size: {{ $tokens['resetMinSize'] ?? 24 }}px;
        --filter-sort-icon-size-16: {{ $tokens['iconSize16'] ?? 16 }}px;
        --filter-sort-icon-size-12: {{ $tokens['iconSize12'] ?? 12 }}px;
        --filter-sort-close-size: {{ $tokens['closeSize'] ?? 6 }}px;
        --filter-sort-close-hit-size: {{ $tokens['closeHitSize'] ?? 12 }}px;
    "
>
    <div class="tma-filter-and-sort__tags" role="list">
        @foreach ($items as $tag)
            @php
                $iconSize = (int) ($tag['iconSize'] ?? 16);
                $iconClass = $iconSize === 12
                    ? 'tma-filter-and-sort__icon tma-filter-and-sort__icon--12'
                    : 'tma-filter-and-sort__icon tma-filter-and-sort__icon--16';
            @endphp
            <div
                class="tma-filter-and-sort__tag"
                role="listitem"
                data-tag-id="{{ $tag['id'] ?? '' }}"
            >
                <img
                    src="{{ \App\Support\FilterAndSort::iconPath($tag['icon']) }}"
                    class="{{ $iconClass }}"
                    width="{{ $iconSize }}"
                    height="{{ $iconSize }}"
                    alt=""
                    aria-hidden="true"
                />
                <span class="tma-filter-and-sort__label">{{ $tag['label'] }}</span>
                <button
                    type="button"
                    class="tma-filter-and-sort__remove"
                    aria-label="Remove {{ $tag['label'] }}"
                    data-remove-tag="{{ $tag['id'] ?? '' }}"
                >
                    <img
                        src="{{ \App\Support\FilterAndSort::iconPath('Close') }}"
                        class="tma-filter-and-sort__icon tma-filter-and-sort__icon--close"
                        width="6"
                        height="6"
                        alt=""
                    />
                </button>
            </div>
        @endforeach
    </div>

    <button type="button" class="tma-filter-and-sort__reset" data-reset-filters>
        <span class="tma-filter-and-sort__reset-label">{{ $reset }}</span>
    </button>
</div>
