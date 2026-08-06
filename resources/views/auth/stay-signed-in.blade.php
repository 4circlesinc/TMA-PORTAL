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
          <p class="tma-auth__subtitle">Do you trust this browser to keep you signed in? Only say yes on devices you use regularly.</p>
        </div>

        @error('stay')
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ $message }}</span>
          </div>
        @enderror

        {{-- Two forms, not two submit buttons in one.
             The answer used to ride on the pressed button's name/value, which
             is only sent when the browser reports a submitter — and a form
             submitted any other way (Enter on a focused control, an extension,
             an assistive tool) sent no `stay` at all. That failed validation,
             bounced back to this screen, and EnsureStaySignedInChoice then held
             the person here for the rest of the session: every URL they typed
             came straight back. With the answer in a hidden field there is no
             submitter to lose, so this cannot happen however the form is sent. --}}
        <div class="tma-auth__section">
          <form method="POST" action="{{ route('stay-signed-in.store') }}">
            @csrf
            <input type="hidden" name="stay" value="yes">
            <button type="submit" class="tma-auth__submit">Yes, stay signed in</button>
          </form>

          <form method="POST" action="{{ route('stay-signed-in.store') }}">
            @csrf
            <input type="hidden" name="stay" value="no">
            <button type="submit" class="tma-auth__submit tma-auth__submit--ghost">No, sign me out when the session ends</button>
          </form>
        </div>
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
