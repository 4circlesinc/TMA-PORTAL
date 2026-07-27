{{-- Data-driven postcard. One view renders every transactional email from a
     structured payload, so both real Mailables and the /design/mail preview
     gallery share exactly the same markup. Nothing here is client-specific;
     each email is just a different payload.

     Payload keys (all optional except heading):
       heading    string   the bold headline inside the card
       greeting   string   "Hi Marcus," line above the headline
       eyebrow    string   small uppercase label above the headline (e.g. SECURITY)
       intro      array    paragraphs before the call-to-action
       button     [label, url]        primary call-to-action
       secondary  [label, url]        optional secondary text link under the button
       details    array of [term, value]   key/value box (login info, file meta…)
       files      array of [name, meta]    a stacked list of files (the "file chain")
       note       string   a highlighted quote/callout block
       outro      array    paragraphs after the call-to-action
       fineprint  string   small muted line (expiry, "ignore this email"…)
       showLink   bool     echo the button url as copy-pasteable plain text
       accent     string   button/eyebrow colour (default brand blue) --}}

@php
    $accent = $accent ?? '#136da0';
    $intro = $intro ?? [];
    $outro = $outro ?? [];
@endphp

@extends('mail.layout')
@section('title', $heading)
@section('preheader', $preheader ?? '')

@section('content')
  @isset($eyebrow)
    <p style="font-size:11px;line-height:16px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;margin:0 0 10px;color:{{ $accent }};">
      {{ $eyebrow }}
    </p>
  @endisset

  @isset($greeting)
    <p style="font-size:14px;line-height:22px;margin:0 0 6px;color:#374151;">{{ $greeting }}</p>
  @endisset

  <h1 style="font-size:19px;line-height:27px;margin:0 0 14px;font-weight:700;color:#0f1115;">
    {{ $heading }}
  </h1>

  @foreach ($intro as $paragraph)
    <p style="font-size:14px;line-height:22px;margin:0 0 14px;color:#374151;">{!! $paragraph !!}</p>
  @endforeach

  @isset($details)
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border:1px solid #e6e8ec;border-radius:10px;background:#f9fafb;">
      @foreach ($details as $row)
        <tr>
          <td style="padding:10px 14px;font-size:13px;line-height:18px;color:#6b7280;width:38%;border-bottom:{{ $loop->last ? 'none' : '1px solid #eceef1' }};">{{ $row[0] }}</td>
          <td style="padding:10px 14px;font-size:13px;line-height:18px;color:#111827;font-weight:600;border-bottom:{{ $loop->last ? 'none' : '1px solid #eceef1' }};">{!! $row[1] !!}</td>
        </tr>
      @endforeach
    </table>
  @endisset

  @isset($files)
    <div style="margin:4px 0 20px;">
      @foreach ($files as $file)
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border:1px solid #e6e8ec;border-radius:10px;background:#ffffff;">
          <tr>
            <td width="40" style="padding:12px 0 12px 14px;vertical-align:middle;">
              <span style="display:inline-block;width:28px;height:28px;border-radius:7px;background:{{ $accent }};color:#ffffff;text-align:center;font-size:12px;font-weight:700;line-height:28px;">{{ strtoupper(pathinfo($file[0], PATHINFO_EXTENSION) ?: '•') }}</span>
            </td>
            <td style="padding:12px 14px;vertical-align:middle;">
              <div style="font-size:14px;line-height:18px;font-weight:600;color:#111827;">{{ $file[0] }}</div>
              <div style="font-size:12px;line-height:16px;color:#6b7280;margin-top:2px;">{{ $file[1] }}</div>
            </td>
          </tr>
        </table>
      @endforeach
    </div>
  @endisset

  @isset($note)
    <div style="border-left:3px solid {{ $accent }};background:#f6fafd;padding:12px 14px;border-radius:0 8px 8px 0;margin:0 0 20px;">
      <p style="font-size:14px;line-height:22px;margin:0;color:#374151;white-space:pre-wrap;">{!! $note !!}</p>
    </div>
  @endisset

  @isset($button)
    <p style="margin:0 0 {{ isset($secondary) ? '10px' : '20px' }};">
      <a href="{{ $button[1] }}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:{{ $accent }};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
        {{ $button[0] }}
      </a>
    </p>
  @endisset

  @isset($secondary)
    <p style="margin:0 0 20px;">
      <a href="{{ $secondary[1] }}" style="font-size:13px;line-height:20px;color:{{ $accent }};text-decoration:none;font-weight:600;">{{ $secondary[0] }}</a>
    </p>
  @endisset

  @foreach ($outro as $paragraph)
    <p style="font-size:14px;line-height:22px;margin:0 0 14px;color:#374151;">{!! $paragraph !!}</p>
  @endforeach

  @isset($fineprint)
    <p style="font-size:13px;line-height:20px;margin:0 0 8px;color:#6b7280;">{!! $fineprint !!}</p>
  @endisset

  @if (($showLink ?? false) && isset($button))
    <p style="font-size:12px;line-height:18px;margin:12px 0 0;color:#9ca3af;word-break:break-all;">
      If the button doesn't work, paste this into your browser:<br>{{ $button[1] }}
    </p>
  @endif
@endsection

@isset($foot)
  @section('foot', $foot)
@endisset
