<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">What you'll be able to do</h1>
  <p class="tma-auth__subtitle">This is the access your account has.</p>
</div>

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
