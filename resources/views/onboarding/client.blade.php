@extends('auth.layout')

@section('title', $title)

@push('scripts')
  <script src="/js/phone-input.js"></script>
  <script src="/js/avatar-cropper.js"></script>
@endpush

@section('body')
  <main class="tma-auth">
    <button class="tma-auth__theme" type="button" data-action="toggle-theme" aria-label="Toggle dark mode">
      <img src="/images/icons/phosphor/Sun.svg" alt="" width="18" height="18" aria-hidden="true">
    </button>

    <div class="tma-auth__body">
      <section class="tma-auth__card tma-auth__card--tall" aria-labelledby="onboarding-title">

        {{-- Where they are. Dots for a short flow, a bar once it gets long. --}}
        <div class="tma-auth__steps" aria-hidden="true">
          @foreach ($steps as $i => $key)
            <span class="tma-auth__step-dot
              @if ($key === $step) tma-auth__step-dot--active
              @elseif ($progress->hasDone($key)) tma-auth__step-dot--done @endif"></span>
          @endforeach
        </div>

        <p class="tma-auth__section-label">Step {{ $index }} of {{ $total }}</p>

        @if ($errors->any())
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ $errors->first() }}</span>
          </div>
        @endif

        @include('onboarding.steps.'.$step)

      </section>
    </div>
  </main>
@endsection
