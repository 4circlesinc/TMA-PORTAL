@include('onboarding.steps._icon', ['icon' => 'ShieldCheck'])
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Your access</h1>
  <p class="tma-auth__subtitle">What this account can do{{ $calendarAvailable ? ', and an optional calendar connection' : '' }}.</p>
</div>
@include('auth.setup._progress')

@if ($calendarAvailable)
  <p class="tma-auth__section-label">Calendar</p>
  <p class="tma-auth__hint">Optional. It keeps meetings we book with you in your own calendar.</p>
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
        <span class="tma-auth__task-copy"><span class="tma-auth__task-name">Connect Google</span></span>
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
        <span class="tma-auth__task-copy"><span class="tma-auth__task-name">Connect Microsoft</span></span>
      </a>
    @endif
  </div>
@endif

<p class="tma-auth__section-label">What you can do</p>
<div class="tma-auth__checklist">
  @foreach ([
    ['FolderNotch', 'Your files', 'Documents we share with you, and anything you upload.'],
    ['PenNib', 'Signatures', 'Review and sign documents sent to you.'],
    ['ChatCircle', 'Messages', 'Talk to the people looking after your work.'],
    ['CalendarBlank', 'Calendar', 'Meetings and events you are invited to.'],
  ] as [$icon, $name, $desc])
    <div class="tma-auth__task tma-auth__task--done">
      <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/{{ $icon }}.svg" alt="" width="16" height="16"></span>
      <span class="tma-auth__task-copy">
        <span class="tma-auth__task-name">{{ $name }}</span>
        <span class="tma-auth__task-desc">{{ $desc }}</span>
      </span>
    </div>
  @endforeach
</div>

@if ($assignedStaff->isNotEmpty())
  <p class="tma-auth__section-label">Your team</p>
  <div class="tma-auth__checklist">
    @foreach ($assignedStaff as $assignment)
      @continue (! $assignment->user)
      <div class="tma-auth__task">
        <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/UserCircle.svg" alt="" width="16" height="16"></span>
        <span class="tma-auth__task-copy">
          <span class="tma-auth__task-name">{{ $assignment->user->name }}</span>
          <span class="tma-auth__task-desc">{{ $assignment->is_primary ? 'Primary contact' : ($assignment->user->job_title ?: 'Your team') }}</span>
        </span>
      </div>
    @endforeach
  </div>
@endif

<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
