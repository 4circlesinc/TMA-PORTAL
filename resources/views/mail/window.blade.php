{{--
  The opened message, in its own window.

  Opened by double-clicking a row (or the row menu's "Open in new window") in
  both the browser and the desktop app. Same as the inbox reading pane: this
  is the message that was clicked, not the rest of the thread. Everything is
  rendered server-side so the mail is readable the instant the window appears.

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
  $composeUrl = static fn (string $uuid, string $mode): string => '/email/compose?message='.urlencode($uuid).'&mode='.$mode;

  $mailboxAddr = strtolower(trim((string) ($mailboxEmail ?? '')));
  $isSelfAddress = static function (string $email) use ($mailboxAddr): bool {
      $email = strtolower(trim($email));

      return $email !== '' && $mailboxAddr !== '' && $email === $mailboxAddr;
  };
  $asAddress = static function (mixed $a): ?array {
      if (is_string($a)) {
          $email = trim($a);

          return $email !== '' ? ['name' => '', 'email' => $email] : null;
      }
      if (! is_array($a)) {
          return null;
      }
      $email = trim((string) ($a['email'] ?? ''));
      if ($email === '') {
          return null;
      }

      return ['name' => trim((string) ($a['name'] ?? '')), 'email' => $email];
  };
  $uniqueAddresses = static function (array $list) use ($asAddress, $isSelfAddress): array {
      $seen = [];
      $out = [];
      foreach ($list as $item) {
          $addr = $asAddress($item);
          if (! $addr || $isSelfAddress($addr['email'])) {
              continue;
          }
          $key = strtolower($addr['email']);
          if (isset($seen[$key])) {
              continue;
          }
          $seen[$key] = true;
          $out[] = $addr;
      }

      return $out;
  };
  $composeSubject = static function (?string $subject, string $mode): string {
      $trimmed = trim((string) $subject);
      if ($mode === 'forward') {
          return preg_match('/^(fwd?:|fw:)/i', $trimmed) ? $trimmed : 'Fwd: '.$trimmed;
      }

      return preg_match('/^re:/i', $trimmed) ? $trimmed : 'Re: '.$trimmed;
  };
  $composeFields = static function ($m, string $mode) use ($addresses, $composeUrl, $composeSubject, $isSelfAddress, $uniqueAddresses): array {
      $subject = $composeSubject($m->subject, $mode);
      if ($mode === 'forward') {
          return ['url' => $composeUrl($m->uuid, $mode), 'to' => '', 'cc' => '', 'subject' => $subject];
      }
      $replyTo = [];
      if (is_string($m->reply_to) && trim($m->reply_to) !== '') {
          $replyTo[] = ['name' => '', 'email' => trim($m->reply_to)];
      } elseif (is_array($m->reply_to) && $m->reply_to) {
          $replyTo = $m->reply_to;
      } else {
          $replyTo[] = ['name' => (string) $m->from_name, 'email' => (string) $m->from_email];
      }
      $fromSelf = $isSelfAddress((string) $m->from_email);
      if ($mode === 'reply') {
          $to = $fromSelf ? $uniqueAddresses($m->to ?? []) : $uniqueAddresses($replyTo);

          return ['url' => $composeUrl($m->uuid, $mode), 'to' => $addresses($to), 'cc' => '', 'subject' => $subject];
      }
      $to = $fromSelf ? [] : $replyTo;
      $to = $uniqueAddresses(array_merge($to, is_array($m->to) ? $m->to : []));
      $inTo = [];
      foreach ($to as $addr) {
          $inTo[strtolower($addr['email'])] = true;
      }
      $cc = [];
      foreach (is_array($m->cc) ? $m->cc : [] as $item) {
          $email = strtolower(trim((string) (is_array($item) ? ($item['email'] ?? '') : $item)));
          if ($email === '' || isset($inTo[$email]) || $isSelfAddress($email)) {
              continue;
          }
          $cc[] = $item;
      }

      return [
          'url' => $composeUrl($m->uuid, $mode),
          'to' => $addresses($to),
          'cc' => $addresses($uniqueAddresses($cc)),
          'subject' => $subject,
      ];
  };
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
  <link rel="stylesheet" href="/css/dashboard.css?v=295">
</head>
<body>
  <div class="tma-dash__email-detail tma-dash__email-detail--window" data-mail-window>
    @php
      $inArchive = $opened->folder === 'archive';
      $isUnread = ! $opened->is_read;
      $isImportant = (bool) $opened->is_important;
      $isStarred = (bool) $opened->is_starred;
      $detailTools = [
          ['id' => 'delete', 'label' => 'Delete', 'icon' => 'Trash', 'menu' => false, 'active' => false],
          $inArchive
              ? ['id' => 'inbox', 'label' => 'Inbox', 'icon' => 'ArchiveTray', 'menu' => false, 'active' => false]
              : ['id' => 'archive', 'label' => 'Archive', 'icon' => 'Archive', 'menu' => false, 'active' => false],
          ['id' => 'move', 'label' => 'Move', 'icon' => 'FolderSimple', 'menu' => true, 'active' => false],
          ['id' => 'flag', 'label' => 'Flag', 'icon' => $isImportant ? 'FlagFilled' : 'Flag', 'menu' => true, 'active' => $isImportant],
          $isUnread
              ? ['id' => 'read', 'label' => 'Mark Read', 'icon' => 'EnvelopeSimpleOpen', 'menu' => false, 'active' => false]
              : ['id' => 'unread', 'label' => 'Mark Unread', 'icon' => 'EnvelopeSimple', 'menu' => false, 'active' => false],
          ['id' => 'star', 'label' => $isStarred ? 'Starred' : 'Star', 'icon' => $isStarred ? 'StarFilled' : 'Star', 'menu' => false, 'active' => $isStarred],
          ['id' => 'spam', 'label' => 'Spam', 'icon' => 'WarningOctagon', 'menu' => false, 'active' => false],
          ['id' => 'print', 'label' => 'Print', 'icon' => 'Printer', 'menu' => false, 'active' => false],
      ];
    @endphp
    <div class="tma-dash__email-toolbar tma-dash__email-detail-tools" data-email-detail-tools role="toolbar" aria-label="Message tools"
         data-message-id="{{ $opened->uuid }}"
         data-folder="{{ $opened->folder }}"
         data-unread="{{ $isUnread ? '1' : '0' }}"
         data-important="{{ $isImportant ? '1' : '0' }}"
         data-starred="{{ $isStarred ? '1' : '0' }}">
      <div class="tma-dash__toolbar-actions">
        <div class="tma-dash__email-toolbar-actions">
          @foreach($detailTools as $tool)
            <button type="button"
                    class="tma-dash__tool-btn tma-dash__email-toolbar-btn{{ !empty($tool['active']) ? ' tma-dash__email-detail-tool--active' : '' }}"
                    data-email-detail-tool="{{ $tool['id'] }}"
                    @if(!empty($tool['menu'])) aria-haspopup="menu" aria-expanded="false" @endif
                    aria-label="{{ $tool['label'] }}">
              <img src="{{ $icon($tool['icon']) }}" alt="">
              <span class="tma-dash__email-toolbar-btn-label tma-dash__email-detail-tool-label">
                {{ $tool['label'] }}
                @if(!empty($tool['menu']))
                  <img class="tma-dash__email-detail-tool-caret" src="{{ $icon('CaretDown') }}" alt="">
                @endif
              </span>
            </button>
          @endforeach
        </div>
      </div>
    </div>
    <div class="tma-dash__email-detail-subject-bar">
      <div class="tma-dash__email-detail-subject">
        <span class="tma-dash__email-detail-subject-text">{{ $subject }}</span>
        <span class="tma-dash__email-detail-subject-trailing">
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
            $reply = $composeFields($m, 'reply');
            $replyAll = $composeFields($m, 'reply-all');
            $forward = $composeFields($m, 'forward');
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
                    <a class="tma-dash__email-action" href="{{ $reply['url'] }}" target="tma-compose-{{ $m->uuid }}" data-mail-window-compose data-compose-to="{{ $reply['to'] }}" data-compose-cc="{{ $reply['cc'] }}" data-compose-subject="{{ $reply['subject'] }}" title="Reply" aria-label="Reply">
                      <img src="{{ $icon('ArrowBendUpLeft') }}" alt="">
                    </a>
                    <a class="tma-dash__email-action" href="{{ $replyAll['url'] }}" target="tma-compose-{{ $m->uuid }}" data-mail-window-compose data-compose-to="{{ $replyAll['to'] }}" data-compose-cc="{{ $replyAll['cc'] }}" data-compose-subject="{{ $replyAll['subject'] }}" title="Reply all" aria-label="Reply all">
                      <img src="{{ $icon('ArrowBendDoubleUpLeft') }}" alt="">
                    </a>
                    <a class="tma-dash__email-action" href="{{ $forward['url'] }}" target="tma-compose-{{ $m->uuid }}" data-mail-window-compose data-compose-to="{{ $forward['to'] }}" data-compose-cc="{{ $forward['cc'] }}" data-compose-subject="{{ $forward['subject'] }}" title="Forward" aria-label="Forward">
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
      @php
        $openedReply = $composeFields($opened, 'reply');
        $openedReplyAll = $composeFields($opened, 'reply-all');
        $openedForward = $composeFields($opened, 'forward');
      @endphp
      <div class="tma-dash__email-thread-actions">
        <div class="tma-dash__email-thread-btns">
          <a class="tma-dash__email-thread-btn" href="{{ $openedReply['url'] }}" target="tma-compose-{{ $opened->uuid }}" data-mail-window-compose data-compose-to="{{ $openedReply['to'] }}" data-compose-cc="{{ $openedReply['cc'] }}" data-compose-subject="{{ $openedReply['subject'] }}">
            <img src="{{ $icon('ArrowBendUpLeft') }}" alt=""> Reply
          </a>
          <a class="tma-dash__email-thread-btn" href="{{ $openedReplyAll['url'] }}" target="tma-compose-{{ $opened->uuid }}" data-mail-window-compose data-compose-to="{{ $openedReplyAll['to'] }}" data-compose-cc="{{ $openedReplyAll['cc'] }}" data-compose-subject="{{ $openedReplyAll['subject'] }}">
            <img src="{{ $icon('ArrowBendDoubleUpLeft') }}" alt=""> Reply all
          </a>
          <a class="tma-dash__email-thread-btn" href="{{ $openedForward['url'] }}" target="tma-compose-{{ $opened->uuid }}" data-mail-window-compose data-compose-to="{{ $openedForward['to'] }}" data-compose-cc="{{ $openedForward['cc'] }}" data-compose-subject="{{ $openedForward['subject'] }}">
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

    /* Reply / Reply all / Forward open the chrome-less composer in its own
       window — the same /email/compose surface New Mail pops out to — rather
       than replacing this conversation with the full mailbox. To and Subject
       travel in sessionStorage so the composer is addressed on the first
       paint, the same way New Mail hands off a draft. */
    document.querySelectorAll('[data-mail-window-compose]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        var href = link.href;
        try {
          var url = new URL(href, window.location.origin);
          var messageId = url.searchParams.get('message') || '';
          var mode = url.searchParams.get('mode') || 'reply';
          if (messageId) {
            var draftId = 'compose-window-' + messageId + '-' + mode;
            var snapshot = {
              id: draftId,
              to: link.getAttribute('data-compose-to') || '',
              cc: link.getAttribute('data-compose-cc') || '',
              bcc: '',
              subject: link.getAttribute('data-compose-subject') || '',
              bodyHtml: '',
              showCc: mode === 'reply-all',
              serverId: null,
              mode: mode,
              inReplyTo: messageId,
              attachments: [],
              signatureId: '',
              _typing: {}
            };
            window.sessionStorage.setItem('tma.mail.compose-popout.' + draftId, JSON.stringify(snapshot));
            url.searchParams.set('draft', draftId);
            href = url.pathname + url.search;
          }
        } catch (e) { /* fall through with the href on the link */ }
        var opened = window.open(
          href,
          link.getAttribute('target') || 'tma-compose',
          'popup=yes,width=760,height=820,menubar=no,toolbar=no,location=no,status=no'
        );
        if (opened) {
          try { opened.focus(); } catch (e) { /* ignore */ }
          return;
        }
        window.location.href = href;
      });
    });

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
  <div class="tma-dash__email-toast" data-mail-window-toast hidden>
    <span data-mail-window-toast-text></span>
  </div>
  <script src="/js/email-api.js?v=11"></script>
  <script>
    (function () {
      var api = window.TMAEmailAPI;
      var bar = document.querySelector('[data-email-detail-tools]');
      var toastEl = document.querySelector('[data-mail-window-toast]');
      var toastText = toastEl && toastEl.querySelector('[data-mail-window-toast-text]');
      if (!api || !bar) return;

      var id = bar.getAttribute('data-message-id');
      var folder = bar.getAttribute('data-folder') || 'inbox';
      var toastTimer = null;

      function toast(msg) {
        if (!toastEl || !toastText) return;
        toastText.textContent = msg;
        toastEl.hidden = false;
        toastEl.classList.add('tma-dash__email-toast--visible');
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () {
          toastEl.classList.remove('tma-dash__email-toast--visible');
          toastTimer = window.setTimeout(function () { toastEl.hidden = true; }, 240);
        }, 2200);
      }

      function fail(err) {
        toast((err && err.message) || 'Could not update this message');
      }

      function closeSoon() {
        window.setTimeout(function () { window.close(); }, 450);
      }

      function iconUrl(name) {
        return '/images/icons/phosphor/' + name + '.svg';
      }

      function closeMenu() {
        var menu = document.querySelector('[data-mail-window-menu]');
        if (!menu) return;
        if (menu._onDoc) document.removeEventListener('mousedown', menu._onDoc, true);
        if (menu._onKey) document.removeEventListener('keydown', menu._onKey, true);
        menu.remove();
        bar.querySelectorAll('[aria-expanded="true"]').forEach(function (el) {
          el.setAttribute('aria-expanded', 'false');
        });
      }

      function openMenu(anchor, items, onPick) {
        closeMenu();
        anchor.setAttribute('aria-expanded', 'true');
        var menu = document.createElement('div');
        menu.className = 'tma-dash__email-context-menu';
        menu.setAttribute('data-mail-window-menu', '');
        menu.setAttribute('role', 'menu');
        menu.innerHTML = items.map(function (item) {
          if (item.separator) return '<div class="tma-dash__email-context-menu-divider" role="separator"></div>';
          return (
            '<button type="button" class="tma-dash__email-context-menu-item' +
            (item.danger ? ' tma-dash__email-context-menu-item--danger' : '') +
            (item.active ? ' is-active' : '') +
            '" role="menuitem" data-mail-window-menu-item="' + item.id + '">' +
            '<img class="tma-dash__email-context-menu-icon" src="' + iconUrl(item.icon) + '" alt="">' +
            '<span>' + item.label + '</span>' +
            '</button>'
          );
        }).join('');
        document.body.appendChild(menu);
        var rect = menu.getBoundingClientRect();
        var point = anchor.getBoundingClientRect();
        var left = Math.max(8, Math.min(point.left, window.innerWidth - rect.width - 8));
        var top = Math.max(8, Math.min(point.bottom + 4, window.innerHeight - rect.height - 8));
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu._onDoc = function (event) {
          if (menu.contains(event.target) || anchor.contains(event.target)) return;
          closeMenu();
        };
        menu._onKey = function (event) {
          if (event.key === 'Escape') closeMenu();
        };
        menu.addEventListener('click', function (event) {
          var btn = event.target.closest('[data-mail-window-menu-item]');
          if (!btn) return;
          event.preventDefault();
          var picked = btn.getAttribute('data-mail-window-menu-item');
          closeMenu();
          onPick(picked);
        });
        document.addEventListener('mousedown', menu._onDoc, true);
        document.addEventListener('keydown', menu._onKey, true);
      }

      function leave(msg) {
        toast(msg);
        closeSoon();
      }

      function moveTo(dest, msg) {
        var req = dest === 'delete' ? api.remove(id) : api.move(id, dest);
        req.then(function () { leave(msg); }).catch(fail);
      }

      function toolBtn(action) {
        return bar.querySelector('[data-email-detail-tool="' + action + '"]');
      }

      function setUnread(unread) {
        bar.setAttribute('data-unread', unread ? '1' : '0');
        var readBtn = toolBtn('read');
        var unreadBtn = toolBtn('unread');
        var btn = readBtn || unreadBtn;
        if (!btn) return;
        btn.setAttribute('data-email-detail-tool', unread ? 'read' : 'unread');
        btn.setAttribute('aria-label', unread ? 'Mark Read' : 'Mark Unread');
        var label = btn.querySelector('.tma-dash__email-detail-tool-label');
        var caret = label && label.querySelector('.tma-dash__email-detail-tool-caret');
        if (label) {
          label.textContent = unread ? 'Mark Read' : 'Mark Unread';
          if (caret) label.appendChild(caret);
        }
        var img = btn.querySelector(':scope > img');
        if (img) img.src = iconUrl(unread ? 'EnvelopeSimpleOpen' : 'EnvelopeSimple');
      }

      function setImportant(important) {
        bar.setAttribute('data-important', important ? '1' : '0');
        var btn = toolBtn('flag');
        if (!btn) return;
        btn.classList.toggle('tma-dash__email-detail-tool--active', important);
        var img = btn.querySelector(':scope > img');
        if (img) img.src = iconUrl(important ? 'FlagFilled' : 'Flag');
      }

      function setStarred(starred) {
        bar.setAttribute('data-starred', starred ? '1' : '0');
        var btn = toolBtn('star');
        if (!btn) return;
        btn.classList.toggle('tma-dash__email-detail-tool--active', starred);
        btn.setAttribute('aria-label', starred ? 'Starred' : 'Star');
        var label = btn.querySelector('.tma-dash__email-detail-tool-label');
        if (label) label.textContent = starred ? 'Starred' : 'Star';
        var img = btn.querySelector(':scope > img');
        if (img) img.src = iconUrl(starred ? 'StarFilled' : 'Star');
      }

      bar.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-email-detail-tool]');
        if (!btn || !bar.contains(btn)) return;
        var action = btn.getAttribute('data-email-detail-tool');
        var important = bar.getAttribute('data-important') === '1';
        var starred = bar.getAttribute('data-starred') === '1';

        if (action === 'delete') {
          moveTo(folder === 'trash' ? 'delete' : 'trash', 'Message deleted');
          return;
        }
        if (action === 'archive') {
          moveTo('archive', 'Message archived');
          return;
        }
        if (action === 'inbox') {
          moveTo('inbox', 'Moved to inbox');
          return;
        }
        if (action === 'unread' || action === 'read') {
          var nextRead = action === 'read';
          api.setFlags(id, { read: nextRead }).then(function () {
            setUnread(!nextRead);
            toast(nextRead ? 'Marked as read' : 'Marked as unread');
          }).catch(fail);
          return;
        }
        if (action === 'star') {
          var nextStar = !starred;
          api.setFlags(id, { starred: nextStar }).then(function () {
            setStarred(nextStar);
            toast(nextStar ? 'Starred' : 'Star removed');
          }).catch(fail);
          return;
        }
        if (action === 'spam') {
          moveTo('spam', 'Marked as spam');
          return;
        }
        if (action === 'print') {
          window.print();
          return;
        }
        if (action === 'move') {
          openMenu(btn, [
            { id: 'inbox', label: 'Inbox', icon: 'Tray' },
            { id: 'archive', label: 'Archive', icon: 'Archive' },
            { id: 'spam', label: 'Spam', icon: 'WarningOctagon' },
            { id: 'trash', label: 'Trash', icon: 'Trash', danger: true }
          ].filter(function (item) { return item.id !== folder; }), function (dest) {
            var msg =
              dest === 'archive' ? 'Message archived' :
              dest === 'inbox' ? 'Moved to inbox' :
              dest === 'spam' ? 'Marked as spam' :
              'Message deleted';
            moveTo(dest === 'trash' && folder === 'trash' ? 'delete' : dest, msg);
          });
          return;
        }
        if (action === 'flag') {
          openMenu(btn, [
            { id: 'important', label: important ? 'Flagged' : 'Flag', icon: important ? 'FlagFilled' : 'Flag', active: important },
            { id: 'not-important', label: 'Clear flag', icon: 'Flag' }
          ], function (picked) {
            var next = picked === 'important';
            api.setFlags(id, { important: next }).then(function () {
              setImportant(next);
              toast(next ? 'Flagged' : 'Flag cleared');
            }).catch(fail);
          });
          return;
        }
      });
    })();
  </script>
</body>
</html>
