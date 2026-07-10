@props([
    'variant' => 'expand',
    'title' => 'Sign in Sessions',
    'rows' => null,
    'fullPageUrl' => '#',
    'class' => '',
])

@php
    $preset = \App\Support\TableBSessions::preset();
    $tokens = $preset['tokens'] ?? [];
    $columns = $preset['columns'] ?? [];
    $items = $rows ?? \App\Support\TableBSessions::rows();
    $filterOptions = $preset['filterOptions'] ?? [];
    $actionOptions = $preset['actionOptions'] ?? [];
    $classes = collect([
        'tma-table-b-sessions',
        'tma-table-b-sessions--' . $variant,
        $class,
    ])->filter()->implode(' ');
@endphp

<div
    {{ $attributes->merge(['class' => $classes]) }}
    data-table-b-sessions
    data-variant="{{ $variant }}"
    data-full-page-url="{{ $fullPageUrl }}"
    style="
        --table-b-sessions-block-width: {{ $tokens['blockWidth'] ?? 892 }}px;
        --table-b-sessions-block-min-width: {{ $tokens['blockMinWidth'] ?? 800 }}px;
        --table-b-sessions-block-background: {{ $tokens['blockBackground'] ?? '#f9f9fa' }};
        --table-b-sessions-block-padding: {{ $tokens['blockPadding'] ?? 24 }}px;
        --table-b-sessions-block-radius: {{ $tokens['blockRadius'] ?? 16 }}px;
        --table-b-sessions-block-gap: {{ $tokens['blockGap'] ?? 4 }}px;
        --table-b-sessions-title-font-size: {{ $tokens['titleFontSize'] ?? 14 }}px;
        --table-b-sessions-title-line-height: {{ $tokens['titleLineHeight'] ?? 20 }}px;
        --table-b-sessions-title-font-weight: {{ $tokens['titleFontWeight'] ?? 600 }};
        --table-b-sessions-row-min-height: {{ $tokens['rowMinHeight'] ?? 40 }}px;
        --table-b-sessions-cell-padding-y: {{ $tokens['cellPaddingY'] ?? 8 }}px;
        --table-b-sessions-cell-padding-x: {{ $tokens['cellPaddingX'] ?? 12 }}px;
        --table-b-sessions-location-cell-padding-right: {{ $tokens['locationCellPaddingRight'] ?? 12 }}px;
        --table-b-sessions-status-cell-padding-left: {{ $tokens['statusCellPaddingLeft'] ?? 8 }}px;
        --table-b-sessions-status-cell-padding-right: {{ $tokens['statusCellPaddingRight'] ?? 12 }}px;
        --table-b-sessions-font-size: {{ $tokens['fontSize'] ?? 12 }}px;
        --table-b-sessions-line-height: {{ $tokens['lineHeight'] ?? 16 }}px;
        --table-b-sessions-font-weight: {{ $tokens['fontWeight'] ?? 400 }};
        --table-b-sessions-text-color: {{ $tokens['textColor'] ?? '#000' }};
        --table-b-sessions-letter-spacing: {{ $tokens['letterSpacing'] ?? 0 }}px;
        --table-b-sessions-header-border-color: {{ $tokens['headerBorderColor'] ?? 'rgba(0, 0, 0, 0.2)' }};
        --table-b-sessions-header-muted-color: {{ $tokens['headerMutedColor'] ?? 'rgba(0, 0, 0, 0.4)' }};
        --table-b-sessions-columns: {{ $tokens['columns'] ?? '174px 1fr 158px 165px 120px' }};
    "
>
    <div class="tma-table-b-sessions__header">
        <h3 class="tma-table-b-sessions__title">{{ $title }}</h3>

        @if ($variant === 'expand')
            <button
                type="button"
                class="tma-table-b-sessions__header-control tma-table-b-sessions__header-control--expand"
                data-sessions-expand
                aria-label="Open as full page"
            >
                <img
                    src="{{ \App\Support\TableBSessions::iconUrl('expand') }}"
                    alt=""
                    class="tma-table-b-sessions__header-control-icon"
                    width="16"
                    height="16"
                />
            </button>
        @elseif ($variant === 'filter')
            <button
                type="button"
                class="tma-table-b-sessions__header-control tma-table-b-sessions__header-control--filter"
                data-sessions-filter
                aria-haspopup="listbox"
                aria-expanded="false"
            >
                <span data-sessions-filter-label>1 hour</span>
                <img
                    src="{{ \App\Support\TableBSessions::iconUrl('arrowDown') }}"
                    alt=""
                    class="tma-table-b-sessions__header-control-icon"
                    width="16"
                    height="16"
                />
            </button>
        @elseif ($variant === 'actions')
            <button
                type="button"
                class="tma-table-b-sessions__header-control tma-table-b-sessions__header-control--actions"
                data-sessions-actions
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded="false"
            >
                <img
                    src="{{ \App\Support\TableBSessions::iconUrl('threeDots') }}"
                    alt=""
                    class="tma-table-b-sessions__header-control-icon"
                    width="16"
                    height="16"
                />
            </button>
        @endif
    </div>

    <div class="tma-table-b-sessions__sheet" role="table" aria-label="{{ $title }}">
        <div class="tma-table-b-sessions__row tma-table-b-sessions__row--head" role="row">
            @foreach ($columns as $column)
                @php
                    $cellClass = 'tma-table-b-sessions__cell';
                    if (($column['padding'] ?? '') === 'location') {
                        $cellClass .= ' tma-table-b-sessions__cell--location';
                    } elseif (($column['padding'] ?? '') === 'status') {
                        $cellClass .= ' tma-table-b-sessions__cell--status';
                    }
                @endphp
                <div class="{{ $cellClass }}" role="columnheader">{{ $column['label'] }}</div>
            @endforeach
        </div>

        @foreach ($items as $row)
            <div class="tma-table-b-sessions__row" role="row">
                @foreach ($columns as $column)
                    @php
                        $cellClass = 'tma-table-b-sessions__cell';
                        if (($column['padding'] ?? '') === 'location') {
                            $cellClass .= ' tma-table-b-sessions__cell--location';
                        } elseif (($column['padding'] ?? '') === 'status') {
                            $cellClass .= ' tma-table-b-sessions__cell--status';
                        }
                    @endphp
                    <div class="{{ $cellClass }}" role="cell">
                        @switch($column['type'])
                            @case('time')
                                <span class="tma-table-b-sessions__time">
                                    <img
                                        src="{{ \App\Support\TableBSessions::iconUrl('clock') }}"
                                        alt=""
                                        class="tma-table-b-sessions__time-icon"
                                        width="16"
                                        height="16"
                                    />
                                    <span>{{ $row['time'] ?? '' }}</span>
                                </span>
                                @break

                            @case('status')
                                <x-status-badge
                                    :variant="\App\Support\TableBSessions::statusVariant($row['status'] ?? '')"
                                    :label="$row['statusLabel'] ?? ''"
                                />
                                @break

                            @default
                                {{ $row[$column['key']] ?? '' }}
                        @endswitch
                    </div>
                @endforeach
            </div>
        @endforeach
    </div>

    @if ($variant === 'filter')
        <div class="tma-table-b__popover" data-table-b-popover="filter" role="listbox" aria-hidden="true" hidden>
            @foreach ($filterOptions as $option)
                <button
                    type="button"
                    class="tma-table-b__popover-item"
                    role="option"
                    data-popover-value="{{ $option['value'] }}"
                    @if ($option['value'] === '1h') data-selected @endif
                >{{ $option['label'] }}</button>
            @endforeach
        </div>
    @elseif ($variant === 'actions')
        <div class="tma-table-b__popover" data-table-b-popover="actions" role="menu" aria-hidden="true" hidden>
            @foreach ($actionOptions as $option)
                <button
                    type="button"
                    class="tma-table-b__popover-item"
                    role="menuitem"
                    data-popover-value="{{ $option['value'] }}"
                >{{ $option['label'] }}</button>
            @endforeach
        </div>
    @endif
</div>
