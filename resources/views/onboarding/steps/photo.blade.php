@php $photo = $user->photoUrl(); @endphp
<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Add a photo or logo</h1>
  <p class="tma-auth__subtitle">A picture helps us recognise you. You can skip this and add one later.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}" enctype="multipart/form-data">
  @csrf
  {{-- Same control as the staff profile-setup screen: a round preview beside an
       upload chip, not a bare file input. --}}
  <div class="tma-auth__group tma-photo">
    <div class="tma-photo__row">
      <span class="tma-photo__preview">
        <img data-photo-preview src="{{ $photo }}" alt="" @unless($photo) hidden @endunless>
        <span class="tma-photo__placeholder" data-photo-placeholder @if($photo) hidden @endif>
          <img src="/images/icons/phosphor/User.svg" alt="" width="26" height="26">
        </span>
      </span>
      <div class="tma-photo__side">
        <p class="tma-auth__hint">JPG, PNG or WEBP, up to 8&nbsp;MB.</p>
        <label class="tma-auth__chip-btn tma-photo__btn" data-photo-btn>
          <img src="/images/icons/tma/UploadCloud.svg" alt="" width="14" height="14" aria-hidden="true">
          <span data-photo-btn-label>{{ $photo ? 'Change photo' : 'Choose photo' }}</span>
          <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden data-photo-input>
        </label>
      </div>
    </div>
    @include('onboarding.steps._error', ['field' => 'photo'])
  </div>

  @include('onboarding.steps._nav', ['label' => 'Continue'])
</form>
<p class="tma-auth__alt-link">
  <button type="submit" form="onboarding-skip" class="tma-auth__link-btn">Skip for now</button>
</p>
<form id="onboarding-skip" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}" hidden>@csrf</form>
@include('onboarding.steps._back-form')
