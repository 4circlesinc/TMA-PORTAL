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
  <main class="tma-auth tma-auth--split">
    <section class="tma-auth__stage" aria-hidden="true">
      <img class="tma-auth__stage-art" src="/images/illustrations/Illustration28.svg" alt="" width="100" height="75">
    </section>

    <section class="tma-auth__panel" aria-labelledby="forgot-title">
      <header class="tma-auth__brand">
        <a href="/" class="tma-auth__brand-link">
          <img src="/images/brand/tma/tma-logo-horizontal.png" alt="TM ANTOINE Partners">
        </a>
      </header>

      <div class="tma-auth__panel-body">
        @if ($sent)
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="forgot-title">Check your inbox</h1>
            <p class="tma-auth__subtitle">If an account exists for that email, we sent reset instructions.</p>
          </div>
          <a class="tma-auth__submit" href="{{ route('login') }}">Back to sign in</a>
        @else
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="forgot-title">Reset your password</h1>
            <p class="tma-auth__subtitle">We'll email you a reset link.</p>
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
            @include('auth.partials.turnstile')
            <button type="submit" class="tma-auth__submit">Send reset link</button>
          </form>

          <p class="tma-auth__alt-link"><a href="{{ route('login') }}">Back to sign in</a></p>
        @endif
      </div>

      <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
    </section>
  </main>
@endsection
