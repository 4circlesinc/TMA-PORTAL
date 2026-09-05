{{--
  One conversation, in its own window.

  Opened by double-clicking a row (or the row menu's "Open in new window") in
  both the browser and the desktop app. Everything on this page is rendered
  server-side: the whole reason it exists is that the mail should be readable
  the instant the window appears, so there is no boot, no fetch and no spinner.

  Chrome matches the inbox reading pane (subject bar, message head, footer
  Reply / Reply all / Forward). Message bodies are attacker-controlled, so
  each one still renders inside a sandboxed, script-free iframe.
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

  $addressLabel = static function (mixed $a): string {
      if (is_string($a)) {
          return $a;
      }
      if (! is_array($a)) {
          return '';
      }
      $name = trim((string) ($a['name'] ?? ''));
      $email = trim((string) ($a['email'] ?? ''));

      return $name !== '' ? $name : $email;
  };

  $toShort = static function (?array $list) use ($addressLabel): string {
      $items = collect($list ?? [])->filter();
      if ($items->isEmpty()) {
          return 'me';
      }
      $first = $addressLabel($items->first());
      $extra = $items->count() - 1;
      if ($extra > 0) {
          return $first.' and '.$extra.' other'.($extra === 1 ? '' : 's');
      }

      return $first !== '' ? $first : 'me';
  };

  /**
   * The frame document for one body. :where() keeps the resets at zero
   * specificity so the sender's own styling still wins.
   */
  $frame = static function (string $html): string {
      return '<!doctype html><html><head><meta charset="utf-8">'
          .'<meta name="referrer" content="no-referrer"><style>'
          .':where(html){margin:0;padding:0;}'
          .':where(body){margin:0;padding:20px 24px 12px;box-sizing:border-box;'
          .'font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.5;'
          .'color:#1c1c1c;background:#fff;word-wrap:break-word;overflow-wrap:anywhere;}'
          .':where(img){max-width:100%;height:auto;}'
          .'</style></head><body>'.$html.'</body></html>';
  };

  $icon = static fn (string $name): string => '/images/icons/phosphor/'.$name.'.svg';
  $composeUrl = static fn (string $uuid, string $mode): string => '/email?message='.urlencode($uuid).'&compose='.$mode;
  $lastId = $messages->last()?->id;
@endphp
<!doctype html>
<html lang="en" class="tma-dash tma-dash--email tma-dash--mail-window">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>{{ $subject }}</title>
  <link rel="icon" type="image/png" href="/images/brand/tma/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/theme.css">
  <link rel="stylesheet" href="/css/dashboard.css?v=289">
</head>
<body>
  <div class="tma-dash__email-detail tma-dash__email-detail--window" data-mail-window>
    <div class="tma-dash__email-detail-subject-bar">
      <div class="tma-dash__email-detail-subject">
        <span class="tma-dash__email-detail-subject-text">{{ $subject }}</span>
        <span class="tma-dash__email-detail-subject-trailing">
          <button type="button" class="tma-dash__email-action" title="Print" aria-label="Print" onclick="window.print()">
            <img src="{{ $icon('Printer') }}" alt="">
          </button>
          <a class="tma-dash__email-action" href="/email?message={{ $opened->uuid }}" title="Open in mailbox" aria-label="Open in mailbox">
            <img src="{{ $icon('ArrowSquareOut') }}" alt="">
          </a>
        </span>
      </div>
    </div>

    <div class="tma-dash__email-detail-scroll">
      <div class="tma-dash__email-thread">
        @foreach($messages as $m)
          @php
            $name = $m->from_name ?: $m->from_email ?: '?';
            $fromEmail = (string) $m->from_email;
            $to = $addresses($m->to);
            $cc = $addresses($m->cc);
            $bcc = $addresses($m->bcc);
            $replyTo = is_string($m->reply_to) ? $m->reply_to : $addresses(is_array($m->reply_to) ? $m->reply_to : null);
            $metaDate = $m->sent_at?->format('M j, Y, g:i A') ?? '';
            $sentAt = $m->sent_at?->toIso8601String();
            $avatar = $avatars[$m->uuid] ?? null;
            $initials = mb_strtoupper(implode('', array_map(
                static fn (string $word) => mb_substr($word, 0, 1),
                array_slice(preg_split('/\s+/', $name) ?: ['?'], 0, 2)
            ))) ?: '?';
            $isCurrent = $m->id === $opened->id;
            $isPrior = $m->id !== $lastId;
            $msgSubject = $m->subject ?: '(no subject)';
            $inlineCount = $m->attachments->where('is_inline', true)->count();
            $fileCount = $m->attachments->count() - $inlineCount;
          @endphp
          <article class="tma-dash__email-message tma-dash__email-message--expanded{{ $isCurrent ? ' tma-dash__email-message--current' : '' }}{{ $isPrior ? ' tma-dash__email-message--prior' : '' }}">
            <div class="tma-dash__email-message-head-wrap">
              <div class="tma-dash__email-message-head">
                <div class="tma-dash__email-message-head-main">
                  <span class="tma-dash__email-message-avatar{{ $avatar ? '' : ' tma-dash__email-message-avatar--initial' }}" data-initials="{{ $initials }}">
                    @if($avatar)
                      <img src="{{ $avatar }}" alt=""
                           onerror="var s=this.closest('.tma-dash__email-message-avatar');s.classList.add('tma-dash__email-message-avatar--initial');s.textContent=s.getAttribute('data-initials')||'?';">
                    @else
                      {{ $initials }}
                    @endif
                  </span>
                  <div class="tma-dash__email-message-head-identity">
                    <div class="tma-dash__email-message-head-line">
                      <span class="tma-dash__email-message-head-name">{{ $name }}</span>
                    </div>
                    <div class="tma-dash__email-message-head-recipient">
                      <button type="button" class="tma-dash__email-message-head-to" data-email-header-details-toggle aria-expanded="false">
                        <span class="tma-dash__email-message-head-to-label">to {{ $toShort($m->to) }}</span>
                        <span class="tma-dash__email-message-head-to-caret-wrap" aria-hidden="true">
                          <img src="{{ $icon('CaretDown') }}" alt="" class="tma-dash__email-message-head-to-caret">
                        </span>
                      </button>
                      <div class="tma-dash__email-header-details" data-email-header-details-panel hidden>
                        <dl class="tma-dash__email-header-details-list">
                          <div class="tma-dash__email-header-details-row">
                            <dt>from:</dt>
                            <dd><strong>{{ $name }}</strong>@if($fromEmail !== '') &lt;{{ $fromEmail }}&gt;@endif</dd>
                          </div>
                          @if($replyTo !== '' && strcasecmp($replyTo, $fromEmail) !== 0)
                            <div class="tma-dash__email-header-details-row">
                              <dt>reply-to:</dt><dd>{{ $replyTo }}</dd>
                            </div>
                          @endif
                          <div class="tma-dash__email-header-details-row">
                            <dt>to:</dt><dd>{{ $to !== '' ? $to : $mailboxEmail }}</dd>
                          </div>
                          @if($cc !== '')
                            <div class="tma-dash__email-header-details-row">
                              <dt>cc:</dt><dd>{{ $cc }}</dd>
                            </div>
                          @endif
                          @if($bcc !== '')
                            <div class="tma-dash__email-header-details-row">
                              <dt>bcc:</dt><dd>{{ $bcc }}</dd>
                            </div>
                          @endif
                          @if($metaDate !== '')
                            <div class="tma-dash__email-header-details-row">
                              <dt>date:</dt><dd @if($sentAt) data-sent-at="{{ $sentAt }}" @endif>{{ $metaDate }}</dd>
                            </div>
                          @endif
                          <div class="tma-dash__email-header-details-row">
                            <dt>subject:</dt><dd>{{ $msgSubject }}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="tma-dash__email-message-head-side">
                  @if($sentAt)
                    <time class="tma-dash__email-detail-date" datetime="{{ $sentAt }}" data-sent-at="{{ $sentAt }}">{{ $metaDate }}</time>
                  @elseif($metaDate !== '')
                    <time class="tma-dash__email-detail-date">{{ $metaDate }}</time>
                  @endif
                  <div class="tma-dash__email-detail-actions">
                    <a class="tma-dash__email-action" href="{{ $composeUrl($m->uuid, 'reply') }}" title="Reply" aria-label="Reply">
                      <img src="{{ $icon('ArrowBendUpLeft') }}" alt="">
                    </a>
                    <a class="tma-dash__email-action" href="{{ $composeUrl($m->uuid, 'reply-all') }}" title="Reply all" aria-label="Reply all">
                      <img src="{{ $icon('ArrowBendDoubleUpLeft') }}" alt="">
                    </a>
                    <a class="tma-dash__email-action" href="{{ $composeUrl($m->uuid, 'forward') }}" title="Forward" aria-label="Forward">
                      <img src="{{ $icon('ArrowBendUpRight') }}" alt="">
                    </a>
                  </div>
                </div>
              </div>
            </div>

            @if($m->body_html)
              <div class="tma-dash__email-body tma-dash__email-body--html">
                <iframe class="tma-dash__email-body-frame" title="Message content" sandbox="allow-same-origin"
                        referrerpolicy="no-referrer" onload="tmaFitFrame(this)"
                        srcdoc="{{ $frame($m->body_html) }}"></iframe>
              </div>
            @else
              <div class="tma-dash__email-body">
                <pre class="tma-dash__email-body-plain">{{ $m->body_text ?: $m->snippet }}</pre>
              </div>
            @endif

            @if($m->attachments->isNotEmpty())
              @php
                $heading = $m->attachments->count().' attachment'.($m->attachments->count() === 1 ? '' : 's');
                if ($inlineCount && $fileCount) {
                    $heading = $fileCount.' attachment'.($fileCount === 1 ? '' : 's')
                        .' · '.$inlineCount.' embedded image'.($inlineCount === 1 ? '' : 's');
                } elseif ($inlineCount && ! $fileCount) {
                    $heading = $inlineCount.' embedded image'.($inlineCount === 1 ? '' : 's');
                }
              @endphp
              <div class="tma-dash__email-attachments">
                <div class="tma-dash__email-attachments-head">
                  <img src="{{ $icon('PaperclipHorizontal') }}" alt="" aria-hidden="true">
                  {{ $heading }}
                </div>
                <div class="tma-dash__email-attachments-list">
                  @foreach($m->attachments as $a)
                    @php
                      $mime = (string) $a->mime_type;
                      $isImage = in_array($mime, ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], true);
                    @endphp
                    <a class="tma-dash__email-attachment-tile{{ $isImage ? '' : ' tma-dash__email-attachment-tile--icon' }}"
                       href="/portal/mail/attachments/{{ $a->uuid }}">
                      <div class="tma-dash__email-attachment-tile-preview">
                        @if($isImage)
                          <img src="/portal/mail/attachments/{{ $a->uuid }}?inline=1" alt="" loading="lazy">
                        @else
                          <img class="tma-dash__email-attachment-tile-icon-img" src="{{ $icon('Paperclip') }}" alt="">
                        @endif
                      </div>
                      <div class="tma-dash__email-attachment-tile-bar">
                        <img class="tma-dash__email-attachment-tile-bar-icon" src="{{ $icon('Paperclip') }}" alt="">
                        <span class="tma-dash__email-attachment-tile-name" title="{{ $a->filename }}">{{ $a->filename }}</span>
                      </div>
                    </a>
                  @endforeach
                </div>
              </div>
            @endif
          </article>
        @endforeach
      </div>
    </div>

    <div class="tma-dash__email-detail-footer">
      <div class="tma-dash__email-thread-actions">
        <div class="tma-dash__email-thread-btns">
          <a class="tma-dash__email-thread-btn" href="{{ $composeUrl($opened->uuid, 'reply') }}">
            <img src="{{ $icon('ArrowBendUpLeft') }}" alt=""> Reply
          </a>
          <a class="tma-dash__email-thread-btn" href="{{ $composeUrl($opened->uuid, 'reply-all') }}">
            <img src="{{ $icon('ArrowBendDoubleUpLeft') }}" alt=""> Reply all
          </a>
          <a class="tma-dash__email-thread-btn" href="{{ $composeUrl($opened->uuid, 'forward') }}">
            <img src="{{ $icon('ArrowBendUpRight') }}" alt=""> Forward
          </a>
        </div>
      </div>
    </div>
  </div>

  <script>
    @if(request()->boolean('print'))
      /* Opened from the message menu's Print: the point of this window is to
         be the printable version, so it goes straight to the dialog once the
         bodies have been measured. */
      window.addEventListener('load', function () { window.setTimeout(function () { window.print(); }, 600); });
    @endif

    document.querySelectorAll('[data-sent-at]').forEach(function (el) {
      var when = new Date(el.getAttribute('data-sent-at'));
      if (isNaN(when.getTime())) return;
      try {
        el.textContent = when.toLocaleString(undefined, {
          month: 'short', day: 'numeric', year: 'numeric',
          hour: 'numeric', minute: '2-digit'
        });
      } catch (e) { /* keep the server-rendered label */ }
    });

    function closeHeaderDetails(except) {
      document.querySelectorAll('[data-email-header-details-toggle]').forEach(function (btn) {
        if (btn === except) return;
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('tma-dash__email-message-head-to--open');
        var wrap = btn.closest('.tma-dash__email-message-head-recipient');
        var panel = wrap && wrap.querySelector('[data-email-header-details-panel]');
        if (!panel) return;
        panel.hidden = true;
        panel.style.top = '';
        panel.style.left = '';
      });
    }

    function positionHeaderDetails(anchor, menu) {
      var rect = anchor.getBoundingClientRect();
      menu.hidden = false;
      menu.style.right = 'auto';
      menu.style.bottom = 'auto';
      menu.style.top = '-9999px';
      menu.style.left = '-9999px';
      var menuRect = menu.getBoundingClientRect();
      var top = rect.bottom + 4;
      var left = rect.left;
      if (left + menuRect.width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - menuRect.width - 8);
      }
      if (top + menuRect.height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuRect.height - 4);
      }
      menu.style.top = Math.round(top) + 'px';
      menu.style.left = Math.round(left) + 'px';
    }

    document.addEventListener('click', function (event) {
      if (event.target.closest('[data-email-header-details-panel]')) return;
      var toggle = event.target.closest('[data-email-header-details-toggle]');
      closeHeaderDetails(toggle);
      if (!toggle) return;
      var wrap = toggle.closest('.tma-dash__email-message-head-recipient');
      var panel = wrap && wrap.querySelector('[data-email-header-details-panel]');
      if (!panel) return;
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      toggle.classList.toggle('tma-dash__email-message-head-to--open', !open);
      if (open) {
        panel.hidden = true;
        panel.style.top = '';
        panel.style.left = '';
        return;
      }
      positionHeaderDetails(toggle, panel);
    });

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
