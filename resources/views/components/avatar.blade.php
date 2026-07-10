@props([
    'src' => null,
    'initial' => null,
    'color' => '#edeefc',
    'size' => 24,
    'alt' => '',
])

@php
    $px = (int) $size;
    $classes = 'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/5 transition hover:opacity-90';
@endphp

@if ($src)
    <img
        {{ $attributes->merge(['class' => $classes]) }}
        src="{{ $src }}"
        alt="{{ $alt }}"
        width="{{ $px }}"
        height="{{ $px }}"
        style="width: {{ $px }}px; height: {{ $px }}px; object-fit: cover;"
    />
@else
    <span
        {{ $attributes->merge(['class' => $classes . ' text-xs font-normal text-black']) }}
        style="width: {{ $px }}px; height: {{ $px }}px; background-color: {{ $color }};"
        aria-label="{{ $alt ?: $initial }}"
    >
        {{ $initial }}
    </span>
@endif
