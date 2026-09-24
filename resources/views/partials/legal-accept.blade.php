{{--
  Two legal documents, each opened in a popup before its tick can be used.

  Props (optional):
    $termsName   — form field for the Terms tick (default: terms)
    $privacyName — form field for the Privacy tick (default: privacy)
--}}
@php
  $termsName = $termsName ?? 'terms';
  $privacyName = $privacyName ?? 'privacy';
@endphp
<div class="tma-legal-accept" data-legal-accept>
  <p class="tma-legal-accept__lead">Open each document, then tick that you have read it.</p>

  <label class="tma-auth__terms tma-legal-accept__row">
    <input
      type="checkbox"
      name="{{ $termsName }}"
      value="1"
      data-legal-check="terms"
      disabled
      @checked(old($termsName))
    >
    <span>
      I have read the
      <a href="{{ url('/terms-of-service/') }}?embed=1" data-legal-open="terms">Terms of Service</a>
    </span>
  </label>

  <label class="tma-auth__terms tma-legal-accept__row">
    <input
      type="checkbox"
      name="{{ $privacyName }}"
      value="1"
      data-legal-check="privacy"
      disabled
      @checked(old($privacyName))
    >
    <span>
      I have read the
      <a href="{{ url('/privacy-policy/') }}?embed=1" data-legal-open="privacy">Privacy Policy</a>
    </span>
  </label>

  <dialog class="tma-legal-accept__dialog" data-legal-dialog>
    <div class="tma-legal-accept__chrome">
      <h2 class="tma-legal-accept__title" data-legal-title>Terms of Service</h2>
      <button type="button" class="tma-legal-accept__close" data-legal-close aria-label="Close">
        <img src="/images/icons/phosphor/X.svg" alt="" width="18" height="18">
      </button>
    </div>
    <iframe class="tma-legal-accept__frame" data-legal-frame title="Legal document" src="about:blank"></iframe>
    <div class="tma-legal-accept__foot">
      <button type="button" class="tma-auth__submit tma-legal-accept__confirm" data-legal-confirm disabled>
        I have read this
      </button>
    </div>
  </dialog>
</div>
