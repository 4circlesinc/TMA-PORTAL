@include('onboarding.steps._icon', ['icon' => 'Buildings'])
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Your details</h1>
  <p class="tma-auth__subtitle">Whether this is for you or a company, plus an address and anyone else we should include.</p>
</div>
@include('auth.setup._progress')
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf

  @php $chosen = old('account_type', $values['account_type'] ?? 'individual'); @endphp
  <p class="tma-auth__section-label">This account is for</p>
  <div class="tma-auth__account-options" role="radiogroup" aria-label="Account type">
    @foreach ([
      ['individual', 'Individual', 'You are working with us in your own name.', 'UserCircle'],
      ['company', 'Company', 'You represent a company or organization.', 'Buildings'],
    ] as [$value, $name, $desc, $icon])
      <label class="tma-auth__account-card">
        <input class="tma-auth__account-input" type="radio" name="account_type" value="{{ $value }}" @checked($chosen === $value) data-account-type>
        <span class="tma-auth__account-radio" aria-hidden="true">
          <svg class="tma-auth__account-radio-svg" width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M16 22C19.3137 22 22 19.3137 22 16C22 12.6863 19.3137 10 16 10C12.6863 10 10 12.6863 10 16C10 19.3137 12.6863 22 16 22ZM16 30C23.732 30 30 23.732 30 16C30 8.26801 23.732 2 16 2C8.26801 2 2 8.26801 2 16C2 23.732 8.26801 30 16 30Z" fill="currentColor"/>
          </svg>
        </span>
        <span class="tma-auth__account-row">
          <span class="tma-auth__account-icon" aria-hidden="true">
            <img src="/images/icons/phosphor/{{ $icon }}.svg" alt="" width="32" height="32">
          </span>
          <span class="tma-auth__account-copy">
            <span class="tma-auth__account-name">{{ $name }}</span>
            <span class="tma-auth__account-desc">{{ $desc }}</span>
          </span>
        </span>
      </label>
    @endforeach
  </div>
  @include('onboarding.steps._error', ['field' => 'account_type'])

  <div data-company-fields @if ($chosen !== 'company') hidden @endif>
    <p class="tma-auth__section-label">Company</p>
    <div class="tma-auth__group">
      <label class="tma-auth__field @error('company_name') tma-auth__field--error @enderror">
        <input class="tma-auth__input" type="text" name="company_name" placeholder="Company name" aria-label="Company name"
               maxlength="255" autocomplete="organization" value="{{ old('company_name', $values['company_name'] ?? '') }}"
               @disabled($chosen !== 'company')>
      </label>
      @include('onboarding.steps._error', ['field' => 'company_name'])
    </div>
    <div class="tma-auth__group">
      <label class="tma-auth__field">
        <input class="tma-auth__input" type="text" name="company_role" placeholder="Your role there (optional)" aria-label="Your role there"
               maxlength="120" autocomplete="organization-title" value="{{ old('company_role', $values['company_role'] ?? '') }}"
               @disabled($chosen !== 'company')>
      </label>
    </div>
    <div class="tma-auth__group">
      <label class="tma-auth__field">
        <input class="tma-auth__input" type="text" name="company_website" placeholder="Website (optional)" aria-label="Website"
               maxlength="255" value="{{ old('company_website', $values['company_website'] ?? '') }}"
               @disabled($chosen !== 'company')>
      </label>
    </div>
  </div>

  <p class="tma-auth__section-label">Address</p>
  <p class="tma-auth__hint">Used on documents and invoices. Optional.</p>
  @foreach ([
    ['street', 'Street address', 'street-address', 255],
    ['city', 'City', 'address-level2', 120],
    ['region', 'State or region', 'address-level1', 120],
    ['postcode', 'Postal code', 'postal-code', 32],
    ['country', 'Country', 'country-name', 120],
  ] as [$field, $placeholder, $autocomplete, $max])
    <div class="tma-auth__group">
      <label class="tma-auth__field @error($field) tma-auth__field--error @enderror">
        <input class="tma-auth__input" type="text" name="{{ $field }}" placeholder="{{ $placeholder }}" aria-label="{{ $placeholder }}"
               maxlength="{{ $max }}" autocomplete="{{ $autocomplete }}" value="{{ old($field, $values[$field] ?? '') }}">
      </label>
      @include('onboarding.steps._error', ['field' => $field])
    </div>
  @endforeach

  @php $rows = old('contacts', $values['contacts'] ?? []); @endphp
  <p class="tma-auth__section-label">Anyone else we should include?</p>
  <p class="tma-auth__hint">Colleagues or family who should receive documents and updates. Optional.</p>
  @for ($i = 0; $i < 3; $i++)
    <div class="tma-auth__group">
      <p class="tma-auth__section-label">Person {{ $i + 1 }}</p>
      <label class="tma-auth__field">
        <input class="tma-auth__input" type="text" name="contacts[{{ $i }}][name]" placeholder="Full name"
               aria-label="Full name" maxlength="120" value="{{ $rows[$i]['name'] ?? '' }}">
      </label>
      <label class="tma-auth__field @error('contacts.'.$i.'.email') tma-auth__field--error @enderror">
        <input class="tma-auth__input" type="email" name="contacts[{{ $i }}][email]" placeholder="Email address"
               aria-label="Email address" maxlength="255" value="{{ $rows[$i]['email'] ?? '' }}">
      </label>
      @include('onboarding.steps._error', ['field' => 'contacts.'.$i.'.email'])
      <label class="tma-auth__field">
        <input class="tma-auth__input" type="text" name="contacts[{{ $i }}][role]" placeholder="Their role, e.g. Finance contact"
               aria-label="Their role" maxlength="120" value="{{ $rows[$i]['role'] ?? '' }}">
      </label>
    </div>
  @endfor

  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
<script>
  (function () {
    var box = document.querySelector('[data-company-fields]');
    if (!box) return;
    function sync() {
      var chosen = document.querySelector('[data-account-type]:checked');
      var on = chosen && chosen.value === 'company';
      box.hidden = !on;
      box.querySelectorAll('input').forEach(function (el) { el.disabled = !on; });
    }
    document.querySelectorAll('[data-account-type]').forEach(function (el) {
      el.addEventListener('change', sync);
    });
    sync();
  })();
</script>
