@extends('auth.layout')

@section('title', $title)

@section('body')
  <main class="tma-auth" data-account-setup data-step="{{ $step }}">
    <div class="tma-auth__body">
      <section class="tma-auth__card tma-auth__card--tall tma-auth__card--setup" aria-labelledby="setup-title">
        <div class="tma-auth__setup-progress" aria-hidden="true">
          @for ($i = 1; $i <= $total; $i++)
            <span class="tma-auth__setup-dot {{ $i < $index ? 'tma-auth__setup-dot--done' : ($i === $index ? 'tma-auth__setup-dot--active' : '') }}"></span>
          @endfor
        </div>

        <p class="tma-auth__setup-kicker">Step {{ $index }} of {{ $total }}</p>

        @yield('setup-content')

        @if ($errors->any())
          <div class="tma-auth__alert tma-auth__alert--error" role="alert">
            <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
            <span>{{ $errors->first() }}</span>
          </div>
        @endif
      </section>
    </div>

    <p class="tma-auth__copyright">&copy; {{ date('Y') }} TM ANTOINE Advisory</p>
  </main>
@endsection

@push('scripts')
  <script src="/js/account-setup.js?v=1"></script>
@endpush
