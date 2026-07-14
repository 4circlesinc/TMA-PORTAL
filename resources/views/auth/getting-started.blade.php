@extends('auth.layout')

@section('title', 'Secure Your Account')

@php
  $twoFactorOn = $user->hasTwoFactorEnabled();
  $done = 1 + ($twoFactorOn ? 1 : 0);
  $total = 2;
@endphp

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
          <p class="tma-auth__subtitle">A few quick steps to keep your account protected.</p>
        </div>

        <div class="tma-auth__progress" aria-hidden="true">
          <div class="tma-auth__progress-row"><span><strong>{{ $done }} of {{ $total }}</strong> complete</span><span></span></div>
          <div class="tma-auth__progress-track"><div class="tma-auth__progress-fill" style="width: {{ (int) ($done / $total * 100) }}%;"></div></div>
        </div>

        <div class="tma-auth__checklist">
          <div class="tma-auth__task tma-auth__task--done">
            <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/EnvelopeSimple.svg" alt="" width="16" height="16"></span>
            <span class="tma-auth__task-copy">
              <span class="tma-auth__task-name">Email verified</span>
              <span class="tma-auth__task-desc">{{ $user->email }}</span>
            </span>
            <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--done">Done</span></span>
          </div>

          @if ($twoFactorOn)
            <div class="tma-auth__task tma-auth__task--done">
              <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/ShieldCheck.svg" alt="" width="16" height="16"></span>
              <span class="tma-auth__task-copy">
                <span class="tma-auth__task-name">Two-factor authentication</span>
                <span class="tma-auth__task-desc">Manage it in Security settings</span>
              </span>
              <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--done">On</span></span>
            </div>
          @elseif ($user->isApproved())
            <a class="tma-auth__task" href="{{ route('security-settings') }}#two-factor">
              <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/ShieldCheck.svg" alt="" width="16" height="16"></span>
              <span class="tma-auth__task-copy">
                <span class="tma-auth__task-name">Turn on two-factor authentication</span>
                <span class="tma-auth__task-desc">A 6-digit app code protects your sign-in</span>
              </span>
              <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--recommended">Recommended</span></span>
            </a>
          @else
            <div class="tma-auth__task tma-auth__task--locked">
              <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/ShieldCheck.svg" alt="" width="16" height="16"></span>
              <span class="tma-auth__task-copy">
                <span class="tma-auth__task-name">Turn on two-factor authentication</span>
                <span class="tma-auth__task-desc">Available once your account is approved</span>
              </span>
              <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--recommended">Recommended</span></span>
            </div>
          @endif

          <div class="tma-auth__task tma-auth__task--locked">
            <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/Password.svg" alt="" width="16" height="16"></span>
            <span class="tma-auth__task-copy">
              <span class="tma-auth__task-name">Connect Google or Microsoft</span>
              <span class="tma-auth__task-desc">Coming soon</span>
            </span>
            <span class="tma-auth__task-side"><span class="tma-auth__badge">Optional</span></span>
          </div>

          <div class="tma-auth__task tma-auth__task--locked">
            <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/DeviceMobile.svg" alt="" width="16" height="16"></span>
            <span class="tma-auth__task-copy">
              <span class="tma-auth__task-name">Add your phone number</span>
              <span class="tma-auth__task-desc">Coming soon</span>
            </span>
            <span class="tma-auth__task-side"><span class="tma-auth__badge">Optional</span></span>
          </div>
        </div>

        @if ($user->isApproved())
          <a class="tma-auth__submit" href="/">Continue to portal</a>
        @else
          <a class="tma-auth__submit" href="{{ route('pending') }}">Continue</a>
        @endif
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
