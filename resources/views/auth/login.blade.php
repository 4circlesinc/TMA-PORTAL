@extends('auth.layout')

@section('title', 'Sign In')

@section('body')
  <main class="tma-auth tma-auth--split">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <section class="tma-auth__stage" aria-hidden="true">
      <img class="tma-auth__stage-art" src="/images/illustrations/Illustration28.svg" alt="" width="100" height="75">
    </section>

    <section class="tma-auth__panel" aria-labelledby="sign-in-title">
      <header class="tma-auth__brand">
        <a href="/" class="tma-auth__brand-link">
          <img src="/images/brand/tma/tma-logo-horizontal.png" alt="TM ANTOINE Partners">
        </a>
      </header>

      <div class="tma-auth__panel-body">
        <div class="tma-auth__intro">
          <h1 class="tma-auth__title" id="sign-in-title">Sign in</h1>
        </div>

        @if (request()->boolean('reset'))
          <div class="tma-auth__alert tma-auth__alert--success" role="status">
            <img src="/images/icons/phosphor/CheckCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>Password updated - sign in with your new password.</span>
          </div>
        @endif

        @error('email')
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ $message }}</span>
          </div>
        @enderror

        @if (session('social_error'))
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ session('social_error') }}</span>
          </div>
        @endif

        <div class="tma-auth__social" data-auth-providers>
          <a class="tma-auth__social-btn" href="{{ route('social.redirect', 'google') }}">
            <img src="/images/icons/brands/Google16.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>Sign in with Google</span>
          </a>
          <button type="button" class="tma-auth__social-btn" title="Coming soon">
            <img src="/images/icons/brands/Microsoft16.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>Sign in with Microsoft</span>
          </button>
          <button type="button" class="tma-auth__social-btn" data-show-email>
            <img src="/images/icons/phosphor/EnvelopeSimple.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>Sign in with Email</span>
          </button>
        </div>

        <form class="tma-auth__form" method="POST" action="{{ route('login') }}" hidden data-auth-email>
          @csrf
          <button type="button" class="tma-auth__back" data-show-providers>
            <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"/></svg>
            <span>All sign in options</span>
          </button>
          <label class="tma-auth__field @error('email') tma-auth__field--error @enderror">
            <input class="tma-auth__input" type="email" name="email" placeholder="Email" autocomplete="username" aria-label="Email" value="{{ old('email') }}" required>
          </label>
          <label class="tma-auth__field tma-auth__field--password">
            <input class="tma-auth__input" type="password" name="password" placeholder="Password" autocomplete="current-password" aria-label="Password" required>
            <button type="button" class="tma-auth__toggle-pwd" data-toggle-password aria-label="Show password" aria-pressed="false">
              <img src="/images/icons/phosphor/EyeSlash.svg" alt="" width="16" height="16" aria-hidden="true">
            </button>
          </label>

          <div class="tma-auth__row-split">
            <label class="tma-auth__check">
              <input type="checkbox" name="remember" value="1">
              <span>Stay signed in</span>
            </label>
            <a class="tma-auth__forgot" href="{{ route('password.request') }}">Forgot password?</a>
          </div>

          <button type="submit" class="tma-auth__submit">Sign in</button>
        </form>

        <p class="tma-auth__alt-link">New to the portal? <a href="{{ route('register') }}">Create an account</a></p>
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
        var first = emailForm.querySelector('input[name="email"]');
        if (first) first.focus();
      }
    }

    function toProviders() {
      emailForm.hidden = true;
      providers.hidden = false;
      showEmail.focus();
    }

    showEmail.addEventListener("click", function () { toEmail(true); });
    showProviders.addEventListener("click", toProviders);

    /* remember the choice so the fields are visible on the next visit -
       password managers can only autofill what they can see at load */
    emailForm.addEventListener("submit", function () {
      try { localStorage.setItem("tma.authMethod", "email"); } catch (e) {}
    });
    var prefersEmail = false;
    try { prefersEmail = localStorage.getItem("tma.authMethod") === "email"; } catch (e) {}

    if (location.hash === "#email") toEmail(true);
    else if (prefersEmail) toEmail(false);
    @if ($errors->any() || old('email'))
      toEmail(false);
    @endif
  })();
</script>
@endpush
