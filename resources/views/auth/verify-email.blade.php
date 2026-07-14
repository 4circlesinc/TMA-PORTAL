@extends('auth.layout')

@section('title', 'Confirm Your Email')

@section('body')
  <main class="tma-auth">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <div class="tma-auth__body">
      <section class="tma-auth__card" aria-labelledby="verify-title">
        <div class="tma-auth__icon" aria-hidden="true">
          <img src="/images/icons/phosphor/EnvelopeSimple.svg" alt="" width="80" height="80">
        </div>

        <div class="tma-auth__intro">
          <h1 class="tma-auth__title" id="verify-title">Confirm your email address</h1>
          <p class="tma-auth__subtitle">We sent a confirmation link to</p>
        </div>

        <p class="tma-auth__phone">{{ auth()->user()->email }}</p>

        @if (session('status') === 'verification-link-sent')
          <div class="tma-auth__alert tma-auth__alert--success" role="status">
            <img src="/images/icons/phosphor/CheckCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>A new confirmation email is on its way.</span>
          </div>
        @endif

        <form method="POST" action="{{ route('verification.send') }}" class="tma-auth__form">
          @csrf
          <button type="submit" class="tma-auth__submit tma-auth__submit--ghost">Resend email</button>
        </form>

        <form method="POST" action="{{ route('logout') }}" class="tma-auth__form">
          @csrf
          <p class="tma-auth__alt-link">Wrong account? <button type="submit" class="tma-auth__link-btn">Sign out</button></p>
        </form>
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
