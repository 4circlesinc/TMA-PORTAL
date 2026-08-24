@extends('auth.setup._shell')

@section('setup-content')
  <div class="tma-auth__icon" aria-hidden="true">
    <img src="/images/icons/phosphor/ShieldCheck.svg" alt="" width="80" height="80">
  </div>

  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="setup-title">Two-factor authentication</h1>
    <p class="tma-auth__subtitle">Sign in with your password plus a 6-digit code from your phone.</p>
  </div>

  @include('auth.setup._progress')

  @if ($twoFactorOn)
    <div class="tma-auth__alert tma-auth__alert--success" role="status">
      <img src="/images/icons/phosphor/CheckCircle.svg" alt="" width="16" height="16" aria-hidden="true">
      <span>Two-factor authentication is already on for your account.</span>
    </div>
    <form class="tma-auth__form" method="POST" action="{{ route('account-setup.store', ['step' => 'two-factor']) }}">
      @csrf
      <div class="tma-auth__nav-actions">
        <button type="submit" class="tma-auth__submit tma-auth__submit--continue">Continue</button>
      </div>
    </form>
    @if ($optional)
      <form method="POST" action="{{ route('account-setup.skip', ['step' => 'two-factor']) }}">
        @csrf
        <p class="tma-auth__alt-link"><button type="submit" class="tma-auth__link-btn">Skip for now</button></p>
      </form>
    @endif
  @else
    <form class="tma-auth__form" method="POST" action="{{ route('account-setup.store', ['step' => 'two-factor']) }}"
          data-setup-form="two-factor"
          data-qr-url="{{ route('account-setup.two-factor.qr') }}">
      @csrf

      <div data-tfa-panel="app">
        <p class="tma-auth__section-label">Choose your authenticator app</p>
        <div class="tma-auth__account-options" role="radiogroup" aria-label="Authenticator app">
          @foreach ($authApps as $app)
            <label class="tma-auth__account-card tma-auth__account-card--compact">
              <input class="tma-auth__account-input" type="radio" name="app" value="{{ $app['key'] }}" {{ $loop->first ? 'checked' : '' }}>
              <span class="tma-auth__account-radio" aria-hidden="true">
                <svg class="tma-auth__account-radio-svg" width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M16 22C19.3137 22 22 19.3137 22 16C22 12.6863 19.3137 10 16 10C12.6863 10 10 12.6863 10 16C10 19.3137 12.6863 22 16 22ZM16 30C23.732 30 30 23.732 30 16C30 8.26801 23.732 2 16 2C8.26801 2 2 8.26801 2 16C2 23.732 8.26801 30 16 30Z" fill="currentColor"/>
                </svg>
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
        <div class="tma-auth__nav-actions">
          <button type="button" class="tma-auth__submit tma-auth__submit--continue" data-tfa-next="scan">Continue</button>
        </div>
      </div>

      <div data-tfa-panel="scan" hidden>
        <p class="tma-auth__section-label">Scan this QR code</p>
        <p class="tma-auth__section-hint">In your app, choose “Add account”, then scan the code below.</p>
        <div class="tma-auth__qr" data-tfa-qr aria-live="polite"></div>
        <p class="tma-auth__section-hint tma-auth__qr-secret" data-tfa-secret hidden></p>
        <div class="tma-auth__nav-actions">
          <button type="button" class="tma-auth__submit tma-auth__submit--previous" data-tfa-back="app">Previous</button>
          <button type="button" class="tma-auth__submit tma-auth__submit--continue" data-tfa-next="confirm">Continue</button>
        </div>
      </div>

      <div data-tfa-panel="confirm" hidden>
        <p class="tma-auth__section-label">Enter the 6-digit code</p>
        <p class="tma-auth__section-hint">Type the code your authenticator app shows for TM ANTOINE Advisory.</p>
        <label class="tma-auth__field">
          <span class="tma-auth__field-label">Verification code</span>
          <input class="tma-auth__input tma-auth__pref-code" type="text" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" required>
        </label>
        <div class="tma-auth__nav-actions">
          <button type="button" class="tma-auth__submit tma-auth__submit--previous" data-tfa-back="scan">Previous</button>
          <button type="submit" class="tma-auth__submit tma-auth__submit--continue">Turn on two-factor</button>
        </div>
      </div>
    </form>

    @if ($optional)
      <form method="POST" action="{{ route('account-setup.skip', ['step' => 'two-factor']) }}">
        @csrf
        <p class="tma-auth__alt-link"><button type="submit" class="tma-auth__link-btn">Not now</button></p>
      </form>
    @endif
  @endif

  @include('auth.setup._back')
@endsection
