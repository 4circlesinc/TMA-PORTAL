@extends('request.layout')
@section('title', 'Link unavailable')
@section('content')
@php
  /*
   * Say which of the three it is. "Expired" and "withdrawn" lead to different
   * next steps, one is worth asking for a new link, the other means the firm
   * decided it no longer needs the documents, and a visitor told only
   * "unavailable" has to email to find out which.
   */
  $copy = match ($reason) {
      'expired' => ['This upload link has expired', 'Ask whoever sent it for a new link and you can upload straight away.'],
      'revoked' => ['This upload link has been withdrawn', 'The firm no longer needs files at this address.'],
      'closed' => ['This request has been closed', 'Everything that was needed has already been received.'],
      default => ['This link is no longer available', 'It may have been removed, or the address may be incomplete.'],
  };
@endphp
<section class="tma-auth__card" aria-labelledby="request-title">
  <div class="tma-auth__icon" aria-hidden="true">
    <img src="/images/icons/phosphor/ClockCountdown.svg" alt="" width="80" height="80">
  </div>

  <div class="tma-auth__intro">
    <h1 class="tma-auth__title" id="request-title">{{ $copy[0] }}</h1>
    <p class="tma-auth__subtitle">{{ $copy[1] }}</p>
  </div>
</section>
@endsection
