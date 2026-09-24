{{--
  Consent sheet: each document has a switch that turns itself on once the page
  has been opened. Agree confirms; Not now dismisses and leaves the form locked.

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
      <button type="button" class="tma-legal-consent__reopen" data-legal-reopen>Review the legal terms</button>
    @endif
  </p>

  <dialog class="tma-legal-consent__sheet" data-legal-sheet aria-labelledby="legal-consent-title">
    <div class="tma-legal-consent__head">
      <span class="tma-legal-consent__icon" aria-hidden="true">
        <img src="/images/icons/phosphor/ShieldCheck.svg" alt="" width="20" height="20">
      </span>
      <div class="tma-legal-consent__headings">
        <h2 class="tma-legal-consent__title" id="legal-consent-title">Before you continue</h2>
        <p class="tma-legal-consent__copy">Open each document; the switch turns on once you have.</p>
      </div>
    </div>

    <ul class="tma-legal-consent__links">
      @foreach ([['terms', 'Terms of Service', url('/terms-of-service/')], ['privacy', 'Privacy Policy', url('/privacy-policy/')]] as [$key, $label, $href])
        <li class="tma-legal-consent__row" data-legal-row="{{ $key }}">
          <a
            class="tma-legal-consent__link"
            href="{{ $href }}"
            target="_blank"
            rel="noopener noreferrer"
            data-legal-visit="{{ $key }}"
          >
            <span class="tma-legal-consent__link-name">{{ $label }}</span>
            <span class="tma-legal-consent__link-hint" data-legal-hint="{{ $key }}">Opens in a new tab</span>
          </a>
          <span class="tma-auth__switch tma-legal-consent__switch">
            <input class="tma-auth__switch-input" type="checkbox" role="switch" tabindex="-1" aria-label="{{ $label }} read" data-legal-switch="{{ $key }}" disabled>
            <span class="tma-auth__switch-ui" aria-hidden="true"><span class="tma-auth__switch-track"></span><span class="tma-auth__switch-thumb"></span></span>
          </span>
        </li>
      @endforeach
    </ul>

    <div class="tma-legal-consent__actions">
      <button type="button" class="tma-auth__submit tma-auth__submit--previous tma-legal-consent__decline" data-legal-decline>
        Not now
      </button>
      <button type="button" class="tma-auth__submit tma-legal-consent__agree" data-legal-agree disabled>
        Agree
      </button>
    </div>
  </dialog>
</div>
