@extends('auth.setup._shell')

@section('setup-content')
  <div class="tma-auth__icon" aria-hidden="true">
    <img src="/images/icons/phosphor/Bell.svg" alt="" width="80" height="80">
  </div>

  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="setup-title">Notifications</h1>
    <p class="tma-auth__subtitle">Choose how you want to hear about activity. You can fine-tune every category later in Settings.</p>
  </div>

  @include('auth.setup._progress')

  <form class="tma-auth__form" method="POST" action="{{ route('account-setup.store', ['step' => 'notifications']) }}">
    @csrf

    <p class="tma-auth__section-label">Notify me about</p>
    <p class="tma-auth__section-hint">Choose how each kind of update reaches you. Approval alerts stay on in the portal. Email for each category stays on by default — turn it off later under Settings → Notifications.</p>

    <div class="tma-auth__pref-notify" role="table" aria-label="Notification preferences">
      <div class="tma-auth__pref-notify-row tma-auth__pref-notify-row--head" role="row">
        <span role="columnheader"></span>
        <span role="columnheader">Portal</span>
        <span role="columnheader">Desktop</span>
      </div>
      @foreach ($groups as $key => $label)
        @php $group = $prefs[$key] ?? ['portal' => true, 'desktop' => false]; @endphp
        <div class="tma-auth__pref-notify-row" role="row">
          <span class="tma-auth__pref-notify-name" role="rowheader">{{ $label }}</span>
          <span class="tma-auth__pref-notify-col" role="cell">
            <label class="tma-auth__switch">
              @if (in_array($key, $nonSilenceable, true))
                <input type="hidden" name="{{ $key }}[portal]" value="1">
                <input class="tma-auth__switch-input" type="checkbox" checked disabled role="switch" aria-label="{{ $label }} portal (always on)">
              @else
                <input type="hidden" name="{{ $key }}[portal]" value="0">
                <input class="tma-auth__switch-input" type="checkbox" name="{{ $key }}[portal]" value="1" role="switch"
                  {{ ($group['portal'] ?? true) ? 'checked' : '' }} aria-label="{{ $label }} portal">
              @endif
              <span class="tma-auth__switch-ui" aria-hidden="true"><span class="tma-auth__switch-track"></span><span class="tma-auth__switch-thumb"></span></span>
            </label>
          </span>
          <span class="tma-auth__pref-notify-col" role="cell">
            <label class="tma-auth__switch">
              <input type="hidden" name="{{ $key }}[desktop]" value="0">
              <input class="tma-auth__switch-input" type="checkbox" name="{{ $key }}[desktop]" value="1" role="switch"
                {{ ($group['desktop'] ?? false) ? 'checked' : '' }} aria-label="{{ $label }} desktop">
              <span class="tma-auth__switch-ui" aria-hidden="true"><span class="tma-auth__switch-track"></span><span class="tma-auth__switch-thumb"></span></span>
            </label>
          </span>
        </div>
      @endforeach
    </div>

    <div class="tma-auth__nav-actions">
      <button type="submit" class="tma-auth__submit tma-auth__submit--continue">Continue</button>
    </div>
  </form>

  @include('auth.setup._back')
@endsection
