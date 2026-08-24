@extends('auth.setup._shell')

@section('setup-content')
  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="setup-title">Your preferences</h1>
    <p class="tma-auth__subtitle">Choose how the portal looks and feels. You can change these anytime in Settings.</p>
  </div>

  <form method="POST" action="{{ route('account-setup.store', ['step' => 'preferences']) }}" class="tma-auth__setup-form" data-setup-form="preferences">
    @csrf

    <div class="tma-auth__setup-group">
      <h2 class="tma-auth__setup-label">Theme</h2>
      <div class="tma-auth__setup-options" role="radiogroup" aria-label="Theme">
        @foreach (['light' => 'Light', 'dark' => 'Dark', 'system' => 'System'] as $value => $label)
          <label class="tma-auth__setup-option">
            <input type="radio" name="themeMode" value="{{ $value }}" {{ ($prefs['themeMode'] ?? 'light') === $value ? 'checked' : '' }} data-pref="themeMode">
            <span class="tma-auth__setup-preview tma-auth__setup-preview--theme tma-auth__setup-preview--{{ $value }}" aria-hidden="true"></span>
            <span class="tma-auth__setup-option-label">{{ $label }}</span>
          </label>
        @endforeach
      </div>
    </div>

    <div class="tma-auth__setup-group">
      <h2 class="tma-auth__setup-label">Font size</h2>
      <div class="tma-auth__setup-font" role="radiogroup" aria-label="Font size">
        @for ($i = 1; $i <= 5; $i++)
          <label class="tma-auth__setup-font-step">
            <input type="radio" name="fontScale" value="{{ $i }}" {{ (int) ($prefs['fontScale'] ?? 3) === $i ? 'checked' : '' }} data-pref="fontScale">
            <span aria-hidden="true"></span>
          </label>
        @endfor
      </div>
    </div>

    <div class="tma-auth__setup-group">
      <h2 class="tma-auth__setup-label">Left sidebar style</h2>
      <div class="tma-auth__setup-options tma-auth__setup-options--two" role="radiogroup" aria-label="Sidebar style">
        @foreach (['standard' => ['Standard', 'Opens beside content and can be expanded or collapsed.'], 'hover' => ['Hover overlay', 'Opens over content when hovered; stays collapsed otherwise.']] as $value => [$label, $desc])
          <label class="tma-auth__setup-option tma-auth__setup-option--tall">
            <input type="radio" name="sidebarStyle" value="{{ $value }}" {{ ($prefs['sidebarStyle'] ?? 'hover') === $value ? 'checked' : '' }} data-pref="sidebarStyle">
            <span class="tma-auth__setup-preview tma-auth__setup-preview--sidebar tma-auth__setup-preview--sidebar-{{ $value }}" aria-hidden="true"></span>
            <span class="tma-auth__setup-option-copy">
              <span class="tma-auth__setup-option-label">{{ $label }}</span>
              <span class="tma-auth__setup-option-desc">{{ $desc }}</span>
            </span>
          </label>
        @endforeach
      </div>
    </div>

    <button type="submit" class="tma-auth__submit">Continue</button>
  </form>
@endsection
