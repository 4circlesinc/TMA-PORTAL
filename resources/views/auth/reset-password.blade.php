@extends('auth.layout')

@section('title', 'Create a New Password')

@section('body')
  <main class="tma-auth">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <div class="tma-auth__body">
      <section class="tma-auth__card" aria-labelledby="reset-title">
        <div class="tma-auth__icon" aria-hidden="true">
          <img src="/images/icons/phosphor/Password.svg" alt="" width="80" height="80">
        </div>

        <div class="tma-auth__intro">
          <h1 class="tma-auth__title" id="reset-title">Create a new password</h1>
          <p class="tma-auth__subtitle">Setting a new password for <strong>{{ $request->email }}</strong></p>
        </div>

        @error('email')
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ $message }} <a href="{{ route('password.request') }}">Request a new link</a>.</span>
          </div>
        @enderror

        <form class="tma-auth__form" method="POST" action="{{ route('password.update') }}">
          @csrf
          <input type="hidden" name="token" value="{{ $request->route('token') }}">
          <input type="hidden" name="email" value="{{ $request->email }}">
          {{-- lets password managers pair the new password with the account --}}
          <input type="email" value="{{ $request->email }}" autocomplete="username" readonly tabindex="-1" aria-hidden="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);border:0;padding:0;">

          <div class="tma-auth__group">
            <label class="tma-auth__field tma-auth__field--password @error('password') tma-auth__field--error @enderror">
              <input class="tma-auth__input" type="password" name="password" placeholder="New password" autocomplete="new-password" aria-label="New password" data-password-meter required autofocus>
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

          <label class="tma-auth__check">
            <input type="checkbox" name="logout_others" value="1" checked>
            <span>Sign out of all other devices</span>
          </label>

          <button type="submit" class="tma-auth__submit">Update password</button>
        </form>

        <p class="tma-auth__alt-link"><a href="{{ route('login') }}">Back to sign in</a></p>
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
