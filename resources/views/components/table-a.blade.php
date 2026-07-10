@props([
    'variant' => 'default',
    'rows' => null,
    'currentPage' => 1,
    'class' => '',
])

@php
    $preset = \App\Support\TableA::preset();
    $tokens = $preset['tokens'] ?? [];
    $columns = $preset['columns'] ?? [];
    $items = $rows ?? \App\Support\TableA::rows();
    $classes = collect([
        'tma-table-a',
        'tma-table-a--' . $variant,
        $class,
    ])->filter()->implode(' ');
@endphp

<div
    {{ $attributes->merge(['class' => $classes]) }}
    style="
        --table-a-width: {{ $tokens['width'] ?? 892 }}px;
        --table-a-gap: {{ $tokens['gap'] ?? 12 }}px;
        --table-a-row-min-height: {{ $tokens['rowMinHeight'] ?? 40 }}px;
        --table-a-cell-padding-x: {{ $tokens['cellPaddingX'] ?? 12 }}px;
        --table-a-cell-padding-y: {{ $tokens['cellPaddingY'] ?? 8 }}px;
        --table-a-status-cell-padding-left: {{ $tokens['statusCellPaddingLeft'] ?? 8 }}px;
        --table-a-status-cell-padding-right: {{ $tokens['statusCellPaddingRight'] ?? 12 }}px;
        --table-a-action-cell-padding-x: {{ $tokens['actionCellPaddingX'] ?? 8 }}px;
        --table-a-action-cell-padding-y: {{ $tokens['actionCellPaddingY'] ?? 4 }}px;
        --table-a-font-size: {{ $tokens['fontSize'] ?? 12 }}px;
        --table-a-line-height: {{ $tokens['lineHeight'] ?? 16 }}px;
        --table-a-font-weight: {{ $tokens['fontWeight'] ?? 400 }};
        --table-a-text-color: {{ $tokens['textColor'] ?? '#000' }};
        --table-a-header-muted-color: {{ $tokens['headerMutedColor'] ?? 'rgba(0, 0, 0, 0.4)' }};
        --table-a-letter-spacing: {{ $tokens['letterSpacing'] ?? 0 }}px;
        --table-a-header-border-color: {{ $tokens['headerBorderColor'] ?? 'rgba(0, 0, 0, 0.2)' }};
        --table-a-row-border-color: {{ $tokens['rowBorderColor'] ?? 'rgba(0, 0, 0, 0.04)' }};
        --table-a-row-hover-background: {{ $tokens['rowHoverBackground'] ?? 'rgba(0, 0, 0, 0.04)' }};
        --table-a-row-radius: {{ $tokens['rowRadius'] ?? 12 }}px;
        --table-a-date-icon-row-gap: {{ $tokens['dateIconRowGap'] ?? 8 }}px;
        --table-a-date-icon-column-gap: {{ $tokens['dateIconColumnGap'] ?? 4 }}px;
        --table-a-user-icon-gap: {{ $tokens['userIconGap'] ?? 8 }}px;
        --table-a-address-icon-column-gap: {{ $tokens['addressIconColumnGap'] ?? 4 }}px;
        --table-a-address-icon-row-gap: {{ $tokens['addressIconRowGap'] ?? 8 }}px;
        --table-a-icon-size: {{ $tokens['iconSize'] ?? 16 }}px;
        --table-a-avatar-size: {{ $tokens['avatarSize'] ?? 24 }}px;
        --table-a-checkbox-size: {{ $tokens['checkboxSize'] ?? 16 }}px;
        --table-a-columns: {{ $tokens['columns'] ?? '32px 88px 1fr 1fr 176px 1fr 110px 40px' }};
    "
>
    <x-function-bar variant="default" />

    <div class="tma-table-a__sheet" role="table" aria-label="Orders">
        <div class="tma-table-a__row tma-table-a__row--head" role="row">
            @foreach ($columns as $column)
                @if ($column['type'] === 'checkbox')
                    <div class="tma-table-a__cell tma-table-a__cell--select" role="columnheader">
                        <button
                            type="button"
                            class="tma-table-a__checkbox-btn"
                            data-select-all
                            aria-label="Select all rows"
                            aria-pressed="false"
                        >
                            <img
                                src="{{ \App\Support\TableA::iconPath('Checkbox') }}"
                                class="tma-table-a__checkbox-glyph"
                                data-checkbox-glyph
                                width="16"
                                height="16"
                                alt=""
                            />
                        </button>
                    </div>
                @elseif ($column['type'] === 'actions')
                    <div class="tma-table-a__cell tma-table-a__cell--actions" role="columnheader" aria-hidden="true"></div>
                @else
                    <div
                        class="tma-table-a__cell tma-table-a__cell--{{ $column['key'] }}{{ ($column['headerMuted'] ?? true) ? '' : ' tma-table-a__cell--header-emphasis' }}"
                        role="columnheader"
                    >
                        <span class="tma-table-a__label">{{ $column['label'] }}</span>
                    </div>
                @endif
            @endforeach
        </div>

        @foreach ($items as $index => $row)
            @php
                $borderVariant = \App\Support\TableA::borderVariant($row);
                $checked = \App\Support\TableA::isRowChecked($row);
                $rowClass = collect([
                    'tma-table-a__row',
                    'tma-table-a__row--' . $borderVariant,
                ])->implode(' ');
                $statusVariant = \App\Support\TableA::statusVariant($row['status'] ?? 'rejected');
            @endphp
            <div
                class="{{ $rowClass }}"
                role="row"
                data-row-index="{{ $index }}"
                data-border-variant="{{ $borderVariant }}"
            >
                <div class="tma-table-a__cell tma-table-a__cell--select" role="cell">
                    <button
                        type="button"
                        class="tma-table-a__checkbox-btn"
                        aria-label="Select row {{ $row['orderId'] }}"
                        aria-pressed="{{ $checked ? 'true' : 'false' }}"
                        data-row-checkbox
                        @if ($checked) data-checked @endif
                    >
                        <img
                            src="{{ \App\Support\TableA::iconPath($checked ? 'CheckboxChecked' : 'Checkbox') }}"
                            class="tma-table-a__checkbox-glyph"
                            data-checkbox-glyph
                            width="16"
                            height="16"
                            alt=""
                        />
                    </button>
                </div>

                <div class="tma-table-a__cell tma-table-a__cell--orderId" role="cell">
                    <span class="tma-table-a__label">{{ $row['orderId'] }}</span>
                </div>

                <div class="tma-table-a__cell tma-table-a__cell--user" role="cell">
                    <span class="tma-table-a__icon-text tma-table-a__icon-text--user">
                        <img
                            src="{{ \App\Support\Avatars::url($row['avatar']) }}"
                            alt=""
                            class="tma-table-a__avatar"
                            width="24"
                            height="24"
                        />
                        <span class="tma-table-a__label">{{ $row['user'] }}</span>
                    </span>
                </div>

                <div class="tma-table-a__cell tma-table-a__cell--project" role="cell">
                    <span class="tma-table-a__label">{{ $row['project'] }}</span>
                </div>

                <div class="tma-table-a__cell tma-table-a__cell--address" role="cell">
                    <span class="tma-table-a__address">
                        <span class="tma-table-a__label">{{ $row['address'] }}</span>
                        <button type="button" class="tma-table-a__clipboard" aria-label="Copy address">
                            <img
                                src="{{ \App\Support\TableA::iconPath('Copy') }}"
                                class="tma-table-a__icon"
                                width="16"
                                height="16"
                                alt=""
                            />
                        </button>
                    </span>
                </div>

                <div class="tma-table-a__cell tma-table-a__cell--date" role="cell">
                    <span class="tma-table-a__icon-text tma-table-a__icon-text--date">
                        <img
                            src="{{ \App\Support\TableA::iconPath('CalendarBlank') }}"
                            class="tma-table-a__icon"
                            width="16"
                            height="16"
                            alt=""
                            aria-hidden="true"
                        />
                        <span class="tma-table-a__label">{{ $row['date'] }}</span>
                    </span>
                </div>

                <div class="tma-table-a__cell tma-table-a__cell--status" role="cell">
                    <x-status-badge
                        :variant="$statusVariant"
                        :label="$row['statusLabel']"
                    />
                </div>

                <div class="tma-table-a__cell tma-table-a__cell--actions" role="cell">
                    <button type="button" class="tma-table-a__action" aria-label="Row actions">
                        <img
                            src="{{ \App\Support\TableA::iconPath('ThreeDots') }}"
                            class="tma-table-a__icon"
                            width="16"
                            height="16"
                            alt=""
                        />
                    </button>
                </div>
            </div>
        @endforeach
    </div>

    <x-pagination variant="stretch" :current-page="$currentPage" />
</div>
