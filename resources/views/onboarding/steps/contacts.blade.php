@php $rows = old('contacts', $values['contacts'] ?? []); @endphp
@include('onboarding.steps._icon', ['icon' => 'Users'])
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Anyone else we should include?</h1>
  <p class="tma-auth__subtitle">Colleagues or family who should receive documents and updates. Optional.</p>
</div>
@include('auth.setup._progress')
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
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
