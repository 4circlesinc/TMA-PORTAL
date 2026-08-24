{{--
  One conversation, in its own window.

  Opened by double-clicking a row (or the row menu's "Open in new window") in
  both the browser and the desktop app. Everything on this page is rendered
  server-side: the whole reason it exists is that the mail should be readable
  the instant the window appears, so there is no boot, no fetch and no spinner.

  Message bodies are attacker-controlled, so each one renders inside a
  sandboxed, script-free iframe, the same rule the reading pane follows.
--}}
@php
  /** Address arrays are stored as [{name, email}]; render them the way a mail client does. */
  $addresses = static function (?array $list): string {
      return collect($list ?? [])
          ->map(function ($a) {
              if (is_string($a)) {
                  return $a;
              }
              $name = trim((string) ($a['name'] ?? ''));
              $email = trim((string) ($a['email'] ?? ''));
              if ($email === '') {
                  return $name;
              }

              return $name !== '' && $name !== $email ? $name.' <'.$email.'>' : $email;
          })
          ->filter()
          ->implode(', ');
  };

  /**
   * The frame document for one body. :where() keeps the resets at zero
   * specificity so the sender's own styling still wins.
   */
  $frame = static function (string $html): string {
      return '<!doctype html><html><head><meta charset="utf-8">'
          .'<meta name="referrer" content="no-referrer"><style>'
          .':where(html){margin:0;padding:0;}'
          .':where(body){margin:0;padding:20px 24px;box-sizing:border-box;'
          .'font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.5;'
          .'color:#1c1c1c;word-wrap:break-word;overflow-wrap:anywhere;}'
          .':where(img){max-width:100%;height:auto;}'
          .'</style></head><body>'.$html.'</body></html>';
  };
@endphp
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>{{ $subject }}</title>
  <link rel="icon" href="/images/logo/favicon.svg">
  <link rel="stylesheet" href="/css/tokens.css">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--color-bg-page, #f5f7fa);
      color: var(--color-text-primary, #1c1c1c);
      font-family: Inter, system-ui, -apple-system, sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }
    .mw { max-width: 900px; margin: 0 auto; padding: 24px 20px 48px; }
    .mw__bar {
      position: sticky; top: 0; z-index: 2;
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 12px 20px;
      background: var(--color-white, #fff);
      border-bottom: 1px solid var(--color-overlay-4, rgba(0, 0, 0, 0.06));
    }
    .mw__bar-title {
      flex: 1 1 240px; min-width: 0;
      font-size: 15px; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .mw__btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px;
      border: 1px solid var(--color-overlay-8, rgba(0, 0, 0, 0.1));
      border-radius: var(--radius-8, 8px);
      background: var(--color-white, #fff);
      color: inherit; font: inherit; font-size: 13px;
      text-decoration: none; cursor: pointer;
    }
    .mw__btn:hover { background: var(--color-hover, rgba(0, 0, 0, 0.04)); }
    .mw__btn--primary {
      background: var(--color-primary, #03a5e9);
      border-color: transparent; color: #fff;
    }
    .mw__btn--primary:hover { background: var(--color-primary-dark, #0288c2); }
    .mw__head { margin: 24px 0 16px; }
    .mw__subject { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; }
    .mw__count { margin: 4px 0 0; font-size: 12px; color: var(--color-text-secondary, #666); }
    .mw__msg {
      background: var(--color-white, #fff);
      border: 1px solid var(--color-overlay-4, rgba(0, 0, 0, 0.06));
      border-radius: var(--radius-12, 12px);
      margin-bottom: 16px;
      overflow: hidden;
    }
    .mw__msg-head {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 16px 20px 12px;
    }
    .mw__avatar {
      flex: 0 0 40px; width: 40px; height: 40px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--color-hover, rgba(0, 0, 0, 0.06));
      font-weight: 600; font-size: 15px; overflow: hidden;
    }
    .mw__avatar img { width: 100%; height: 100%; object-fit: cover; }
    .mw__who { flex: 1 1 auto; min-width: 0; }
    .mw__name { font-weight: 600; }
    .mw__from { font-size: 12px; color: var(--color-text-secondary, #666); }
    .mw__date { flex: 0 0 auto; font-size: 12px; color: var(--color-text-secondary, #666); }
    .mw__fields {
      margin: 0; padding: 0 20px 12px;
      display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px;
      font-size: 12px; color: var(--color-text-secondary, #666);
    }
    .mw__fields dt { font-weight: 600; text-transform: lowercase; }
    .mw__fields dd { margin: 0; word-break: break-word; }
    .mw__body { width: 100%; border: 0; display: block; background: #fff; }
    .mw__plain {
      margin: 0; padding: 16px 24px 20px;
      font: inherit; white-space: pre-wrap; word-break: break-word;
    }
    .mw__files {
      display: flex; flex-wrap: wrap; gap: 8px;
      padding: 12px 20px 16px;
      border-top: 1px solid var(--color-overlay-4, rgba(0, 0, 0, 0.06));
    }
    .mw__file {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 10px;
      border: 1px solid var(--color-overlay-8, rgba(0, 0, 0, 0.1));
      border-radius: var(--radius-8, 8px);
      font-size: 12px; color: inherit; text-decoration: none;
    }
    .mw__file:hover { background: var(--color-hover, rgba(0, 0, 0, 0.04)); }
    @media print {
      .mw__bar { display: none; }
      .mw__msg { border: 0; }
    }
  </style>
</head>
<body>
  <div class="mw__bar">
    <span class="mw__bar-title">{{ $subject }}</span>
    <a class="mw__btn mw__btn--primary" href="/email?message={{ $opened->uuid }}&amp;compose=reply">Reply</a>
    <a class="mw__btn" href="/email?message={{ $opened->uuid }}&amp;compose=reply-all">Reply all</a>
    <a class="mw__btn" href="/email?message={{ $opened->uuid }}&amp;compose=forward">Forward</a>
    <button type="button" class="mw__btn" onclick="window.print()">Print</button>
    <a class="mw__btn" href="/email?message={{ $opened->uuid }}">Open in mailbox</a>
  </div>

  <div class="mw">
    <div class="mw__head">
      <h1 class="mw__subject">{{ $subject }}</h1>
      @if($messages->count() > 1)
        <p class="mw__count">{{ $messages->count() }} messages in this conversation</p>
      @endif
    </div>

    @foreach($messages as $m)
      @php
        $name = $m->from_name ?: $m->from_email;
        $to = $addresses($m->to);
        $cc = $addresses($m->cc);
        $bcc = $addresses($m->bcc);
      @endphp
      <article class="mw__msg">
        <div class="mw__msg-head">
          <span class="mw__avatar">{{ mb_strtoupper(mb_substr($name ?: '?', 0, 1)) }}</span>
          <span class="mw__who">
            <span class="mw__name">{{ $name }}</span>
            <span class="mw__from">&lt;{{ $m->from_email }}&gt;</span>
          </span>
          <time class="mw__date">{{ $m->sent_at?->format('M j, Y, g:i A') }}</time>
        </div>

        <dl class="mw__fields">
          <dt>to:</dt><dd>{{ $to !== '' ? $to : '-' }}</dd>
          @if($cc !== '')<dt>cc:</dt><dd>{{ $cc }}</dd>@endif
          @if($bcc !== '')<dt>bcc:</dt><dd>{{ $bcc }}</dd>@endif
          <dt>subject:</dt><dd>{{ $m->subject ?: '(no subject)' }}</dd>
        </dl>

        @if($m->body_html)
          <iframe class="mw__body" title="Message content" sandbox="allow-same-origin"
                  referrerpolicy="no-referrer" onload="tmaFitFrame(this)"
                  srcdoc="{{ $frame($m->body_html) }}"></iframe>
        @else
          <pre class="mw__plain">{{ $m->body_text ?: $m->snippet }}</pre>
        @endif

        @if($m->attachments->isNotEmpty())
          <div class="mw__files">
            @foreach($m->attachments as $a)
              {{-- No ?inline, the plain attachment URL downloads, which is
                   what a paperclip in a read-only window should do. --}}
              <a class="mw__file" href="/portal/mail/attachments/{{ $a->uuid }}">
                <img src="/images/icons/phosphor/PaperclipHorizontal.svg" alt="" width="14" height="14">
                <span>{{ $a->filename }}</span>
              </a>
            @endforeach
          </div>
        @endif
      </article>
    @endforeach
  </div>

  <script>
    @if(request()->boolean('print'))
      /* Opened from the message menu's Print: the point of this window is to
         be the printable version, so it goes straight to the dialog once the
         bodies have been measured. */
      window.addEventListener('load', function () { window.setTimeout(function () { window.print(); }, 600); });
    @endif

    /* Grow each frame to its content so the window scrolls once, not twice. */
    function tmaFitFrame(frame) {
      try {
        var doc = frame.contentDocument;
        if (!doc) return;
        var fit = function () {
          frame.style.height = Math.max(
            doc.body ? doc.body.scrollHeight : 0,
            doc.documentElement ? doc.documentElement.scrollHeight : 0,
            80
          ) + 'px';
        };
        fit();
        // Late-loading images change the height after the first measurement.
        if (window.ResizeObserver && doc.body) new ResizeObserver(fit).observe(doc.body);
        window.setTimeout(fit, 400);
      } catch (e) { /* a frame we cannot measure keeps its default height */ }
    }
  </script>
</body>
</html>
