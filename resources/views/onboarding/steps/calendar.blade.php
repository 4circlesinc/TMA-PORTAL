<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Connect your calendar</h1>
  <p class="tma-auth__subtitle">Optional. It keeps meetings we book with you in your own calendar.</p>
</div>

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
    <a class="tma-auth__task" href="{{ route('social.redirect', ['provider' => 'google', 'return' => 'getting-started']) }}">
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
    <a class="tma-auth__task" href="{{ route('social.redirect', ['provider' => 'microsoft', 'return' => 'getting-started']) }}">
      <span class="tma-auth__task-icon" aria-hidden="true"><img src="/images/icons/brands/Microsoft16.svg" alt="" width="16" height="16"></span>
      <span class="tma-auth__task-copy"><span class="tma-auth__task-name">Connect Microsoft</span></span>
    </a>
  @endif
</div>

<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  @include('onboarding.steps._nav', ['label' => ($google || $microsoft) ? 'Continue' : 'Skip for now'])
</form>
@include('onboarding.steps._back-form')
