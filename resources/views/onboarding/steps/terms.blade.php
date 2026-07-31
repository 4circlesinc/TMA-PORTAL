<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Terms and privacy</h1>
  <p class="tma-auth__subtitle">One last thing before we finish.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <label class="tma-auth__check">
    <input type="checkbox" name="accept_terms" value="1" required @checked(old('accept_terms', $values['accept_terms'] ?? false))>
    <span>I agree to the <a href="{{ url('/terms-of-service') }}" target="_blank" rel="noopener">Terms of Service</a>
      and the <a href="{{ url('/privacy-policy') }}" target="_blank" rel="noopener">Privacy Policy</a>.</span>
  </label>
  @error('accept_terms')<span class="tma-auth__field-msg">{{ $message }}</span>@enderror
  @include('onboarding.steps._nav', ['label' => 'Agree and continue'])
</form>
@include('onboarding.steps._back-form')
