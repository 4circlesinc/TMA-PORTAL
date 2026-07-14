@extends('auth.layout')

@section('title', 'Reset Your Password')

@php
  // Never reveal whether an account exists: a "user not found" response
  // renders exactly like a successful send.
  $sent = session('status') !== null
      || ($errors->has('email') && $errors->first('email') === __('passwords.user'));
  $formError = $errors->has('email') && ! $sent ? $errors->first('email') : null;
@endphp

@section('body')
  <main class="tma-auth">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <div class="tma-auth__body">
      <section class="tma-auth__card" aria-labelledby="forgot-title">
        <div class="tma-auth__icon" aria-hidden="true">
          <img src="/images/icons/phosphor/LockKey.svg" alt="" width="80" height="80">
        </div>

        @if ($sent)
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="forgot-title">Check your inbox</h1>
            <p class="tma-auth__subtitle">If an account exists for that email address, password reset instructions have been sent.</p>
          </div>
          <a class="tma-auth__submit" href="{{ route('login') }}">Back to sign in</a>
        @else
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="forgot-title">Reset your password</h1>
            <p class="tma-auth__subtitle">We'll email you reset instructions.</p>
          </div>

          <form class="tma-auth__form" method="POST" action="{{ route('password.email') }}">
            @csrf
            <div class="tma-auth__group">
              <label class="tma-auth__field @if($formError) tma-auth__field--error @endif">
                <input class="tma-auth__input" type="email" name="email" placeholder="Email" autocomplete="email" aria-label="Email" value="{{ old('email') }}" required autofocus>
              </label>
              @if ($formError)
                <p class="tma-auth__field-msg">
                  <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                  <span>{{ $formError }}</span>
                </p>
              @endif
            </div>
            <button type="submit" class="tma-auth__submit">Send reset link</button>
          </form>

          <p class="tma-auth__alt-link"><a href="{{ route('login') }}">Back to sign in</a></p>
        @endif
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
