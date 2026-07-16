@extends('mail.signatures.layout')
@section('title', 'Please sign')

@section('content')
  <h1 style="font-size:18px;line-height:26px;margin:0 0 12px;font-weight:700;">
    {{ $sender ? $sender.' asked you to '.$action.' a document' : 'A document needs your signature' }}
  </h1>

  <p style="font-size:14px;line-height:22px;margin:0 0 16px;color:#374151;">
    {{ $name ? 'Hi '.$name.',' : 'Hello,' }} you can {{ $action }} <strong>{{ $title }}</strong> online — no account needed.
  </p>

  @if ($note)
    <div style="border-left:3px solid #e6e8ec;padding:2px 0 2px 14px;margin:0 0 20px;">
      <p style="font-size:14px;line-height:22px;margin:0;color:#374151;white-space:pre-wrap;">{{ $note }}</p>
    </div>
  @endif

  <p style="margin:0 0 24px;">
    <a href="{{ $url }}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:#136da0;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
      Review &amp; {{ $action }}
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
