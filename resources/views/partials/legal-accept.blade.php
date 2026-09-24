{{--
  Cookie-style consent: links open the real legal pages; Agree unlocks after
  both have been opened. Sets the form ticks the server already expects.

  Props (optional):
    $termsName   — form field for Terms (default: terms)
    $privacyName — form field for Privacy (default: privacy)
--}}
@php
  $termsName = $termsName ?? 'terms';
  $privacyName = $privacyName ?? 'privacy';
  $already = old($termsName) && old($privacyName);
@endphp
<div
  class="tma-legal-consent{{ $already ? ' is-agreed' : '' }}"
  data-legal-consent
  @if ($already) data-agreed="1" @endif
>
  {{-- Server-validated fields; filled when they Agree. --}}
  <input type="checkbox" class="tma-legal-consent__input" name="{{ $termsName }}" value="1" data-legal-check="terms" tabindex="-1" aria-hidden="true" @checked(old($termsName))>
  <input type="checkbox" class="tma-legal-consent__input" name="{{ $privacyName }}" value="1" data-legal-check="privacy" tabindex="-1" aria-hidden="true" @checked(old($privacyName))>

  <p class="tma-legal-consent__status" data-legal-status>
    @if ($already)
      You have agreed to the Terms of Service and Privacy Policy.
    @else
      Open each document in the consent banner, then Agree.
    @endif
  </p>

  <dialog class="tma-legal-consent__sheet" data-legal-sheet>
    <p class="tma-legal-consent__copy">
      To continue you must agree to our legal terms. Open each page, then Agree.
    </p>
    <ul class="tma-legal-consent__links">
      <li>
        <a
          href="{{ url('/terms-of-service/') }}"
          target="_blank"
          rel="noopener noreferrer"
          data-legal-visit="terms"
        >Terms of Service</a>
        <span class="tma-legal-consent__mark" data-legal-mark="terms" hidden>✓</span>
      </li>
      <li>
        <a
          href="{{ url('/privacy-policy/') }}"
          target="_blank"
          rel="noopener noreferrer"
          data-legal-visit="privacy"
        >Privacy Policy</a>
        <span class="tma-legal-consent__mark" data-legal-mark="privacy" hidden>✓</span>
      </li>
    </ul>
    <button type="button" class="tma-auth__submit tma-legal-consent__agree" data-legal-agree disabled>
      Agree
    </button>
  </dialog>
</div>
