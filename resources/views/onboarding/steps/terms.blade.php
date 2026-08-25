@include('onboarding.steps._icon', ['icon' => 'FileText'])
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Terms and privacy</h1>
  <p class="tma-auth__subtitle">What this account includes, and the terms we need you to agree to.</p>
</div>
@include('auth.setup._progress')
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf

  <div class="tma-auth__group">
    <p class="tma-auth__section-label">Included with this account</p>
    <div class="tma-auth__checklist">
      @foreach ([
        ['FolderNotch', 'Your files', 'Documents we share with you, and anything you upload.'],
        ['PenNib', 'Signatures', 'Review and sign documents sent to you.'],
        ['ChatCircle', 'Messages', 'Talk to the people looking after your work.'],
        ['CalendarBlank', 'Calendar', 'Meetings and events you are invited to.'],
      ] as [$icon, $name, $desc])
        <div class="tma-auth__task">
          <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/{{ $icon }}.svg" alt="" width="16" height="16"></span>
          <span class="tma-auth__task-copy">
            <span class="tma-auth__task-name">{{ $name }}</span>
            <span class="tma-auth__task-desc">{{ $desc }}</span>
          </span>
        </div>
      @endforeach
      @if ($cipAvailable)
        <div class="tma-auth__task">
          <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/phosphor/IdentificationCard.svg" alt="" width="16" height="16"></span>
          <span class="tma-auth__task-copy">
            <span class="tma-auth__task-name">CIP Applications</span>
            <span class="tma-auth__task-desc">Manage your CIP applications.</span>
          </span>
        </div>
      @endif
    </div>
  </div>

  @if ($assignedStaff->isNotEmpty())
    <div class="tma-auth__group">
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
    </div>
  @endif

  <label class="tma-auth__check">
    <input type="checkbox" name="accept_terms" value="1" required @checked(old('accept_terms', $values['accept_terms'] ?? false))>
    <span>I agree to the <a href="{{ url('/terms-of-service') }}" target="_blank" rel="noopener">Terms of Service</a>
      and the <a href="{{ url('/privacy-policy') }}" target="_blank" rel="noopener">Privacy Policy</a>.</span>
  </label>
  @error('accept_terms')<span class="tma-auth__field-msg">{{ $message }}</span>@enderror
  @include('onboarding.steps._nav', ['label' => 'Agree and continue'])
</form>
@include('onboarding.steps._back-form')
