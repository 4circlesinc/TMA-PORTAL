<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Database — TM ANTOINE Advisory (dev)</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/theme.css">
  <script>(function(){try{var m=localStorage.getItem("tma.themeMode")||"",t=localStorage.getItem("tma.theme")||"",d=m?m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches):t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.setAttribute("data-theme","dark");}catch(e){}})();</script>
  <style>
    :root { --db-border: var(--color-border-soft); }
    [data-theme="dark"] {
      --color-bg-page: #161616; --color-bg-card: #1c1c1c; --color-white: #1c1c1c;
      --color-text-primary: rgba(255,255,255,.9); --color-text-secondary: rgba(255,255,255,.45);
      --db-border: rgba(255,255,255,.12); --color-hover: rgba(255,255,255,.06);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body { font-family: var(--font-family); background: var(--color-bg-page); color: var(--color-text-primary); font-size: var(--text-size-14); }
    .db { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
    .db__side { border-right: 0.5px solid var(--db-border); padding: var(--space-16); overflow-y: auto; }
    .db__brand { display: flex; align-items: center; gap: var(--space-8); margin-bottom: var(--space-16); }
    .db__brand img { height: 28px; width: auto; }
    .db__tag { font-size: var(--text-size-12); color: var(--color-text-secondary); border: 0.5px solid var(--db-border); border-radius: var(--radius-pill); padding: 0 var(--space-8); }
    .db__side-title { font-size: var(--text-size-12); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: .04em; margin: var(--space-8) 0; }
    .db__tlist { display: flex; flex-direction: column; gap: 2px; }
    .db__tlink { display: flex; align-items: center; justify-content: space-between; gap: var(--space-8); padding: var(--space-6) var(--space-10); border-radius: var(--radius-8); color: inherit; text-decoration: none; font-size: var(--text-size-14); }
    .db__tlink:hover { background: var(--color-hover); }
    .db__tlink.is-active { background: color-mix(in srgb, var(--color-primary) 14%, transparent); font-weight: var(--font-weight-semibold); }
    .db__tcount { font-size: var(--text-size-12); color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
    .db__main { padding: var(--space-24); min-width: 0; overflow-x: hidden; }
    .db__head { display: flex; align-items: baseline; gap: var(--space-12); margin-bottom: var(--space-16); flex-wrap: wrap; }
    .db__h1 { margin: 0; font-size: var(--text-size-24); font-weight: var(--font-weight-semibold); }
    .db__meta { font-size: var(--text-size-12); color: var(--color-text-secondary); }
    .db__scroll { overflow-x: auto; border: 0.5px solid var(--db-border); border-radius: var(--radius-12); }
    table.db__table { border-collapse: collapse; width: 100%; font-size: var(--text-size-12); line-height: var(--text-lh-12); white-space: nowrap; }
    .db__table th, .db__table td { padding: var(--space-8) var(--space-12); border-bottom: 0.5px solid var(--db-border); text-align: left; vertical-align: top; }
    .db__table th { position: sticky; top: 0; background: var(--color-bg-card); color: var(--color-text-secondary); font-weight: var(--font-weight-semibold); }
    .db__table td { font-family: "SF Mono", ui-monospace, Menlo, monospace; }
    .db__table tbody tr:hover { background: var(--color-hover); }
    .db__redacted { color: var(--color-text-secondary); font-style: italic; }
    .db__null { color: var(--color-text-placeholder); }
    .db__note { margin-top: var(--space-12); font-size: var(--text-size-12); color: var(--color-text-secondary); }
    .db__back { font-size: var(--text-size-12); color: var(--color-text-link); text-decoration: none; }
    @media (max-width: 720px) { .db { grid-template-columns: 1fr; } .db__side { border-right: 0; border-bottom: 0.5px solid var(--db-border); } }
  </style>
</head>
<body>
  <div class="db">
    <aside class="db__side">
      <div class="db__brand">
        <img src="/images/brand/tma/tma-logo-horizontal.png" alt="TM ANTOINE">
        <span class="db__tag">dev</span>
      </div>
      <a class="db__back" href="/">← Back to portal</a>
      <div class="db__side-title">Tables ({{ $tables->count() }})</div>
      <nav class="db__tlist">
        @foreach ($tables as $t)
          <a class="db__tlink {{ $t['name'] === $active ? 'is-active' : '' }}" href="?table={{ $t['name'] }}">
            <span>{{ $t['name'] }}</span>
            <span class="db__tcount">{{ number_format($t['count']) }}</span>
          </a>
        @endforeach
      </nav>
    </aside>

    <main class="db__main">
      @if ($active)
        <div class="db__head">
          <h1 class="db__h1">{{ $active }}</h1>
          <span class="db__meta">{{ number_format($total) }} rows · {{ count($columns) }} columns</span>
        </div>

        <div class="db__scroll">
          <table class="db__table">
            <thead>
              <tr>@foreach ($columns as $col)<th>{{ $col }}</th>@endforeach</tr>
            </thead>
            <tbody>
              @forelse ($rows as $row)
                <tr>
                  @foreach ($columns as $col)
                    @php $v = $row[$col] ?? '—'; @endphp
                    <td class="{{ $v === '—' ? 'db__null' : (str_contains($v, 'hidden') ? 'db__redacted' : '') }}">{{ $v }}</td>
                  @endforeach
                </tr>
              @empty
                <tr><td colspan="{{ max(1, count($columns)) }}" style="text-align:center;color:var(--color-text-secondary);padding:var(--space-24)">No rows</td></tr>
              @endforelse
            </tbody>
          </table>
        </div>

        @if ($total > $limit)
          <p class="db__note">Showing the first {{ $limit }} of {{ number_format($total) }} rows.</p>
        @endif
        <p class="db__note">Read-only viewer · secrets, tokens, and hashes are hidden · local development only.</p>
      @else
        <p>No tables found.</p>
      @endif
    </main>
  </div>
</body>
</html>
