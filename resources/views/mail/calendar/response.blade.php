@extends('mail.calendar.layout')
@section('title', 'Invitation response')

@section('content')
  <h1 style="font-size:18px;line-height:26px;margin:0 0 12px;font-weight:700;">
    {{ $attendee }} {{ $responseLabel }}
  </h1>

  <p style="font-size:14px;line-height:22px;margin:0 0 16px;color:#374151;">
    {{ $name ? 'Hi '.$name.',' : 'Hello,' }}
    <strong>{{ $attendee }}</strong> {{ $responseLabel }} your invitation to <strong>{{ $title }}</strong>.
  </p>

  @include('mail.calendar._details')

  @if ($url)
    <p style="margin:0 0 8px;">
      <a href="{{ $url }}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:#136da0;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
        See all responses
      </a>
    </p>
  @endif
@endsection

@section('foot')
  You're getting this because you organized this event.
@endsection
