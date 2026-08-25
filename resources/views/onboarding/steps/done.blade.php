@include('onboarding.steps._icon', ['icon' => 'CheckCircle'])
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">You're all set</h1>
  <p class="tma-auth__subtitle">Your account is ready. Everything we work on together will be here.</p>
</div>
@include('auth.setup._progress')
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.complete') }}">
  @csrf
  <div class="tma-auth__nav-actions">
    <button type="submit" class="tma-auth__submit tma-auth__submit--continue">Go to the portal</button>
  </div>
</form>
@include('onboarding.steps._back-form')
