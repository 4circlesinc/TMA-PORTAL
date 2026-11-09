{{-- Email-safe, fully-inlined version of the approved /design/mail postcard.
     Mail clients strip <style>/classes, so every rule is inline and the layout
     is table-based to survive Outlook. This mirrors the auth-card design in
     public/js/email-templates.js (centred card, logo mark, black button, footer
     with wordmark + email + socials). Data-driven: every transactional email is
     a payload for this one view.

     Responsive by construction, not by a stylesheet alone. The card is a
     fluid table (100% wide, never wider than 560px) rather than a fixed 560px
     one, so it fits a phone even where the <style> block below is stripped;
     long links and addresses wrap instead of pushing the message sideways,
     and pictures in the body are held to its width. The <style> block then
     tightens a phone further where it is honoured (Apple Mail, Gmail, the
     portal's own reading pane): smaller padding, a smaller title, detail
     rows stacked. Desktop Outlook, which ignores max-width, gets a 560px
     ghost table in conditional comments.

     Payload (all optional except $title):
       preheader  string  inbox preview line
       eyebrow    string  small uppercase label above the title
       title      string  the headline
       lead       string  sub-headline under the title
       greeting   string  "Hi Marcus," (rendered above the body)
       bodyHtml   string  pre-built HTML body (paragraphs)
       code       string  a large verification code
       details    array   [[label, value], …] key/value rows
       files      array   [[name, meta], …] attachment rows
       quote      string  a quoted message / callout
       button     array   ['label' => …, 'url' => …]
       help       bool    show the "trouble with the button" fine print (default true when a button exists)
       helpUrl    string  the fallback link (defaults to the portal) --}}
@php
    $BLUE = '#03a5e9';
    $INK = '#000000';
    $MUTED = 'rgba(0,0,0,0.40)';
    $LINE = 'rgba(0,0,0,0.10)';
    // Long words (links, addresses, file names) wrap rather than widen the card.
    $WRAP = 'word-break:break-word;overflow-wrap:anywhere;';
    // The live portal is portal.tmantoine*law*.com, the hardcoded
    // portal.tmantoine.com this used to carry does not resolve (NXDOMAIN), so
    // the unsubscribe and fallback links in every email were dead. Taken from
    // APP_URL instead, which is correct in production and follows the app.
    $portal = url('/');
    $help = $help ?? isset($button);
    $helpUrl = $helpUrl ?? ($button['url'] ?? $portal);
    $socials = [
        ['Facebook', 'https://www.facebook.com/tmantoinepartners', 'Facebook40.svg'],
        ['Instagram', 'https://www.instagram.com/tmapartners/', 'Instagram40.svg'],
    ];
    $fileIcon = function (string $name): string {
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $tma = ['doc' => 'DocxIcon.svg', 'docx' => 'DocxIcon.svg', 'xls' => 'XlsxIcon.svg', 'xlsx' => 'XlsxIcon.svg', 'csv' => 'XlsxIcon.svg', 'ppt' => 'PptIcon.svg', 'pptx' => 'PptIcon.svg', 'txt' => 'TxtIcon.svg'];
        $ph = ['pdf' => 'FilePdf.svg', 'png' => 'FileImage.svg', 'jpg' => 'FileImage.svg', 'jpeg' => 'FileImage.svg', 'gif' => 'FileImage.svg', 'zip' => 'FileZip.svg'];
        if (isset($tma[$ext])) return url('/images/icons/tma/'.$tma[$ext]);
        if (isset($ph[$ext])) return url('/images/icons/phosphor/'.$ph[$ext]);
        return url('/images/icons/tma/DefaultIcon.svg');
    };
@endphp
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  {{-- Drawn for a light background; a phone in dark mode is told so rather
       than left to invert the black button and text on its own. --}}
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>{{ $title }}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
    * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    .pc-body img { max-width: 100% !important; height: auto !important; }
    .pc-body table { max-width: 100% !important; }
    .pc-body a, .pc-wrap { word-break: break-word; overflow-wrap: anywhere; }

    @media only screen and (max-width: 600px) {
      .pc-outer { padding: 12px 8px !important; }
      .pc-card { padding: 28px 20px !important; border-radius: 20px !important; }
      .pc-logo { width: 56px !important; height: 56px !important; }
      .pc-logo-cell { padding-bottom: 18px !important; }
      .pc-title { font-size: 22px !important; line-height: 28px !important; }
      .pc-lead { font-size: 15px !important; line-height: 22px !important; margin-bottom: 18px !important; }
      .pc-detail-label, .pc-detail-value { display: block !important; width: auto !important; }
      .pc-detail-label { padding: 8px 0 0 !important; }
      .pc-detail-value { padding: 2px 0 4px !important; }
      .pc-code { font-size: 22px !important; line-height: 28px !important; letter-spacing: .16em !important; padding: 14px 12px !important; }
      .pc-button a { padding: 14px 16px !important; font-size: 16px !important; }
      .pc-footer { margin-top: 24px !important; }
      .pc-footer-logo { height: 32px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background:#f9f9fa;font-family:Inter,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:{{ $INK }};-webkit-font-smoothing:antialiased;">
  @isset($preheader)
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">{{ $preheader }}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
  @endisset

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f9f9fa;">
    <tr>
      <td align="center" class="pc-outer" style="padding:28px 12px;">
        <!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;">

          {{-- Card --}}
          <tr>
            <td class="pc-card" style="background:#ffffff;border-radius:28px;padding:40px 32px;">
              {{-- Logo mark --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" class="pc-logo-cell" style="padding:0 0 24px;">
                <img class="pc-logo" src="{{ url('/images/brand/tma/tma-logo-mark.png') }}" alt="TM ANTOINE Advisory" width="72" height="72" style="display:block;width:72px;height:72px;">
              </td></tr></table>

              @isset($eyebrow)
                <p class="pc-wrap" style="margin:0 0 8px;text-align:center;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:{{ $BLUE }};">{{ $eyebrow }}</p>
              @endisset

              <h1 class="pc-title pc-wrap" style="margin:0 0 10px;text-align:center;font-size:26px;line-height:32px;font-weight:600;color:{{ $INK }};{{ $WRAP }}">{{ $title }}</h1>

              @isset($lead)
                <p class="pc-lead pc-wrap" style="margin:0 0 22px;text-align:center;font-size:15px;line-height:22px;color:{{ $INK }};{{ $WRAP }}">{{ $lead }}</p>
              @endisset

              @isset($greeting)
                <p style="margin:22px 0 12px;font-size:15px;line-height:22px;color:{{ $INK }};">{{ $greeting }}</p>
              @endisset

              @isset($bodyHtml)
                <div class="pc-body" style="font-size:15px;line-height:22px;color:{{ $INK }};text-align:left;{{ $WRAP }}">{!! $bodyHtml !!}</div>
              @endisset

              @if (! empty($details))
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;">
                  @foreach ($details as $row)
                    <tr>
                      <td class="pc-detail-label" width="32%" style="padding:4px 12px 4px 0;font-size:14px;line-height:20px;color:{{ $MUTED }};vertical-align:top;width:32%;">{{ $row[0] }}</td>
                      <td class="pc-detail-value" style="padding:4px 0;font-size:14px;line-height:20px;color:{{ $INK }};font-weight:600;{{ $WRAP }}">{!! $row[1] !!}</td>
                    </tr>
                  @endforeach
                </table>
              @endif

              @isset($files)
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;">
                  @foreach ($files as $file)
                    <tr>
                      <td width="28" style="padding:6px 0;vertical-align:middle;width:28px;"><img src="{{ $fileIcon($file[0]) }}" alt="" width="28" height="28" style="display:block;width:28px;height:28px;"></td>
                      <td style="padding:6px 0 6px 10px;vertical-align:middle;">
                        <div style="font-size:15px;line-height:18px;font-weight:600;color:{{ $INK }};{{ $WRAP }}">{{ $file[0] }}</div>
                        <div style="font-size:13px;line-height:16px;color:{{ $MUTED }};">{{ $file[1] }}</div>
                      </td>
                    </tr>
                  @endforeach
                </table>
              @endisset

              @isset($quote)
                {{--
                  Escaped, NOT raw. This block carries text a user typed, the
                  message on a signature request, an invitation note, and it
                  goes out to external recipients. Rendering it unescaped let a
                  sender put markup (or a <script> tag) into somebody else's
                  inbox. Line breaks are the only formatting it needs, and
                  nl2br on an escaped string gives exactly that.
                --}}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;"><tr>
                  <td style="border-left:3px solid {{ $LINE }};padding:2px 0 2px 14px;font-size:15px;line-height:22px;color:#374151;{{ $WRAP }}">{!! nl2br(e($quote)) !!}</td>
                </tr></table>
              @endisset

              @isset($code)
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;width:100%;"><tr>
                  <td align="center" class="pc-code" style="background:rgba(0,0,0,0.04);border-radius:16px;padding:16px 20px;font-size:26px;line-height:32px;font-weight:700;letter-spacing:.24em;color:{{ $INK }};">{{ $code }}</td>
                </tr></table>
              @endisset

              @isset($button)
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;width:100%;"><tr>
                  <td align="center" bgcolor="#000000" class="pc-button" style="background:#000000;border-radius:16px;">
                    <a href="{{ $button['url'] }}" style="display:block;padding:14px 24px;font-size:17px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;text-align:center;">{{ $button['label'] }}</a>
                  </td>
                </tr></table>
              @endisset

              @if ($help)
                <p style="margin:20px 0 0;font-size:13px;line-height:18px;color:{{ $MUTED }};{{ $WRAP }}">
                  Trouble with the button? Copy and paste this link into your browser:
                  <a href="{{ $helpUrl }}" class="pc-wrap" style="color:{{ $BLUE }};text-decoration:none;word-break:break-all;">{{ $helpUrl }}</a>
                </p>
              @endif

              @isset($footNote)
                <p class="pc-wrap" style="margin:12px 0 0;font-size:13px;line-height:18px;color:{{ $MUTED }};{{ $WRAP }}">{!! $footNote !!}</p>
              @endisset

              {{-- Footer --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="pc-footer" style="margin:32px 0 0;width:100%;border-top:1px solid {{ $LINE }};">
                <tr><td align="center" style="padding:24px 0 0;">
                  <img class="pc-footer-logo" src="{{ url('/images/brand/tma/tma-logo-horizontal.png') }}" alt="TM ANTOINE Advisory" height="40" style="display:block;height:40px;width:auto;max-width:100%;margin:0 auto 16px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
                    <td style="padding:0 8px;font-size:13px;line-height:18px;color:{{ $MUTED }};vertical-align:middle;">
                      <a href="mailto:support@tmantoinelaw.com" style="color:{{ $BLUE }};text-decoration:none;">support@tmantoinelaw.com</a>
                    </td>
                    @foreach ($socials as $s)
                      <td style="padding:0 4px;vertical-align:middle;"><a href="{{ $s[1] }}" style="text-decoration:none;"><img src="{{ url('/images/icons/brands/'.$s[2]) }}" alt="{{ $s[0] }}" width="18" height="18" style="display:block;width:18px;height:18px;"></a></td>
                    @endforeach
                  </tr></table>
                </td></tr>
              </table>
            </td>
          </tr>

          {{-- Legal --}}
          <tr><td align="center" style="padding:16px 8px 0;font-size:13px;line-height:18px;color:{{ $MUTED }};">
            &copy; {{ date('Y') }} TM ANTOINE Advisory &nbsp;·&nbsp;
            <a href="{{ $portal }}" style="color:{{ $MUTED }};text-decoration:underline;">Unsubscribe</a>
          </td></tr>

        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>
