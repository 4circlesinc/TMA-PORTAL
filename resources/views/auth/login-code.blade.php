@extends('auth.layout')

@section('title', 'Confirm it is you')

@section('body')
  @php
    $isLocation = ($reason ?? 'new-device') === 'new-location';
  @endphp
  <main class="tma-auth">
    <div class="tma-auth__body">
      <section class="tma-auth__card" aria-labelledby="code-title">
        <div class="tma-auth__icon" aria-hidden="true">
          <img src="/images/icons/phosphor/{{ $isLocation ? 'Globe' : 'Devices' }}.svg" alt="" width="80" height="80">
        </div>

        <div class="tma-auth__intro">
          <h1 class="tma-auth__title" id="code-title">Let's confirm it's you</h1>
          <p class="tma-auth__subtitle">
            @if ($isLocation)
              New sign-in location. We sent a code to <strong>{{ $maskedEmail }}</strong>.
            @else
              New device detected. We sent a code to <strong>{{ $maskedEmail }}</strong>.
            @endif
          </p>
        </div>

        @if ($errors->any())
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ $errors->first() }}</span>
          </div>
        @endif

        @if (session('status') === 'code-sent')
          <div class="tma-auth__alert tma-auth__alert--success" role="status">
            <img src="/images/icons/phosphor/CheckCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>A new code is on its way.</span>
          </div>
        @endif

        <form class="tma-auth__form" method="POST" action="{{ route('login-code.store') }}" data-tfa-form>
          @csrf
          <input type="hidden" name="code" data-otp-value>
          <div class="tma-auth__group">
            <div class="tma-auth__otp tma-auth__otp--6" data-otp role="group" aria-label="6 digit email code">
              @for ($i = 1; $i <= 6; $i++)
                <input class="tma-auth__otp-digit" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" @if($i === 1) autocomplete="one-time-code" autofocus @endif aria-label="Digit {{ $i }}">
              @endfor
            </div>
          </div>

          <label class="tma-auth__check">
            <input type="checkbox" name="trust_device" value="1">
            <span>Trust this device for {{ $trustDays }} days</span>
          </label>
          @include('auth.partials.turnstile')
          <button type="submit" class="tma-auth__submit">Confirm</button>
        </form>

        <form method="POST" action="{{ route('login-code.resend') }}">
          @csrf
          @include('auth.partials.turnstile')
          <button type="submit" class="tma-auth__submit tma-auth__submit--ghost" data-resend @if (! $canResend) disabled @endif>Resend code</button>
        </form>
        @if (! $canResend)
          <p class="tma-auth__hint tma-auth__countdown" data-countdown data-seconds="{{ max(1, $resendIn) }}" aria-live="off">
            Resend in <strong data-countdown-num>{{ max(1, $resendIn) }}</strong>s
          </p>
        @endif

        <p class="tma-auth__hint">
          Wasn't you? <a href="{{ route('password.request') }}" class="tma-auth__link-btn">Reset your password</a>
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
    var form = document.querySelector("[data-tfa-form]");
    if (form) {
      form.addEventListener("submit", function () {
        var digits = form.querySelectorAll(".tma-auth__otp-digit");
        var value = "";
        for (var i = 0; i < digits.length; i++) value += digits[i].value;
        form.querySelector("[data-otp-value]").value = value;
      });
    }
  })();
</script>
@endpush
