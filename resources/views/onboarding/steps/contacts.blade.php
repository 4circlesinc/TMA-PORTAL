@php $rows = old('contacts', $values['contacts'] ?? []); @endphp
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Anyone else we should include?</h1>
  <p class="tma-auth__subtitle">Colleagues or family who should receive documents and updates. Optional.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}">
  @csrf
  @for ($i = 0; $i < 3; $i++)
    <div class="tma-auth__fields">
      <label class="tma-auth__field">
        <span class="tma-auth__section-label">{{ $i === 0 ? 'Name' : 'Name '.($i + 1) }} <span class="tma-auth__hint">optional</span></span>
        <input class="tma-auth__input" type="text" name="contacts[{{ $i }}][name]" maxlength="120"
               value="{{ $rows[$i]['name'] ?? '' }}">
      </label>
      <label class="tma-auth__field @error('contacts.'.$i.'.email') tma-auth__field--error @enderror">
        <span class="tma-auth__section-label">Email</span>
        <input class="tma-auth__input" type="email" name="contacts[{{ $i }}][email]" maxlength="255"
               value="{{ $rows[$i]['email'] ?? '' }}">
        @error('contacts.'.$i.'.email')<span class="tma-auth__field-msg">{{ $message }}</span>@enderror
      </label>
      <label class="tma-auth__field">
        <span class="tma-auth__section-label">Their role</span>
        <input class="tma-auth__input" type="text" name="contacts[{{ $i }}][role]" maxlength="120"
               placeholder="e.g. Finance contact" value="{{ $rows[$i]['role'] ?? '' }}">
      </label>
    </div>
  @endfor
  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
