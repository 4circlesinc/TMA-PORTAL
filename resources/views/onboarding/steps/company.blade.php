@include('onboarding.steps._icon', ['icon' => 'Buildings'])
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Your company</h1>
  <p class="tma-auth__subtitle">If colleagues already use this portal, we'll put you on the same company record.</p>
</div>
@include('auth.setup._progress')
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__group">
    <label class="tma-auth__field @error('company_name') tma-auth__field--error @enderror">
      <input class="tma-auth__input" type="text" name="company_name" placeholder="Company name" aria-label="Company name"
             required maxlength="255" autocomplete="organization" value="{{ old('company_name', $values['company_name'] ?? '') }}">
    </label>
    @include('onboarding.steps._error', ['field' => 'company_name'])
  </div>

  <div class="tma-auth__group">
    <label class="tma-auth__field">
      <input class="tma-auth__input" type="text" name="company_role" placeholder="Your role there (optional)" aria-label="Your role there"
             maxlength="120" autocomplete="organization-title" value="{{ old('company_role', $values['company_role'] ?? '') }}">
    </label>
  </div>

  <div class="tma-auth__group">
    <label class="tma-auth__field">
      <input class="tma-auth__input" type="text" name="company_website" placeholder="Website (optional)" aria-label="Website"
             maxlength="255" value="{{ old('company_website', $values['company_website'] ?? '') }}">
    </label>
  </div>

  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
