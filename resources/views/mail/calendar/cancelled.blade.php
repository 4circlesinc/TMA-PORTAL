@extends('mail.calendar.layout')
@section('title', 'Event cancelled')

@section('content')
  <h1 style="font-size:18px;line-height:26px;margin:0 0 12px;font-weight:700;">
    {{ $title }} was cancelled
  </h1>

  <p style="font-size:14px;line-height:22px;margin:0 0 16px;color:#374151;">
    {{ $name ? 'Hi '.$name.',' : 'Hello,' }}
    {{ $organizer ? $organizer.' cancelled this event.' : 'This event was cancelled.' }}
    You don't need to do anything — it has been taken off your calendar.
  </p>

  @include('mail.calendar._details')

  @if (! empty($note))
    <div style="border-left:3px solid #e6e8ec;padding:2px 0 2px 14px;margin:0 0 20px;">
      <p style="font-size:14px;line-height:22px;margin:0;color:#374151;white-space:pre-wrap;">{{ $note }}</p>
    </div>
  @endif
@endsection
