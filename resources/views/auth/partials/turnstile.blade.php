@if (\App\Support\Security\Turnstile::siteKey())
  <div class="cf-turnstile" data-sitekey="{{ \App\Support\Security\Turnstile::siteKey() }}" data-theme="light" style="margin: 12px 0;"></div>
@endif
