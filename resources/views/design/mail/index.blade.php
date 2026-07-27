<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email postcards · TM ANTOINE Advisory</title>
  <style>
    :root {
      --bg: #f6f7f9; --panel: #ffffff; --line: #e6e8ec; --ink: #0f1115;
      --muted: #6b7280; --accent: #136da0; --accent-soft: #eaf3f8;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg); }
    .wrap { display: grid; grid-template-columns: 288px 1fr; min-height: 100vh; }

    .side { border-right: 1px solid var(--line); background: var(--panel); padding: 20px 0; overflow-y: auto; height: 100vh; position: sticky; top: 0; }
    .side__head { padding: 0 20px 16px; border-bottom: 1px solid var(--line); margin-bottom: 8px; }
    .side__title { font-size: 15px; font-weight: 700; margin: 0; }
    .side__sub { font-size: 12px; color: var(--muted); margin: 4px 0 0; line-height: 17px; }
    .grp { padding: 12px 0 4px; }
    .grp__label { font-size: 11px; letter-spacing: .07em; text-transform: uppercase; font-weight: 700; color: var(--muted); padding: 0 20px 6px; }
    .item { display: flex; align-items: center; gap: 8px; padding: 9px 20px; font-size: 13.5px; color: #374151; text-decoration: none; border-left: 3px solid transparent; }
    .item:hover { background: #f9fafb; }
    .item.is-active { background: var(--accent-soft); border-left-color: var(--accent); color: var(--accent); font-weight: 600; }
    .item__dot { width: 6px; height: 6px; border-radius: 50%; background: #cbd2d9; flex: none; }
    .item.is-active .item__dot { background: var(--accent); }

    .main { padding: 24px 28px; }
    .bar { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
    .bar__label { font-size: 18px; font-weight: 700; margin: 0; }
    .bar__slug { font-size: 12px; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .subject { font-size: 13px; color: var(--muted); margin: 2px 0 18px; }
    .subject b { color: #374151; font-weight: 600; }

    .stage { background: var(--bg); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
    .stage__chrome { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--panel); }
    .stage__dot { width: 10px; height: 10px; border-radius: 50%; background: #e0e3e8; }
    .stage__url { margin-left: 8px; font-size: 12px; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .stage__actions { margin-left: auto; }
    .stage__open { font-size: 12px; color: var(--accent); text-decoration: none; font-weight: 600; }
    iframe { width: 100%; height: calc(100vh - 200px); min-height: 560px; border: 0; display: block; background: #f6f7f9; }

    @media (max-width: 820px) { .wrap { grid-template-columns: 1fr; } .side { position: static; height: auto; } }
  </style>
</head>
<body>
  <div class="wrap">
    <aside class="side">
      <div class="side__head">
        <p class="side__title">Email postcards</p>
        <p class="side__sub">Every transactional email the portal sends, rendered from sample data. Review each and approve — nothing here is live.</p>
      </div>
      @foreach ($groups as $group)
        <div class="grp">
          <div class="grp__label">{!! $group['label'] !!}</div>
          @foreach ($group['items'] as $slug => $entry)
            <a class="item {{ $slug === $current ? 'is-active' : '' }}" href="{{ url('/design/mail/'.$slug) }}">
              <span class="item__dot"></span>{{ $entry['label'] }}
            </a>
          @endforeach
        </div>
      @endforeach
    </aside>

    <main class="main">
      @if ($currentEntry)
        <div class="bar">
          <h1 class="bar__label">{{ $currentEntry['label'] }}</h1>
          <span class="bar__slug">{{ $current }}</span>
        </div>
        <p class="subject">Subject line: <b>{{ $currentEntry['subject'] }}</b></p>

        <div class="stage">
          <div class="stage__chrome">
            <span class="stage__dot"></span><span class="stage__dot"></span><span class="stage__dot"></span>
            <span class="stage__url">inbox — {{ $currentEntry['subject'] }}</span>
            <span class="stage__actions">
              <a class="stage__open" href="{{ url('/design/mail/'.$current.'/raw') }}" target="_blank" rel="noopener">Open full ↗</a>
            </span>
          </div>
          <iframe src="{{ url('/design/mail/'.$current.'/raw') }}" title="{{ $currentEntry['label'] }} preview"></iframe>
        </div>
      @else
        <p>No postcard selected.</p>
      @endif
    </main>
  </div>
</body>
</html>
