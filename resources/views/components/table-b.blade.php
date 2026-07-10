@props([
    'variant' => 'default',
    'title' => 'Tasks',
    'rows' => null,
    'interactive' => false,
    'dataPageUrl' => '#',
    'class' => '',
])

@php
    $preset = \App\Support\TableB::preset();
    $tokens = $preset['tokens'] ?? [];
    $columns = $preset['columns'] ?? [];
    $items = $rows ?? \App\Support\TableB::rows();
    $classes = collect([
        'tma-table-b',
        'tma-table-b--' . $variant,
        $interactive ? 'tma-table-b--interactive' : null,
        $class,
    ])->filter()->implode(' ');
@endphp

<div
    {{ $attributes->merge(['class' => $classes]) }}
    @if ($interactive) data-table-b data-data-page-url="{{ $dataPageUrl }}" @endif
    style="
        --table-b-block-width: {{ $tokens['blockWidth'] ?? 662 }}px;
        --table-b-block-height: {{ $tokens['blockHeight'] ?? 312 }}px;
        --table-b-block-background: {{ $tokens['blockBackground'] ?? '#f9f9fa' }};
        --table-b-block-padding: {{ $tokens['blockPadding'] ?? 24 }}px;
        --table-b-block-radius: {{ $tokens['blockRadius'] ?? 16 }}px;
        --table-b-block-gap: {{ $tokens['blockGap'] ?? 4 }}px;
        --table-b-title-font-size: {{ $tokens['titleFontSize'] ?? 14 }}px;
        --table-b-title-line-height: {{ $tokens['titleLineHeight'] ?? 20 }}px;
        --table-b-title-font-weight: {{ $tokens['titleFontWeight'] ?? 600 }};
        --table-b-row-min-height: {{ $tokens['rowMinHeight'] ?? 40 }}px;
        --table-b-cell-padding-y: {{ $tokens['cellPaddingY'] ?? 8 }}px;
        --table-b-cell-padding-x: {{ $tokens['cellPaddingX'] ?? 12 }}px;
        --table-b-title-cell-padding-right: {{ $tokens['titleCellPaddingRight'] ?? 12 }}px;
        --table-b-status-cell-padding-left: {{ $tokens['statusCellPaddingLeft'] ?? 8 }}px;
        --table-b-status-cell-padding-right: {{ $tokens['statusCellPaddingRight'] ?? 12 }}px;
        --table-b-font-size: {{ $tokens['fontSize'] ?? 12 }}px;
        --table-b-line-height: {{ $tokens['lineHeight'] ?? 16 }}px;
        --table-b-font-weight: {{ $tokens['fontWeight'] ?? 400 }};
        --table-b-text-color: {{ $tokens['textColor'] ?? '#000' }};
        --table-b-letter-spacing: {{ $tokens['letterSpacing'] ?? 0 }}px;
        --table-b-header-border-color: {{ $tokens['headerBorderColor'] ?? 'rgba(0, 0, 0, 0.2)' }};
        --table-b-header-muted-color: {{ $tokens['headerMutedColor'] ?? 'rgba(0, 0, 0, 0.4)' }};
        --table-b-avatar-size: {{ $tokens['avatarSize'] ?? 24 }}px;
        --table-b-avatar-overlap: {{ $tokens['avatarOverlap'] ?? 8 }}px;
        --table-b-avatar-border-color: {{ $tokens['avatarBorderColor'] ?? '#fff' }};
        --table-b-avatar-overflow-background: {{ $tokens['avatarOverflowBackground'] ?? '#e6f1fd' }};
        --table-b-title-column-min-width: {{ $tokens['titleColumnMinWidth'] ?? 224 }}px;
        --table-b-columns: {{ $tokens['columns'] ?? '1fr 1fr 1fr 1fr' }};
    "
>
    @if ($interactive)
        <button type="button" class="tma-table-b__title tma-table-b__title-link" data-table-b-title>{{ $title }}</button>
    @else
        <h3 class="tma-table-b__title">{{ $title }}</h3>
    @endif

    <div class="tma-table-b__sheet" role="table" aria-label="{{ $title }}">
        <div class="tma-table-b__row tma-table-b__row--head" role="row">
            @foreach ($columns as $column)
                @php
                    $cellClass = 'tma-table-b__cell';
                    if (($column['padding'] ?? '') === 'title') {
                        $cellClass .= ' tma-table-b__cell--title';
                    } elseif (($column['padding'] ?? '') === 'status') {
                        $cellClass .= ' tma-table-b__cell--status';
                    } elseif ($column['type'] === 'avatars') {
                        $cellClass .= ' tma-table-b__cell--avatars';
                    }
                @endphp
                <div class="{{ $cellClass }}" role="columnheader">{{ $column['label'] }}</div>
            @endforeach
        </div>

        @foreach ($items as $row)
            <div class="tma-table-b__row" role="row">
                @foreach ($columns as $column)
                    @php
                        $cellClass = 'tma-table-b__cell';
                        if (($column['padding'] ?? '') === 'title') {
                            $cellClass .= ' tma-table-b__cell--title';
                        } elseif (($column['padding'] ?? '') === 'status') {
                            $cellClass .= ' tma-table-b__cell--status';
                        } elseif ($column['type'] === 'avatars') {
                            $cellClass .= ' tma-table-b__cell--avatars';
                        }
                    @endphp
                    <div class="{{ $cellClass }}" role="cell">
                        @switch($column['type'])
                            @case('avatars')
                                @php
                                    $group = $row['assignedTo'] ?? [];
                                    $avatars = $group['avatars'] ?? [];
                                    $overflow = $group['overflow'] ?? null;
                                @endphp
                                <div class="tma-table-b__avatar-group">
                                    @foreach ($avatars as $avatar)
                                        @if ($interactive)
                                            <button type="button" class="tma-table-b__avatar-btn" data-user-avatar data-user-id="{{ $avatar }}">
                                                <img
                                                    src="{{ \App\Support\TableB::avatarUrl($avatar) }}"
                                                    alt=""
                                                    class="tma-table-b__avatar"
                                                    width="24"
                                                    height="24"
                                                />
                                            </button>
                                        @else
                                            <img
                                                src="{{ \App\Support\TableB::avatarUrl($avatar) }}"
                                                alt=""
                                                class="tma-table-b__avatar"
                                                width="24"
                                                height="24"
                                            />
                                        @endif
                                    @endforeach
                                    @if ($overflow)
                                        <span class="tma-table-b__avatar-overflow">{{ $overflow }}</span>
                                    @endif
                                </div>
                                @break

                            @case('status')
                                <x-status-badge
                                    :variant="\App\Support\TableB::statusVariant($row['status'] ?? '')"
                                    :label="$row['statusLabel'] ?? ''"
                                />
                                @break

                            @default
                                @if ($interactive && $column['key'] === 'title')
                                    <button type="button" class="tma-table-b__row-link" data-task-title>{{ $row[$column['key']] ?? '' }}</button>
                                @else
                                    {{ $row[$column['key']] ?? '' }}
                                @endif
                        @endswitch
                    </div>
                @endforeach
            </div>
        @endforeach
    </div>
</div>
