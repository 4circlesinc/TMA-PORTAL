@props([
    'variant' => 'default',
    'currentPage' => 1,
    'totalPages' => null,
    'pages' => null,
    'pageSize' => 20,
    'totalResults' => 105,
    'class' => '',
])

@php
    $preset = \App\Support\Pagination::preset();
    $tokens = $preset['tokens'] ?? [];
    $variantTokens = \App\Support\Pagination::variantTokens($variant);
    $resolvedPages = $pages ?? ($preset['pages'] ?? [1, 2, 3, 4, 5]);
    $resolvedTotalPages = $totalPages ?? count($resolvedPages);
    $resolvedPageSize = $pageSize ?? ($variantTokens['pageSize'] ?? 20);
    $resolvedTotalResults = $totalResults ?? ($variantTokens['totalResults'] ?? 105);
    $resultsLabel = \App\Support\Pagination::resultsLabel($variant, (int) $resolvedTotalResults);
    $showFooter = $variant === 'footer';
    $classes = collect([
        'tma-pagination-bar',
        'tma-pagination-bar--' . $variant,
        $class,
    ])->filter()->implode(' ');
@endphp

<div {{ $attributes->merge(['class' => $classes]) }}>
    @if ($showFooter)
        <div class="tma-pagination-bar__meta">
            <button type="button" class="tma-pagination-bar__page-size" aria-label="Rows per page">
                <span class="tma-pagination__label">{{ $resolvedPageSize }}</span>
                <img
                    src="{{ \App\Support\Pagination::iconPath('ArrowLineDown') }}"
                    class="tma-pagination__icon"
                    width="16"
                    height="16"
                    alt=""
                    aria-hidden="true"
                />
            </button>
            @if ($resultsLabel)
                <span class="tma-pagination-bar__results">{{ $resultsLabel }}</span>
            @endif
        </div>
    @endif

    <nav class="tma-pagination" aria-label="Pagination">
        @foreach ($resolvedPages as $page)
            <button
                type="button"
                class="tma-pagination__button {{ (int) $page === (int) $currentPage ? 'tma-pagination__button--active' : '' }}"
                aria-label="Page {{ $page }}"
                @if ((int) $page === (int) $currentPage) aria-current="page" @endif
                data-page="{{ $page }}"
            >
                <span class="tma-pagination__label">{{ $page }}</span>
            </button>
        @endforeach

        <button
            type="button"
            class="tma-pagination__button tma-pagination__button--icon"
            aria-label="Previous page"
            data-direction="prev"
            @disabled((int) $currentPage <= 1)
        >
            <img
                src="{{ \App\Support\Pagination::iconPath('ArrowLineLeft') }}"
                class="tma-pagination__icon"
                width="16"
                height="16"
                alt=""
            />
        </button>

        <button
            type="button"
            class="tma-pagination__button tma-pagination__button--icon tma-pagination__button--next"
            data-direction="next"
            aria-label="Next page"
            @disabled((int) $currentPage >= (int) $resolvedTotalPages)
        >
            <img
                src="{{ \App\Support\Pagination::iconPath('ArrowLineRight') }}"
                class="tma-pagination__icon"
                width="16"
                height="16"
                alt=""
            />
        </button>
    </nav>
</div>
