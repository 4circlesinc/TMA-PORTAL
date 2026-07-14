@extends('auth.layout')

@section('title', 'Sign Up')

@section('body')
  <main class="tma-auth tma-auth--split">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <section class="tma-auth__stage" aria-hidden="true">
      <img class="tma-auth__stage-mark" src="/images/brand/tma/tma-logo-mark.png" alt="" width="40" height="40">
      <img class="tma-auth__stage-art" src="/images/illustrations/Illustration28.svg" alt="" width="100" height="75">
    </section>

    <section class="tma-auth__panel" aria-labelledby="sign-up-title">
      <header class="tma-auth__brand">
        <a href="/" class="tma-auth__brand-link">
          <img src="/images/brand/tma/tma-logo-horizontal.png" alt="TM ANTOINE Partners">
        </a>
      </header>

      <div class="tma-auth__panel-body">
        <div class="tma-auth__intro">
          <h1 class="tma-auth__title" id="sign-up-title">Create your account</h1>
        </div>

        @if (session('social_error'))
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ session('social_error') }}</span>
          </div>
        @endif

        <div class="tma-auth__social" data-auth-providers>
          <a class="tma-auth__social-btn" href="{{ route('social.redirect', 'google') }}">
            <img src="/images/icons/brands/Google16.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>Sign up with Google</span>
          </a>
          <a class="tma-auth__social-btn" href="{{ route('social.redirect', 'microsoft') }}">
            <img src="/images/icons/brands/Microsoft16.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>Sign up with Microsoft</span>
          </a>
          <button type="button" class="tma-auth__social-btn" data-show-email>
            <img src="/images/icons/phosphor/EnvelopeSimple.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>Sign up with Email</span>
          </button>
        </div>

        <form class="tma-auth__form" method="POST" action="{{ route('register') }}" hidden data-auth-email>
          @csrf
          <button type="button" class="tma-auth__back" data-show-providers>
            <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"/></svg>
            <span>All sign up options</span>
          </button>

          <div class="tma-auth__group">
            <label class="tma-auth__field @error('name') tma-auth__field--error @enderror">
              <input class="tma-auth__input" type="text" name="name" placeholder="Full name" autocomplete="name" aria-label="Full name" value="{{ old('name') }}" required>
            </label>
            @error('name')
              <p class="tma-auth__field-msg">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                <span>{{ $message }}</span>
              </p>
            @enderror
          </div>

          <div class="tma-auth__group">
            <label class="tma-auth__field @error('email') tma-auth__field--error @enderror">
              <input class="tma-auth__input" type="email" name="email" placeholder="Email" autocomplete="username" aria-label="Email" value="{{ old('email') }}" required>
            </label>
            @error('email')
              <p class="tma-auth__field-msg">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                <span>{{ $message }}</span>
              </p>
            @enderror
          </div>

          <div class="tma-auth__group">
            <label class="tma-auth__field tma-auth__field--password @error('password') tma-auth__field--error @enderror">
              <input class="tma-auth__input" type="password" name="password" placeholder="Password" autocomplete="new-password" aria-label="Password" data-password-meter required>
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

          <div class="tma-auth__group">
            <label class="tma-auth__terms">
              <input type="checkbox" name="terms" value="1" @checked(old('terms'))>
              <span>I agree to the <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a></span>
            </label>
            @error('terms')
              <p class="tma-auth__field-msg">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                <span>{{ $message }}</span>
              </p>
            @enderror
          </div>

          <button type="submit" class="tma-auth__submit">Create account</button>
        </form>

        <p class="tma-auth__alt-link">Already have an account? <a href="{{ route('login') }}">Sign in</a></p>
      </div>

      <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
    </section>
  </main>
@endsection

@push('scripts')
<script>
  (function () {
    var providers = document.querySelector("[data-auth-providers]");
    var emailForm = document.querySelector("[data-auth-email]");
    var showEmail = document.querySelector("[data-show-email]");
    var showProviders = document.querySelector("[data-show-providers]");
    if (!providers || !emailForm || !showEmail || !showProviders) return;

    function toEmail(focus) {
      providers.hidden = true;
      emailForm.hidden = false;
      if (focus) {
        var first = emailForm.querySelector('input[name="name"]');
        if (first) first.focus();
      }
    }

    emailForm.addEventListener("submit", function () {
      try { localStorage.setItem("tma.authMethod", "email"); } catch (e) {}
    });
    showEmail.addEventListener("click", function () { toEmail(true); });
    showProviders.addEventListener("click", function () {
      emailForm.hidden = true;
      providers.hidden = false;
      showEmail.focus();
    });
    if (location.hash === "#email") toEmail(true);
    @if ($errors->any() || old('email') || old('name'))
      toEmail(false);
    @endif
  })();
</script>
@endpush
