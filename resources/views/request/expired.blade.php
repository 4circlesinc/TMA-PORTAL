@extends('request.layout')
@section('title', 'Link unavailable')
@section('content')
@php
  /*
   * Say which of the three it is. "Expired" and "withdrawn" lead to different
   * next steps — one is worth asking for a new link, the other means the firm
   * decided it no longer needs the documents — and a visitor told only
   * "unavailable" has to email to find out which.
   */
  $copy = match ($reason) {
      'expired' => ['This upload link has expired', 'Ask whoever sent it for a new link and you can upload straight away.'],
      'revoked' => ['This upload link has been withdrawn', 'The firm no longer needs files at this address.'],
      'closed' => ['This request has been closed', 'Everything that was needed has already been received.'],
      default => ['This link is no longer available', 'It may have been removed, or the address may be incomplete.'],
  };
@endphp
<div class="card" style="max-width:460px;margin:40px auto 0">
  <div class="card__body" style="text-align:center">
    <h1 style="font-size:18px;margin:0 0 6px">{{ $copy[0] }}</h1>
    <p style="color:var(--muted);font-size:14px;margin:0">{{ $copy[1] }}</p>
  </div>
</div>
@endsection
