{{-- Mirrors mail/signatures/layout: plain, inlined styles, because mail
     clients don't honour stylesheets and this has to survive Outlook as well
     as it renders in Gmail. --}}
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>@yield('title', 'Calendar')</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f1115;">
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
  </div>
</body>
</html>
