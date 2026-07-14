# Avatar usage (TMA → Laravel)

Source frames:
- [Avatars](https://www.figma.com/design/58ZXC7sZYQsbenzf0foWCH/Portal-Design?node-id=30485-156827)
- [AvatarNames](https://www.figma.com/design/58ZXC7sZYQsbenzf0foWCH/Portal-Design?node-id=30485-156802)

## Assets

```
public/images/avatars/
├── AvatarMale01.png … AvatarMale06.png
├── AvatarFemale01.png … AvatarFemale06.png
├── Avatar3d01.png … Avatar3d04.png
├── AvatarAbstract01.png … AvatarAbstract04.png
├── AvatarByewind.png
├── AvatarDefault.png    (24px user icon)
├── AvatarMore.png       (24px +N overflow)
└── AvatarNophoto.png    (24px initials fallback)
```

## Component patterns (from Figma)

### 1. Photo avatar (64px or 24px)

Figma pattern:
```tsx
<div className="bg-black/4 overflow-clip rounded-[80px] size-[64px]">
  <img className="absolute inset-0 object-cover size-full" src={img} />
</div>
```

Laravel:
```blade
<x-avatar
    src="{{ asset('images/avatars/AvatarMale01.png') }}"
    alt="Drew Cano"
    :size="64"
/>
```

### 2. Initials avatar (no photo)

Figma pattern (`AvatarNophoto`, `BruceWayne`, `MichaelBrown`):
```tsx
<div className="bg-[#7dbbff] rounded-[80px] size-[24px]">
  <p className="text-[12px]">B</p>
</div>
```

Laravel:
```blade
<x-avatar initial="B" color="#7dbbff" :size="24" alt="Bruce Wayne" />
```

### 3. User chip (avatar + name)

Figma `AvatarNames` pattern - used in tables, chat lists, sidebars:
```tsx
<div className="flex items-center gap-[8px]">
  <Avatar size={24} src={img} />
  <p className="text-[14px] leading-[20px]">Drew Cano</p>
</div>
```

Laravel:
```blade
<x-user-chip name="Drew Cano" avatar="AvatarMale01" />
```

With initials:
```blade
<x-user-chip name="Bruce Wayne" initial="B" color="#7dbbff" />
```

### 4. Lookup by slug (PHP registry)

```php
use App\Support\Avatars;

$user = Avatars::findBySlug('drew-cano');
// ['slug' => 'drew-cano', 'name' => 'Drew Cano', 'avatar' => 'AvatarMale01', 'type' => 'photo']

Avatars::url('AvatarMale01'); // /images/avatars/AvatarMale01.png
```

Blade loop over all demo users:
```blade
@foreach (App\Support\Avatars::users() as $user)
    <x-user-chip
        :name="$user['name']"
        :avatar="$user['avatar'] ?? null"
        :initial="$user['initial'] ?? null"
        :color="$user['color'] ?? '#edeefc'"
    />
@endforeach
```

### 5. Avatar group (stacked)

Figma `AvatarGroup` - overlapping 24px avatars with `-8px` margin, ends with `+3`:
```blade
<div class="flex items-center">
    @foreach (['AvatarByewind', 'AvatarFemale01', 'AvatarMale02'] as $key)
        <x-avatar
            :src="asset('images/avatars/' . $key . '.png')"
            :size="24"
            class="-mr-2 border-2 border-white"
        />
    @endforeach
    <x-avatar initial="+3" color="#ededed" :size="24" class="-mr-2 border-2 border-white" />
</div>
```

## Name → avatar mapping

| Name | Avatar key | Type |
|------|-----------|------|
| Andi Lane | AvatarFemale01 | photo |
| Aliah Davis | AvatarFemale02 | photo |
| Alexander Williams | AvatarMale06 | photo |
| ByeWind | AvatarByewind | photo |
| Bruce Wayne | - | initials `B` / `#7dbbff` |
| James Wilson | AvatarMale05 | photo |
| Brie Larson | AvatarFemale03 | photo |
| Christopher Davis | Avatar3d01 | photo |
| Drew Cano | AvatarMale01 | photo |
| Emma Smith | Avatar3d04 | photo |
| John Smith | AvatarMale02 | photo |
| Benjamin Thompson | AvatarAbstract03 | photo |
| Samuel Anderson | AvatarAbstract04 | photo |
| Sophia Martinez | Avatar3d03 | photo |
| Isabella Davis | AvatarAbstract01 | photo |
| Kate Morrison | AvatarFemale04 | photo |
| Koray Okumus | AvatarMale04 | photo |
| Melody Macy | AvatarFemale05 | photo |
| Matthew Johnson | AvatarAbstract02 | photo |
| Michael Brown | - | initials `M` / `#71dd8c` |
| Natali Craig | AvatarFemale06 | photo |
| Orlando Diggs | AvatarMale03 | photo |
| Olivia Johnson | Avatar3d02 | photo |
