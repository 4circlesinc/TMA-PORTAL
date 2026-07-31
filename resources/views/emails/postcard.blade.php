{{-- Email-safe, fully-inlined version of the approved /design/mail postcard.
     Mail clients strip <style>/classes, so every rule is inline and the layout
     is table-based to survive Outlook. This mirrors the auth-card design in
     public/js/email-templates.js (centred card, logo mark, black button, footer
     with wordmark + email + socials). Data-driven: every transactional email is
     a payload for this one view.

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
    $portal = 'https://portal.tmantoine.com/';
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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>{{ $title }}</title>
</head>
<body style="margin:0;padding:0;background:#f9f9fa;font-family:Inter,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:{{ $INK }};-webkit-font-smoothing:antialiased;">
  @isset($preheader)
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">{{ $preheader }}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
  @endisset

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9fa;">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;">

          {{-- Card --}}
          <tr>
            <td style="background:#ffffff;border-radius:28px;padding:40px;">
              {{-- Logo mark --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 0 24px;">
                <img src="{{ url('/images/brand/tma/tma-logo-mark.png') }}" alt="TM ANTOINE Advisory" width="72" height="72" style="display:block;width:72px;height:72px;">
              </td></tr></table>

              @isset($eyebrow)
                <p style="margin:0 0 8px;text-align:center;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:{{ $BLUE }};">{{ $eyebrow }}</p>
              @endisset

              <h1 style="margin:0 0 10px;text-align:center;font-size:26px;line-height:32px;font-weight:600;color:{{ $INK }};">{{ $title }}</h1>

              @isset($lead)
                <p style="margin:0 0 22px;text-align:center;font-size:15px;line-height:22px;color:{{ $INK }};">{{ $lead }}</p>
              @endisset

              @isset($greeting)
                <p style="margin:22px 0 12px;font-size:15px;line-height:22px;color:{{ $INK }};">{{ $greeting }}</p>
              @endisset

              @isset($bodyHtml)
                <div style="font-size:15px;line-height:22px;color:{{ $INK }};text-align:left;">{!! $bodyHtml !!}</div>
              @endisset

              @if (! empty($details))
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
                  @foreach ($details as $row)
                    <tr>
                      <td style="padding:4px 12px 4px 0;font-size:14px;line-height:20px;color:{{ $MUTED }};vertical-align:top;width:96px;">{{ $row[0] }}</td>
                      <td style="padding:4px 0;font-size:14px;line-height:20px;color:{{ $INK }};font-weight:600;">{!! $row[1] !!}</td>
                    </tr>
                  @endforeach
                </table>
              @endif

              @isset($files)
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
                  @foreach ($files as $file)
                    <tr>
                      <td width="28" style="padding:6px 0;vertical-align:middle;"><img src="{{ $fileIcon($file[0]) }}" alt="" width="28" height="28" style="display:block;width:28px;height:28px;"></td>
                      <td style="padding:6px 0 6px 10px;vertical-align:middle;">
                        <div style="font-size:15px;line-height:18px;font-weight:600;color:{{ $INK }};">{{ $file[0] }}</div>
                        <div style="font-size:13px;line-height:16px;color:{{ $MUTED }};">{{ $file[1] }}</div>
                      </td>
                    </tr>
                  @endforeach
                </table>
              @endisset

              @isset($quote)
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;"><tr>
                  <td style="border-left:3px solid {{ $LINE }};padding:2px 0 2px 14px;font-size:15px;line-height:22px;color:#374151;">{!! $quote !!}</td>
                </tr></table>
              @endisset

              @isset($code)
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr>
                  <td align="center" style="background:rgba(0,0,0,0.04);border-radius:16px;padding:16px 20px;font-size:26px;line-height:32px;font-weight:700;letter-spacing:.24em;color:{{ $INK }};">{{ $code }}</td>
                </tr></table>
              @endisset

              @isset($button)
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;"><tr>
                  <td align="center" bgcolor="#000000" style="background:#000000;border-radius:16px;">
                    <a href="{{ $button['url'] }}" style="display:block;padding:14px 24px;font-size:17px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;">{{ $button['label'] }}</a>
                  </td>
                </tr></table>
              @endisset

              @if ($help)
                <p style="margin:20px 0 0;font-size:13px;line-height:18px;color:{{ $MUTED }};">
                  Trouble with the button? Copy and paste this link into your browser:
                  <a href="{{ $helpUrl }}" style="color:{{ $BLUE }};text-decoration:none;">{{ $helpUrl }}</a>
                </p>
              @endif

              @isset($footNote)
                <p style="margin:12px 0 0;font-size:13px;line-height:18px;color:{{ $MUTED }};">{!! $footNote !!}</p>
              @endisset

              {{-- Footer --}}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:32px 0 0;border-top:1px solid {{ $LINE }};">
                <tr><td align="center" style="padding:24px 0 0;">
                  <img src="{{ url('/images/brand/tma/tma-logo-horizontal.png') }}" alt="TM ANTOINE Advisory" height="40" style="display:block;height:40px;width:auto;margin:0 auto 16px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
                    <td style="padding:0 8px;font-size:13px;line-height:18px;color:{{ $MUTED }};vertical-align:middle;">
                      <a href="mailto:support@tmantoine.com" style="color:{{ $BLUE }};text-decoration:none;">support@tmantoine.com</a>
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
      </td>
    </tr>
  </table>
</body>
</html>
