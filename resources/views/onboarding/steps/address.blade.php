<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Your address</h1>
  <p class="tma-auth__subtitle">Used on documents and invoices. You can skip this and add it later.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  {{-- Not $label: _nav reads `$label ?? 'Continue'` off the shared view scope,
       so a loop variable by that name renames the Continue button. --}}
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

  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
