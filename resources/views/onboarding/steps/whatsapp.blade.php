<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Your WhatsApp number</h1>
  <p class="tma-auth__subtitle">Leave it blank if it's the same as the number you just gave us.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__field @error('whatsapp') tma-auth__field--error @enderror">
    <span class="tma-auth__section-label">WhatsApp number <span class="tma-auth__hint">optional</span></span>
    <input class="tma-auth__input" type="tel" name="whatsapp" placeholder="+1 555 123 4567"
           value="{{ old('whatsapp', $values['whatsapp'] ?? '') }}">
    @error('whatsapp')<span class="tma-auth__field-msg">{{ $message }}</span>@enderror
  </div>
  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
