<div class="tma-auth__intro">
  <h1 class="tma-auth__title" id="onboarding-title">Add a photo or logo</h1>
  <p class="tma-auth__subtitle">A picture helps us recognise you. You can skip this and add one later.</p>
</div>
<form class="tma-auth__form" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}" enctype="multipart/form-data">
  @csrf
  <div class="tma-auth__field">
    <input class="tma-auth__input" type="file" name="photo" accept="image/jpeg,image/png,image/webp" data-photo-input>
    <span class="tma-auth__hint">JPG, PNG or WEBP, up to 8&nbsp;MB.</span>
    @error('photo')<span class="tma-auth__field-msg">{{ $message }}</span>@enderror
  </div>
  @include('onboarding.steps._nav', ['label' => 'Continue'])
</form>
<p class="tma-auth__alt-link">
  <button type="submit" form="onboarding-skip" class="tma-auth__link-btn">Skip for now</button>
</p>
<form id="onboarding-skip" method="POST" action="{{ route('onboarding.store', ['step' => $step]) }}" hidden>@csrf</form>
@include('onboarding.steps._back-form')
