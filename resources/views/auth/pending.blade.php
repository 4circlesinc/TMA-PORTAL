@extends('auth.layout')

@section('title', $user->isApproved() ? 'Account Approved' : 'Account Under Review')

@section('body')
  <main class="tma-auth">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <div class="tma-auth__body">
      <section class="tma-auth__card" aria-labelledby="pending-title">
        @if ($user->isApproved())
          <div class="tma-auth__icon" aria-hidden="true">
            <img src="/images/icons/phosphor/SealCheck.svg" alt="" width="80" height="80">
          </div>
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="pending-title">You're approved</h1>
            <p class="tma-auth__subtitle">Your account is ready. Welcome aboard.</p>
          </div>
          <a class="tma-auth__submit" href="/">Continue to the portal</a>
        @else
          <div class="tma-auth__icon" aria-hidden="true">
            <img src="/images/icons/phosphor/Hourglass.svg" alt="" width="80" height="80">
          </div>
          <div class="tma-auth__intro">
            <h1 class="tma-auth__title" id="pending-title">Your account is under review</h1>
            <p class="tma-auth__subtitle">All done. An administrator will now review and approve your account.</p>
          </div>

          <div class="tma-auth__checklist">
            <div class="tma-auth__task tma-auth__task--done">
              <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/CheckCircle.svg" alt="" width="16" height="16"></span>
              <span class="tma-auth__task-copy">
                <span class="tma-auth__task-name">Account created &amp; email verified</span>
              </span>
              <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--done">Done</span></span>
            </div>
            <div class="tma-auth__task">
              <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/UserCircle.svg" alt="" width="16" height="16"></span>
              <span class="tma-auth__task-copy">
                <span class="tma-auth__task-name">Administrator review</span>
                <span class="tma-auth__task-desc">Usually within one business day</span>
              </span>
              <span class="tma-auth__task-side"><span class="tma-auth__badge">In progress</span></span>
            </div>
            <div class="tma-auth__task tma-auth__task--locked">
              <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/EnvelopeSimple.svg" alt="" width="16" height="16"></span>
              <span class="tma-auth__task-copy">
                <span class="tma-auth__task-name">Approval email</span>
                <span class="tma-auth__task-desc">We'll notify {{ $user->email }}</span>
              </span>
              <span class="tma-auth__task-side"><span class="tma-auth__badge">Up next</span></span>
            </div>
          </div>

          <form method="POST" action="{{ route('logout') }}">
            @csrf
            <p class="tma-auth__alt-link"><button type="submit" class="tma-auth__link-btn">Sign out</button></p>
          </form>
        @endif
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
