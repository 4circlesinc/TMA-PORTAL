<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Add a phone number</h1>
  <p class="tma-auth__subtitle">So we can reach you quickly when something needs your attention.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__field @error('phone') tma-auth__field--error @enderror">
    <span class="tma-auth__section-label">Phone number</span>
    <input class="tma-auth__input" type="tel" name="phone" required autocomplete="tel"
           placeholder="+1 555 123 4567" value="{{ old('phone', $values['phone'] ?? '') }}">
    @error('phone')<span class="tma-auth__field-msg">{{ $message }}</span>@enderror
  </div>
  <label class="tma-auth__check">
    <input type="checkbox" name="uses_whatsapp" value="1"
           @checked(old('uses_whatsapp', $values['uses_whatsapp'] ?? false))>
    <span>I use WhatsApp</span>
  </label>
  <span class="tma-auth__hint">We'll ask for your WhatsApp number next.</span>
  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
