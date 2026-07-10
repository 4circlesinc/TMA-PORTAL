@props([
    'name',
    'avatar' => null,
    'initial' => null,
    'color' => '#edeefc',
    'size' => 24,
])

{{-- TMA AvatarNames pattern: 24px avatar + 14px name label, 8px gap --}}
<div {{ $attributes->merge(['class' => 'inline-flex items-center gap-2']) }}>
    <x-avatar
        :src="$avatar ? asset('images/avatars/' . $avatar . '.png') : null"
        :initial="$initial"
        :color="$color"
        :size="$size"
        :alt="$name"
    />
    <span class="text-sm leading-5 text-black">{{ $name }}</span>
</div>
