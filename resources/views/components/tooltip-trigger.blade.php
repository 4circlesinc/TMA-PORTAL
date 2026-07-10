@props([
    'text' => null,
    'title' => null,
    'shortcut' => null,
    'variant' => null,
    'position' => null,
    'type' => 'default',
    'disabled' => false,
    'class' => '',
])

@php
    $preset = \App\Support\Tooltip::preset();
    $behavior = \App\Support\Tooltip::behavior();
    $resolvedVariant = $variant ?? $preset['defaultVariant'] ?? 'compact';
    $resolvedPosition = $position ?? $preset['defaultPosition'] ?? 'top';
    $tooltipId = 'tooltip-' . uniqid();
    $groupClasses = collect([
        'tma-tooltip-trigger',
        $disabled ? 'tma-tooltip-trigger--disabled' : '',
        $class,
    ])->filter()->implode(' ');
@endphp

<span
    {{ $attributes->merge(['class' => $groupClasses]) }}
    @if (! $disabled)
        data-tooltip-trigger
        data-tooltip-type="{{ $type }}"
        data-tooltip-target="{{ $tooltipId }}"
        data-tooltip-initial-delay="{{ $behavior['initialDelayMs'] ?? 1500 }}"
        data-tooltip-rehover-delay="{{ $behavior['rehoverDelayMs'] ?? 500 }}"
        data-tooltip-rehover-window="{{ $behavior['rehoverWindowMs'] ?? 30000 }}"
        data-tooltip-position="{{ $resolvedPosition }}"
        aria-describedby="{{ $tooltipId }}"
    @endif
>
    {{ $slot }}

    @if (! $disabled && ($text || $title))
        <x-tooltip
            :id="$tooltipId"
            :text="$text"
            :title="$title"
            :shortcut="$shortcut"
            :variant="$resolvedVariant"
            :position="$resolvedPosition"
            class="tma-tooltip-trigger__tip"
        />
    @endif
</span>
