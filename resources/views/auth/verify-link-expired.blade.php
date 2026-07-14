@extends('auth.layout')

@section('title', 'Link Expired')

@section('body')
  <main class="tma-auth">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <div class="tma-auth__body">
      <section class="tma-auth__card" aria-labelledby="expired-title">
        <div class="tma-auth__icon" aria-hidden="true">
          <img src="/images/icons/phosphor/ClockCountdown.svg" alt="" width="80" height="80">
        </div>

        <div class="tma-auth__intro">
          <h1 class="tma-auth__title" id="expired-title">This link has expired</h1>
        </div>

        @auth
          <form method="POST" action="{{ route('verification.send') }}" class="tma-auth__form">
            @csrf
            <button type="submit" class="tma-auth__submit">Email me a new link</button>
          </form>
        @else
          <a class="tma-auth__submit" href="{{ route('login') }}">Back to sign in</a>
        @endauth
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
