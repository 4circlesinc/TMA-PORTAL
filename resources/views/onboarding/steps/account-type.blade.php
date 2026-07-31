<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Is this account for you or a company?</h1>
  <p class="tma-auth__subtitle">It decides what we ask for next and how your records are grouped.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  @php $chosen = old('account_type', $values['account_type'] ?? 'individual'); @endphp
  <div class="tma-auth__account-options" role="radiogroup" aria-label="Account type">
    @foreach ([
      ['individual', 'Individual', 'You are working with us in your own name.', 'UserCircle'],
      ['company', 'Company', 'You represent a company or organization.', 'Buildings'],
    ] as [$value, $name, $desc, $icon])
      <label class="tma-auth__account-card">
        <input class="tma-auth__account-input" type="radio" name="account_type" value="{{ $value }}" @checked($chosen === $value)>
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
  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
