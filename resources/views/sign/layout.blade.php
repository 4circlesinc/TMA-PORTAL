{{-- Standalone: this page is for people with no portal account, so it shares
     nothing with the dashboard shell and links nowhere into it. --}}
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>@yield('title', 'Sign document') — TM ANTOINE Advisory</title>
  <link rel="icon" type="image/png" href="/images/brand/tma/favicon.png">
  <style>
    :root {
      --ink:#0f1115; --muted:#6b7280; --line:#e6e8ec; --bg:#f6f7f9;
      --brand:#136da0; --danger:#d1242f; --ok:#0f7b3f;
    }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; color:var(--ink); background:var(--bg); }
    .top { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 20px; background:#fff; border-bottom:1px solid var(--line); }
    .top img { height:26px; }
    .top__doc { font-size:13px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .wrap { max-width: 920px; margin:0 auto; padding: 8px 20px 64px; }
    .card { background:#fff; border:1px solid var(--line); border-radius:14px; }
    .btn { display:inline-flex; align-items:center; gap:8px; padding:10px 18px; border-radius:10px; border:0; background:var(--brand); color:#fff; font:inherit; font-weight:600; font-size:14px; text-decoration:none; cursor:pointer; }
    .btn:disabled { opacity:.5; cursor:not-allowed; }
    .btn--ghost { background:#fff; color:var(--ink); border:1px solid var(--line); }
    .btn--link { background:none; border:0; color:var(--muted); text-decoration:underline; padding:10px 4px; cursor:pointer; font:inherit; font-size:13px; }
    .foot { text-align:center; color:var(--muted); font-size:12px; margin-top:24px; }
    .msg { border-left:3px solid var(--line); padding:2px 0 2px 14px; margin:0 0 18px; color:#374151; font-size:14px; line-height:22px; white-space:pre-wrap; }
    h1 { font-size:18px; line-height:26px; margin:0 0 6px; }
    p.sub { color:var(--muted); font-size:14px; line-height:22px; margin:0; }
    @yield('style')
  </style>
</head>
<body>
  <div class="top">
    <img src="/images/brand/tma/tma-logo-horizontal.png" alt="TM ANTOINE Advisory" onerror="this.style.display='none'">
    <span class="top__doc">@yield('doc')</span>
  </div>
  @yield('body')
</body>
</html>
