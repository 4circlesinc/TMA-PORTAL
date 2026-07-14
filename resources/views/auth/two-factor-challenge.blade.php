@extends('auth.layout')

@section('title', 'Two-Step Verification')

@section('body')
  <main class="tma-auth">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <div class="tma-auth__body">
      <section class="tma-auth__card" aria-labelledby="tfa-title">
        <div class="tma-auth__icon" aria-hidden="true">
          <img src="/images/icons/phosphor/ShieldCheck.svg" alt="" width="80" height="80">
        </div>

        <div class="tma-auth__intro" data-tfa-intro>
          <h1 class="tma-auth__title" id="tfa-title">Two-step verification</h1>
          <p class="tma-auth__subtitle">Enter the 6-digit code from your authenticator app.</p>
        </div>

        <div class="tma-auth__intro" data-recovery-intro hidden>
          <h1 class="tma-auth__title">Use a recovery code</h1>
          <p class="tma-auth__subtitle">Enter one of your saved recovery codes.</p>
        </div>

        @if ($errors->any())
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ $errors->first() }}</span>
          </div>
        @endif

        {{-- authenticator code --}}
        <form class="tma-auth__form" method="POST" action="{{ route('two-factor.login.store') }}" data-tfa-form>
          @csrf
          <input type="hidden" name="code" data-otp-value>
          <div class="tma-auth__group">
            <div class="tma-auth__otp tma-auth__otp--6" data-otp role="group" aria-label="6 digit authenticator code">
              @for ($i = 1; $i <= 6; $i++)
                <input class="tma-auth__otp-digit" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" @if($i === 1) autocomplete="one-time-code" autofocus @endif aria-label="Digit {{ $i }}">
              @endfor
            </div>
          </div>
          <button type="submit" class="tma-auth__submit">Verify</button>
        </form>

        {{-- recovery code --}}
        <form class="tma-auth__form" method="POST" action="{{ route('two-factor.login.store') }}" data-recovery-form hidden>
          @csrf
          <div class="tma-auth__group">
            <label class="tma-auth__field">
              <input class="tma-auth__input" type="text" name="recovery_code" placeholder="Recovery code (e.g. 4XKT-9RMB)" autocomplete="off" spellcheck="false" aria-label="Recovery code">
            </label>
          </div>
          <button type="submit" class="tma-auth__submit">Verify recovery code</button>
        </form>

        <p class="tma-auth__alt-link" data-tfa-alt>
          Can't use your app? <button type="button" class="tma-auth__link-btn" data-show-recovery>Use a recovery code</button>
        </p>
        <p class="tma-auth__alt-link" data-recovery-alt hidden>
          Found your phone? <button type="button" class="tma-auth__link-btn" data-show-tfa>Use the authenticator app</button>
        </p>

        <p class="tma-auth__alt-link"><a href="{{ route('login') }}">Back to sign in</a></p>
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection

@push('scripts')
<script>
  (function () {
    /* join the 6 digit boxes into the hidden "code" field */
    var form = document.querySelector("[data-tfa-form]");
    if (form) {
      form.addEventListener("submit", function () {
        var digits = form.querySelectorAll(".tma-auth__otp-digit");
        var value = "";
        for (var i = 0; i < digits.length; i++) value += digits[i].value;
        form.querySelector("[data-otp-value]").value = value;
      });
    }

    /* toggle between authenticator and recovery views */
    function swap(showRecovery) {
      var ids = ["[data-tfa-intro]", "[data-tfa-form]", "[data-tfa-alt]"];
      var rec = ["[data-recovery-intro]", "[data-recovery-form]", "[data-recovery-alt]"];
      ids.forEach(function (s) { document.querySelector(s).hidden = showRecovery; });
      rec.forEach(function (s) { document.querySelector(s).hidden = !showRecovery; });
      var focus = showRecovery
        ? document.querySelector('[name="recovery_code"]')
        : document.querySelector(".tma-auth__otp-digit");
      if (focus) focus.focus();
    }

    var showRec = document.querySelector("[data-show-recovery]");
    var showTfa = document.querySelector("[data-show-tfa]");
    if (showRec) showRec.addEventListener("click", function () { swap(true); });
    if (showTfa) showTfa.addEventListener("click", function () { swap(false); });

    @if ($errors->has('recovery_code') || old('recovery_code'))
      swap(true);
    @endif
  })();
</script>
@endpush
