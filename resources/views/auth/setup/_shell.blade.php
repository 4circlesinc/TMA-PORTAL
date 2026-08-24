@extends('auth.layout')

@section('title', $title)

@section('body')
  <main class="tma-auth" data-account-setup data-step="{{ $step }}">
    <div class="tma-auth__body">
      <section class="tma-auth__card tma-auth__card--tall" aria-labelledby="setup-title">
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

        @yield('setup-content')
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection

@push('scripts')
  <script src="/js/account-setup.js?v=2"></script>
@endpush
