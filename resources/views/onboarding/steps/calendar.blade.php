@include('onboarding.steps._icon', ['icon' => 'CalendarBlank'])
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Connect a calendar</h1>
  <p class="tma-auth__subtitle">Optional. Meetings we book with you land in the calendar you use.</p>
</div>
@include('auth.setup._progress')

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

<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__group">
    <div class="tma-auth__checklist">
      @if ($google)
        <div class="tma-auth__task tma-auth__task--done">
          <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Google16.svg" alt="" width="16" height="16"></span>
          <span class="tma-auth__task-copy">
            <span class="tma-auth__task-name">Google connected</span>
            <span class="tma-auth__task-desc">{{ $google->email }}</span>
          </span>
          <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--done">Done</span></span>
        </div>
      @elseif (config('services.google.client_id'))
        <a class="tma-auth__task" href="{{ route('social.redirect', ['provider' => 'google', 'sync_all' => 1, 'return' => 'onboarding']) }}">
          <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Google16.svg" alt="" width="16" height="16"></span>
          <span class="tma-auth__task-copy">
            <span class="tma-auth__task-name">Connect Google</span>
            <span class="tma-auth__task-desc">Meetings in Google Calendar</span>
          </span>
        </a>
      @endif

      @if ($microsoft)
        <div class="tma-auth__task tma-auth__task--done">
          <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Microsoft16.svg" alt="" width="16" height="16"></span>
          <span class="tma-auth__task-copy">
            <span class="tma-auth__task-name">Microsoft connected</span>
            <span class="tma-auth__task-desc">{{ $microsoft->email }}</span>
          </span>
          <span class="tma-auth__task-side"><span class="tma-auth__badge tma-auth__badge--done">Done</span></span>
        </div>
      @elseif (config('services.microsoft.client_id'))
        <a class="tma-auth__task" href="{{ route('social.redirect', ['provider' => 'microsoft', 'sync_all' => 1, 'return' => 'onboarding']) }}">
          <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Microsoft16.svg" alt="" width="16" height="16"></span>
          <span class="tma-auth__task-copy">
            <span class="tma-auth__task-name">Connect Microsoft</span>
            <span class="tma-auth__task-desc">Meetings in Outlook Calendar</span>
          </span>
        </a>
      @endif
    </div>
  </div>

  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
