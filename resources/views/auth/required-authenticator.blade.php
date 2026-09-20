@extends('auth.layout')

@section('title', 'Set up two-factor authentication')

{{--
  The stop screen for an account that must set up an authenticator before it
  can go anywhere. Deliberately built from the same panels as the onboarding
  step (auth/setup/two-factor.blade.php) so it reads as a screen the person
  has seen before; what differs is that there is no Skip and no Back, because
  there is nowhere else to go until this is done.
--}}
@section('body')
  <main class="tma-auth" data-required-authenticator>
    <div class="tma-auth__body">
      <section class="tma-auth__card tma-auth__card--tall" aria-labelledby="required-title">
        <div class="tma-auth__card-scroll">
          <div class="tma-auth__card-scroll-inner">
            @php
              $scanUrl = route('required-authenticator.show', ['panel' => 'scan', 'app' => $chosenApp]);
              $confirmUrl = route('required-authenticator.show', ['panel' => 'confirm', 'app' => $chosenApp]);
              $appUrl = route('required-authenticator.show', ['panel' => 'app', 'app' => $chosenApp]);
            @endphp

            @if ($errors->any())
              <div class="tma-auth__alert tma-auth__alert--error" role="alert">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
                <span>{{ $errors->first() }}</span>
              </div>
            @endif

            <div class="tma-auth__icon" aria-hidden="true">
              <img src="/images/icons/phosphor/ShieldCheck.svg" alt="" width="80" height="80">
            </div>

            <div class="tma-auth__intro">
              <h1 class="tma-auth__title" id="required-title">Set up two-factor authentication</h1>
              <p class="tma-auth__subtitle">Your firm requires an authenticator app on this account.</p>
              <p class="tma-auth__hint" style="margin:0">
                <span class="tma-auth__badge tma-auth__badge--recommended">Required</span>
              </p>
            </div>

            @if ($panel === 'scan')
              <div class="tma-auth__form">
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
              </div>
            @elseif ($panel === 'confirm')
              <form class="tma-auth__form" method="POST" action="{{ route('required-authenticator.store') }}">
                @csrf
                <input type="hidden" name="app" value="{{ $chosenApp }}">
                <p class="tma-auth__section-label">Enter the 6-digit code</p>
                <p class="tma-auth__section-hint">Type the code your authenticator app shows for TM ANTOINE Advisory.</p>
                <label class="tma-auth__field">
                  <span class="tma-auth__field-label">Verification code</span>
                  <input class="tma-auth__input tma-auth__pref-code" type="text" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" required autofocus>
                </label>
                <div class="tma-auth__nav-actions">
                  <a class="tma-auth__submit tma-auth__submit--previous" href="{{ $scanUrl }}">Previous</a>
                  <button type="submit" class="tma-auth__submit tma-auth__submit--continue">Turn on two-factor</button>
                </div>
              </form>
            @else
              <form class="tma-auth__form" method="GET" action="{{ route('required-authenticator.show') }}">
                <input type="hidden" name="panel" value="scan">
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
                <div class="tma-auth__nav-actions">
                  <button type="submit" class="tma-auth__submit tma-auth__submit--continue">Set up authenticator</button>
                </div>
              </form>
            @endif

            {{-- The only way out of this screen other than finishing it. --}}
            <form method="POST" action="{{ route('logout') }}">
              @csrf
              <p class="tma-auth__alt-link">
                <button type="submit" class="tma-auth__link-btn">Sign out</button>
              </p>
            </form>
          </div>
        </div>
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
