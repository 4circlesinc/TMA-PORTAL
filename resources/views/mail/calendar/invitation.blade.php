@extends('mail.calendar.layout')
@section('title', 'Invitation')

@section('content')
  <h1 style="font-size:18px;line-height:26px;margin:0 0 12px;font-weight:700;">
    {{ $organizer ? $organizer.' invited you to '.$title : 'You have been invited to '.$title }}
  </h1>

  <p style="font-size:14px;line-height:22px;margin:0 0 16px;color:#374151;">
    {{ $name ? 'Hi '.$name.',' : 'Hello,' }} here are the details.
  </p>

  @include('mail.calendar._details')

  @if ($url)
    <p style="margin:0 0 24px;">
      <a href="{{ $url }}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:#136da0;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
        Open in the portal
      </a>
    </p>
    <p style="font-size:13px;line-height:20px;margin:0;color:#6b7280;">
      You can accept, mark yourself tentative, or decline from the event.
    </p>
  @else
    {{-- No portal account, so there is nothing to link to. --}}
    <p style="font-size:13px;line-height:20px;margin:0;color:#6b7280;">
      Please reply to this email to let the organizer know if you can make it.
    </p>
  @endif
@endsection
