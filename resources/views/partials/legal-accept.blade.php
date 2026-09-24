{{--
  Consent sheet: each document has a switch that turns itself on once the page
  has been opened. Agree confirms; Not now dismisses and leaves the form locked.

  Props (optional):
    $termsName   — form field for Terms (default: terms)
    $privacyName — form field for Privacy (default: privacy)
    $always      — open the sheet for the whole page, not just while the
                   surrounding form is visible (sign-up: consent covers the
                   provider buttons too)
--}}
@php
  $termsName = $termsName ?? 'terms';
  $privacyName = $privacyName ?? 'privacy';
  $always = $always ?? false;
  $already = old($termsName) && old($privacyName);
@endphp
<div
  class="tma-legal-consent{{ $already ? ' is-agreed' : '' }}"
  data-legal-consent
  @if ($always) data-legal-always @endif
  @if ($already) data-agreed="1" @endif
>
  {{-- Server-validated fields; filled when they Agree. --}}
  <input type="checkbox" class="tma-legal-consent__input" name="{{ $termsName }}" value="1" data-legal-check="terms" tabindex="-1" aria-hidden="true" @checked(old($termsName))>
  <input type="checkbox" class="tma-legal-consent__input" name="{{ $privacyName }}" value="1" data-legal-check="privacy" tabindex="-1" aria-hidden="true" @checked(old($privacyName))>

  <p class="tma-legal-consent__status" data-legal-status>
    @if ($already)
      You have agreed to the Terms of Service and Privacy Policy.
    @else
      <button type="button" class="tma-legal-consent__reopen" data-legal-reopen>Review the legal terms</button>
    @endif
  </p>

  <dialog class="tma-legal-consent__sheet" data-legal-sheet aria-labelledby="legal-consent-title">
    <h2 class="tma-legal-consent__title" id="legal-consent-title">Legal terms</h2>

    <p class="tma-legal-consent__copy">
      To create an account you must agree to our legal terms. Please read the
      <a href="{{ url('/terms-of-service/') }}" target="_blank" rel="noopener noreferrer" data-legal-visit="terms">Terms of Service</a>
      and the
      <a href="{{ url('/privacy-policy/') }}" target="_blank" rel="noopener noreferrer" data-legal-visit="privacy">Privacy Policy</a>;
      each switch turns on once you have opened that document.
    </p>

    <div class="tma-legal-consent__toggles">
      @foreach ([['terms', 'Terms'], ['privacy', 'Privacy']] as [$key, $label])
        <span class="tma-legal-consent__toggle" data-legal-row="{{ $key }}">
          <span class="tma-legal-consent__toggle-label">{{ $label }}</span>
          <span class="tma-auth__switch tma-legal-consent__switch">
            <input class="tma-auth__switch-input" type="checkbox" role="switch" tabindex="-1" aria-label="{{ $label }} read" data-legal-switch="{{ $key }}" disabled>
            <span class="tma-auth__switch-ui" aria-hidden="true"><span class="tma-auth__switch-track"></span><span class="tma-auth__switch-thumb"></span></span>
          </span>
        </span>
      @endforeach
    </div>

    <div class="tma-legal-consent__actions">
      <button type="button" class="tma-legal-consent__btn tma-legal-consent__btn--ghost" data-legal-decline>
        Not now
      </button>
      <button type="button" class="tma-legal-consent__btn tma-legal-consent__btn--primary" data-legal-agree disabled>
        Agree
      </button>
    </div>
  </dialog>
</div>
