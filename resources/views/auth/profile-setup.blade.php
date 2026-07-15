@extends('auth.layout')

@section('title', 'Set Up Your Profile')

@php
  $providerPhoto = $user->provider_avatar_url;
  $hasProviderPhoto = (bool) $providerPhoto;
@endphp

@push('scripts')
  <script src="/js/phone-input.js"></script>
  <script src="/js/avatar-cropper.js"></script>
  <script>
    (function () {
      var input = document.querySelector('[data-photo-input]');
      var preview = document.querySelector('[data-photo-preview]');
      var placeholder = document.querySelector('[data-photo-placeholder]');
      var btn = document.querySelector('[data-photo-btn]');
      var btnLabel = document.querySelector('[data-photo-btn-label]');
      var providerSrc = preview ? preview.getAttribute('src') : '';
      if (!input) return;

      var msg = document.querySelector('[data-photo-msg]');
      function hideMsg() { if (msg) msg.hidden = true; }

      var cropped = null;   // the square-cropped File actually submitted
      function setInputFile(file) {
        try {
          var dt = new DataTransfer();
          if (file) dt.items.add(file);
          input.files = dt.files;
        } catch (e) { /* older browsers: fall back to raw selection */ }
      }

      // Selecting a file opens the square cropper; we submit the crop, not the
      // raw file. Cancelling keeps whatever crop was there before.
      input.addEventListener('change', function () {
        var picked = input.files && input.files[0];
        if (!picked || (cropped && picked === cropped)) return;
        if (!window.TMAAvatarCropper) return; // graceful: submit raw file as-is
        window.TMAAvatarCropper.open(picked, function (blob, dataUrl) {
          cropped = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
          setInputFile(cropped);
          preview.src = dataUrl;
          preview.hidden = false;
          if (placeholder) placeholder.hidden = true;
          if (btnLabel) btnLabel.textContent = 'Change photo';
          hideMsg();
        }, function () {
          setInputFile(cropped); // restore previous crop (or clear)
        });
      });

      document.querySelectorAll('[data-photo-choice]').forEach(function (radio) {
        radio.addEventListener('change', function () {
          var upload = radio.getAttribute('data-photo-choice') === 'upload';
          if (btn) btn.hidden = !upload;
          if (!upload) hideMsg();
          if (upload) {
            input.click();
          } else {
            cropped = null;
            setInputFile(null);
            preview.src = providerSrc;
            preview.hidden = !providerSrc;
            if (placeholder) placeholder.hidden = !!providerSrc;
            if (btnLabel) btnLabel.textContent = 'Choose photo';
          }
        });
      });

      // A photo is required unless the user keeps their provider photo. Warn
      // visibly instead of relying on a hidden input's native validation.
      var form = input.form || input.closest('form');
      if (form) {
        form.addEventListener('submit', function (ev) {
          var choice = document.querySelector('[data-photo-choice]:checked');
          var keepingProvider = choice && choice.getAttribute('data-photo-choice') === 'provider';
          var hasFile = input.files && input.files.length > 0;
          if (!keepingProvider && !hasFile) {
            ev.preventDefault();
            if (msg) {
              msg.hidden = false;
              msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            if (btn) btn.focus();
          }
        });
      }
    })();
  </script>
@endpush

@section('body')
  <main class="tma-auth">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <div class="tma-auth__body">
      <section class="tma-auth__card tma-auth__card--tall" aria-labelledby="profile-setup-title">
        <div class="tma-auth__intro">
          <h1 class="tma-auth__title" id="profile-setup-title">Set up your profile</h1>
          <p class="tma-auth__subtitle">This is how colleagues and clients see you.</p>
        </div>

        <form class="tma-auth__form" method="POST" action="{{ route('profile-setup.store') }}" enctype="multipart/form-data">
          @csrf

          <div class="tma-auth__group tma-photo">
            <p class="tma-auth__section-label">Profile picture</p>
            <div class="tma-photo__row">
              <span class="tma-photo__preview">
                <img data-photo-preview src="{{ $hasProviderPhoto ? $providerPhoto : '' }}" alt="" @unless($hasProviderPhoto) hidden @endunless>
                <span class="tma-photo__placeholder" data-photo-placeholder @if($hasProviderPhoto) hidden @endif>
                  <img src="/images/icons/phosphor/User.svg" alt="" width="26" height="26">
                </span>
              </span>
              <div class="tma-photo__side">
                @if ($hasProviderPhoto)
                  <label class="tma-auth__check"><input type="radio" name="avatar_choice" value="provider" checked data-photo-choice="provider"><span>Use my account photo</span></label>
                  <label class="tma-auth__check"><input type="radio" name="avatar_choice" value="upload" data-photo-choice="upload"><span>Upload a different photo</span></label>
                @else
                  <p class="tma-auth__hint">A clear, recent photo of your face. This is required.</p>
                @endif
                <label class="tma-auth__chip-btn tma-photo__btn" @if($hasProviderPhoto) hidden @endif data-photo-btn>
                  <img src="/images/icons/tma/UploadCloud.svg" alt="" width="14" height="14" aria-hidden="true">
                  <span data-photo-btn-label>Choose photo</span>
                  {{-- No native `required`: a hidden file input would block
                       submit silently (browsers can't show a bubble on a hidden
                       control). The submit handler below warns visibly instead. --}}
                  <input type="file" name="avatar_photo" accept="image/jpeg,image/png,image/webp" hidden data-photo-input>
                </label>
              </div>
            </div>
            @error('avatar_photo')
              <p class="tma-auth__field-msg">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                <span>{{ $message }}</span>
              </p>
            @enderror
            <p class="tma-auth__field-msg" data-photo-msg hidden>
              <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
              <span>Please add a photo of yourself to continue.</span>
            </p>
          </div>

          <div class="tma-auth__group">
            <label class="tma-auth__field @error('first_name') tma-auth__field--error @enderror">
              <input class="tma-auth__input" type="text" name="first_name" placeholder="First name" autocomplete="given-name"
                aria-label="First name" value="{{ old('first_name', $user->first_name) }}" required>
            </label>
            @error('first_name')
              <p class="tma-auth__field-msg">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                <span>{{ $message }}</span>
              </p>
            @enderror
          </div>

          <div class="tma-auth__group">
            <label class="tma-auth__field">
              <input class="tma-auth__input" type="text" name="middle_name" placeholder="Middle name (optional)"
                autocomplete="additional-name" aria-label="Middle name" value="{{ old('middle_name', $user->middle_name) }}">
            </label>
          </div>

          <div class="tma-auth__group">
            <label class="tma-auth__field @error('last_name') tma-auth__field--error @enderror">
              <input class="tma-auth__input" type="text" name="last_name" placeholder="Last name" autocomplete="family-name"
                aria-label="Last name" value="{{ old('last_name', $user->last_name) }}" required>
            </label>
            @error('last_name')
              <p class="tma-auth__field-msg">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                <span>{{ $message }}</span>
              </p>
            @enderror
          </div>

          <div class="tma-auth__group">
            <label class="tma-auth__field tma-auth__field--icon-start @error('phone') tma-auth__field--error @enderror">
              <img src="/images/icons/phosphor/DeviceMobile.svg" alt="" width="16" height="16" aria-hidden="true">
              <input class="tma-auth__input" type="tel" name="phone" placeholder="Phone number"
                autocomplete="tel" aria-label="Phone number" value="{{ old('phone', $user->phone) }}" required>
            </label>
            @error('phone')
              <p class="tma-auth__field-msg">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                <span>{{ $message }}</span>
              </p>
            @enderror
          </div>

          <div class="tma-auth__group">
            <label class="tma-auth__field @error('gender') tma-auth__field--error @enderror">
              <select class="tma-auth__input" name="gender" aria-label="Gender" required>
                <option value="" disabled hidden @selected(!old('gender', $user->gender))>Gender</option>
                @foreach (['Female', 'Male', 'Non-binary', 'Prefer not to say'] as $g)
                  <option value="{{ $g }}" @selected(old('gender', $user->gender) === $g)>{{ $g }}</option>
                @endforeach
              </select>
            </label>
            @error('gender')
              <p class="tma-auth__field-msg">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                <span>{{ $message }}</span>
              </p>
            @enderror
          </div>

          <div class="tma-auth__group">
            <label class="tma-auth__field @error('job_title') tma-auth__field--error @enderror">
              <input class="tma-auth__input" type="text" name="job_title" placeholder="Role"
                aria-label="Role" value="{{ old('job_title', $user->job_title) }}" maxlength="120" required>
            </label>
            @error('job_title')
              <p class="tma-auth__field-msg">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                <span>{{ $message }}</span>
              </p>
            @enderror
          </div>

          <div class="tma-auth__group">
            <label class="tma-auth__field tma-auth__field--textarea">
              <textarea class="tma-auth__textarea" name="bio" placeholder="About you (optional)"
                aria-label="About you" maxlength="1000">{{ old('bio', $user->bio) }}</textarea>
            </label>
          </div>

          <div class="tma-auth__group">
            <label class="tma-auth__field tma-auth__field--icon-start @error('linkedin_url') tma-auth__field--error @enderror">
              <img src="/images/icons/brands/LinkedIn16.svg" alt="" width="16" height="16" aria-hidden="true">
              <input class="tma-auth__input" type="text" name="linkedin_url" placeholder="linkedin.com/in/your-name"
                aria-label="LinkedIn profile" value="{{ old('linkedin_url', $user->linkedin_url) }}">
            </label>
            @error('linkedin_url')
              <p class="tma-auth__field-msg">
                <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="14" height="14" aria-hidden="true">
                <span>{{ $message }}</span>
              </p>
            @enderror
          </div>

          <button type="submit" class="tma-auth__submit">Continue</button>
        </form>
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
