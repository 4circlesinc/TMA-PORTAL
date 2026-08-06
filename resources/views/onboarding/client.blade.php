@extends('auth.layout')

@section('title', $title)

@push('scripts')
  <script src="/js/phone-input.js"></script>
  <script src="/js/avatar-cropper.js"></script>
  @if ($step === 'photo')
    {{-- avatar-cropper.js only exposes an API; without this the picture picked
         is submitted uncropped and the round preview never changes. --}}
    <script>
      (function () {
        var input = document.querySelector('[data-photo-input]');
        var preview = document.querySelector('[data-photo-preview]');
        var placeholder = document.querySelector('[data-photo-placeholder]');
        var btnLabel = document.querySelector('[data-photo-btn-label]');
        if (!input) return;

        // A stored photo that won't load must fall back to the placeholder -
        // a broken image reads as "we lost it".
        if (preview) {
          preview.addEventListener('error', function () {
            preview.hidden = true;
            if (placeholder) placeholder.hidden = false;
          });
        }

        var cropped = null;
        function setInputFile(file) {
          try {
            var dt = new DataTransfer();
            if (file) dt.items.add(file);
            input.files = dt.files;
          } catch (e) { /* older browsers: submit the raw selection */ }
        }

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
          }, function () {
            setInputFile(cropped); // cancelled: keep whatever crop was there
          });
        });
      })();
    </script>
  @endif
@endpush

@section('body')
  <main class="tma-auth">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <div class="tma-auth__body">
      <section class="tma-auth__card tma-auth__card--tall" aria-labelledby="onboarding-title">

        {{-- The same progress component the staff getting-started screen uses.
             Dots were tried first and don't survive a 13-step flow; the label
             also has to live inside this row, because tma-auth__section-label
             is a full-width form label and sat flush left of centred content. --}}
        <div class="tma-auth__progress" aria-hidden="true">
          <div class="tma-auth__progress-row">
            <span><strong>Step {{ $index }}</strong> of {{ $total }}</span>
            <span>@if ($optional) Optional @endif</span>
          </div>
          <div class="tma-auth__progress-track">
            <div class="tma-auth__progress-fill" style="width: {{ (int) round($index / max($total, 1) * 100) }}%;"></div>
          </div>
        </div>

        @if ($errors->any())
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ $errors->first() }}</span>
          </div>
        @endif

        @include('onboarding.steps.'.$step)

      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection
