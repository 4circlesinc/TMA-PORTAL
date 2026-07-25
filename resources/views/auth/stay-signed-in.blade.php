@extends('auth.layout')

@section('title', 'Stay Signed In')

@section('body')
  <main class="tma-auth">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <div class="tma-auth__body">
      <section class="tma-auth__card" aria-labelledby="stay-title">
        <div class="tma-auth__icon" aria-hidden="true">
          <img src="/images/icons/phosphor/Devices.svg" alt="" width="80" height="80">
        </div>

        <div class="tma-auth__intro">
          <h1 class="tma-auth__title" id="stay-title">Stay signed in?</h1>
          <p class="tma-auth__subtitle">Stay signed in for 30 days on this device.</p>
        </div>

        <form class="tma-auth__section" method="POST" action="{{ route('stay-signed-in.store') }}">
          @csrf
          <button type="submit" class="tma-auth__submit" name="stay" value="yes">Yes</button>
          <button type="submit" class="tma-auth__submit tma-auth__submit--ghost" name="stay" value="no">No</button>
        </form>
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
