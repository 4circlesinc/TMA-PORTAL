<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Your WhatsApp number</h1>
  <p class="tma-auth__subtitle">Leave it blank if it's the same as the number you just gave us.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  <div class="tma-auth__group">
    <label class="tma-auth__field tma-auth__field--icon-start @error('whatsapp') tma-auth__field--error @enderror">
      <img src="/images/icons/phosphor/ChatCircle.svg" alt="" width="16" height="16" aria-hidden="true">
      <input class="tma-auth__input" type="tel" name="whatsapp" placeholder="WhatsApp number (optional)" aria-label="WhatsApp number"
             value="{{ old('whatsapp', $values['whatsapp'] ?? '') }}">
    </label>
    @include('onboarding.steps._error', ['field' => 'whatsapp'])
  </div>

  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
