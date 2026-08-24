@extends('auth.setup._shell')

@section('setup-content')
  @php
    $panel = $panel ?? 'app';
    $chosenApp = $chosenApp ?? 'microsoft';
    $scanUrl = route('account-setup.show', ['step' => 'two-factor', 'panel' => 'scan', 'app' => $chosenApp]);
    $confirmUrl = route('account-setup.show', ['step' => 'two-factor', 'panel' => 'confirm', 'app' => $chosenApp]);
    $appUrl = route('account-setup.show', ['step' => 'two-factor', 'panel' => 'app', 'app' => $chosenApp]);
  @endphp

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
  @elseif ($panel === 'scan')
    <p class="tma-auth__section-label">Scan this QR code</p>
    <p class="tma-auth__section-hint">In your app, choose “Add account”, then scan the code below.</p>
    <div class="tma-auth__qr" aria-live="polite">{!! $qrSvg !!}</div>
    @if ($secretKey)
      <p class="tma-auth__section-hint tma-auth__qr-secret">Manual key: {{ $secretKey }}</p>
    @endif
    <div class="tma-auth__nav-actions">
      <a class="tma-auth__submit tma-auth__submit--previous" href="{{ $appUrl }}">Previous</a>
      <a class="tma-auth__submit tma-auth__submit--continue" href="{{ $confirmUrl }}">Continue</a>
    </div>
  @elseif ($panel === 'confirm')
    <form class="tma-auth__form" method="POST" action="{{ route('account-setup.store', ['step' => 'two-factor']) }}">
      @csrf
      <input type="hidden" name="app" value="{{ $chosenApp }}">
      <p class="tma-auth__section-label">Enter the 6-digit code</p>
      <p class="tma-auth__section-hint">Type the code your authenticator app shows for TM ANTOINE Advisory.</p>
      <label class="tma-auth__field">
        <span class="tma-auth__field-label">Verification code</span>
        <input class="tma-auth__input tma-auth__pref-code" type="text" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" required>
      </label>
      <div class="tma-auth__nav-actions">
        <a class="tma-auth__submit tma-auth__submit--previous" href="{{ $scanUrl }}">Previous</a>
        <button type="submit" class="tma-auth__submit tma-auth__submit--continue">Turn on two-factor</button>
      </div>
    </form>
  @else
    {{-- App picker. Optional Continue posts the same store action as every
         other step (no code) and advances. Setup uses real GET links so it
         still works when JavaScript does not run. --}}
    <form id="tfa-setup" method="GET" action="{{ route('account-setup.show', ['step' => 'two-factor']) }}">
      <input type="hidden" name="panel" value="scan">
      <p class="tma-auth__section-label">Choose your authenticator app</p>
      <div class="tma-auth__account-options" role="radiogroup" aria-label="Authenticator app">
        @foreach ($authApps as $app)
          <label class="tma-auth__account-card tma-auth__account-card--compact">
            <input class="tma-auth__account-input" type="radio" name="app" value="{{ $app['key'] }}" {{ ($chosenApp === $app['key'] || $loop->first && ! request()->query('app')) ? 'checked' : '' }}>
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
    </form>

    @if ($optional)
      <form class="tma-auth__form" method="POST" action="{{ route('account-setup.store', ['step' => 'two-factor']) }}">
        @csrf
        <div class="tma-auth__nav-actions">
          <button type="submit" class="tma-auth__submit tma-auth__submit--continue">Continue</button>
        </div>
      </form>
      <p class="tma-auth__alt-link">
        <button type="submit" form="tfa-setup" class="tma-auth__link-btn">Set up authenticator</button>
      </p>
    @else
      <div class="tma-auth__nav-actions">
        <button type="submit" form="tfa-setup" class="tma-auth__submit tma-auth__submit--continue">Continue</button>
      </div>
    @endif
  @endif

  @include('auth.setup._back')
@endsection
