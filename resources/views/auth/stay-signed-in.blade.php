@extends('auth.layout')

@section('title', 'Stay Signed In')

@section('body')
  <main class="tma-auth">
    <div class="tma-auth__body">
      <section class="tma-auth__card" aria-labelledby="stay-title">
        <div class="tma-auth__intro">
          <h1 class="tma-auth__title" id="stay-title">Stay signed in?</h1>
          <p class="tma-auth__subtitle">Only on devices you trust.</p>
        </div>

        @error('stay')
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ $message }}</span>
          </div>
        @enderror

        <div class="tma-auth__section">
          <form method="POST" action="{{ route('stay-signed-in.store') }}">
            @csrf
            <input type="hidden" name="stay" value="yes">
            <button type="submit" class="tma-auth__submit">Yes</button>
          </form>

          <form method="POST" action="{{ route('stay-signed-in.store') }}">
            @csrf
            <input type="hidden" name="stay" value="no">
            <button type="submit" class="tma-auth__submit tma-auth__submit--ghost">Not this time</button>
          </form>
        </div>
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
