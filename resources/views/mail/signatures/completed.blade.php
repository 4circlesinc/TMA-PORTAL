@extends('mail.signatures.layout')
@section('title', 'Signed')

@section('content')
  <h1 style="font-size:18px;line-height:26px;margin:0 0 12px;font-weight:700;">
    {{ $title }} is signed
  </h1>

  <p style="font-size:14px;line-height:22px;margin:0 0 16px;color:#374151;">
    {{ $name ? 'Hi '.$name.',' : 'Hello,' }} everyone has now signed
    <strong>{{ $title }}</strong>.
  </p>

  @if ($signers)
    <p style="font-size:14px;line-height:22px;margin:0 0 16px;color:#374151;">
      Signed by: {{ implode(', ', $signers) }}.
    </p>
  @endif

  @if ($attached)
    <p style="font-size:14px;line-height:22px;margin:0;color:#374151;">
      The signed copy is attached to this email for your records.
    </p>
  @else
    {{-- Stamping failed. Say so rather than point at an attachment that
         isn't there. --}}
    <p style="font-size:14px;line-height:22px;margin:0;color:#374151;">
      We're still preparing the signed copy — it'll follow shortly.
    </p>
  @endif
@endsection

@section('foot')
  Signed securely via TM ANTOINE Advisory.
@endsection
