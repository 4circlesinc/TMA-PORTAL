@extends('auth.setup._shell')

@section('setup-content')
  <div class="tma-auth__icon" aria-hidden="true">
    <img src="/images/icons/phosphor/Palette.svg" alt="" width="80" height="80">
  </div>

  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="setup-title">Your preferences</h1>
    <p class="tma-auth__subtitle">Choose how the portal looks and feels. You can change these anytime in Settings.</p>
  </div>

  <form class="tma-auth__form" method="POST" action="{{ route('account-setup.store', ['step' => 'preferences']) }}" data-setup-form="preferences">
    @csrf

    <div class="tma-auth__pref-stack">
      <div class="tma-auth__pref-group">
        <p class="tma-auth__section-label">Theme</p>
        <div class="tma-auth__pref-theme-options" role="radiogroup" aria-label="Theme">
          @foreach (['light' => 'Light', 'dark' => 'Dark'] as $value => $label)
            <label class="tma-auth__pref-theme-option">
              <input class="tma-auth__pref-input" type="radio" name="themeMode" value="{{ $value }}"
                {{ ($prefs['themeMode'] ?? 'light') === $value ? 'checked' : '' }} data-pref="themeMode">
              @include('auth.setup._theme-preview', ['mode' => $value])
              <span class="tma-auth__pref-theme-label">{{ $label }}</span>
            </label>
          @endforeach
        </div>
      </div>

      <hr class="tma-auth__pref-divider" aria-hidden="true">

      <div class="tma-auth__pref-group">
        <p class="tma-auth__section-label">Font size</p>
        <div class="tma-auth__pref-font-scale" role="radiogroup" aria-label="Font size">
          <img class="tma-auth__pref-font-icon tma-auth__pref-font-icon--sm" src="/images/icons/phosphor/TextAa.svg" alt="" width="20" height="20">
          <div class="tma-auth__pref-font-track">
            @for ($i = 1; $i <= 5; $i++)
              <label class="tma-auth__pref-font-step">
                <input class="tma-auth__pref-input" type="radio" name="fontScale" value="{{ $i }}"
                  {{ (int) ($prefs['fontScale'] ?? 3) === $i ? 'checked' : '' }} data-pref="fontScale"
                  aria-label="Font size step {{ $i }}">
              </label>
            @endfor
          </div>
          <img class="tma-auth__pref-font-icon tma-auth__pref-font-icon--lg" src="/images/icons/phosphor/TextAa.svg" alt="" width="32" height="32">
        </div>
      </div>

      <hr class="tma-auth__pref-divider" aria-hidden="true">

      <div class="tma-auth__pref-group">
        <p class="tma-auth__section-label">Sidebar style</p>
        <div class="tma-auth__pref-sidebar-options" role="radiogroup" aria-label="Sidebar style">
          @foreach ([
            'standard' => ['Standard sidebar', 'Opens beside the content and can be expanded or collapsed by clicking.'],
            'hover' => ['Hover overlay sidebar', 'Opens over the content when hovered and stays collapsed when not in use.'],
          ] as $value => [$label, $desc])
            <label class="tma-auth__pref-sidebar-option">
              <input class="tma-auth__pref-input" type="radio" name="sidebarStyle" value="{{ $value }}"
                {{ ($prefs['sidebarStyle'] ?? 'hover') === $value ? 'checked' : '' }} data-pref="sidebarStyle">
              <span class="tma-auth__pref-preview tma-auth__pref-preview--light tma-auth__pref-sidebar-preview tma-auth__pref-sidebar-preview--{{ $value }}" aria-hidden="true">
                <span class="tma-auth__pref-preview-sidebar"></span>
                <span class="tma-auth__pref-preview-main">
                  <span class="tma-auth__pref-preview-block tma-auth__pref-preview-block--header"></span>
                  <span class="tma-auth__pref-preview-block"></span>
                </span>
              </span>
              <span class="tma-auth__pref-sidebar-copy">
                <span class="tma-auth__pref-sidebar-label">{{ $label }}</span>
                <span class="tma-auth__pref-sidebar-desc">{{ $desc }}</span>
              </span>
            </label>
          @endforeach
        </div>
      </div>
    </div>

    <div class="tma-auth__nav-actions">
      <button type="submit" class="tma-auth__submit tma-auth__submit--continue">Continue</button>
    </div>
  </form>
@endsection
