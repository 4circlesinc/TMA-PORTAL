{{--
  Refused because of where the request came from.

  Uses the stranger-facing layout, not the portal shell: whoever is reading
  this has been refused before any account was involved, so there is nothing
  of the workspace to draw and no session to draw it for.

  The message is the firm's own, from Account settings › Security. The page
  adds no detail of its own — not the country seen, not the policy, not
  whether an account exists — because the person reading it is the one person
  who does not need to know how the rule works.
--}}
@extends('request.layout')
@section('title', 'Not available here')
@section('content')
<section class="tma-auth__card" aria-labelledby="geo-title">
  <div class="tma-auth__icon" aria-hidden="true">
    <img src="/images/icons/phosphor/GlobeHemisphereWest.svg" alt="" width="80" height="80">
  </div>

  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="geo-title">Not available here</h1>
    <p class="tma-auth__subtitle">{{ $message }}</p>
    <p class="tma-auth__subtitle">If you believe this is wrong, contact the firm.</p>
  </div>
</section>
@endsection
