<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Your address</h1>
  <p class="tma-auth__subtitle">Used on documents and invoices. You can skip this and add it later.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__fields">
    <label class="tma-auth__field">
      <span class="tma-auth__section-label">Street address</span>
      <input class="tma-auth__input" type="text" name="street" maxlength="255" autocomplete="street-address"
             value="{{ old('street', $values['street'] ?? '') }}">
    </label>
    <label class="tma-auth__field">
      <span class="tma-auth__section-label">City</span>
      <input class="tma-auth__input" type="text" name="city" maxlength="120" autocomplete="address-level2"
             value="{{ old('city', $values['city'] ?? '') }}">
    </label>
    <label class="tma-auth__field">
      <span class="tma-auth__section-label">State or region</span>
      <input class="tma-auth__input" type="text" name="region" maxlength="120" autocomplete="address-level1"
             value="{{ old('region', $values['region'] ?? '') }}">
    </label>
    <label class="tma-auth__field">
      <span class="tma-auth__section-label">Postal code</span>
      <input class="tma-auth__input" type="text" name="postcode" maxlength="32" autocomplete="postal-code"
             value="{{ old('postcode', $values['postcode'] ?? '') }}">
    </label>
    <label class="tma-auth__field">
      <span class="tma-auth__section-label">Country</span>
      <input class="tma-auth__input" type="text" name="country" maxlength="120" autocomplete="country-name"
             value="{{ old('country', $values['country'] ?? '') }}">
    </label>
  </div>
  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
