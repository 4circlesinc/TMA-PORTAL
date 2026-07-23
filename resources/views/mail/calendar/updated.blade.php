@extends('mail.calendar.layout')
@section('title', 'Event updated')

@section('content')
  <h1 style="font-size:18px;line-height:26px;margin:0 0 12px;font-weight:700;">
    {{ $title }} has changed
  </h1>

  <p style="font-size:14px;line-height:22px;margin:0 0 16px;color:#374151;">
    {{ $name ? 'Hi '.$name.',' : 'Hello,' }}
    {{ $organizer ? $organizer.' updated this event.' : 'This event was updated.' }}
    Here are the current details.
  </p>

  @if (! empty($changes))
    <div style="background:#fff8e6;border:1px solid #ffe0a3;border-radius:10px;padding:12px 14px;margin:0 0 20px;">
      <p style="font-size:13px;line-height:20px;margin:0 0 4px;color:#92400e;font-weight:600;">What changed</p>
      <ul style="font-size:13px;line-height:20px;margin:0;padding-left:18px;color:#92400e;">
        @foreach ($changes as $change)
          <li>{{ $change }}</li>
        @endforeach
      </ul>
    </div>
  @endif

  @include('mail.calendar._details')

  @if ($url)
    <p style="margin:0 0 8px;">
      <a href="{{ $url }}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:#136da0;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
        Open in the portal
      </a>
    </p>
  @endif
@endsection
