@extends('auth.setup._shell')

@section('setup-content')
  <div class="tma-auth__icon" aria-hidden="true">
    <img src="/images/icons/phosphor/Bell.svg" alt="" width="80" height="80">
  </div>

  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="setup-title">Notifications</h1>
    <p class="tma-auth__subtitle">Choose how you want to hear about activity. You can fine-tune every category later in Settings.</p>
  </div>

  <form class="tma-auth__form" method="POST" action="{{ route('account-setup.store', ['step' => 'notifications']) }}">
    @csrf

    <div class="tma-auth__pref-notify">
      @foreach ($groups as $key => $label)
        @php $group = $prefs[$key] ?? ['portal' => true, 'desktop' => false]; @endphp
        <div class="tma-auth__pref-notify-row">
          <span class="tma-auth__pref-notify-name">{{ $label }}</span>
          <div class="tma-auth__pref-notify-toggles">
            <label class="tma-auth__pref-notify-toggle">
              <span class="tma-auth__pref-notify-toggle-label">In portal</span>
              <span class="tma-auth__switch">
                @if (in_array($key, $nonSilenceable, true))
                  <input type="hidden" name="{{ $key }}[portal]" value="1">
                  <input class="tma-auth__switch-input" type="checkbox" checked disabled aria-label="{{ $label }} in portal (always on)">
                @else
                  <input type="hidden" name="{{ $key }}[portal]" value="0">
                  <input class="tma-auth__switch-input" type="checkbox" name="{{ $key }}[portal]" value="1"
                    {{ ($group['portal'] ?? true) ? 'checked' : '' }} aria-label="{{ $label }} in portal">
                @endif
                <span class="tma-auth__switch-ui"><span class="tma-auth__switch-track"></span><span class="tma-auth__switch-thumb"></span></span>
              </span>
            </label>
            <label class="tma-auth__pref-notify-toggle">
              <span class="tma-auth__pref-notify-toggle-label">Desktop</span>
              <span class="tma-auth__switch">
                <input type="hidden" name="{{ $key }}[desktop]" value="0">
                <input class="tma-auth__switch-input" type="checkbox" name="{{ $key }}[desktop]" value="1"
                  {{ ($group['desktop'] ?? false) ? 'checked' : '' }} aria-label="{{ $label }} on desktop">
                <span class="tma-auth__switch-ui"><span class="tma-auth__switch-track"></span><span class="tma-auth__switch-thumb"></span></span>
              </span>
            </label>
          </div>
        </div>
      @endforeach
    </div>

    <p class="tma-auth__section-hint">Email notifications for each category stay on by default. Turn them off anytime under Settings → Notifications.</p>

    <div class="tma-auth__nav-actions">
      <button type="submit" class="tma-auth__submit tma-auth__submit--continue">Continue</button>
    </div>
  </form>
@endsection
