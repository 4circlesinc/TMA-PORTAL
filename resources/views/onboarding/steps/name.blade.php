<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Confirm your name</h1>
  <p class="tma-auth__subtitle">This is how your name appears to everyone at {{ \App\Support\Mail\Postcards::site() }}.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__fields">
    <label class="tma-auth__field @error('first_name') tma-auth__field--error @enderror">
      <span class="tma-auth__section-label">First name</span>
      <input class="tma-auth__input" type="text" name="first_name" required maxlength="100"
             autocomplete="given-name" value="{{ old('first_name', $values['first_name'] ?? '') }}">
      @error('first_name')<span class="tma-auth__field-msg">{{ $message }}</span>@enderror
    </label>
    <label class="tma-auth__field">
      <span class="tma-auth__section-label">Middle name <span class="tma-auth__hint">optional</span></span>
      <input class="tma-auth__input" type="text" name="middle_name" maxlength="100"
             autocomplete="additional-name" value="{{ old('middle_name', $values['middle_name'] ?? '') }}">
    </label>
    <label class="tma-auth__field @error('last_name') tma-auth__field--error @enderror">
      <span class="tma-auth__section-label">Last name</span>
      <input class="tma-auth__input" type="text" name="last_name" required maxlength="100"
             autocomplete="family-name" value="{{ old('last_name', $values['last_name'] ?? '') }}">
    </label>
  </div>
  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
