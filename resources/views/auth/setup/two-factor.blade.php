@extends('auth.setup._shell')

@section('setup-content')
  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="setup-title">Two-factor authentication</h1>
    <p class="tma-auth__subtitle">Sign in with your password plus a 6-digit code from your phone.</p>
  </div>

  @if ($twoFactorOn)
    <div class="tma-auth__alert tma-auth__alert--success" role="status">
      <img src="/images/icons/phosphor/CheckCircle.svg" alt="" width="16" height="16" aria-hidden="true">
      <span>Two-factor authentication is already on for your account.</span>
    </div>
    <form method="POST" action="{{ route('account-setup.store', ['step' => 'two-factor']) }}">
      @csrf
      <button type="submit" class="tma-auth__submit">Continue</button>
    </form>
    @if ($optional)
      <form method="POST" action="{{ route('account-setup.skip', ['step' => 'two-factor']) }}" class="tma-auth__skip-form">
        @csrf
        <button type="submit" class="tma-auth__alt-link tma-auth__alt-link--button">Skip for now</button>
      </form>
    @endif
  @else
    <form method="POST" action="{{ route('account-setup.store', ['step' => 'two-factor']) }}"
          class="tma-auth__setup-form" data-setup-form="two-factor"
          data-qr-url="{{ route('account-setup.two-factor.qr') }}"
          data-recovery-url="{{ route('account-setup.two-factor.recovery') }}">
      @csrf

      <div class="tma-auth__tfa-panel" data-tfa-panel="app">
        <h2 class="tma-auth__setup-label">Choose your authenticator app</h2>
        <div class="tma-auth__account-options">
          @foreach ($authApps as $app)
            <label class="tma-auth__account-card tma-auth__account-card--compact">
              <input class="tma-auth__account-input" type="radio" name="app" value="{{ $app['key'] }}" {{ $loop->first ? 'checked' : '' }}>
              <span class="tma-auth__account-radio" aria-hidden="true">
                <svg class="tma-auth__account-radio-svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"/></svg>
              </span>
              <span class="tma-auth__account-row">
                <span class="tma-auth__account-icon"><img src="{{ $app['logo'] }}" alt="" width="32" height="32"></span>
                <span class="tma-auth__account-copy">
                  <span class="tma-auth__account-name">{{ $app['name'] }}</span>
                  <span class="tma-auth__account-desc">Free on iOS and Android</span>
                </span>
              </span>
            </label>
          @endforeach
        </div>
        <button type="button" class="tma-auth__submit" data-tfa-next="scan">Continue</button>
      </div>

      <div class="tma-auth__tfa-panel" data-tfa-panel="scan" hidden>
        <h2 class="tma-auth__setup-label">Scan this QR code</h2>
        <p class="tma-auth__setup-hint">In your app, choose “Add account”, then scan the code below.</p>
        <div class="tma-auth__qr-wrap" data-tfa-qr aria-live="polite"></div>
        <p class="tma-auth__setup-hint tma-auth__setup-hint--mono" data-tfa-secret hidden></p>
        <div class="tma-auth__nav-actions">
          <button type="button" class="tma-auth__submit tma-auth__submit--previous" data-tfa-back="app">Previous</button>
          <button type="button" class="tma-auth__submit" data-tfa-next="confirm">Continue</button>
        </div>
      </div>

      <div class="tma-auth__tfa-panel" data-tfa-panel="confirm" hidden>
        <h2 class="tma-auth__setup-label">Enter the 6-digit code</h2>
        <p class="tma-auth__setup-hint">Type the code your authenticator app shows for TM ANTOINE Advisory.</p>
        <label class="tma-auth__field">
          <span class="tma-auth__field-label">Verification code</span>
          <input class="tma-auth__input tma-auth__input--code" type="text" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" required>
        </label>
        <div class="tma-auth__nav-actions">
          <button type="button" class="tma-auth__submit tma-auth__submit--previous" data-tfa-back="scan">Previous</button>
          <button type="submit" class="tma-auth__submit">Turn on two-factor</button>
        </div>
      </div>
    </form>

    @if ($optional)
      <form method="POST" action="{{ route('account-setup.skip', ['step' => 'two-factor']) }}" class="tma-auth__skip-form">
        @csrf
        <button type="submit" class="tma-auth__alt-link tma-auth__alt-link--button">Not now</button>
      </form>
    @endif
  @endif
@endsection
