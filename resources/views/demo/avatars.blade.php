<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Portal — Avatar Demo</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: Inter, sans-serif; background: #f5f5f7; padding: 48px; margin: 0; }
        .frame { display: flex; gap: 100px; background: #fff; border-radius: 80px; padding: 100px; max-width: 1400px; margin-bottom: 64px; }
        .nav-card { flex: 0 0 480px; background: #000; border-radius: 80px; padding: 80px 60px; }
        .nav-card h1 {
            font-size: 72px; font-weight: 700; margin: 0 0 24px;
            background: linear-gradient(100deg, #fff 1%, #dcd4ff 46%, #e2cbff 56%, #98baff 67%);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .nav-card p { font-size: 22px; line-height: 1.4; color: #fff; margin: 0; }
        .avatar-names { display: flex; flex-direction: column; gap: 12px; }
        .avatar-grid { display: flex; flex-direction: column; gap: 16px; }
        .avatar-row { display: flex; gap: 16px; flex-wrap: wrap; }
        .avatar-group { display: flex; }
        .avatar-group .avatar { margin-right: -8px; border: 2px solid #fff; }
        .label { font-size: 11px; color: #999; margin-bottom: 6px; }
        .utility-row { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
        .section-title { font-size: 13px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 24px; }
        .section { margin-bottom: 80px; }

        @media (max-width: 1100px) {
            body { padding: 32px 24px; }
            .frame { gap: 48px; padding: 64px; border-radius: 48px; }
            .nav-card { flex: 0 0 360px; padding: 56px 40px; border-radius: 48px; }
            .nav-card h1 { font-size: 56px; }
            .nav-card p { font-size: 20px; }
        }

        @media (max-width: 768px) {
            body { padding: 24px 16px; }
            .section { margin-bottom: 48px; }
            .frame {
                flex-direction: column;
                gap: 32px;
                padding: 32px 24px;
                border-radius: 32px;
                max-width: 100%;
            }
            .nav-card {
                flex: none;
                width: 100%;
                padding: 40px 32px;
                border-radius: 32px;
            }
            .nav-card h1 { font-size: 40px; }
            .nav-card p { font-size: 18px; }
            .avatar-names, .avatar-grid { width: 100%; }
            .utility-row { gap: 16px; }
        }

        @media (max-width: 480px) {
            body { padding: 16px 12px; }
            .frame { padding: 24px 16px; border-radius: 24px; gap: 24px; }
            .nav-card { padding: 28px 20px; border-radius: 24px; }
            .nav-card h1 { font-size: 32px; }
            .nav-card p { font-size: 16px; }
            .avatar-row { gap: 12px; }
        }
    </style>
</head>
<body>

{{-- AvatarNames — exact Figma demonstration --}}
<div class="section">
<p class="section-title">AvatarNames — as used in tables, chat lists &amp; sidebars</p>
<div class="frame">
    <div class="nav-card">
        <h1>AvatarNames</h1>
    </div>

    <div class="avatar-names">
        @foreach (\App\Support\Avatars::users() as $user)
            <x-user-chip
                :name="$user['name']"
                :avatar="$user['avatar'] ?? null"
                :initial="$user['initial'] ?? null"
                :color="$user['color'] ?? '#edeefc'"
            />
        @endforeach
    </div>
</div>
</div>

{{-- Avatars grid — 64px components --}}
<div class="section">
<p class="section-title">Avatars — 64px components</p>
<div class="frame">
    <div class="nav-card">
        <h1>Avatars</h1>
        <p>From Figma community &amp; Unsplash. All avatars support hover state.</p>
    </div>

    <div class="avatar-grid">
        @foreach ([
            'Male'     => ['AvatarMale01','AvatarMale02','AvatarMale03','AvatarMale04','AvatarMale05','AvatarMale06'],
            'Female'   => ['AvatarFemale01','AvatarFemale02','AvatarFemale03','AvatarFemale04','AvatarFemale05','AvatarFemale06'],
            '3D'       => ['Avatar3d01','Avatar3d02','Avatar3d03','Avatar3d04'],
            'Abstract' => ['AvatarAbstract01','AvatarAbstract02','AvatarAbstract03','AvatarAbstract04'],
        ] as $label => $keys)
            <div>
                <p class="label">{{ $label }}</p>
                <div class="avatar-row">
                    @foreach ($keys as $key)
                        <x-avatar :src="\App\Support\Avatars::url($key)" :alt="$key" :size="64" />
                    @endforeach
                </div>
            </div>
        @endforeach

        <div>
            <p class="label">Groups &amp; utilities</p>
            <div class="utility-row">
                <x-avatar :src="\App\Support\Avatars::url('AvatarByewind')" alt="ByeWind" :size="64" />
                <div class="avatar-group">
                    @foreach (['AvatarByewind','AvatarFemale01','AvatarMale02','AvatarMale04','AvatarAbstract02','AvatarFemale06'] as $key)
                        <x-avatar :src="\App\Support\Avatars::url($key)" :alt="$key" :size="24" />
                    @endforeach
                    <x-avatar initial="+3" color="#ededed" :size="24" />
                </div>
                <x-avatar initial="F" color="#edeefc" :size="24" />
                <x-avatar initial="+3" color="#e6f1fd" :size="24" />
                <x-avatar :src="\App\Support\Avatars::url('AvatarDefault')" alt="Default" :size="24" />
            </div>
        </div>
    </div>
</div>
</div>

</body>
</html>
