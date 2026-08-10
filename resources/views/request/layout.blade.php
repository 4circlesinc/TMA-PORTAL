{{--
  The chrome a stranger sees when they open an upload link.

  Deliberately its own layout rather than the portal shell: nobody here has an
  account, so loading the shell's fifty scripts to draw one drop zone would be
  slow, would fail half its requests, and would put the workspace's navigation
  in front of somebody who has no access to any of it. It mirrors the share
  layout's palette so the two public pages read as the same firm.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>@yield('title', 'Upload files') — TM ANTOINE Advisory</title>
  <link rel="icon" type="image/png" href="/images/brand/tma/favicon.png">
  <style>
    :root {
      --ink:#0f1115; --muted:#6b7280; --line:#e6e8ec; --bg:#f6f7f9;
      --brand:#136da0; --brand-soft:#e8f1f7; --ok:#1b7a52; --ok-soft:#e6f4ee;
      --err:#b3261e; --err-soft:#fdecea;
    }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, system-ui, -apple-system, sans-serif; color:var(--ink); background:var(--bg); }
    .wrap { max-width: 640px; margin: 0 auto; padding: 8px 20px 64px; }
    .top { display:flex; align-items:center; gap:12px; padding: 20px 0; }
    .top img { height: 28px; }
    .card { background:#fff; border:1px solid var(--line); border-radius:14px; overflow:hidden; }
    .card__head { padding:20px; border-bottom:1px solid var(--line); }
    .eyebrow { font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--brand); margin:0 0 8px; }
    .card__title { font-size:20px; font-weight:700; margin:0; word-break:break-word; }
    .card__from { font-size:13px; color:var(--muted); margin:6px 0 0; }
    .card__body { padding:20px; }
    .note { background:var(--bg); border-radius:10px; padding:14px 16px; font-size:14px; line-height:21px; color:#374151; margin:0 0 20px; white-space:pre-wrap; }
    .rules { list-style:none; margin:0 0 20px; padding:0; font-size:13px; color:var(--muted); }
    .rules li { display:flex; gap:8px; padding:4px 0; }
    .rules li::before { content:"•"; color:var(--brand); }
    .drop {
      border:2px dashed var(--line); border-radius:12px; padding:32px 20px; text-align:center;
      background:#fff; transition:border-color .15s, background .15s; cursor:pointer;
    }
    .drop:hover, .drop.is-over { border-color:var(--brand); background:var(--brand-soft); }
    .drop__title { font-size:15px; font-weight:600; margin:0 0 4px; }
    .drop__hint { font-size:13px; color:var(--muted); margin:0; }
    .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:10px 18px; border-radius:10px; border:0; background:var(--brand); color:#fff; font:inherit; font-weight:600; font-size:14px; text-decoration:none; cursor:pointer; }
    .btn[disabled] { opacity:.5; cursor:default; }
    .btn--ghost { background:#fff; color:var(--ink); border:1px solid var(--line); }
    .field { margin:0 0 14px; }
    .field label { display:block; font-size:13px; font-weight:600; margin:0 0 6px; }
    input[type=text], input[type=email], input[type=password] {
      width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px; font:inherit; background:#fff; color:var(--ink);
    }
    .row { display:flex; gap:12px; }
    .row > * { flex:1; min-width:0; }
    .queue { list-style:none; margin:20px 0 0; padding:0; }
    .queue li { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); font-size:14px; }
    .queue li:last-child { border-bottom:0; }
    .queue .name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .queue .state { font-size:12px; font-weight:600; padding:3px 9px; border-radius:999px; background:var(--bg); color:var(--muted); flex:0 0 auto; }
    .queue .state.is-done { background:var(--ok-soft); color:var(--ok); }
    .queue .state.is-error { background:var(--err-soft); color:var(--err); }
    .banner { border-radius:10px; padding:12px 14px; font-size:14px; margin:0 0 16px; }
    .banner--ok { background:var(--ok-soft); color:var(--ok); }
    .banner--err { background:var(--err-soft); color:var(--err); }
    .foot { text-align:center; color:var(--muted); font-size:12px; margin-top:24px; line-height:19px; }
    .err { color:var(--err); font-size:13px; margin-top:8px; }
    .empty { text-align:center; color:var(--muted); padding:40px 20px; }
    @media (max-width: 520px) { .row { flex-direction:column; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <img src="/images/brand/tma/tma-logo-horizontal.png" alt="TM ANTOINE Advisory" onerror="this.style.display='none'">
    </div>
    @yield('content')
    <p class="foot">
      Uploaded over an encrypted connection to TM ANTOINE Advisory.<br>
      This link only accepts files — it gives no access to anything else.
    </p>
  </div>
</body>
</html>
