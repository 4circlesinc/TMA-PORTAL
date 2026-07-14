@extends('auth.layout')

@section('title', 'Confirm Your Password')

@section('body')
  <main class="tma-auth">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <div class="tma-auth__body">
      <section class="tma-auth__card" aria-labelledby="confirm-title">
        <div class="tma-auth__icon" aria-hidden="true">
          <img src="/images/icons/phosphor/LockKey.svg" alt="" width="80" height="80">
        </div>

        <div class="tma-auth__intro">
          <h1 class="tma-auth__title" id="confirm-title">Confirm your password</h1>
          <p class="tma-auth__subtitle">For your security, confirm your password to continue.</p>
        </div>

        <form class="tma-auth__form" method="POST" action="{{ route('password.confirm.store') }}">
          @csrf
          <div class="tma-auth__group">
            <label class="tma-auth__field tma-auth__field--password @error('password') tma-auth__field--error @enderror">
              <input class="tma-auth__input" type="password" name="password" placeholder="Password" autocomplete="current-password" aria-label="Password" required autofocus>
              <button type="button" class="tma-auth__toggle-pwd" data-toggle-password aria-label="Show password" aria-pressed="false">
                <img src="/images/icons/phosphor/EyeSlash.svg" alt="" width="16" height="16" aria-hidden="true">
              </button>
            </label>
            @error('password')
              <p class="tma-auth__field-msg">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                <span>{{ $message }}</span>
              </p>
            @enderror
          </div>
          <button type="submit" class="tma-auth__submit">Confirm</button>
        </form>
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
