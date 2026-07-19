@extends('mail.signatures.layout')
@section('title', 'Changes requested')

@section('content')
  <h1 style="font-size:18px;line-height:26px;margin:0 0 12px;font-weight:700;">
    Changes were requested
  </h1>

  <p style="font-size:14px;line-height:22px;margin:0 0 16px;color:#374151;">
    <strong>{{ $title }}</strong> was reviewed{{ $by ? ' by '.$by : '' }}, who asked for changes before approving. The request is on hold until you revise and resend it.
  </p>

  <div style="border-left:3px solid #e6e8ec;padding:2px 0 2px 14px;margin:0 0 20px;">
    <p style="font-size:14px;line-height:22px;margin:0;color:#374151;white-space:pre-wrap;">{{ $comment }}</p>
  </div>

  <p style="margin:0;">
    <a href="{{ $url }}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:#136da0;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
      Open Signatures
    </a>
  </p>
@endsection
