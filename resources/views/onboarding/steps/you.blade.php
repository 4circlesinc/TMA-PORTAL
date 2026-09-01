@php $photo = $user->photoUrl(); @endphp
@include('onboarding.steps._icon', ['icon' => 'User'])
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">About you</h1>
  <p class="tma-auth__subtitle">Your name, and a photo if you have one. You can add the picture later.</p>
</div>
@include('auth.setup._progress')
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}" enctype="multipart/form-data">
  @csrf

  <div class="tma-auth__group tma-photo">
    <p class="tma-auth__section-label">Photo or logo</p>
    <div class="tma-photo__row">
      <span class="tma-photo__preview">
        <img data-photo-preview src="{{ $photo }}" alt="" @unless($photo) hidden @endunless
             onerror="this.hidden=true;var p=this.nextElementSibling;if(p)p.hidden=false;">
        <span class="tma-photo__placeholder" data-photo-placeholder @if($photo) hidden @endif>
          <img src="/images/icons/phosphor/User.svg" alt="" width="26" height="26">
        </span>
      </span>
      <div class="tma-photo__side">
        <p class="tma-auth__hint">JPG, PNG or WEBP, up to 8&nbsp;MB. Optional.</p>
        <label class="tma-auth__chip-btn tma-photo__btn" data-photo-btn>
          <img src="/images/icons/tma/UploadCloud.svg" alt="" width="14" height="14" aria-hidden="true">
          <span data-photo-btn-label>{{ $photo ? 'Change photo' : 'Choose photo' }}</span>
          <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden data-photo-input>
        </label>
      </div>
    </div>
    @include('onboarding.steps._error', ['field' => 'photo'])
  </div>

  <div class="tma-auth__stack">
    <label class="tma-auth__field @error('first_name') tma-auth__field--error @enderror">
      <input class="tma-auth__input" type="text" name="first_name" placeholder="First name" aria-label="First name"
             required maxlength="100" autocomplete="given-name" value="{{ old('first_name', $values['first_name'] ?? '') }}">
    </label>
    @include('onboarding.steps._error', ['field' => 'first_name'])
    <label class="tma-auth__field">
      <input class="tma-auth__input" type="text" name="middle_name" placeholder="Middle name (optional)" aria-label="Middle name"
             maxlength="100" autocomplete="additional-name" value="{{ old('middle_name', $values['middle_name'] ?? '') }}">
    </label>
    <label class="tma-auth__field @error('last_name') tma-auth__field--error @enderror">
      <input class="tma-auth__input" type="text" name="last_name" placeholder="Last name" aria-label="Last name"
             required maxlength="100" autocomplete="family-name" value="{{ old('last_name', $values['last_name'] ?? '') }}">
    </label>
    @include('onboarding.steps._error', ['field' => 'last_name'])
  </div>

  @include('onboarding.steps._nav')
</form>
@include('onboarding.steps._back-form')
