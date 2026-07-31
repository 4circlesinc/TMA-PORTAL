<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Your company</h1>
  <p class="tma-auth__subtitle">If colleagues already use this portal, we'll put you on the same company record.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__fields">
    <label class="tma-auth__field @error('company_name') tma-auth__field--error @enderror">
      <span class="tma-auth__section-label">Company name</span>
      <input class="tma-auth__input" type="text" name="company_name" required maxlength="255"
             autocomplete="organization" value="{{ old('company_name', $values['company_name'] ?? '') }}">
      @error('company_name')<span class="tma-auth__field-msg">{{ $message }}</span>@enderror
    </label>
    <label class="tma-auth__field">
      <span class="tma-auth__section-label">Your role there <span class="tma-auth__hint">optional</span></span>
      <input class="tma-auth__input" type="text" name="company_role" maxlength="120"
             autocomplete="organization-title" value="{{ old('company_role', $values['company_role'] ?? '') }}">
    </label>
    <label class="tma-auth__field">
      <span class="tma-auth__section-label">Website <span class="tma-auth__hint">optional</span></span>
      <input class="tma-auth__input" type="text" name="company_website" maxlength="255"
             placeholder="example.com" value="{{ old('company_website', $values['company_website'] ?? '') }}">
    </label>
  </div>
  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
