{{-- Shared master layout for every transactional "postcard" the portal sends.
     Plain, inlined styles: mail clients don't honour stylesheets, and this has
     to survive Outlook as well as it renders in Gmail. The existing
     mail/signatures and mail/calendar layouts predate this and mirror it. --}}
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>@yield('title', 'TM ANTOINE Advisory')</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f1115;-webkit-font-smoothing:antialiased;">
  {{-- Hidden preheader: the grey preview line inboxes show next to the subject. --}}
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
    @yield('preheader', '')
    {{-- Padding entities stop the client from spilling body text into the preview. --}}
    &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="padding-bottom:20px;">
      <img src="{{ url('/images/brand/tma/tma-logo-horizontal.png') }}" alt="TM ANTOINE Advisory" height="26" style="height:26px;">
    </div>

    <div style="background:#ffffff;border:1px solid #e6e8ec;border-radius:14px;padding:28px;">
      @yield('content')
    </div>

    <p style="color:#6b7280;font-size:12px;line-height:18px;margin:20px 0 0;text-align:center;">
      @yield('foot', 'Sent securely via TM ANTOINE Advisory.')
    </p>
    <p style="color:#9ca3af;font-size:11px;line-height:16px;margin:8px 0 0;text-align:center;">
      TM ANTOINE Advisory · This message was sent to you because you have an account or file with our firm.
    </p>
  </div>
</body>
</html>
