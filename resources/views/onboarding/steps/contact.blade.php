@include('onboarding.steps._icon', ['icon' => 'EnvelopeSimple'])
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">How we reach you</h1>
  <p class="tma-auth__subtitle">Confirm your email, add a number, and say how we should contact you first.</p>
</div>
@include('auth.setup._progress')
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf

  <div class="tma-auth__group">
    <p class="tma-auth__section-label">Email</p>
    <label class="tma-auth__field tma-auth__field--icon-start">
      <img src="/images/icons/phosphor/EnvelopeSimple.svg" alt="" width="16" height="16" aria-hidden="true">
      <input class="tma-auth__input" type="email" aria-label="Email address" value="{{ $user->email }}" disabled>
    </label>
    <p class="tma-auth__hint">To change this, ask your contact at {{ \App\Support\Mail\Postcards::site() }}.</p>
  </div>

  <div class="tma-auth__group">
    <label class="tma-auth__check">
      <input type="checkbox" name="email_confirmed" value="1" required
             @checked(old('email_confirmed', $values['email_confirmed'] ?? false))>
      <span>Yes, this is the right email address.</span>
    </label>
    @include('onboarding.steps._error', ['field' => 'email_confirmed'])
  </div>

  <div class="tma-auth__group">
    <p class="tma-auth__section-label">Phone</p>
    <label class="tma-auth__field tma-auth__field--icon-start @error('phone') tma-auth__field--error @enderror">
      <img src="/images/icons/phosphor/DeviceMobile.svg" alt="" width="16" height="16" aria-hidden="true">
      <input class="tma-auth__input" type="tel" name="phone" placeholder="Phone number" aria-label="Phone number"
             required autocomplete="tel" value="{{ old('phone', $values['phone'] ?? '') }}">
    </label>
    @include('onboarding.steps._error', ['field' => 'phone'])
  </div>

  <div class="tma-auth__group">
    <label class="tma-auth__check">
      <input type="checkbox" name="uses_whatsapp" value="1" data-whatsapp-toggle
             @checked(old('uses_whatsapp', $values['uses_whatsapp'] ?? false))>
      <span>I use WhatsApp</span>
    </label>
  </div>

  <div class="tma-auth__group" data-whatsapp-field @if (! old('uses_whatsapp', $values['uses_whatsapp'] ?? false)) hidden @endif>
    <label class="tma-auth__field tma-auth__field--icon-start @error('whatsapp') tma-auth__field--error @enderror">
      <img src="/images/icons/phosphor/ChatCircle.svg" alt="" width="16" height="16" aria-hidden="true">
      <input class="tma-auth__input" type="tel" name="whatsapp" placeholder="WhatsApp number (optional)" aria-label="WhatsApp number"
             value="{{ old('whatsapp', $values['whatsapp'] ?? '') }}"
             @disabled(! old('uses_whatsapp', $values['uses_whatsapp'] ?? false))>
    </label>
    @include('onboarding.steps._error', ['field' => 'whatsapp'])
    <p class="tma-auth__hint">Leave it blank if it is the same as the number above.</p>
  </div>

  <div class="tma-auth__group">
    <p class="tma-auth__section-label">Preferred contact</p>
    @php $chosen = old('preferred_contact', $values['preferred_contact'] ?? 'Email'); @endphp
    <div class="tma-auth__account-options" role="radiogroup" aria-label="Preferred contact method">
      @foreach ($contactMethods as $method)
        <label class="tma-auth__account-card tma-auth__account-card--compact">
          <input class="tma-auth__account-input" type="radio" name="preferred_contact" value="{{ $method }}" @checked($chosen === $method)>
          <span class="tma-auth__account-radio" aria-hidden="true">
            <svg class="tma-auth__account-radio-svg" width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M16 22C19.3137 22 22 19.3137 22 16C22 12.6863 19.3137 10 16 10C12.6863 10 10 12.6863 10 16C10 19.3137 12.6863 22 16 22ZM16 30C23.732 30 30 23.732 30 16C30 8.26801 23.732 2 16 2C8.26801 2 2 8.26801 2 16C2 23.732 8.26801 30 16 30Z" fill="currentColor"/>
            </svg>
          </span>
          <span class="tma-auth__account-row">
            <span class="tma-auth__account-copy"><span class="tma-auth__account-name">{{ $method }}</span></span>
          </span>
        </label>
      @endforeach
    </div>
    @include('onboarding.steps._error', ['field' => 'preferred_contact'])
  </div>

  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
<script>
  (function () {
    var toggle = document.querySelector('[data-whatsapp-toggle]');
    var field = document.querySelector('[data-whatsapp-field]');
    if (!toggle || !field) return;
    function sync() {
      field.hidden = !toggle.checked;
      field.querySelectorAll('input').forEach(function (el) { el.disabled = field.hidden; });
    }
    toggle.addEventListener('change', sync);
    sync();
  })();
</script>
