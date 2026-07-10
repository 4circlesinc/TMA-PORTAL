@props([
    'name' => 'vertical-01',
    'file' => null,
    'alt' => null,
    'class' => '',
])

@php
    $resolvedFile = $file ?? \App\Support\Charts::file($name);
    $item = \App\Support\Charts::find($name) ?? \App\Support\Charts::find($resolvedFile);
    $label = $alt ?? ($item['name'] ?? $name);
    $width = $item['width'] ?? null;
    $height = $item['height'] ?? null;
    $modifiers = collect([
        $item['wide'] ?? false ? 'tma-chart-graphic--wide' : null,
        ($item['category'] ?? null) === 'motion' ? 'tma-chart-graphic--motion' : null,
    ])->filter()->implode(' ');
@endphp

<img
    {{ $attributes->merge([
        'class' => trim('tma-chart-graphic ' . $modifiers . ' ' . $class),
        'src' => asset('images/charts/' . $resolvedFile),
        'alt' => $label,
        'loading' => 'lazy',
        'decoding' => 'async',
    ]) }}
    @if($width) width="{{ $width }}" @endif
    @if($height) height="{{ $height }}" @endif
/>
