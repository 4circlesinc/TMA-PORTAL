{{--
  The screen an emailed invitation link opens. One view, one `$state`:

    register     , no account for this address yet; create one
    registration-closed, no account yet, and the firm creates them itself
    signin       , the address already has a login; sign in to accept
    wrong-account, signed in as somebody else
    accept       , signed in as the invited person; confirm
    expired / accepted / cancelled / invalid / declined, dead ends, each said plainly

  Same split shell as sign-in and sign-up: illustration stage, brand lockup,
  form panel. Invitation context is subtitle copy, not a separate fact sheet.
--}}
@php
  $dead = in_array($state, ['expired', 'accepted', 'cancelled', 'invalid', 'declined', 'registration-closed'], true);
  $pageTitle = match ($state) {
      'register' => 'Sign Up',
      'signin', 'accept', 'wrong-account' => 'Sign In',
      default => 'Invitation',
  };
@endphp
@extends('auth.layout')

@section('title', $pageTitle)

@section('body')
  <main class="tma-auth tma-auth--split">
    <section class="tma-auth__stage" aria-hidden="true">
      <img class="tma-auth__stage-art" src="/images/illustrations/Illustration28.svg" alt="" width="100" height="75">
    </section>

    <section class="tma-auth__panel" aria-labelledby="invite-title">
      <header class="tma-auth__brand">
        <a href="/" class="tma-auth__brand-link">
          <img src="/images/brand/tma/tma-logo-horizontal.png" alt="TM ANTOINE Partners">
        </a>
      </header>

      <div class="tma-auth__panel-body">
        @if ($errors->any())
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ $errors->first() }}</span>
          </div>
        @endif

        {{-- ---------------------------------------------------- dead ends --}}
        @if ($state === 'expired')
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="invite-title">This invitation has expired</h1>
            <p class="tma-auth__subtitle">Ask the person who invited you to send a new one.</p>
          </div>
          <a class="tma-auth__submit" href="mailto:support@tmantoine.com?subject={{ rawurlencode('New portal invitation request') }}">Request a new invitation</a>
          <p class="tma-auth__alt-link"><a href="{{ url('/auth/login') }}">Go to sign in</a></p>

        @elseif ($state === 'accepted')
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="invite-title">This invitation has already been accepted</h1>
            <p class="tma-auth__subtitle">Your account is already set up. Sign in to carry on where you left off.</p>
          </div>
          <a class="tma-auth__submit" href="{{ url('/auth/login') }}">Sign in</a>

        @elseif ($state === 'cancelled')
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="invite-title">This invitation was withdrawn</h1>
            <p class="tma-auth__subtitle">This invitation is no longer available. Contact us if you think that's a mistake.</p>
          </div>
          <a class="tma-auth__submit" href="mailto:support@tmantoine.com">Contact support</a>

        @elseif ($state === 'declined')
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="invite-title">Invitation declined</h1>
            <p class="tma-auth__subtitle">Thanks for letting us know. We won't set up an account.</p>
          </div>
          <a class="tma-auth__submit" href="{{ url('/auth/login') }}">Go to sign in</a>

        @elseif ($state === 'invalid')
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="invite-title">This invitation link isn't valid</h1>
            <p class="tma-auth__subtitle">The link may be incomplete, or it may have been replaced by a newer invitation. Please request a new one.</p>
          </div>
          <a class="tma-auth__submit" href="mailto:support@tmantoine.com?subject={{ rawurlencode('New portal invitation request') }}">Request a new invitation</a>
          <p class="tma-auth__alt-link"><a href="{{ url('/auth/login') }}">Go to sign in</a></p>

        {{-- The firm has switched self-registration off in Client hub access, so
             the account has to be created for them. Deliberately vague about why:
             the visitor cannot act on the firm's settings. --}}
        @elseif ($state === 'registration-closed')
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="invite-title">We'll finish setting up your account</h1>
            <p class="tma-auth__subtitle">{{ $organisation }} creates portal accounts for its clients. We'll be in touch with your sign-in details shortly.</p>
          </div>
          <a class="tma-auth__submit" href="mailto:support@tmantoine.com?subject={{ rawurlencode('Portal account setup') }}">Contact support</a>
          <p class="tma-auth__alt-link"><a href="{{ url('/auth/login') }}">Go to sign in</a></p>

        {{-- --------------------------------------------- create an account --}}
        @elseif ($state === 'register')
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="invite-title">Create your account</h1>
            @include('partials.invite-summary')
          </div>

          <form class="tma-auth__form" method="POST" action="{{ url('/invite/'.$token) }}">
            @csrf
            <div class="tma-auth__group">
              <label class="tma-auth__field @error('first_name') tma-auth__field--error @enderror">
                <input class="tma-auth__input" type="text" name="first_name" placeholder="First name" autocomplete="given-name" aria-label="First name" value="{{ old('first_name', $nameParts['first'] ?? '') }}" required autofocus>
              </label>
              @error('first_name')
                <p class="tma-auth__field-msg">
                  <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                  <span>{{ $message }}</span>
                </p>
              @enderror
            </div>

            <div class="tma-auth__group">
              <label class="tma-auth__field @error('middle_name') tma-auth__field--error @enderror">
                <input class="tma-auth__input" type="text" name="middle_name" placeholder="Middle name (optional)" autocomplete="additional-name" aria-label="Middle name" value="{{ old('middle_name', $nameParts['middle'] ?? '') }}">
              </label>
              @error('middle_name')
                <p class="tma-auth__field-msg">
                  <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                  <span>{{ $message }}</span>
                </p>
              @enderror
            </div>

            <div class="tma-auth__group">
              <label class="tma-auth__field @error('last_name') tma-auth__field--error @enderror">
                <input class="tma-auth__input" type="text" name="last_name" placeholder="Last name" autocomplete="family-name" aria-label="Last name" value="{{ old('last_name', $nameParts['last'] ?? '') }}" required>
              </label>
              @error('last_name')
                <p class="tma-auth__field-msg">
                  <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                  <span>{{ $message }}</span>
                </p>
              @enderror
            </div>

            <div class="tma-auth__group">
              <label class="tma-auth__field tma-auth__field--locked">
                <input class="tma-auth__input" type="email" value="{{ $email }}" readonly tabindex="-1" aria-label="Email">
              </label>
            </div>

            <div class="tma-auth__group">
              <label class="tma-auth__field tma-auth__field--password @error('password') tma-auth__field--error @enderror">
                <input class="tma-auth__input" type="password" name="password" placeholder="Password" autocomplete="new-password" aria-label="Password" data-password-meter required>
                <button type="button" class="tma-auth__toggle-pwd" data-toggle-password aria-label="Show password" aria-pressed="false">
                  <img src="/images/icons/phosphor/EyeSlash.svg" alt="" width="16" height="16" aria-hidden="true">
                </button>
              </label>
              <div class="tma-auth__strength" aria-hidden="true">
                <span class="tma-auth__strength-seg"></span>
                <span class="tma-auth__strength-seg"></span>
                <span class="tma-auth__strength-seg"></span>
                <span class="tma-auth__strength-seg"></span>
              </div>
              <ul class="tma-auth__req-list">
                <li class="tma-auth__req" data-req="length" data-met="false">At least 10 characters</li>
                <li class="tma-auth__req" data-req="case" data-met="false">Upper &amp; lower case</li>
                <li class="tma-auth__req" data-req="number" data-met="false">At least one number</li>
                <li class="tma-auth__req" data-req="symbol" data-met="false">At least one symbol</li>
              </ul>
              @error('password')
                <p class="tma-auth__field-msg">
                  <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                  <span>{{ $message }}</span>
                </p>
              @enderror
            </div>

            <div class="tma-auth__group">
              <label class="tma-auth__field tma-auth__field--password">
                <input class="tma-auth__input" type="password" name="password_confirmation" placeholder="Confirm password" autocomplete="new-password" aria-label="Confirm password" data-password-confirm required>
                <button type="button" class="tma-auth__toggle-pwd" data-toggle-password aria-label="Show password" aria-pressed="false">
                  <img src="/images/icons/phosphor/EyeSlash.svg" alt="" width="16" height="16" aria-hidden="true">
                </button>
              </label>
              <p class="tma-auth__field-msg" data-mismatch-msg hidden>
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                <span>Passwords don't match yet.</span>
              </p>
            </div>

            <div class="tma-auth__group">
              <label class="tma-auth__terms">
                <input type="checkbox" name="terms" value="1" required @checked(old('terms'))>
                <span>I agree to the <a href="{{ url('/terms-of-service') }}">Terms of Service</a> and <a href="{{ url('/privacy-policy') }}">Privacy Policy</a></span>
              </label>
              @error('terms')
                <p class="tma-auth__field-msg">
                  <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                  <span>{{ $message }}</span>
                </p>
              @enderror
            </div>

            <button type="submit" class="tma-auth__submit">Create account</button>
          </form>

        {{-- ------------------------------------- already has an account --}}
        @elseif ($state === 'signin')
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="invite-title">Sign in to accept</h1>
            @include('partials.invite-summary')
            <p class="tma-auth__subtitle">Sign in as {{ $email }}.</p>
          </div>
          <form class="tma-auth__form" method="POST" action="{{ url('/invite/'.$token.'/signin') }}">
            @csrf
            <button type="submit" class="tma-auth__submit">Sign in</button>
          </form>

        @elseif ($state === 'wrong-account')
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="invite-title">Wrong account</h1>
            <p class="tma-auth__subtitle">This invitation is for {{ $email }}. Sign out, then sign in as that address.</p>
          </div>
          <form class="tma-auth__form" method="POST" action="{{ url('/logout') }}">
            @csrf
            <button type="submit" class="tma-auth__submit">Sign out</button>
          </form>

        {{-- ---------------------------------------- signed in, confirm --}}
        @elseif ($state === 'accept')
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="invite-title">Accept your invitation</h1>
            @include('partials.invite-summary')
          </div>
          <form class="tma-auth__form" method="POST" action="{{ url('/invite/'.$token.'/accept') }}">
            @csrf
            <button type="submit" class="tma-auth__submit">Accept invitation</button>
          </form>
          <form class="tma-auth__form" method="POST" action="{{ url('/invite/'.$token.'/decline') }}">
            @csrf
            <button type="submit" class="tma-auth__submit tma-auth__submit--ghost">Decline</button>
          </form>
        @endif

        @unless ($dead)
          <p class="tma-auth__alt-link">
            @if ($expiresAt)
              Expires {{ $expiresAt->format('j M Y') }}.
            @endif
            <a href="mailto:support@tmantoine.com">Contact support</a>
          </p>
        @endunless
      </div>

      <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
    </section>
  </main>
@endsection
