@include('onboarding.steps._icon', ['icon' => 'DeviceMobile'])
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Add a phone number</h1>
  <p class="tma-auth__subtitle">So we can reach you quickly when something needs your attention.</p>
</div>
@include('auth.setup._progress')
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__group">
    <label class="tma-auth__field tma-auth__field--icon-start @error('phone') tma-auth__field--error @enderror">
      <img src="/images/icons/phosphor/DeviceMobile.svg" alt="" width="16" height="16" aria-hidden="true">
      <input class="tma-auth__input" type="tel" name="phone" placeholder="Phone number" aria-label="Phone number"
             required autocomplete="tel" value="{{ old('phone', $values['phone'] ?? '') }}">
    </label>
    @include('onboarding.steps._error', ['field' => 'phone'])
  </div>

  <div class="tma-auth__group">
    <label class="tma-auth__check">
      <input type="checkbox" name="uses_whatsapp" value="1"
             @checked(old('uses_whatsapp', $values['uses_whatsapp'] ?? false))>
      <span>I use WhatsApp</span>
    </label>
    <p class="tma-auth__hint">We'll ask for your WhatsApp number next.</p>
  </div>

  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
