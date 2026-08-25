@include('onboarding.steps._icon', ['icon' => 'HandWaving'])
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Welcome{{ $user->first_name ? ', '.$user->first_name : '' }}</h1>
  <p class="tma-auth__subtitle">Let's set up your account. It takes about two minutes, and you can stop and come back at any point.</p>
</div>
@include('auth.setup._progress')
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__nav-actions">
    <button type="submit" class="tma-auth__submit tma-auth__submit--continue">Get started</button>
  </div>
</form>
