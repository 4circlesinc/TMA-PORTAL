@extends('request.layout')
@section('title', 'Password required')
@section('content')
<section class="tma-auth__card" aria-labelledby="request-title">
  <div class="tma-request__brand">
    <img src="/images/brand/tma/tma-logo-horizontal.png" alt="TM ANTOINE Advisory">
  </div>

  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="request-title">Password required</h1>
    <p class="tma-auth__subtitle">Enter the password you were given to open this upload link.</p>
  </div>

  <form class="tma-auth__form" method="POST" action="/r/{{ $token }}/unlock">
    @csrf
    @if($error)
      <div class="tma-auth__alert tma-auth__alert--error" role="alert">
        <img src="/images/icons/phosphor/WarningCircle.svg" alt="" width="16" height="16" aria-hidden="true">
        <span>Incorrect password. Please try again.</span>
      </div>
    @endif
    <label class="tma-auth__field tma-auth__field--password{{ $error ? ' tma-auth__field--error' : '' }}">
      <input class="tma-auth__input" type="password" name="password" placeholder="Password" aria-label="Password" autofocus required autocomplete="off">
      <button type="button" class="tma-auth__toggle-pwd" data-toggle-password aria-label="Show password" aria-pressed="false">
        <img src="/images/icons/phosphor/EyeSlash.svg" alt="" width="16" height="16" aria-hidden="true">
      </button>
    </label>
    <button type="submit" class="tma-auth__submit">Unlock</button>
  </form>
</section>
@endsection
