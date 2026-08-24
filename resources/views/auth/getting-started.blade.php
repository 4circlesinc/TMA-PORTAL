@extends('auth.layout')

@section('title', 'Set Up Your Account')

@section('body')
  <main class="tma-auth">
    <div class="tma-auth__body">
      <section class="tma-auth__card tma-auth__card--tall" aria-labelledby="getting-started-title">
        <div class="tma-auth__icon" aria-hidden="true">
          <img src="/images/icons/phosphor/ShieldCheck.svg" alt="" width="80" height="80">
        </div>

        <div class="tma-auth__intro">
          <h1 class="tma-auth__title" id="getting-started-title">Set up your account</h1>
          <p class="tma-auth__subtitle">
            @if ($requireMicrosoft || $requireGoogle)
              Finish the required steps below to continue.
            @else
              Your account is approved. These steps are optional.
            @endif
          </p>
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
            <span>Connected. Syncing continues in the background.</span>
          </div>
        @endif

        <div class="tma-auth__progress" aria-hidden="true">
          <div class="tma-auth__progress-row"><span><strong>{{ $done }} of {{ $total }}</strong> complete</span><span></span></div>
          <div class="tma-auth__progress-track"><div class="tma-auth__progress-fill" style="width: {{ (int) ($done / max($total, 1) * 100) }}%;"></div></div>
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

          @if ($microsoftReady)
            @php
              $connectUrl = route('social.redirect', ['provider' => 'microsoft', 'sync_all' => 1, 'return' => 'getting-started']);
              $msBadge = $requireMicrosoft ? 'Required' : 'Optional';
              $msBadgeClass = $requireMicrosoft ? 'tma-auth__badge--recommended' : '';
              $rows = [
                ['key' => 'email', 'icon' => '/images/icons/brands/Outlook.svg', 'name' => 'Connect your email', 'desc' => 'Outlook mail, right in the portal'],
                ['key' => 'calendar', 'icon' => '/images/icons/brands/outlook_calendar.svg', 'name' => 'Connect your calendar', 'desc' => 'Meetings sync both ways'],
                ['key' => 'onedrive', 'icon' => '/images/icons/brands/OneDrive40.svg', 'name' => 'Connect OneDrive', 'desc' => 'Your files in the library'],
              ];
            @endphp

            @foreach ($rows as $row)
              @if ($features[$row['key']])
                <div class="tma-auth__task tma-auth__task--done">
                  <span class="tma-auth__task-icon" aria-hidden="true"><img src="{{ $row['icon'] }}" alt="" width="16" height="16"></span>
                  <span class="tma-auth__task-copy">
                    <span class="tma-auth__task-name">{{ $row['name'] }}</span>
                    <span class="tma-auth__task-desc">{{ $microsoft?->email }}</span>
                  </span>
                  <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--done">Done</span></span>
                </div>
              @else
                <a class="tma-auth__task" href="{{ $connectUrl }}">
                  <span class="tma-auth__task-icon" aria-hidden="true"><img src="{{ $row['icon'] }}" alt="" width="16" height="16"></span>
                  <span class="tma-auth__task-copy">
                    <span class="tma-auth__task-name">{{ $row['name'] }}</span>
                    <span class="tma-auth__task-desc">{{ $row['desc'] }}</span>
                  </span>
                  <span class="tma-auth__task-side"><span class="tma-auth__badge {{ $msBadgeClass }}">{{ $msBadge }}</span></span>
                </a>
              @endif
            @endforeach
          @elseif ($microsoftConfigured || $requireMicrosoft)
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
              <a class="tma-auth__task" href="{{ route('social.redirect', ['provider' => 'microsoft', 'sync_all' => 1, 'return' => 'getting-started']) }}">
                <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Microsoft16.svg" alt="" width="16" height="16"></span>
                <span class="tma-auth__task-copy">
                  <span class="tma-auth__task-name">Connect Microsoft</span>
                  <span class="tma-auth__task-desc">Sign in with one tap</span>
                </span>
                <span class="tma-auth__task-side"><span class="tma-auth__badge {{ $requireMicrosoft ? 'tma-auth__badge--recommended' : '' }}">{{ $requireMicrosoft ? 'Required' : 'Optional' }}</span></span>
              </a>
            @endif
          @endif

          @if ($googleConfigured || $requireGoogle || $google)
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
              <a class="tma-auth__task" href="{{ route('social.redirect', ['provider' => 'google', 'sync_all' => 1, 'return' => 'getting-started']) }}">
                <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Google16.svg" alt="" width="16" height="16"></span>
                <span class="tma-auth__task-copy">
                  <span class="tma-auth__task-name">Connect Google</span>
                  <span class="tma-auth__task-desc">Sign in with one tap</span>
                </span>
                <span class="tma-auth__task-side"><span class="tma-auth__badge {{ $requireGoogle ? 'tma-auth__badge--recommended' : '' }}">{{ $requireGoogle ? 'Required' : 'Optional' }}</span></span>
              </a>
            @endif
          @endif

        </div>

        @php
          $blocked = ($requireMicrosoft && ! $allConnected && $microsoftReady)
            || ($requireGoogle && ! $google);
        @endphp

        <form method="POST" action="{{ route('getting-started.finish') }}">
          @csrf
          @if ($blocked)
            <button type="submit" class="tma-auth__submit" disabled>Finish required steps to continue</button>
          @else
            <button type="submit" class="tma-auth__submit">Continue</button>
          @endif
        </form>
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
