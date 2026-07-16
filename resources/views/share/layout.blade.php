<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>@yield('title', 'Shared') — TM ANTOINE Advisory</title>
  <link rel="icon" type="image/png" href="/images/brand/tma/favicon.png">
  <style>
    :root { --ink:#0f1115; --muted:#6b7280; --line:#e6e8ec; --bg:#f6f7f9; --brand:#136da0; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, system-ui, -apple-system, sans-serif; color:var(--ink); background:var(--bg); }
    .wrap { max-width: 920px; margin: 0 auto; padding: 8px 20px 64px; }
    .top { display:flex; align-items:center; gap:12px; padding: 20px 0; }
    .top img { height: 28px; }
    .card { background:#fff; border:1px solid var(--line); border-radius:14px; overflow:hidden; }
    .card__head { display:flex; align-items:center; gap:14px; padding:18px 20px; border-bottom:1px solid var(--line); }
    .card__head .ico { width:36px; height:36px; flex:0 0 36px; }
    .card__title { font-size:16px; font-weight:700; word-break:break-word; }
    .card__meta { font-size:13px; color:var(--muted); margin-top:2px; }
    .card__body { padding:20px; }
    .btn { display:inline-flex; align-items:center; gap:8px; padding:9px 16px; border-radius:10px; border:0; background:var(--brand); color:#fff; font:inherit; font-weight:600; font-size:14px; text-decoration:none; cursor:pointer; }
    .btn--ghost { background:#fff; color:var(--ink); border:1px solid var(--line); }
    .preview { display:flex; align-items:center; justify-content:center; background:#0d0f13; border-radius:10px; overflow:hidden; min-height:200px; }
    .preview img, .preview video { max-width:100%; max-height:70vh; display:block; }
    .preview iframe { width:100%; height:72vh; border:0; background:#fff; }
    .list { list-style:none; margin:0; padding:0; }
    .list li { display:flex; align-items:center; gap:12px; padding:12px 4px; border-bottom:1px solid var(--line); }
    .list li:last-child { border-bottom:0; }
    .list .name { word-break:break-word; }
    .list a { color:var(--brand); text-decoration:none; font-weight:600; font-size:13px; }
    .empty { text-align:center; color:var(--muted); padding:40px 20px; }
    .foot { text-align:center; color:var(--muted); font-size:12px; margin-top:24px; }
    input[type=password]{ width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px; font:inherit; }
    .err { color:#d1242f; font-size:13px; margin-top:8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <img src="/images/brand/tma/tma-logo-horizontal.png" alt="TM ANTOINE Advisory" onerror="this.style.display='none'">
    </div>
    @yield('content')
    <p class="foot">Shared securely via TM ANTOINE Advisory</p>
  </div>
</body>
</html>
