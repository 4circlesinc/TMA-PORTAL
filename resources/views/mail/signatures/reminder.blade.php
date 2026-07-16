@extends('mail.signatures.layout')
@section('title', 'Reminder')

@section('content')
  <h1 style="font-size:18px;line-height:26px;margin:0 0 12px;font-weight:700;">
    A quick reminder
  </h1>

  <p style="font-size:14px;line-height:22px;margin:0 0 20px;color:#374151;">
    {{ $name ? 'Hi '.$name.',' : 'Hello,' }} <strong>{{ $title }}</strong> is still waiting for your signature{{ $sender ? ', sent by '.$sender : '' }}.
  </p>

  <p style="margin:0 0 24px;">
    <a href="{{ $url }}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:#136da0;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
      Review &amp; sign
    </a>
  </p>

  @if ($expiresAt)
    <p style="font-size:13px;line-height:20px;margin:0 0 8px;color:#6b7280;">
      This link expires on {{ $expiresAt->format('j M Y') }}.
    </p>
  @endif

  <p style="font-size:12px;line-height:18px;margin:0;color:#9ca3af;word-break:break-all;">
    If the button doesn't work, paste this into your browser:<br>{{ $url }}
  </p>
@endsection

@section('foot')
  This link is personal to you — please don't forward it.
@endsection
