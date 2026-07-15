@extends('auth.layout')

@section('title', 'Secure Your Account')

@section('body')
  <main class="tma-auth">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <div class="tma-auth__body">
      <section class="tma-auth__card tma-auth__card--tall" aria-labelledby="getting-started-title">
        <div class="tma-auth__icon" aria-hidden="true">
          <img src="/images/icons/phosphor/ShieldCheck.svg" alt="" width="80" height="80">
        </div>

        <div class="tma-auth__intro">
          <h1 class="tma-auth__title" id="getting-started-title">Secure your account</h1>
          <p class="tma-auth__subtitle">Your account is approved. These steps are optional.</p>
        </div>

        @if (session('social_error'))
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ session('social_error') }}</span>
          </div>
        @endif

        @if (session('status') === 'social-connected')
          <div class="tma-auth__alert tma-auth__alert--success" role="status">
            <img src="/images/icons/phosphor/CheckCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>Sign-in method connected.</span>
          </div>
        @endif

        <div class="tma-auth__progress" aria-hidden="true">
          <div class="tma-auth__progress-row"><span><strong>{{ $done }} of {{ $total }}</strong> complete</span><span></span></div>
          <div class="tma-auth__progress-track"><div class="tma-auth__progress-fill" style="width: {{ (int) ($done / $total * 100) }}%;"></div></div>
        </div>

        <div class="tma-auth__checklist">
          {{-- Email --}}
          <div class="tma-auth__task tma-auth__task--done">
            <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/EnvelopeSimple.svg" alt="" width="16" height="16"></span>
            <span class="tma-auth__task-copy">
              <span class="tma-auth__task-name">Email verified</span>
              <span class="tma-auth__task-desc">{{ $user->email }}</span>
            </span>
            <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--done">Done</span></span>
          </div>

          {{-- Google --}}
          @if ($google)
            <div class="tma-auth__task tma-auth__task--done">
              <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Google16.svg" alt="" width="16" height="16"></span>
              <span class="tma-auth__task-copy">
                <span class="tma-auth__task-name">Google connected</span>
                <span class="tma-auth__task-desc">{{ $google->email }}</span>
              </span>
              <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--done">Done</span></span>
            </div>
          @else
            <a class="tma-auth__task" href="{{ route('social.redirect', ['provider' => 'google', 'return' => 'getting-started']) }}">
              <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Google16.svg" alt="" width="16" height="16"></span>
              <span class="tma-auth__task-copy">
                <span class="tma-auth__task-name">Connect Google</span>
                <span class="tma-auth__task-desc">Sign in with one tap</span>
              </span>
              <span class="tma-auth__task-side"><span class="tma-auth__badge">Optional</span></span>
            </a>
          @endif

          {{-- Microsoft --}}
          @if ($microsoft)
            <div class="tma-auth__task tma-auth__task--done">
              <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Microsoft16.svg" alt="" width="16" height="16"></span>
              <span class="tma-auth__task-copy">
                <span class="tma-auth__task-name">Microsoft connected</span>
                <span class="tma-auth__task-desc">{{ $microsoft->email }}</span>
              </span>
              <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--done">Done</span></span>
            </div>
          @else
            <a class="tma-auth__task" href="{{ route('social.redirect', ['provider' => 'microsoft', 'return' => 'getting-started']) }}">
              <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Microsoft16.svg" alt="" width="16" height="16"></span>
              <span class="tma-auth__task-copy">
                <span class="tma-auth__task-name">Connect Microsoft</span>
                <span class="tma-auth__task-desc">Sign in with one tap</span>
              </span>
              <span class="tma-auth__task-side"><span class="tma-auth__badge">Optional</span></span>
            </a>
          @endif

          {{-- Two-factor --}}
          @if ($twoFactorOn)
            <div class="tma-auth__task tma-auth__task--done">
              <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/ShieldCheck.svg" alt="" width="16" height="16"></span>
              <span class="tma-auth__task-copy">
                <span class="tma-auth__task-name">Two-factor authentication</span>
                <span class="tma-auth__task-desc">A code is required when you sign in</span>
              </span>
              <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--done">On</span></span>
            </div>
          @else
            <a class="tma-auth__task" href="{{ route('security-settings') }}#two-factor">
              <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/ShieldCheck.svg" alt="" width="16" height="16"></span>
              <span class="tma-auth__task-copy">
                <span class="tma-auth__task-name">Turn on two-factor authentication</span>
                <span class="tma-auth__task-desc">A 6-digit app code protects your sign-in</span>
              </span>
              <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--recommended">Recommended</span></span>
            </a>
          @endif
        </div>

        <form method="POST" action="{{ route('getting-started.finish') }}">
          @csrf
          <button type="submit" class="tma-auth__submit">Continue to portal</button>
        </form>
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
