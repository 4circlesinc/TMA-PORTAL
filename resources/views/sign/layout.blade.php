{{-- Standalone: this page is for people with no portal account, so it shares
     nothing with the dashboard shell and links nowhere into it. --}}
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>@yield('title', 'Sign document') | TM ANTOINE Advisory</title>
  <link rel="icon" type="image/png" href="/images/brand/tma/favicon.png">
  <style>
    /* The signing page can't load the portal shell (no account, no session),
       so the design system's values are restated here rather than guessed at.
       These are copies of public/css/tokens.css - keep them in step. */
    :root {
      --ink:#000000;
      --muted:rgba(0,0,0,0.40);
      --line:rgba(0,0,0,0.10);
      --line-strong:rgba(0,0,0,0.20);
      --bg:#f5f5f7;
      --card:#f9f9fa;
      --hover:rgba(0,0,0,0.04);
      --hover-deep:rgba(0,0,0,0.08);
      --brand:#136da0;          /* --color-primary-dark */
      --brand-bright:#03a5e9;   /* --color-primary */
      --danger:#ff4747;         /* --color-red */
      --ok:#71dd8c;             /* --color-green */
      --ok-ink:#0f7b3f;         /* readable text on white; --color-green is a fill */
      --radius:12px;
      --shadow-popup:0 8px 28px rgba(0,0,0,0.10);
    }
    * { box-sizing: border-box; }
    body {
      margin:0;
      font-family: Inter, system-ui, sans-serif;
      font-feature-settings: "ss01" 1, "cv01" 1;
      color:var(--ink); background:var(--bg);
    }
    .top { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 20px; background:#fff; border-bottom:1px solid var(--line); }
    .top img { height:26px; }
    .top__doc { font-size:13px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .wrap { max-width: 920px; margin:0 auto; padding: 8px 20px 64px; }
    .card { background:#fff; border:1px solid var(--line); border-radius:var(--radius); }
    /* The portal's primary button: black pill, white label. */
    .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:36px; padding:8px 18px; border-radius:999px; border:0; background:var(--ink); color:#fff; font:inherit; font-weight:600; font-size:13px; text-decoration:none; cursor:pointer; transition:filter .15s ease, background .15s ease; }
    .btn:hover:not(:disabled) { filter:brightness(1.35); }
    .btn:disabled { opacity:.4; cursor:not-allowed; }
    .btn--ghost { background:var(--hover); color:var(--ink); }
    .btn--ghost:hover:not(:disabled) { filter:none; background:var(--hover-deep); }
    .btn--link { background:none; border:0; color:var(--muted); padding:10px 4px; cursor:pointer; font:inherit; font-size:13px; border-radius:999px; }
    .btn--link:hover { color:var(--ink); }
    :focus-visible { outline:2px solid var(--brand-bright); outline-offset:2px; }
    .foot { text-align:center; color:var(--muted); font-size:12px; margin-top:24px; }
    .msg { border-left:3px solid var(--line); padding:2px 0 2px 14px; margin:0 0 18px; color:var(--ink); font-size:14px; line-height:22px; white-space:pre-wrap; }
    h1 { font-size:19px; line-height:26px; margin:0 0 6px; font-weight:600; }
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
