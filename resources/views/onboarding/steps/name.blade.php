<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Confirm your name</h1>
  <p class="tma-auth__subtitle">This is how your name appears to everyone at {{ \App\Support\Mail\Postcards::site() }}.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__group">
    <label class="tma-auth__field @error('first_name') tma-auth__field--error @enderror">
      <input class="tma-auth__input" type="text" name="first_name" placeholder="First name" aria-label="First name"
             required maxlength="100" autocomplete="given-name" value="{{ old('first_name', $values['first_name'] ?? '') }}">
    </label>
    @include('onboarding.steps._error', ['field' => 'first_name'])
  </div>

  <div class="tma-auth__group">
    <label class="tma-auth__field">
      <input class="tma-auth__input" type="text" name="middle_name" placeholder="Middle name (optional)" aria-label="Middle name"
             maxlength="100" autocomplete="additional-name" value="{{ old('middle_name', $values['middle_name'] ?? '') }}">
    </label>
  </div>

  <div class="tma-auth__group">
    <label class="tma-auth__field @error('last_name') tma-auth__field--error @enderror">
      <input class="tma-auth__input" type="text" name="last_name" placeholder="Last name" aria-label="Last name"
             required maxlength="100" autocomplete="family-name" value="{{ old('last_name', $values['last_name'] ?? '') }}">
    </label>
    @include('onboarding.steps._error', ['field' => 'last_name'])
  </div>

  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
