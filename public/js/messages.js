/*
 * TMA - Messages page ( /social/messages )
 * Global: window.TMAMessages
 */
(function () {
  'use strict';

  var ICON = 'images/icons/phosphor/';

  var ICONS = {
    NotePencil: ICON + 'NotePencil.svg',
    GearSix: ICON + 'GearSix.svg',
    MagnifyingGlass: ICON + 'MagnifyingGlass.svg',
    Phone: ICON + 'Phone.svg',
    VideoCamera: ICON + 'VideoCamera.svg',
    DotsThree: ICON + 'DotsThree.svg',
    PaperPlaneRight: ICON + 'PaperPlaneRight.svg',
    Smiley: ICON + 'Smiley.svg',
    Paperclip: ICON + 'Paperclip.svg',
    Microphone: ICON + 'Microphone.svg',
    ArrowBendUpLeft: ICON + 'ArrowBendUpLeft.svg',
    Heart: ICON + 'Heart.svg',
    User: ICON + 'User.svg',
    ThreadsLogo: ICON + 'ThreadsLogo.svg',
    CaretLeft: ICON + 'CaretLeft.svg',
    PushPin: ICON + 'PushPin.svg',
    BellSlash: ICON + 'BellSlash.svg',
    Archive: ICON + 'Archive.svg',
    Trash: ICON + 'Trash.svg',
    CheckCircle: ICON + 'CheckCircle.svg',
  };

  var MESSAGES_MOBILE_MQ = '(max-width: 1024px)';

  function isMessagesMobile() {
    return window.matchMedia(MESSAGES_MOBILE_MQ).matches;
  }

  function isMessagesReading(state) {
    return isMessagesMobile() && !!state.reading && !!state.selectedId;
  }

  /*
   * Live state. Conversations and messages come from /portal/messaging; there
   * is no local seed data. Until the first load resolves the page shows its
   * loading state rather than stand-in content.
   */
  var STORE = {
    threads: [],
    // conversation id -> { messages: [], hasMore: bool, loading: bool, loaded: bool }
    threadMessages: {},
    me: null,
    settings: {},
    realtime: null,
    limits: {},
    loaded: false,
    loadError: null,
  };

  function getThreads() {
    return STORE.threads;
  }

  function findThread(id) {
    for (var i = 0; i < STORE.threads.length; i++) {
      if (STORE.threads[i].id === id) return STORE.threads[i];
    }
    return null;
  }

  /* The message cache for one conversation, created empty on first ask. */
  function threadBucket(id) {
    if (!id) return { messages: [], hasMore: false, loading: false, loaded: false };
    if (!STORE.threadMessages[id]) {
      STORE.threadMessages[id] = { messages: [], hasMore: false, loading: false, loaded: false };
    }
    return STORE.threadMessages[id];
  }

  function getMessages(id) {
    return threadBucket(id).messages;
  }

  /*
   * Merge server messages into a conversation's cache, keyed on `seq` so a
   * message that arrives twice - once optimistically, once over the socket -
   * collapses into one bubble instead of duplicating.
   */
  function mergeMessages(id, incoming, atFront) {
    var bucket = threadBucket(id);
    var bySeq = {};
    var byNonce = {};

    bucket.messages.forEach(function (msg, index) {
      if (msg.seq) bySeq[msg.seq] = index;
      if (msg.nonce) byNonce[msg.nonce] = index;
    });

    var fresh = [];
    incoming.forEach(function (msg) {
      // A confirmed send replaces its own optimistic placeholder in place, so
      // the bubble never jumps position when the server answers.
      var existing = bySeq[msg.seq];
      if (existing === undefined && msg.nonce !== undefined) existing = byNonce[msg.nonce];
      if (existing !== undefined) {
        bucket.messages[existing] = msg;
        return;
      }
      fresh.push(msg);
    });

    if (!fresh.length) return bucket;

    bucket.messages = atFront ? fresh.concat(bucket.messages) : bucket.messages.concat(fresh);
    bucket.messages.sort(function (a, b) {
      // Pending sends have no seq yet and belong last, in arrival order.
      var aSeq = a.seq || Number.MAX_SAFE_INTEGER;
      var bSeq = b.seq || Number.MAX_SAFE_INTEGER;
      return aSeq - bSeq;
    });

    return bucket;
  }

  /*
   * The server resolves display names, photos and presence for the viewer, so
   * there is nothing left to overlay client-side. Kept as a seam because the
   * render functions all call it.
   */
  function resolveThread(row) {
    return row || {};
  }

  function isDirectThread(row) {
    return row.type !== 'group';
  }

  function threadPresence(row) {
    if (row.presence) return row.presence;
    return isDirectThread(row) ? { lastSeen: 'Last seen recently' } : { label: 'Group chat' };
  }

  function renderPresence(row) {
    var presence = threadPresence(row);

    // A live typing / recording indicator outranks online-or-last-seen.
    if (presence.typing) {
      return (
        '<span class="tma-dash__messages-chat-presence tma-dash__messages-chat-presence--typing">' +
        esc(presence.typing === 'recording' ? 'Recording voice note…' : 'Typing…') +
        '</span>'
      );
    }

    if (presence.online) {
      return (
        '<span class="tma-dash__messages-chat-presence tma-dash__messages-chat-presence--online">' +
        '<span class="tma-dash__messages-chat-presence-dot" aria-hidden="true"></span>' +
        '<span>Online</span></span>'
      );
    }
    var label = presence.label || presence.lastSeen || 'Offline';
    return '<span class="tma-dash__messages-chat-presence">' + esc(label) + '</span>';
  }

  function threadDisplayName(row) {
    return String(row.name || '').split(',')[0];
  }

  function renderContactName(row) {
    return (
      '<span class="tma-dash__messages-chat-name">' + esc(threadDisplayName(row)) + '</span>'
    );
  }

  function renderChatContactText(row) {
    row = resolveThread(row);
    var html = renderContactName(row);
    if (row.subtitle) {
      html += '<span class="tma-dash__messages-chat-subtitle">' + esc(row.subtitle) + '</span>';
    }
    html += renderPresence(row);
    return html;
  }

  function renderChatThreadIcon(row) {
    return threadIcon(resolveThread(row));
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* Up to two letters from a display name, for the no-photo fallback. */
  function initialsFor(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  /* Stable colour per name, so someone's initials tile doesn't change colour
   * between renders or between the list and the header. */
  var INITIAL_COLOURS = ['blue', 'green', 'purple', 'amber', 'rose'];

  function initialColourFor(name) {
    var sum = 0;
    var text = String(name || '');
    for (var i = 0; i < text.length; i++) sum = (sum + text.charCodeAt(i)) % 9973;
    return INITIAL_COLOURS[sum % INITIAL_COLOURS.length];
  }

  function renderInitialAvatar(name, extraClass) {
    return (
      '<span class="tma-dash__messages-row-avatar tma-dash__messages-row-avatar--initial ' +
      'tma-dash__messages-row-avatar--' + initialColourFor(name) +
      (extraClass ? ' ' + extraClass : '') + '">' +
      esc(initialsFor(name)) +
      '</span>'
    );
  }

  /*
   * Conversation avatar. Real photos only; where there is none the initials
   * tile stands in - the portal never shows a stock avatar for a real person.
   */
  function threadIcon(row) {
    if (row.photo) {
      return (
        '<span class="tma-dash__messages-row-avatar">' +
        '<img src="' + esc(row.photo) + '" alt="" loading="lazy">' +
        '</span>'
      );
    }

    if (row.type === 'group') {
      var members = (row.members || []).slice(0, 2);
      if (!members.length) return renderInitialAvatar(row.name, 'tma-dash__messages-row-avatar--group');

      return (
        '<span class="tma-dash__messages-row-avatar tma-dash__messages-row-avatar--group">' +
        members
          .map(function (member, i) {
            var cls = 'tma-dash__messages-row-avatar-part tma-dash__messages-row-avatar-part--' + (i + 1);
            return member.photo
              ? '<img class="' + cls + '" src="' + esc(member.photo) + '" alt="" loading="lazy">'
              : '<span class="' + cls + ' tma-dash__messages-row-avatar-part--initial">' +
                esc(initialsFor(member.name).charAt(0)) + '</span>';
          })
          .join('') +
        '</span>'
      );
    }

    return renderInitialAvatar(row.name);
  }

  function isThreadOnline(row) {
    return !!(threadPresence(row).online && isDirectThread(row));
  }

  function renderInboxThreadIcon(row) {
    var icon = threadIcon(resolveThread(row));
    if (!isThreadOnline(row)) return icon;
    return (
      '<span class="tma-dash__messages-row-avatar-wrap tma-dash__messages-row-avatar-wrap--online">' +
      icon +
      '<span class="tma-dash__messages-row-online-dot" aria-hidden="true"></span>' +
      '</span>'
    );
  }

  function renderBadge(count) {
    if (!count) return '';
    if (window.TMABadge) {
      return window.TMABadge.renderBadge({ type: 'number', value: String(count), color: 'blue' });
    }
    return '<span class="tma-dash__messages-unread">' + esc(count) + '</span>';
  }

  function renderComposeBtn(className, attrs) {
    return (
      '<button type="button" class="' +
      className +
      '" aria-label="New message"' +
      (attrs || '') +
      '>' +
      '<img src="' + ICONS.NotePencil + '" alt="">' +
      '</button>'
    );
  }



  /*
   * The search field. Was a plain <span> with no input behind it; it is now a
   * real field driving `state.search`, which filters conversations and also
   * turns up people you have no conversation with yet.
   */
  function renderSearchField(state) {
    var value = state.search || '';
    return (
      '<div class="tma-dash__messages-search" role="search">' +
      '<img src="' + ICONS.MagnifyingGlass + '" alt="">' +
      '<input type="search" class="tma-dash__messages-search-input" data-messages-search ' +
      // Placeholder stays as short as the original design's; the aria-label
      // carries the detail so the field doesn't clip at this width.
      'placeholder="Search" aria-label="Search conversations and people" ' +
      'value="' + esc(value) + '" autocomplete="off">' +
      (value
        ? '<button type="button" class="tma-dash__messages-search-clear" data-messages-search-clear ' +
          'aria-label="Clear search"><span aria-hidden="true">×</span></button>'
        : '<kbd class="tma-dash__kbd">/</kbd>') +
      '</div>'
    );
  }

  /* Top of the inbox column: search only. */
  function renderListHead(state) {
    return (
      '<div class="tma-dash__messages-list-head">' +
      renderSearchField(state) +
      '</div>'
    );
  }

  /*
   * Bottom of the inbox column: New message and Messages settings. Pinned
   * outside the scrolling list so both stay reachable however far the
   * conversation list runs.
   */
  function renderListFoot(state) {
    return (
      '<div class="tma-dash__messages-list-foot">' +
      renderComposeBtn(
        'tma-dash__messages-list-foot-btn',
        ' data-messages-compose'
      ).replace('aria-label="New message"', 'aria-label="New message" title="New message"') +
      '<button type="button" class="tma-dash__messages-list-foot-btn' +
      (state && state.settingsOpen ? ' is-active' : '') +
      '" aria-label="Messages settings" title="Messages settings" data-messages-settings' +
      ' aria-expanded="' + (state && state.settingsOpen ? 'true' : 'false') + '">' +
      '<img src="' + ICONS.GearSix + '" alt="">' +
      '</button>' +
      '</div>'
    );
  }

  function renderListMobileHead(state) {
    return (
      '<div class="tma-dash__messages-list-mobile-head">' +
      '<span class="tma-dash__messages-list-mobile-title">Messages</span>' +
      renderSearchField(state) +
      '</div>'
    );
  }

  /*
   * The rows the chat list should show, after the active tab, the search box,
   * and pin ordering are applied.
   *
   * The server already returns the list pinned-first then newest-first, so the
   * order here only has to be *stable*: re-sorting on every render is what used
   * to make rows shuffle under the pointer.
   */
  function getVisibleThreads(state) {
    var term = (state.search || '').trim().toLowerCase();
    var tab = state.tab || 'all';

    return getThreads().filter(function (row) {
      // Archived conversations live in their own tab, never the main list.
      if (tab === 'archived') {
        if (!row.archived) return false;
      } else if (row.archived) {
        return false;
      }

      if (tab === 'unread' && !row.unread) return false;

      if (!term) return true;

      return (
        (row.name || '').toLowerCase().indexOf(term) !== -1 ||
        (row.preview || '').toLowerCase().indexOf(term) !== -1
      );
    });
  }

  function buildMessagesRowInner(row, state) {
    var item = resolveThread(row);
    var pinned = row.pinned;
    var muted = row.muted;
    return (
      renderInboxThreadIcon(row) +
      '<span class="tma-dash__messages-row-text">' +
      '<span class="tma-dash__messages-row-name">' +
      esc(item.name) +
      (pinned
        ? '<img class="tma-dash__messages-row-pin" src="' + ICONS.PushPin + '" alt="" width="14" height="14" aria-hidden="true">'
        : '') +
      (muted
        ? '<img class="tma-dash__messages-row-mute" src="' + ICONS.BellSlash + '" alt="" width="14" height="14" aria-hidden="true">'
        : '') +
      '</span>' +
      '<span class="tma-dash__messages-row-preview">' +
      // Precedence in the preview slot: an unsent draft first (you were part
      // way through something), then a reaction newer than the last message,
      // then the message itself.
      (row.draft
        ? '<span class="tma-dash__messages-row-draft">Draft: </span>' + esc(row.draft)
        : row.reactionNote
          ? '<span class="tma-dash__messages-row-reaction">' + esc(row.reactionNote) + '</span>'
          : esc(row.preview || '')) +
      '</span>' +
      '</span>' +
      '<span class="tma-dash__messages-row-meta">' +
      '<span class="tma-dash__messages-row-time">' +
      esc(row.time) +
      '</span>' +
      renderBadge(row.unread) +
      '</span>'
    );
  }

  function buildMessagesRowHtml(row, state) {
    var active = state.selectedId === row.id;
    var pinned = row.pinned;
    var muted = row.muted;
    var rowCls =
      'tma-dash__messages-row' +
      (active ? ' tma-dash__messages-row--active' : '') +
      (pinned ? ' tma-dash__messages-row--pinned' : '') +
      (muted ? ' tma-dash__messages-row--muted' : '');
    return (
      '<div class="' +
      rowCls +
      '" data-messages-row="' +
      esc(row.id) +
      '" role="button" tabindex="0">' +
      buildMessagesRowInner(row, state) +
      '</div>'
    );
  }

  function buildMessagesRowSwipeWrap(row, state, rowHtml) {
    var rowId = row.id;
    var pinned = row.pinned;
    var muted = row.muted;
    return (
      '<div class="tma-dash__messages-row-swipe" data-messages-row-swipe="' +
      esc(rowId) +
      '">' +
      '<div class="tma-dash__messages-row-swipe-actions tma-dash__messages-row-swipe-actions--left" aria-hidden="true">' +
      '<button type="button" class="tma-dash__messages-row-swipe-action tma-dash__messages-row-swipe-action--pin"' +
      ' data-messages-row-swipe-action="pin" data-messages-row-id="' +
      esc(rowId) +
      '" aria-label="' +
      (pinned ? 'Unpin conversation' : 'Pin conversation') +
      '">' +
      '<img class="tma-dash__messages-row-swipe-action-icon" src="' +
      ICONS.PushPin +
      '" alt="" width="18" height="18">' +
      (pinned ? 'Unpin' : 'Pin') +
      '</button>' +
      '<button type="button" class="tma-dash__messages-row-swipe-action tma-dash__messages-row-swipe-action--mute"' +
      ' data-messages-row-swipe-action="mute" data-messages-row-id="' +
      esc(rowId) +
      '" aria-label="' +
      (muted ? 'Unmute conversation' : 'Mute conversation') +
      '">' +
      '<img class="tma-dash__messages-row-swipe-action-icon" src="' +
      ICONS.BellSlash +
      '" alt="" width="18" height="18">' +
      (muted ? 'Unmute' : 'Mute') +
      '</button>' +
      // Read / unread toggle. The label follows the row's current state so the
      // button always names what it is about to do.
      '<button type="button" class="tma-dash__messages-row-swipe-action tma-dash__messages-row-swipe-action--read"' +
      ' data-messages-row-swipe-action="' + (row.unread ? 'read' : 'unread') + '" data-messages-row-id="' +
      esc(rowId) +
      '" aria-label="' +
      (row.unread ? 'Mark as read' : 'Mark as unread') +
      '">' +
      '<img class="tma-dash__messages-row-swipe-action-icon" src="' +
      ICONS.CheckCircle +
      '" alt="" width="18" height="18">' +
      (row.unread ? 'Read' : 'Unread') +
      '</button>' +
      '</div>' +
      '<div class="tma-dash__messages-row-swipe-actions tma-dash__messages-row-swipe-actions--right" aria-hidden="true">' +
      '<button type="button" class="tma-dash__messages-row-swipe-action tma-dash__messages-row-swipe-action--archive"' +
      ' data-messages-row-swipe-action="archive" data-messages-row-id="' +
      esc(rowId) +
      '" aria-label="Archive">' +
      'Archive</button>' +
      '<button type="button" class="tma-dash__messages-row-swipe-action tma-dash__messages-row-swipe-action--delete"' +
      ' data-messages-row-swipe-action="delete" data-messages-row-id="' +
      esc(rowId) +
      '" aria-label="Delete">' +
      '<img class="tma-dash__messages-row-swipe-delete-icon" src="' +
      ICONS.Trash +
      '" alt="" width="24" height="24">' +
      '</button></div>' +
      '<div class="tma-dash__messages-row-swipe-track" data-messages-row-swipe-track tabindex="0" role="group" aria-label="Conversation">' +
      rowHtml +
      '</div></div>'
    );
  }

  /* ------------------------------------------------------------------
   * New-message panel
   * ---------------------------------------------------------------- */

  function renderPersonRow(person, action) {
    return (
      '<button type="button" class="tma-dash__messages-person" ' + action + '="' + esc(String(person.id)) + '">' +
      (person.photo
        ? '<span class="tma-dash__messages-row-avatar"><img src="' + esc(person.photo) + '" alt="" loading="lazy"></span>'
        : renderInitialAvatar(person.name)) +
      '<span class="tma-dash__messages-person-text">' +
      '<span class="tma-dash__messages-person-name">' + esc(person.name) + '</span>' +
      '<span class="tma-dash__messages-person-meta">' +
      esc([person.accountType, person.email].filter(Boolean).join(' · ')) +
      '</span></span></button>'
    );
  }

  function renderComposePanel(state) {
    if (!state.composeOpen) return '';

    var body;
    if (state.composeLoading) {
      body = '<div class="tma-dash__messages-list-state" role="status">Searching…</div>';
    } else if (state.composeError) {
      body = '<div class="tma-dash__messages-list-state tma-dash__messages-list-state--error">' +
        '<p>People could not be loaded.</p></div>';
    } else if (!state.composeResults || !state.composeResults.length) {
      body = '<div class="tma-dash__messages-list-state">' +
        ((state.composeQuery || '').trim() ? 'Nobody matches that name.' : 'No one else to message yet.') +
        '</div>';
    } else {
      body = state.composeResults
        .map(function (person) {
          return renderPersonRow(person, 'data-messages-start');
        })
        .join('');
    }

    return (
      '<div class="tma-dash__messages-panel" data-messages-panel role="dialog" aria-label="New message">' +
      '<div class="tma-dash__messages-panel-head">' +
      '<span class="tma-dash__messages-panel-title">New message</span>' +
      '<button type="button" class="tma-dash__messages-icon-btn" data-messages-panel-close aria-label="Close">' +
      '<span aria-hidden="true">×</span></button>' +
      '</div>' +
      '<div class="tma-dash__messages-search tma-dash__messages-search--panel" role="search">' +
      '<img src="' + ICONS.MagnifyingGlass + '" alt="">' +
      '<input type="search" class="tma-dash__messages-search-input" data-messages-compose-search ' +
      'placeholder="Search people" aria-label="Search people" value="' + esc(state.composeQuery || '') + '" autocomplete="off">' +
      '</div>' +
      '<div class="tma-dash__messages-panel-body">' + body + '</div>' +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------
   * Messages settings panel
   * ---------------------------------------------------------------- */

  function renderSettingsToggle(key, label, hint) {
    var on = STORE.settings[key] !== false;
    return (
      '<label class="tma-dash__messages-setting">' +
      '<span class="tma-dash__messages-setting-text">' +
      '<span class="tma-dash__messages-setting-label">' + esc(label) + '</span>' +
      (hint ? '<span class="tma-dash__messages-setting-hint">' + esc(hint) + '</span>' : '') +
      '</span>' +
      '<input type="checkbox" class="tma-dash__messages-setting-input" data-messages-setting="' + key + '"' +
      (on ? ' checked' : '') + '>' +
      '</label>'
    );
  }

  function renderSettingsChoice(key, label, hint) {
    var value = STORE.settings[key] || 'everyone';
    var options = [
      { value: 'everyone', label: 'Everyone' },
      { value: 'contacts', label: 'People I chat with' },
      { value: 'nobody', label: 'Nobody' },
    ];
    return (
      '<label class="tma-dash__messages-setting">' +
      '<span class="tma-dash__messages-setting-text">' +
      '<span class="tma-dash__messages-setting-label">' + esc(label) + '</span>' +
      (hint ? '<span class="tma-dash__messages-setting-hint">' + esc(hint) + '</span>' : '') +
      '</span>' +
      '<select class="tma-dash__messages-setting-select" data-messages-setting="' + key + '">' +
      options
        .map(function (o) {
          return '<option value="' + o.value + '"' + (value === o.value ? ' selected' : '') + '>' +
            esc(o.label) + '</option>';
        })
        .join('') +
      '</select></label>'
    );
  }

  function renderSettingsPanel(state) {
    if (!state.settingsOpen) return '';

    return (
      '<div class="tma-dash__messages-panel" data-messages-panel role="dialog" aria-label="Messages settings">' +
      '<div class="tma-dash__messages-panel-head">' +
      '<span class="tma-dash__messages-panel-title">Messages settings</span>' +
      '<button type="button" class="tma-dash__messages-icon-btn" data-messages-panel-close aria-label="Close">' +
      '<span aria-hidden="true">×</span></button>' +
      '</div>' +
      '<div class="tma-dash__messages-panel-body">' +
      '<div class="tma-dash__messages-setting-group">Privacy</div>' +
      renderSettingsChoice('onlineStatus', 'Who can see when I am online') +
      renderSettingsChoice('lastSeen', 'Who can see my last seen') +
      renderSettingsToggle('readReceipts', 'Read receipts', 'Turn off and you will not see others’ either') +
      renderSettingsToggle('typingIndicator', 'Typing indicator') +

      '<div class="tma-dash__messages-setting-group">Notifications</div>' +
      renderSettingsToggle('notificationSounds', 'Notification sounds') +
      renderSettingsToggle('desktopNotifications', 'Desktop notifications', 'Needs browser permission') +
      renderSettingsToggle('notificationPreview', 'Show message text in notifications') +

      '<div class="tma-dash__messages-setting-group">Composing</div>' +
      renderSettingsToggle('enterToSend', 'Enter sends the message', 'Off: Enter adds a line, the send button sends') +

      '<div class="tma-dash__messages-setting-group">Media</div>' +
      renderSettingsToggle('mediaAutoDownload', 'Download media automatically') +
      '</div>' +
      '<p class="tma-dash__messages-panel-note">These settings apply to your account only.</p>' +
      '</div>'
    );
  }

  /* Loading / empty / error stand-ins. Never sample content. */
  function renderListPlaceholder(state) {
    if (STORE.loadError) {
      return (
        '<div class="tma-dash__messages-list-state tma-dash__messages-list-state--error">' +
        '<p>Conversations could not be loaded.</p>' +
        '<button type="button" class="tma-dash__messages-list-retry" data-messages-retry>Try again</button>' +
        '</div>'
      );
    }

    if (!STORE.loaded) {
      return '<div class="tma-dash__messages-list-state" role="status">Loading conversations…</div>';
    }

    if ((state.search || '').trim()) {
      return '<div class="tma-dash__messages-list-state">No conversations match that search.</div>';
    }

    if (state.tab === 'archived') {
      return '<div class="tma-dash__messages-list-state">No archived conversations.</div>';
    }

    return '<div class="tma-dash__messages-list-state">No conversations yet.</div>';
  }

  function renderList(state) {
    var mobile = isMessagesMobile();
    var rows = getVisibleThreads(state);

    var body = rows.length
      ? rows
          .map(function (row) {
            if (mobile) return buildMessagesRowSwipeWrap(row, state, buildMessagesRowHtml(row, state));
            var active = state.selectedId === row.id;
            return (
              '<button type="button" class="tma-dash__messages-row' +
              (active ? ' tma-dash__messages-row--active' : '') +
              (row.pinned ? ' tma-dash__messages-row--pinned' : '') +
              (row.muted ? ' tma-dash__messages-row--muted' : '') +
              '" data-messages-row="' +
              esc(row.id) +
              '">' +
              buildMessagesRowInner(row, state) +
              '</button>'
            );
          })
          .join('')
      : renderListPlaceholder(state);

    // A search can also turn up people with no conversation yet, so the field
    // finds someone whether or not you have spoken before.
    var people = '';
    if ((state.search || '').trim() && state.peopleResults && state.peopleResults.length) {
      people =
        '<div class="tma-dash__messages-list-group">Start a new conversation</div>' +
        state.peopleResults
          .map(function (person) {
            return renderPersonRow(person, 'data-messages-start');
          })
          .join('');
    }

    return (
      '<div class="tma-dash__messages-list">' +
      (mobile ? renderListMobileHead(state) : renderListHead(state)) +
      renderComposePanel(state) +
      renderSettingsPanel(state) +
      '<div class="tma-dash__messages-list-body" data-messages-list-body>' +
      (rows.length ? body : (people ? '' : body)) +
      people +
      '</div>' +
      renderListFoot(state) +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------
   * Emoji
   *
   * Native Unicode characters, from the generated emoji-data.js. The previous
   * picker drew 21 SVG assets, 18 of which were malformed XML and rendered as
   * broken images — and 21 images could never satisfy categories or search.
   * ---------------------------------------------------------------- */

  var RECENT_EMOJI_KEY = 'tma.messages.recentEmoji';
  var RECENT_EMOJI_MAX = 24;

  function emojiData() {
    return window.TMAEmojiData || { quick: [], groups: [] };
  }

  function recentEmoji() {
    try {
      var raw = window.localStorage.getItem(RECENT_EMOJI_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(function (c) { return typeof c === 'string'; }) : [];
    } catch (err) {
      // Private browsing, or a corrupted value — recents are a nicety.
      return [];
    }
  }

  function rememberEmoji(char) {
    if (!char) return;
    try {
      var list = recentEmoji().filter(function (c) {
        return c !== char;
      });
      list.unshift(char);
      window.localStorage.setItem(
        RECENT_EMOJI_KEY,
        JSON.stringify(list.slice(0, RECENT_EMOJI_MAX))
      );
    } catch (err) {
      /* not worth surfacing */
    }
  }

  /* Match on the Unicode name and its keywords, so "cry" finds 😢 and 😭. */
  function searchEmoji(term) {
    var needle = term.trim().toLowerCase();
    if (!needle) return [];

    var hits = [];
    emojiData().groups.forEach(function (group) {
      group.items.forEach(function (item) {
        if (hits.length >= 90) return;
        if (item.k.indexOf(needle) !== -1 || item.n.toLowerCase().indexOf(needle) !== -1) {
          hits.push(item);
        }
      });
    });
    return hits;
  }


  var MESSAGE_ICON_PATHS = {
    Smiley:
      'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216ZM80,108a12,12,0,1,1,12,12A12,12,0,0,1,80,108Zm96,0a12,12,0,1,1-12-12A12,12,0,0,1,176,108Zm-1.07,48c-10.29,17.79-27.4,28-46.93,28s-36.63-10.2-46.92-28a8,8,0,1,1,13.84-8c7.47,12.91,19.21,20,33.08,20s25.61-7.1,33.07-20a8,8,0,0,1,13.86,8Z',
    ArrowBendUpLeft:
      'M232,200a8,8,0,0,1-16,0,88.1,88.1,0,0,0-88-88H51.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,85.66,61.66L51.31,96H128A104.11,104.11,0,0,1,232,200Z',
    ArrowBendUpRight:
      'M229.66,109.66l-48,48a8,8,0,0,1-11.32-11.32L204.69,112H128a88.1,88.1,0,0,0-88,88,8,8,0,0,1-16,0A104.11,104.11,0,0,1,128,96h76.69L170.34,61.66a8,8,0,0,1,11.32-11.32l48,48A8,8,0,0,1,229.66,109.66Z',
    DotsThree:
      'M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128Zm56-12a12,12,0,1,0,12,12A12,12,0,0,0,196,116ZM60,116a12,12,0,1,0,12,12A12,12,0,0,0,60,116Z',
    Paperclip:
      'M209.66,122.34a8,8,0,0,1,0,11.32l-82.05,82a56,56,0,0,1-79.2-79.21L147.67,35.73a40,40,0,1,1,56.61,56.55L105,193A24,24,0,1,1,71,159L154.3,74.38A8,8,0,1,1,165.7,85.6L82.39,170.31a8,8,0,1,0,11.27,11.36L192.93,81A24,24,0,1,0,159,47L59.76,147.68a40,40,0,1,0,56.53,56.62l82.06-82A8,8,0,0,1,209.66,122.34Z',
    Microphone:
      'M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z',
    PaperPlaneRight:
      'M231.87,114l-168-95.89A16,16,0,0,0,40.92,37.34L71.55,128,40.92,218.67A16,16,0,0,0,56,240a16.15,16.15,0,0,0,7.93-2.1l167.92-96.05a16,16,0,0,0,.05-27.89ZM56,224a.56.56,0,0,0,0-.12L85.74,136H144a8,8,0,0,0,0-16H85.74L56.06,32.16A.46.46,0,0,0,56,32l168,95.83Z',
  };

  function renderMessagesIcon(name) {
    var path = MESSAGE_ICON_PATHS[name];
    if (!path) return '';
    return (
      '<svg class="tma-dash__messages-icon" viewBox="0 0 256 256" aria-hidden="true">' +
      '<path d="' +
      path +
      '"></path></svg>'
    );
  }

  var REPLY_SWIPE_MAX = 72;
  var REPLY_SWIPE_TRIGGER = 56;

  function getReplySwipeTrigger() {
    return isMessagesMobile() ? 44 : REPLY_SWIPE_TRIGGER;
  }

  function messagesWheelDeltaX(e, fallbackWidth) {
    var dx = e.deltaX;
    if (e.deltaMode === 1) dx *= 16;
    else if (e.deltaMode === 2) dx *= fallbackWidth || 320;
    return dx;
  }

  function focusComposerInput(root) {
    var composer = root.querySelector('.tma-dash__messages-composer');
    var input = root.querySelector('[data-messages-composer-input]');
    if (composer) composer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (input) input.focus();
  }

  function messagePreview(msg) {
    if (!msg) return '';
    if (msg.deleted) return 'Message deleted';
    if (msg.body) return msg.body.length > 96 ? msg.body.slice(0, 96) + '…' : msg.body;
    var attachment = msg.attachments && msg.attachments[0];
    if (msg.type === 'voice') return 'Voice note';
    if (attachment) {
      if (attachment.kind === 'image') return 'Photo';
      if (attachment.kind === 'video') return 'Video';
      return attachment.name;
    }
    return 'Message';
  }

  function messageReplyLabel(msg) {
    if (msg.direction === 'out') return 'Replying to yourself';
    return 'Replying to ' + ((msg.sender && msg.sender.name) || 'them');
  }

  function clearReplyTo(state) {
    state.replyTo = null;
  }

  /*
   * Replies are held by message id, not by list position: paging in older
   * history shifts every index, and a reply pinned to an index would silently
   * retarget to a different message.
   */
  function setReplyTo(state, messageId) {
    if (!messageId) return;
    state.replyTo = { threadId: state.selectedId, messageId: messageId };
  }

  function findMessageById(conversationId, messageId) {
    var list = getMessages(conversationId);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === messageId) return list[i];
    }
    return null;
  }

  function getReplyMessage(state) {
    if (!state.replyTo || state.replyTo.threadId !== state.selectedId) return null;
    return findMessageById(state.selectedId, state.replyTo.messageId);
  }

  /*
   * Turn bare URLs in a message into links.
   *
   * The text is escaped first and the URL is re-escaped into the href, so a
   * message can never inject markup. Only http(s) is linked - a javascript:
   * or data: string stays inert text - and every link opens in a new tab with
   * noopener so the target can't reach back into the portal.
   */
  var URL_PATTERN = /\b(https?:\/\/[^\s<]+[^\s<.,:;"')\]}]|www\.[^\s<]+[^\s<.,:;"')\]}])/gi;

  function linkify(text) {
    return esc(text).replace(URL_PATTERN, function (match) {
      var href = match.indexOf('www.') === 0 ? 'https://' + match : match;
      return (
        '<a class="tma-dash__messages-link" href="' + esc(href) +
        '" target="_blank" rel="noopener noreferrer nofollow">' + match + '</a>'
      );
    });
  }

  /* Controls inside a message bubble that must receive their own clicks
   * rather than being absorbed by the swipe-to-reply gesture. */
  var INTERACTIVE_IN_BUBBLE =
    '.tma-dash__messages-link-action-btn, .tma-dash__messages-bubble-action, ' +
    '.tma-dash__messages-bubble-quote, .tma-dash__messages-reaction, ' +
    // Attachments too: an image opens the lightbox, and video/audio have their
    // own transport controls that must receive pointer events.
    '.tma-dash__messages-attachment, .tma-dash__messages-voice, video, audio, a';

  function renderSwipeReplyIcon(side) {
    var icon = side === 'in' ? 'ArrowBendUpRight' : 'ArrowBendUpLeft';
    return (
      '<span class="tma-dash__messages-bubble-swipe-reply" aria-hidden="true">' +
      renderMessagesIcon(icon) +
      '</span>'
    );
  }

  function renderSwipeTrack(content, side) {
    return (
      '<div class="tma-dash__messages-bubble-swipe">' +
      renderSwipeReplyIcon(side) +
      '<div class="tma-dash__messages-bubble-track" data-messages-swipe-track>' +
      content +
      '</div></div>'
    );
  }

  function renderReplyPreview(state) {
    var msg = getReplyMessage(state);
    if (!msg) return '';
    return (
      '<div class="tma-dash__messages-reply-preview">' +
      '<span class="tma-dash__messages-reply-preview-bar" aria-hidden="true"></span>' +
      '<span class="tma-dash__messages-reply-preview-body">' +
      '<span class="tma-dash__messages-reply-preview-label">' +
      esc(messageReplyLabel(msg)) +
      '</span>' +
      '<span class="tma-dash__messages-reply-preview-text">' +
      esc(messagePreview(msg)) +
      '</span></span>' +
      '<button type="button" class="tma-dash__messages-reply-preview-clear" data-messages-reply-clear aria-label="Cancel reply">' +
      '<span aria-hidden="true">×</span></button></div>'
    );
  }

  function resolveMessageTime(msg, row) {
    if (msg && msg.time) return msg.time;
    if (row && row.time) return row.time;
    return '';
  }

  /*
   * Delivery ticks. Drawn as one SVG rather than two "✓" glyphs so the second
   * tick can overlap the first the way every messenger renders it — text
   * characters sit a full advance-width apart and read as two separate marks.
   *
   * The viewBox is deliberately narrow (16x10) and the second tick starts at
   * x=5, giving the tight nested look.
   */
  function renderTicks(doubled) {
    var stroke =
      'fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"';

    return (
      '<svg class="tma-dash__messages-tick" viewBox="0 0 16 10" width="16" height="10" aria-hidden="true">' +
      '<path d="M1 5.5 L4 8.5 L10 1.5" ' + stroke + '></path>' +
      (doubled ? '<path d="M6 5.5 L9 8.5 L15 1.5" ' + stroke + '></path>' : '') +
      '</svg>'
    );
  }

  /*
   * Sender-side only — an incoming message never carries a tick.
   *
   *   pending    the optimistic bubble, not yet confirmed by the server
   *   sent       stored, but nobody's client has acknowledged it
   *   delivered  every other participant's client has it  (two grey)
   *   read       every other participant has opened it    (two blue)
   *   failed     the send errored and can be retried
   */
  function renderBubbleStatus(msg) {
    if (msg.direction !== 'out') return '';

    var state = msg.failed ? 'failed' : msg.pending ? 'pending' : msg.status || 'sent';
    var label = {
      pending: 'Sending',
      failed: 'Not sent — tap to retry',
      sent: 'Sent',
      delivered: 'Delivered',
      read: 'Seen',
    }[state] || 'Sent';

    var glyph;
    if (state === 'failed') glyph = '<span aria-hidden="true">!</span>';
    else if (state === 'pending') glyph = '<span class="tma-dash__messages-tick-pending" aria-hidden="true"></span>';
    else glyph = renderTicks(state === 'delivered' || state === 'read');

    return (
      '<span class="tma-dash__messages-bubble-status tma-dash__messages-bubble-status--' + state +
      '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
      glyph +
      '</span>'
    );
  }

  function renderBubbleTime(msg, row) {
    var time = resolveMessageTime(msg, row);
    if (!time && !msg.edited) return '';
    return (
      '<time class="tma-dash__messages-bubble-time"' +
      (msg.sentAt ? ' datetime="' + esc(msg.sentAt) + '"' : '') +
      '>' +
      (msg.edited ? '<span class="tma-dash__messages-bubble-edited">edited</span> ' : '') +
      esc(time) +
      renderBubbleStatus(msg) +
      '</time>'
    );
  }

  /*
   * The quoted original shown inside a reply bubble. Click scrolls to it.
   *
   * When the original was a file the quote carries its thumbnail (for an
   * image) or its file-type icon, so "Replying to a photo" is visible at a
   * glance rather than only readable.
   */
  function renderQuotedReply(msg) {
    if (!msg.replyTo) return '';

    var quoted = msg.replyTo;
    var media = '';

    if (quoted.thumbUrl) {
      media = '<span class="tma-dash__messages-bubble-quote-thumb">' +
        '<img src="' + esc(quoted.thumbUrl) + '" alt=""></span>';
    } else if (quoted.attachmentName) {
      media = '<span class="tma-dash__messages-bubble-quote-thumb">' +
        '<img src="' + esc(attachmentIconSrc(quoted.attachmentName)) + '" alt=""></span>';
    }

    return (
      '<button type="button" class="tma-dash__messages-bubble-quote" data-messages-jump="' +
      esc(quoted.id) +
      '">' +
      '<span class="tma-dash__messages-bubble-quote-bar" aria-hidden="true"></span>' +
      '<span class="tma-dash__messages-bubble-quote-body">' +
      '<span class="tma-dash__messages-bubble-quote-name">' +
      esc(quoted.senderName) +
      '</span>' +
      '<span class="tma-dash__messages-bubble-quote-text">' +
      esc(quoted.preview) +
      '</span></span>' +
      media +
      '</button>'
    );
  }

  /* Grouped reaction pills. The viewer's own reaction is marked so a second
   * tap removes it rather than adding a duplicate. */
  function renderReactions(msg) {
    if (!msg.reactions || !msg.reactions.length) return '';
    return (
      '<div class="tma-dash__messages-reactions">' +
      msg.reactions
        .map(function (reaction) {
          var who = (reaction.users || [])
            .map(function (u) { return u.name; })
            .join(', ');
          return (
            '<button type="button" class="tma-dash__messages-reaction' +
            (reaction.mine ? ' tma-dash__messages-reaction--mine' : '') +
            '" data-messages-react="' + esc(msg.id) +
            '" data-messages-react-emoji="' + esc(reaction.emoji) +
            '" title="' + esc(who) + '">' +
            '<span class="tma-dash__messages-reaction-emoji">' + esc(reaction.emoji) + '</span>' +
            (reaction.count > 1
              ? '<span class="tma-dash__messages-reaction-count">' + reaction.count + '</span>'
              : '') +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }


  /* ------------------------------------------------------------------
   * Link previews
   *
   * Cards are fetched lazily per URL and cached in memory here (the server
   * caches them too). A message never waits on one: it sends immediately and
   * the card fills in when the metadata arrives.
   * ---------------------------------------------------------------- */

  var linkPreviews = {};   // url -> card | null (null = no metadata)
  var linkPreviewsInFlight = {};

  function firstUrlIn(text) {
    if (!text) return null;
    var match = String(text).match(/\bhttps?:\/\/[^\s<>"']+/i);
    return match ? match[0] : null;
  }

  /* Fetch once per URL, then repaint. Misses are remembered so a link with no
   * metadata is not asked about again on every render. */
  function ensureLinkPreview(url, onReady) {
    if (!url || url in linkPreviews) return linkPreviews[url] || null;
    if (linkPreviewsInFlight[url]) return null;

    linkPreviewsInFlight[url] = true;

    window.TMAMessagingAPI.linkPreview(url)
      .then(function (data) {
        linkPreviews[url] = (data && data.preview) || null;
      })
      .catch(function () {
        linkPreviews[url] = null;
      })
      .then(function () {
        delete linkPreviewsInFlight[url];
        if (onReady) onReady();
      });

    return null;
  }

  /*
   * A link card.
   *
   * When the image is the point of the card it gets the room: the picture runs
   * edge to edge and the text sits beneath it, blended into the bubble rather
   * than boxed inside a second panel. The domain appears once, at the bottom —
   * the raw URL is dropped, since the card already says where it goes.
   */
  function renderLinkCard(card, opts) {
    opts = opts || {};

    return (
      '<a class="tma-dash__messages-link-card' +
      (opts.compact ? ' tma-dash__messages-link-card--compact' : '') +
      (card.imageUrl ? '' : ' tma-dash__messages-link-card--textonly') +
      '" href="' + esc(card.url) + '" target="_blank" rel="noopener noreferrer nofollow">' +
      (card.imageUrl
        ? '<span class="tma-dash__messages-link-image">' +
          '<img src="' + esc(card.imageUrl) + '" alt="" loading="lazy"></span>'
        : '') +
      '<span class="tma-dash__messages-link-body">' +
      (card.title
        ? '<span class="tma-dash__messages-link-title">' + esc(card.title) + '</span>'
        : '') +
      (card.description
        ? '<span class="tma-dash__messages-link-desc">' + esc(card.description) + '</span>'
        : '') +
      '<span class="tma-dash__messages-link-site">' +
      (card.faviconUrl
        ? '<img class="tma-dash__messages-link-favicon" src="' + esc(card.faviconUrl) + '" alt="">'
        : '') +
      esc(card.domain || card.siteName || '') +
      '</span>' +
      '</span></a>'
    );
  }

  /* The card attached to a sent message, if its first link has metadata. */
  var linkPreviewTimer = null;

  /*
   * Watch the composer for a link and fetch its card.
   *
   * Waits for the URL to look finished — a trailing space, or a short pause —
   * so a half-typed address isn't requested character by character.
   */
  function scheduleLinkPreview(state, text, render) {
    var url = firstUrlIn(text);

    if (state.composerLinkUrl !== url) {
      state.composerLinkUrl = url;
      state.composerLinkDismissed = null;
      // Repaint straight away so a removed link drops its card.
      if (!url) render();
    }

    if (!url) return;

    if (linkPreviewTimer) clearTimeout(linkPreviewTimer);
    linkPreviewTimer = setTimeout(function () {
      linkPreviewTimer = null;
      if (state.composerLinkUrl !== url) return;

      if (url in linkPreviews) {
        render();
        return;
      }

      ensureLinkPreview(url, function () {
        // Only paint if the composer still holds this link.
        if (state.composerLinkUrl === url) render();
      });
    }, 600);
  }

  function renderMessageLinkCard(msg, render) {
    if (msg.deleted || !msg.body) return '';

    var url = firstUrlIn(msg.body);
    if (!url) return '';

    var card = ensureLinkPreview(url, render);
    return card ? renderLinkCard(card) : '';
  }

  /* ------------------------------------------------------------------
   * Attachment rendering
   *
   * Each kind gets the affordance it actually needs: images and video are
   * shown, audio gets transport controls, and anything else gets its file-type
   * icon plus name and size — the File Library's icons, not a second set.
   * ---------------------------------------------------------------- */

  function renderAttachment(msg, attachment) {
    var open = ' data-messages-attachment="' + esc(attachment.id) + '"';

    if (attachment.kind === 'image') {
      // Reserve the right box from the stored dimensions so the thread doesn't
      // jump as images load while someone is scrolling.
      var ratio =
        attachment.width && attachment.height
          ? ' style="aspect-ratio:' + attachment.width + '/' + attachment.height + '"'
          : '';
      return (
        '<button type="button" class="tma-dash__messages-attachment tma-dash__messages-attachment--image"' +
        open + ' aria-label="Open ' + esc(attachment.name) + '">' +
        '<img src="' + esc(attachment.thumbUrl || attachment.url) + '" alt="' + esc(attachment.name) +
        '" loading="lazy"' + ratio + '>' +
        '</button>'
      );
    }

    if (attachment.kind === 'video') {
      return (
        '<div class="tma-dash__messages-attachment tma-dash__messages-attachment--video">' +
        '<video src="' + esc(attachment.url) + '" controls preload="metadata" playsinline></video>' +
        '</div>'
      );
    }

    if (attachment.kind === 'voice') {
      return renderVoiceNote(msg, attachment);
    }

    if (attachment.kind === 'audio') {
      return (
        '<div class="tma-dash__messages-attachment tma-dash__messages-attachment--audio">' +
        '<audio src="' + esc(attachment.url) + '" controls preload="metadata"></audio>' +
        '<span class="tma-dash__messages-attachment-name">' + esc(attachment.name) + '</span>' +
        '</div>'
      );
    }

    return (
      '<button type="button" class="tma-dash__messages-attachment tma-dash__messages-attachment--file"' +
      open + ' aria-label="Open ' + esc(attachment.name) + '">' +
      '<img class="tma-dash__messages-attachment-icon" src="' +
      esc(attachmentIconSrc(attachment.name)) + '" alt="" width="28" height="28">' +
      '<span class="tma-dash__messages-attachment-text">' +
      '<span class="tma-dash__messages-attachment-name">' + esc(attachment.name) + '</span>' +
      '<span class="tma-dash__messages-attachment-meta">' + esc(formatBytes(attachment.size)) + '</span>' +
      '</span></button>'
    );
  }

  function renderAttachments(msg) {
    if (!msg.attachments || !msg.attachments.length) return '';
    return (
      '<div class="tma-dash__messages-attachments' +
      (msg.attachments.length > 1 ? ' tma-dash__messages-attachments--multi' : '') +
      '">' +
      msg.attachments
        .map(function (a) {
          return renderAttachment(msg, a);
        })
        .join('') +
      '</div>'
    );
  }

  /* Open one attachment in the shared portal lightbox, with the rest of the
   * message's files available as prev/next. */
  function openAttachment(state, attachmentId) {
    if (!window.TMAPortalLightbox) return;

    var all = [];
    var index = 0;

    getMessages(state.selectedId).forEach(function (msg) {
      (msg.attachments || []).forEach(function (a) {
        if (a.id === attachmentId) index = all.length;
        all.push({
          name: a.name,
          mime: a.mime,
          size: a.size,
          url: a.url,
        });
      });
    });

    if (all.length) window.TMAPortalLightbox.open(all, index);
  }

  /* A day separator, inserted between messages sent on different dates. */
  function renderDayDivider(label) {
    return '<div class="tma-dash__messages-divider">' + esc(label) + '</div>';
  }

  /* "Ana added Ben to the group", rendered as a centred system line. */
  function renderSystemMessage(msg) {
    return (
      '<div class="tma-dash__messages-divider tma-dash__messages-divider--system" data-messages-id="' +
      esc(msg.id) + '">' +
      esc(systemMessageText(msg)) +
      '</div>'
    );
  }

  function systemMessageText(msg) {
    var event = msg.systemEvent || {};
    var actor = event.actorName || 'Someone';
    var subject = event.subjectName || 'someone';

    switch (event.event) {
      case 'group_created': return actor + ' created the group';
      case 'member_added': return actor + ' added ' + subject;
      case 'member_removed': return actor + ' removed ' + subject;
      case 'member_left': return actor + ' left';
      case 'admin_granted': return actor + ' made ' + subject + ' an administrator';
      case 'admin_revoked': return actor + ' removed ' + subject + ' as administrator';
      case 'name_changed': return actor + ' changed the group name to "' + (event.name || '') + '"';
      case 'photo_changed': return actor + ' changed the group photo';
      default: return msg.body || 'Conversation updated';
    }
  }

  function renderBubble(msg, index, isReplyTarget, row, showSender, render) {
    if (msg.type === 'system') return renderSystemMessage(msg);

    var timeHtml = renderBubbleTime(msg, row);
    var side = msg.direction === 'out' ? 'out' : 'in';
    var inner;
    var bubbleExtraClass = '';

    if (msg.deleted) {
      inner =
        '<div class="tma-dash__messages-bubble-text tma-dash__messages-bubble-text--deleted">' +
        '<p class="tma-dash__messages-bubble-line">' +
        '<span class="tma-dash__messages-bubble-copy">This message was deleted</span>' +
        timeHtml +
        '</p></div>';
    } else {
      // A message may be files only, text only, or both. When there is no
      // text the timestamp rides under the attachments instead of an empty
      // paragraph.
      var linkCardHtml = renderMessageLinkCard(msg, render);

      /*
       * When the whole message *is* the link and a card was built, the raw URL
       * is dropped: the card already carries the image, the title and the
       * domain, so repeating the address underneath is noise. A link sent
       * alongside a sentence keeps its text.
       */
      var bodyIsOnlyLink =
        !!linkCardHtml && !!msg.body && msg.body.trim() === (firstUrlIn(msg.body) || '');

      var hasText = !!(msg.body && msg.body.trim()) && !bodyIsOnlyLink;

      // A card-only bubble tightens its padding so the image nearly reaches
      // the bubble's edge, leaving only a thin surround.
      if (bodyIsOnlyLink) bubbleExtraClass += ' tma-dash__messages-bubble--card';

      /*
       * The timestamp and ticks always sit at the bottom-right of the bubble.
       *
       * They used to be inline right after the text, so a long or wrapping
       * message left them stranded mid-line. A float keeps them on the last
       * line when there is room and drops them onto their own line when there
       * isn't — which is how every messenger behaves — and the zero-width
       * spacer stops the text running underneath them.
       */
      inner =
        renderAttachments(msg) +
        linkCardHtml +
        '<div class="tma-dash__messages-bubble-text' +
        (hasText ? '' : ' tma-dash__messages-bubble-text--meta') +
        '">' +
        '<p class="tma-dash__messages-bubble-line">' +
        (hasText
          ? '<span class="tma-dash__messages-bubble-copy">' + linkify(msg.body) + '</span>'
          : '') +
        timeHtml +
        '</p></div>';
    }

    // In a group the sender's name sits above their first bubble in a run.
    var senderHtml =
      showSender && side === 'in' && msg.sender
        ? '<span class="tma-dash__messages-bubble-sender">' + esc(msg.sender.name) + '</span>'
        : '';

    /*
     * The bubble and its reactions stack; the action tools sit *beside* that
     * stack rather than under it. They used to be a third block in the column,
     * which pushed them well below the message and far from each other.
     */
    var bubble =
      '<div class="tma-dash__messages-bubble-main">' +
      '<div class="tma-dash__messages-bubble tma-dash__messages-bubble--' + side +
      bubbleExtraClass +
      (isReplyTarget ? ' tma-dash__messages-bubble--reply-target' : '') +
      (msg.failed ? ' tma-dash__messages-bubble--failed' : '') +
      (msg.pending ? ' tma-dash__messages-bubble--pending' : '') +
      '">' +
      senderHtml +
      renderQuotedReply(msg) +
      inner +
      '</div>' +
      renderReactions(msg) +
      '</div>' +
      renderBubbleActions(msg, index);

    return (
      '<div class="tma-dash__messages-bubble-row tma-dash__messages-bubble-row--' +
      side +
      '" data-messages-swipe="' +
      side +
      '" data-messages-index="' +
      index +
      '" data-messages-id="' +
      esc(msg.id) +
      '">' +
      renderSwipeTrack(bubble, side) +
      '</div>'
    );
  }

  /* Hover actions on a bubble: react, reply, and the overflow menu. */
  function renderBubbleActions(msg, index) {
    if (msg.deleted || msg.pending) return '';
    return (
      '<div class="tma-dash__messages-bubble-actions">' +
      '<button type="button" class="tma-dash__messages-icon-btn tma-dash__messages-bubble-action" ' +
      'data-messages-react-open="' + esc(msg.id) + '" aria-label="React to message">' +
      renderMessagesIcon('Smiley') +
      '</button>' +
      '<button type="button" class="tma-dash__messages-icon-btn tma-dash__messages-bubble-action" ' +
      'data-messages-reply="' + index + '" aria-label="Reply to message">' +
      renderMessagesIcon('ArrowBendUpLeft') +
      '</button>' +
      '<button type="button" class="tma-dash__messages-icon-btn tma-dash__messages-bubble-action" ' +
      'data-messages-menu="' + esc(msg.id) + '" aria-label="More actions" aria-haspopup="menu">' +
      renderMessagesIcon('DotsThree') +
      '</button>' +
      '</div>'
    );
  }

  function getInboxUnreadCount(state) {
    return getVisibleThreads(state || {}).reduce(function (total, row) {
      return total + (row.unread || 0);
    }, 0);
  }

  function getComposerDraft(state) {
    if (!state.composerDrafts) state.composerDrafts = {};
    return state.composerDrafts[state.selectedId] || '';
  }

  function setComposerDraft(state, text) {
    if (!state.composerDrafts) state.composerDrafts = {};
    state.composerDrafts[state.selectedId] = text;
  }

  /* ------------------------------------------------------------------
   * Composer attachments
   *
   * Files are uploaded as soon as they are chosen and held as *staged* rows
   * server-side; the message claims them on send. That is what makes a preview,
   * a progress bar, a remove button and a retry possible — and it means a
   * failed upload can never take the typed text with it.
   * ---------------------------------------------------------------- */

  var MAX_ATTACHMENTS = 10;

  function pendingAttachments(state) {
    if (!state.attachments) state.attachments = {};
    if (!state.attachments[state.selectedId]) state.attachments[state.selectedId] = [];
    return state.attachments[state.selectedId];
  }

  function formatBytes(bytes) {
    if (window.TMAPortalLightbox) return window.TMAPortalLightbox.formatBytes(bytes);
    return (Number(bytes) || 0) + ' B';
  }

  function attachmentIconSrc(name) {
    if (window.TMAFileIcons) return window.TMAFileIcons.fileIconSrc(null, name);
    return ICONS.Paperclip;
  }

  function renderComposerAttachments(state) {
    var items = pendingAttachments(state);
    if (!items.length) return '';

    return (
      '<div class="tma-dash__messages-tray">' +
      items
        .map(function (item) {
          var failed = item.status === 'failed';
          var uploading = item.status === 'uploading';

          // A local object URL while uploading, the server thumbnail once it
          // lands — so an image previews immediately rather than after the round trip.
          var thumb = item.previewUrl || (item.attachment && item.attachment.thumbUrl);

          return (
            '<div class="tma-dash__messages-tray-item' +
            (failed ? ' is-failed' : '') +
            '" data-messages-tray-item="' + esc(item.localId) + '">' +
            '<span class="tma-dash__messages-tray-thumb">' +
            (thumb
              ? '<img src="' + esc(thumb) + '" alt="">'
              : '<img class="tma-dash__messages-tray-icon" src="' +
                esc(attachmentIconSrc(item.name)) + '" alt="">') +
            '</span>' +
            '<span class="tma-dash__messages-tray-text">' +
            '<span class="tma-dash__messages-tray-name" title="' + esc(item.name) + '">' +
            esc(item.name) + '</span>' +
            '<span class="tma-dash__messages-tray-meta">' +
            (failed
              ? esc(item.error || 'Upload failed')
              : esc(formatBytes(item.size))) +
            '</span>' +
            (uploading
              ? '<span class="tma-dash__messages-tray-bar"><span class="tma-dash__messages-tray-bar-fill" ' +
                'style="width:' + (item.progress || 0) + '%"></span></span>'
              : '') +
            '</span>' +
            (failed
              ? '<button type="button" class="tma-dash__messages-tray-btn" ' +
                'data-messages-tray-retry="' + esc(item.localId) + '" aria-label="Retry upload">↻</button>'
              : '') +
            '<button type="button" class="tma-dash__messages-tray-btn" ' +
            'data-messages-tray-remove="' + esc(item.localId) + '" aria-label="Remove ' +
            esc(item.name) + '"><span aria-hidden="true">×</span></button>' +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /*
   * The preview shown above the composer as a link is typed.
   *
   * Dismissible: pasting a link and not wanting a card is common. The message
   * still sends immediately either way — nothing here blocks sending.
   */
  function renderComposerLinkPreview(state) {
    var url = state.composerLinkUrl;
    if (!url || state.composerLinkDismissed === url) return '';

    var card = linkPreviews[url];
    if (!card) return '';

    return (
      '<div class="tma-dash__messages-composer-link">' +
      renderLinkCard(card, { compact: true }) +
      '<button type="button" class="tma-dash__messages-composer-link-clear" ' +
      'data-messages-link-dismiss aria-label="Remove link preview">' +
      '<span aria-hidden="true">×</span></button>' +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------
   * Voice notes
   * ---------------------------------------------------------------- */

  function formatDuration(ms) {
    var total = Math.max(0, Math.round((ms || 0) / 1000));
    var mins = Math.floor(total / 60);
    var secs = total % 60;
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function renderWaveform(peaks, extraClass) {
    var bars = (peaks && peaks.length ? peaks : null);

    // No peaks (an older note, or a browser without Web Audio) still gets a
    // bar chart, just a flat one — better than an empty gap.
    if (!bars) {
      bars = [];
      for (var i = 0; i < 40; i++) bars.push(18);
    }

    return (
      '<span class="tma-dash__messages-wave' + (extraClass ? ' ' + extraClass : '') + '" aria-hidden="true">' +
      bars
        .map(function (peak) {
          return '<span class="tma-dash__messages-wave-bar" style="height:' +
            Math.max(8, Math.min(100, peak)) + '%"></span>';
        })
        .join('') +
      '</span>'
    );
  }

  /*
   * The composer while recording, or holding a finished recording for review.
   *
   * Replaces the text field entirely: there is nothing else to do with the
   * composer mid-recording, and a half-visible text box invites typing that
   * would be lost.
   */
  function renderRecorder(state) {
    var rec = state.recording;
    if (!rec) return '';

    if (rec.stage === 'recording' || rec.stage === 'paused') {
      return (
        '<div class="tma-dash__messages-recorder" role="group" aria-label="Recording a voice note">' +
        '<button type="button" class="tma-dash__messages-recorder-btn tma-dash__messages-recorder-cancel" ' +
        'data-messages-record-cancel aria-label="Cancel recording">×</button>' +
        '<span class="tma-dash__messages-recorder-dot' +
        (rec.stage === 'paused' ? ' is-paused' : '') + '" aria-hidden="true"></span>' +
        '<span class="tma-dash__messages-recorder-time">' + esc(formatDuration(rec.elapsedMs)) + '</span>' +
        renderWaveform(rec.livePeaks, 'tma-dash__messages-wave--live') +
        '<button type="button" class="tma-dash__messages-recorder-btn" data-messages-record-pause ' +
        'aria-label="' + (rec.stage === 'paused' ? 'Resume recording' : 'Pause recording') + '">' +
        (rec.stage === 'paused' ? '▶' : '❚❚') +
        '</button>' +
        '<button type="button" class="tma-dash__messages-recorder-btn tma-dash__messages-recorder-send" ' +
        'data-messages-record-stop aria-label="Finish recording">✓</button>' +
        '</div>'
      );
    }

    // Finished: review it before it goes anywhere.
    return (
      '<div class="tma-dash__messages-recorder tma-dash__messages-recorder--review" role="group" ' +
      'aria-label="Review voice note">' +
      '<button type="button" class="tma-dash__messages-recorder-btn tma-dash__messages-recorder-cancel" ' +
      'data-messages-record-discard aria-label="Discard recording">×</button>' +
      '<button type="button" class="tma-dash__messages-recorder-btn" data-messages-record-play ' +
      'aria-label="Play recording">' + (rec.playing ? '❚❚' : '▶') + '</button>' +
      renderWaveform(rec.waveform) +
      '<span class="tma-dash__messages-recorder-time">' + esc(formatDuration(rec.durationMs)) + '</span>' +
      '<button type="button" class="tma-dash__messages-recorder-btn tma-dash__messages-recorder-send" ' +
      'data-messages-record-send aria-label="Send voice note">' +
      renderMessagesIcon('PaperPlaneRight') +
      '</button>' +
      '</div>'
    );
  }

  /* A received voice note: transport, waveform, length and playback speed. */
  function renderVoiceNote(msg, attachment) {
    var speed = STORE.settings.voicePlaybackSpeed || 1;

    return (
      '<div class="tma-dash__messages-voice" data-messages-voice="' + esc(attachment.id) + '" ' +
      'data-messages-voice-src="' + esc(attachment.url) + '" ' +
      // MediaRecorder's WebM carries no duration in the container, so
      // audio.duration reads Infinity. The recorded length is stored instead
      // and used whenever the element cannot report one.
      'data-messages-voice-duration="' + (attachment.durationMs || 0) + '">' +
      '<button type="button" class="tma-dash__messages-voice-play" data-messages-voice-play ' +
      'aria-label="Play voice note">▶</button>' +
      '<span class="tma-dash__messages-voice-track" data-messages-voice-seek>' +
      renderWaveform(attachment.waveform) +
      '<span class="tma-dash__messages-voice-progress" data-messages-voice-progress></span>' +
      '</span>' +
      '<span class="tma-dash__messages-voice-time" data-messages-voice-time>' +
      esc(formatDuration(attachment.durationMs)) +
      '</span>' +
      '<button type="button" class="tma-dash__messages-voice-speed" data-messages-voice-speed ' +
      'aria-label="Playback speed">' + esc(speed + '×') + '</button>' +
      '</div>'
    );
  }

  function renderComposerActionBtn(id, icon, label, extraAttrs) {
    return (
      '<button type="button" class="tma-dash__messages-composer-btn" data-messages-composer-' +
      id +
      ' aria-label="' +
      esc(label) +
      '"' +
      (extraAttrs || '') +
      '>' +
      renderMessagesIcon(icon) +
      '</button>'
    );
  }

  /* One tappable emoji. `label` is the Unicode name, for screen readers. */
  function renderEmojiButton(char, label) {
    return (
      '<button type="button" class="tma-dash__messages-emoji-picker-item" ' +
      'data-messages-emoji-char="' + esc(char) + '" ' +
      'title="' + esc(label || '') + '" aria-label="' + esc(label || 'Emoji') + '">' +
      esc(char) +
      '</button>'
    );
  }

  function renderEmojiGrid(items) {
    return (
      '<div class="tma-dash__messages-emoji-picker-grid">' +
      items
        .map(function (item) {
          return renderEmojiButton(item.c, item.n);
        })
        .join('') +
      '</div>'
    );
  }

  function renderEmojiPicker(state) {
    var open = !!state.emojiPickerOpen;
    var data = emojiData();
    var term = state.emojiSearch || '';
    var body;

    if (term.trim()) {
      var hits = searchEmoji(term);
      body = hits.length
        ? renderEmojiGrid(hits)
        : '<div class="tma-dash__messages-emoji-empty">No emoji match “' + esc(term) + '”</div>';
    } else {
      var recents = recentEmoji();
      var activeKey = state.emojiCategory || (data.groups[0] && data.groups[0].key);

      // Recents are their own pseudo-category, shown first when present.
      if (activeKey === 'recent') {
        body = recents.length
          ? renderEmojiGrid(recents.map(function (c) { return { c: c, n: '' }; }))
          : '<div class="tma-dash__messages-emoji-empty">No recent emoji yet</div>';
      } else {
        var group = null;
        data.groups.forEach(function (g) {
          if (g.key === activeKey) group = g;
        });
        body = group ? renderEmojiGrid(group.items) : '';
      }
    }

    var tabs = [];
    if (recentEmoji().length) tabs.push({ key: 'recent', label: 'Recent', glyph: '🕘' });
    data.groups.forEach(function (g) {
      tabs.push({ key: g.key, label: g.label, glyph: g.items[0] ? g.items[0].c : '·' });
    });

    var activeTab = state.emojiCategory || (data.groups[0] && data.groups[0].key);

    return (
      '<div class="tma-dash__messages-emoji-picker' +
      (open ? ' tma-dash__messages-emoji-picker--open' : '') +
      '" data-messages-emoji-picker' +
      (open ? '' : ' hidden') +
      ' role="dialog" aria-label="Choose emoji">' +
      '<div class="tma-dash__messages-emoji-search">' +
      '<input type="search" class="tma-dash__messages-emoji-search-input" data-messages-emoji-search ' +
      'placeholder="Search emoji" aria-label="Search emoji" value="' + esc(term) + '" autocomplete="off">' +
      '</div>' +
      '<div class="tma-dash__messages-emoji-body">' + body + '</div>' +
      // Category strip is hidden while searching — the results span categories.
      (term.trim()
        ? ''
        : '<div class="tma-dash__messages-emoji-tabs" role="tablist">' +
          tabs
            .map(function (tab) {
              return (
                '<button type="button" role="tab" class="tma-dash__messages-emoji-tab' +
                (tab.key === activeTab ? ' is-active' : '') +
                '" data-messages-emoji-category="' + esc(tab.key) + '" ' +
                'title="' + esc(tab.label) + '" aria-label="' + esc(tab.label) + '" ' +
                'aria-selected="' + (tab.key === activeTab ? 'true' : 'false') + '">' +
                esc(tab.glyph) +
                '</button>'
              );
            })
            .join('') +
          '</div>') +
      '</div>'
    );
  }

  /*
   * The compact reaction row shown above the message context menu, plus a
   * button that opens the full picker for anything else.
   */
  function renderQuickReactions(messageId, mine) {
    var quick = emojiData().quick || [];

    return (
      '<div class="tma-dash__messages-quick-reactions">' +
      quick
        .map(function (char) {
          return (
            // Distinct attribute from the reaction pills under a bubble: the
            // two look similar but mean different things (offer vs. existing),
            // and sharing one hook made every selector ambiguous.
            '<button type="button" class="tma-dash__messages-quick-reaction' +
            (mine.indexOf(char) !== -1 ? ' is-mine' : '') +
            '" data-messages-quick-react="' + esc(messageId) + '" ' +
            'data-messages-quick-emoji="' + esc(char) + '" aria-label="React with ' + esc(char) + '">' +
            esc(char) +
            '</button>'
          );
        })
        .join('') +
      '<button type="button" class="tma-dash__messages-quick-reaction ' +
      'tma-dash__messages-quick-reaction--more" data-messages-react-open="' + esc(messageId) + '" ' +
      'aria-label="More emoji">+</button>' +
      '</div>'
    );
  }

  function renderComposer(state) {
    var draft = getComposerDraft(state);
    var editing = !!state.editing;

    return (
      '<div class="tma-dash__messages-composer-wrap' +
      (editing ? ' tma-dash__messages-composer-wrap--editing' : '') +
      '">' +
      renderEmojiPicker(state) +
      (editing
        ? '<div class="tma-dash__messages-composer-editing">Editing message — press Escape to cancel</div>'
        : '') +
      renderComposerLinkPreview(state) +
      renderComposerAttachments(state) +
      // Recording replaces the input row entirely — there is nothing else to
      // do with the composer mid-recording.
      (state.recording
        ? renderRecorder(state)
        : '<div class="tma-dash__messages-composer-main">' +
      '<div class="tma-dash__messages-composer-input' +
      (draft ? ' tma-dash__messages-composer-input--filled' : '') +
      '" contenteditable="true" data-messages-composer-input data-placeholder="Type message" role="textbox" aria-multiline="true" aria-label="Message">' +
      esc(draft) +
      '</div>' +
      '<div class="tma-dash__messages-composer-tools">' +
      renderComposerActionBtn(
        'emoji',
        'Smiley',
        'Add emoji',
        ' aria-expanded="' + (state.emojiPickerOpen ? 'true' : 'false') + '" aria-haspopup="dialog"'
      ) +
      renderComposerActionBtn('attach', 'Paperclip', 'Attach files', ' title="Attach files"') +
      '<input type="file" class="tma-dash__messages-composer-file" data-messages-composer-file hidden multiple>' +
      renderComposerActionBtn('voice', 'Microphone', 'Record voice note', ' title="Record voice note"') +
      '<button type="button" class="tma-dash__messages-composer-btn tma-dash__messages-composer-send" data-messages-composer-send aria-label="' +
      (editing ? 'Save edit' : 'Send message') +
      '">' +
      renderMessagesIcon('PaperPlaneRight') +
      '</button></div></div>') +
      '</div>'
    );
  }

  function insertComposerText(input, text) {
    if (!input || !text) return;
    input.focus();
    var selection = window.getSelection();
    if (!selection) return;
    var range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !input.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    range.deleteContents();
    var node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function syncComposerInputState(input) {
    if (!input) return;
    var hasText = (input.textContent || '').trim().length > 0;
    input.classList.toggle('tma-dash__messages-composer-input--filled', hasText);
  }

  function bindComposer(root, state, render) {
    var composer = root.querySelector('.tma-dash__messages-composer');
    if (!composer) return;

    var input = composer.querySelector('[data-messages-composer-input]');
    var emojiBtn = composer.querySelector('[data-messages-composer-emoji]');
    var sendBtn = composer.querySelector('[data-messages-composer-send]');
    var picker = composer.querySelector('[data-messages-emoji-picker]');

    if (input) {
      syncComposerInputState(input);

      input.addEventListener('input', function () {
        var text = input.textContent || '';
        setComposerDraft(state, text);
        syncComposerInputState(input);

        // Keep the list row's "Draft:" preview in step without a re-render,
        // which would move the caret out from under the user.
        var row = findThread(state.selectedId);
        if (row && !state.editing) row.draft = text.trim() ? text : null;

        if (state.selectedId && !state.editing) scheduleDraftSave(state.selectedId, text);

        // Look up a preview for the first link as it is typed. Debounced with
        // the draft save so a half-typed URL isn't fetched on every keystroke.
        scheduleLinkPreview(state, text, render);
      });

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && state.editing) {
          e.preventDefault();
          state.editing = null;
          setComposerDraft(state, '');
          render();
          return;
        }

        if (e.key !== 'Enter') return;

        // Enter's behaviour follows the user's own setting: either Enter sends
        // and Shift+Enter breaks the line, or Enter always breaks the line and
        // only the send button sends.
        var enterSends = STORE.settings.enterToSend !== false;

        if (enterSends && !e.shiftKey) {
          e.preventDefault();
          if (sendBtn) sendBtn.click();
        }
      });

      // Paste as plain text: the composer is contenteditable, so pasted markup
      // would otherwise land as live HTML inside the message. A pasted *file*
      // (a screenshot, typically) is attached instead.
      input.addEventListener('paste', function (e) {
        if (!e.clipboardData) return;

        var files = e.clipboardData.files;
        if (files && files.length) {
          e.preventDefault();
          queueFiles(root, state, render, files);
          return;
        }

        e.preventDefault();
        insertComposerText(input, e.clipboardData.getData('text/plain'));
      });
    }

    function closeEmojiPicker() {
      state.emojiPickerOpen = false;
      if (picker) {
        picker.hidden = true;
        picker.classList.remove('tma-dash__messages-emoji-picker--open');
      }
      if (emojiBtn) emojiBtn.setAttribute('aria-expanded', 'false');
    }

    /*
     * Opening re-renders rather than just unhiding.
     *
     * The picker's contents depend on state that changes while it is closed —
     * recently used emoji above all — and simply flipping `hidden` showed
     * whatever markup was produced the last time the composer rendered. A
     * freshly used emoji never appeared under Recent because of it.
     */
    function toggleEmojiPicker() {
      var opening = !state.emojiPickerOpen;
      state.emojiPickerOpen = opening;

      if (opening) {
        state.emojiSearch = '';
        render();
        focusComposerInput(root);
        return;
      }

      if (picker) {
        picker.hidden = true;
        picker.classList.remove('tma-dash__messages-emoji-picker--open');
      }
      if (emojiBtn) emojiBtn.setAttribute('aria-expanded', 'false');
    }

    if (emojiBtn) {
      emojiBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleEmojiPicker();
      });
    }

    if (picker) {
      // Inserting keeps the picker open — people usually add more than one —
      // and remembers the choice for the Recent tab.
      picker.querySelectorAll('[data-messages-emoji-char]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var char = btn.getAttribute('data-messages-emoji-char');
          rememberEmoji(char);
          insertComposerText(input, char);
        });
      });

      var emojiSearch = picker.querySelector('[data-messages-emoji-search]');
      if (emojiSearch) {
        emojiSearch.addEventListener('click', function (e) {
          e.stopPropagation();
        });
        emojiSearch.addEventListener('input', function () {
          state.emojiSearch = emojiSearch.value;
          render();
        });
      }

      picker.querySelectorAll('[data-messages-emoji-category]').forEach(function (tab) {
        tab.addEventListener('click', function (e) {
          e.stopPropagation();
          state.emojiCategory = tab.getAttribute('data-messages-emoji-category');
          state.emojiSearch = '';
          render();
        });
      });
    }

    var attachBtn = composer.querySelector('[data-messages-composer-attach]');
    var fileInput = composer.querySelector('[data-messages-composer-file]');

    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', function () {
        fileInput.click();
      });
      fileInput.addEventListener('change', function () {
        queueFiles(root, state, render, fileInput.files);
        // Reset so choosing the same file twice still fires a change event.
        fileInput.value = '';
      });
    }

    var linkDismiss = composer.querySelector('[data-messages-link-dismiss]');
    if (linkDismiss) {
      linkDismiss.addEventListener('click', function () {
        state.composerLinkDismissed = state.composerLinkUrl;
        render();
      });
    }

    composer.querySelectorAll('[data-messages-tray-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        removeAttachment(root, state, render, btn.getAttribute('data-messages-tray-remove'));
      });
    });

    composer.querySelectorAll('[data-messages-tray-retry]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-messages-tray-retry');
        pendingAttachments(state).forEach(function (item) {
          if (item.localId === id) startUpload(root, state, render, item);
        });
        render();
      });
    });

    var voiceBtn = composer.querySelector('[data-messages-composer-voice]');
    if (voiceBtn) {
      voiceBtn.addEventListener('click', function () {
        startRecording(root, state, render);
      });
    }

    var recControls = [
      ['[data-messages-record-cancel]', function () { cancelRecording(root, state, render); }],
      ['[data-messages-record-discard]', function () { cancelRecording(root, state, render); }],
      ['[data-messages-record-pause]', function () { togglePauseRecording(root, state, render); }],
      ['[data-messages-record-stop]', function () { stopRecording(root, state, render); }],
      ['[data-messages-record-play]', function () { togglePreviewPlayback(root, state, render); }],
      ['[data-messages-record-send]', function () { sendRecording(root, state, render); }],
    ];

    recControls.forEach(function (pair) {
      var el = composer.querySelector(pair[0]);
      if (el) el.addEventListener('click', pair[1]);
    });

    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        var text = input ? (input.textContent || '').trim() : getComposerDraft(state).trim();

        // A message may be files only. Bailing on empty text here is what
        // previously made an attachment-only send do nothing at all.
        if (!text && !pendingAttachments(state).length) return;

        state.emojiPickerOpen = false;

        // The composer doubles as the edit field while a message is being
        // edited, so the same button commits the edit.
        if (state.editing) {
          commitEdit(root, state, render, text);
          return;
        }

        var row = findThread(state.selectedId);
        if (row) row.draft = null;
        flushDraft(state.selectedId, '');

        sendMessage(root, state, render, text);
      });
    }

    if (!root._messagesComposerDocBound) {
      root._messagesComposerDocBound = true;
      document.addEventListener('click', function (e) {
        if (!state.emojiPickerOpen) return;
        var activeComposer = root.querySelector('.tma-dash__messages-composer');
        if (activeComposer && activeComposer.contains(e.target)) return;
        state.emojiPickerOpen = false;
        var activePicker = root.querySelector('[data-messages-emoji-picker]');
        if (activePicker) {
          activePicker.hidden = true;
          activePicker.classList.remove('tma-dash__messages-emoji-picker--open');
        }
        var activeEmojiBtn = root.querySelector('[data-messages-composer-emoji]');
        if (activeEmojiBtn) activeEmojiBtn.setAttribute('aria-expanded', 'false');
      });
    }
  }

  function renderChatBackBtn(state) {
    var unread = getInboxUnreadCount(state);
    var countHtml = unread
      ? '<span class="tma-dash__messages-chat-back-count">' + esc(String(unread)) + '</span>'
      : '';
    var label = unread ? 'Back to Messages, ' + unread + ' unread' : 'Back to Messages';
    return (
      '<button type="button" class="tma-dash__messages-chat-back' +
      (unread ? ' tma-dash__messages-chat-back--unread' : '') +
      '" data-messages-back aria-label="' +
      esc(label) +
      '">' +
      '<img src="' +
      ICONS.CaretLeft +
      '" alt="">' +
      countHtml +
      '</button>'
    );
  }

  /* "Today" / "Yesterday" / "12 March 2026", for the day separators. */
  function dayLabel(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';

    var today = new Date();
    var startOfDay = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    var diffDays = Math.round((startOfDay(today) - startOfDay(date)) / 86400000);

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });

    return date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    });
  }

  function sameDay(a, b) {
    if (!a || !b) return false;
    var x = new Date(a);
    var y = new Date(b);
    return (
      x.getFullYear() === y.getFullYear() &&
      x.getMonth() === y.getMonth() &&
      x.getDate() === y.getDate()
    );
  }

  function renderChatBody(state, row, render) {
    var bucket = threadBucket(state.selectedId);
    var messages = bucket.messages;

    if (!bucket.loaded && !messages.length) {
      return '<div class="tma-dash__messages-chat-state" role="status">Loading messages…</div>';
    }

    if (bucket.error) {
      return (
        '<div class="tma-dash__messages-chat-state tma-dash__messages-chat-state--error">' +
        '<p>Messages could not be loaded.</p>' +
        '<button type="button" class="tma-dash__messages-list-retry" data-messages-thread-retry>Try again</button>' +
        '</div>'
      );
    }

    if (!messages.length) {
      return '<div class="tma-dash__messages-chat-state">No messages yet. Say hello.</div>';
    }

    // The "load older" affordance sits at the top; scrolling into it triggers
    // the fetch, and it keeps working when there is no pointer to scroll with.
    var head = bucket.hasMore
      ? '<button type="button" class="tma-dash__messages-load-more" data-messages-load-more' +
        (bucket.loadingOlder ? ' disabled' : '') + '>' +
        (bucket.loadingOlder ? 'Loading…' : 'Load earlier messages') +
        '</button>'
      : '';

    var isGroup = row && row.type === 'group';
    var replyId = state.replyTo && state.replyTo.threadId === state.selectedId
      ? state.replyTo.messageId
      : null;

    var html = '';
    messages.forEach(function (msg, index) {
      var previous = messages[index - 1];

      if (!previous || !sameDay(previous.sentAt, msg.sentAt)) {
        html += renderDayDivider(dayLabel(msg.sentAt));
      }

      // Only label the first bubble of a run by the same sender.
      var showSender =
        isGroup &&
        msg.direction === 'in' &&
        (!previous ||
          previous.type === 'system' ||
          !previous.sender ||
          !msg.sender ||
          previous.sender.id !== msg.sender.id);

      html += renderBubble(msg, index, replyId === msg.id, row, showSender, render);
    });

    return head + html;
  }

  function renderChat(state, render) {
    var row = findThread(state.selectedId);

    if (!row) {
      return (
        '<div class="tma-dash__messages-chat tma-dash__messages-chat--empty"><p>' +
        (STORE.loaded && !getThreads().length
          ? 'Start a conversation to begin messaging.'
          : 'Select a conversation') +
        '</p></div>'
      );
    }

    var mobile = isMessagesMobile();

    return (
      '<div class="tma-dash__messages-chat">' +
      '<div class="tma-dash__messages-chat-head">' +
      '<div class="tma-dash__messages-chat-contact">' +
      (mobile && isMessagesReading(state) ? renderChatBackBtn(state) : '') +
      renderChatThreadIcon(row) +
      '<span class="tma-dash__messages-chat-contact-text">' +
      renderChatContactText(row) +
      '</span>' +
      '</div>' +
      '<div class="tma-dash__messages-chat-actions">' +
      // Calling is out of scope for this phase: the buttons stay in the design
      // but are disabled and announced as unavailable rather than doing nothing.
      [
        { icon: 'Phone', label: 'Voice call (unavailable)', disabled: true },
        { icon: 'VideoCamera', label: 'Video call (unavailable)', disabled: true },
        {
          icon: 'DotsThree',
          label: 'Conversation menu',
          attr: ' data-messages-conversation-menu aria-haspopup="menu"',
        },
      ]
        .map(function (action) {
          return (
            '<button type="button" class="tma-dash__messages-icon-btn' +
            (action.disabled ? ' tma-dash__messages-icon-btn--disabled' : '') +
            '" aria-label="' + esc(action.label) + '"' +
            (action.disabled ? ' disabled aria-disabled="true" title="Calling is not available yet"' : '') +
            (action.attr || '') +
            '>' +
            '<img src="' + esc(ICONS[action.icon]) + '" alt="">' +
            '</button>'
          );
        })
        .join('') +
      // Close the conversation and go back to the list. Escape does the same.
      '<button type="button" class="tma-dash__messages-icon-btn tma-dash__messages-chat-close" ' +
      'data-messages-close aria-label="Close conversation" title="Close conversation (Esc)">' +
      '<span aria-hidden="true">×</span></button>' +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__messages-chat-body" data-messages-chat-body>' +
      renderChatBody(state, row, render) +
      '</div>' +
      '<div class="tma-dash__messages-composer' +
      (state.replyTo && state.replyTo.threadId === state.selectedId ? ' tma-dash__messages-composer--reply' : '') +
      '">' +
      renderReplyPreview(state) +
      renderComposer(state) +
      '</div>' +
      '</div>'
    );
  }

  function renderLayout(state, render) {
    var layoutCls = 'tma-dash__messages-layout';
    if (isMessagesMobile()) {
      layoutCls += ' tma-dash__messages-layout--mobile';
      if (isMessagesReading(state)) layoutCls += ' tma-dash__messages-layout--mobile-reading';
    }
    var html = '<div class="' + layoutCls + '">' + renderList(state) + renderChat(state, render) + '</div>';
    return html;
  }

  function getMessagesDashRoot() {
    return document.querySelector('.tma-dash');
  }

  function ensureMessagesMobileHeader(root, state) {
    var dash = getMessagesDashRoot();
    if (!dash) return;

    dash.classList.toggle('tma-dash--messages-mobile', isMessagesMobile());
    dash.classList.toggle('tma-dash--messages-mobile-reading', isMessagesReading(state));

    if (typeof dash._syncSidebarToggleIcon === 'function') dash._syncSidebarToggleIcon();
  }

  function clearMessagesMobileHeader() {
    var dash = getMessagesDashRoot();
    if (!dash) return;
    dash.classList.remove('tma-dash--messages-mobile', 'tma-dash--messages-mobile-reading');
    if (typeof dash._syncSidebarToggleIcon === 'function') dash._syncSidebarToggleIcon();
  }

  function bindMessageSwipes(root, state, render) {
    var chatBody = root.querySelector('.tma-dash__messages-chat-body');

    root.querySelectorAll('[data-messages-swipe]').forEach(function (row) {
      if (row.dataset.messagesSwipeBound) return;
      row.dataset.messagesSwipeBound = '1';

      var side = row.getAttribute('data-messages-swipe');
      var index = parseInt(row.getAttribute('data-messages-index'), 10);
      var swipe = row.querySelector('.tma-dash__messages-bubble-swipe');
      var track = row.querySelector('[data-messages-swipe-track]');
      var replyIcon = row.querySelector('.tma-dash__messages-bubble-swipe-reply');
      if (!track || !swipe || side !== 'in' && side !== 'out') return;

      var startX = 0;
      var startY = 0;
      var startOffset = 0;
      var dragging = false;
      var moved = false;
      var wheelEndTimer = null;

      function getCurrentOffset() {
        var match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform || '');
        return match ? parseFloat(match[1]) : 0;
      }

      function setOffset(px) {
        var clamped =
          side === 'in'
            ? Math.max(0, Math.min(REPLY_SWIPE_MAX, px))
            : Math.min(0, Math.max(-REPLY_SWIPE_MAX, px));
        var progress = Math.abs(clamped) / REPLY_SWIPE_MAX;

        if (Math.abs(clamped) < 1) {
          track.style.transform = '';
          swipe.classList.remove('is-replying');
          if (replyIcon) replyIcon.style.opacity = '';
          return 0;
        }

        track.style.transform = 'translateX(' + clamped + 'px)';
        swipe.classList.toggle('is-replying', progress > 0.12);
        if (replyIcon) replyIcon.style.opacity = String(Math.min(1, progress * 1.35));
        return clamped;
      }

      function resetSwipe(animate) {
        track.classList.remove('is-dragging');
        swipe.classList.remove('is-replying');
        if (replyIcon) replyIcon.style.opacity = '';
        if (chatBody) chatBody.classList.remove('is-swipe-dragging');
        if (animate) {
          track.style.transform = '';
          return;
        }
        setOffset(0);
      }

      function clearWheelEndTimer() {
        if (wheelEndTimer) {
          clearTimeout(wheelEndTimer);
          wheelEndTimer = null;
        }
      }

      function finishSwipeGesture() {
        if (!track.isConnected) return;
        track.classList.remove('is-dragging');
        if (chatBody) chatBody.classList.remove('is-swipe-dragging');
        var current = getCurrentOffset();
        var trigger = getReplySwipeTrigger();

        if (side === 'in' && current >= trigger) {
          triggerReply();
          return;
        }
        if (side === 'out' && current <= -trigger) {
          triggerReply();
          return;
        }

        resetSwipe(true);
      }

      function scheduleWheelEnd() {
        clearWheelEndTimer();
        wheelEndTimer = setTimeout(finishSwipeGesture, 160);
      }

      function triggerReply() {
        clearWheelEndTimer();

        // setReplyTo takes a message *id*. This passed the bubble's numeric
        // index — a leftover from when replies were tracked by position — so
        // the swipe stored a reply target no message could ever match and the
        // preview never appeared.
        var msg = getMessages(state.selectedId)[index];
        if (!msg) {
          resetSwipe(true);
          return;
        }

        setReplyTo(state, msg.id);
        resetSwipe(true);
        render();
        focusComposerInput(root);
      }

      function wheelDeltaX(e) {
        return messagesWheelDeltaX(e, track.clientWidth || wrap.offsetWidth || 320);
      }

      function beginDrag(clientX, clientY) {
        clearWheelEndTimer();
        dragging = true;
        moved = false;
        startX = clientX;
        startY = clientY;
        startOffset = getCurrentOffset();
        track.classList.add('is-dragging');
      }

      /*
       * Decide once, early, whether a gesture is a horizontal swipe-to-reply
       * or a vertical scroll, then commit to that decision.
       *
       * DEAD_ZONE keeps a tap or a slightly shaky finger from moving anything
       * at all. AXIS_RATIO is what stops the swipe firing during a scroll: the
       * horizontal component has to clearly dominate, not merely win by a
       * pixel, which is how a fast thumb-scroll used to trigger a reply.
       */
      var DEAD_ZONE = 8;
      var AXIS_RATIO = 1.3;

      function moveDrag(clientX, clientY, prevent, pointerId) {
        if (!dragging) return;
        var dx = clientX - startX;
        var dy = clientY - startY;

        if (!moved) {
          if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;

          if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) {
            // A scroll, not a swipe. Give the pointer back so the list
            // actually scrolls — holding capture here left the gesture dead.
            dragging = false;
            track.classList.remove('is-dragging');
            if (pointerId !== undefined && track.hasPointerCapture(pointerId)) {
              track.releasePointerCapture(pointerId);
            }
            setOffset(0);
            return;
          }

          moved = true;
          if (chatBody) chatBody.classList.add('is-swipe-dragging');
        }

        if (prevent) prevent();

        // Past the trigger the bubble resists further travel, so the gesture
        // has a felt end point rather than sliding on to the clamp.
        var raw = startOffset + dx;
        var trigger = getReplySwipeTrigger();
        if (Math.abs(raw) > trigger) {
          var overshoot = Math.abs(raw) - trigger;
          raw = (raw < 0 ? -1 : 1) * (trigger + overshoot * 0.35);
        }

        setOffset(raw);
      }

      function endDrag() {
        if (!dragging) {
          track.classList.remove('is-dragging');
          if (chatBody) chatBody.classList.remove('is-swipe-dragging');
          return;
        }
        dragging = false;
        finishSwipeGesture();
      }

      track.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        // Interactive controls inside a bubble (react / reply / menu, and a
        // quoted reply) must keep their click. Starting a swipe here would
        // capture the pointer and the click would never arrive.
        if (e.target.closest(INTERACTIVE_IN_BUBBLE)) return;
        beginDrag(e.clientX, e.clientY);
        track.setPointerCapture(e.pointerId);
      });

      track.addEventListener(
        'pointermove',
        function (e) {
          if (!dragging) return;
          moveDrag(
            e.clientX,
            e.clientY,
            function () {
              e.preventDefault();
            },
            e.pointerId
          );
        },
        { passive: false }
      );

      track.addEventListener('pointerup', function (e) {
        if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
        endDrag();
      });

      track.addEventListener('pointercancel', function (e) {
        if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
        endDrag();
      });

      track.addEventListener(
        'wheel',
        function (e) {
          if (dragging) return;
          // Interactive controls inside a bubble (react / reply / menu, and a
        // quoted reply) must keep their click. Starting a swipe here would
        // capture the pointer and the click would never arrive.
        if (e.target.closest(INTERACTIVE_IN_BUBBLE)) return;

          var dx = wheelDeltaX(e);
          var dy = e.deltaY;
          if (Math.abs(dx) < 0.5) return;

          var current = getCurrentOffset();
          var movement = -dx;
          var forward = side === 'in' ? movement > 0 : movement < 0;
          var backward = side === 'in' ? movement < 0 && current > 0 : movement > 0 && current < 0;

          if (!forward && !backward) {
            if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
            return;
          }

          if (Math.abs(dx) <= Math.abs(dy) * 0.85 && Math.abs(current) < 1) return;

          e.preventDefault();
          track.classList.add('is-dragging');
          if (chatBody) chatBody.classList.add('is-swipe-dragging');
          setOffset(current + movement);
          scheduleWheelEnd();
        },
        { passive: false }
      );
    });
  }

  function ensureMessagesToast(dash) {
    if (!dash || dash.querySelector('[data-messages-toast]')) return;
    var toast = document.createElement('div');
    toast.className = 'tma-dash__messages-toast';
    toast.hidden = true;
    toast.setAttribute('data-messages-toast', '');
    toast.innerHTML =
      '<img src="' + ICONS.CheckCircle + '" alt="">' +
      '<span data-messages-toast-text></span>';
    dash.appendChild(toast);
  }

  function showMessagesToast(root, message) {
    var dash = root.closest('.tma-dash');
    if (!dash) return;
    ensureMessagesToast(dash);
    var toast = dash.querySelector('[data-messages-toast]');
    var text = dash.querySelector('[data-messages-toast-text]');
    if (!toast || !text) return;
    text.textContent = message;
    toast.hidden = false;
    window.requestAnimationFrame(function () {
      toast.classList.add('tma-dash__messages-toast--visible');
    });
    window.clearTimeout(dash._messagesToastTimer);
    // Long messages need longer to read than "Message copied" does.
    var linger = message.length > 60 ? 5200 : 2800;
    dash._messagesToastTimer = window.setTimeout(function () {
      toast.classList.remove('tma-dash__messages-toast--visible');
      window.setTimeout(function () {
        toast.hidden = true;
      }, 240);
    }, linger);
  }

  function closeMessagesRowSwipes(root, except) {
    if (!root) return;
    root.querySelectorAll('[data-messages-row-swipe]').forEach(function (wrap) {
      if (except && wrap === except) return;
      if (!wrap.classList.contains('is-open-left') && !wrap.classList.contains('is-open-right')) return;
      wrap.classList.remove(
        'is-open-left',
        'is-open-right',
        'is-right-wide',
        'is-left-wide',
        'is-dragging'
      );
      wrap.style.removeProperty('--messages-swipe-right-width');
      wrap.style.removeProperty('--messages-swipe-left-width');
      var track = wrap.querySelector('[data-messages-row-swipe-track]');
      if (track) track.style.transform = '';
    });
  }

  function animateMessagesRowDismiss(wrap, destination, callback) {
    if (!wrap) {
      if (callback) callback();
      return;
    }
    var track = wrap.querySelector('[data-messages-row-swipe-track]');
    var max = wrap.offsetWidth || 0;
    var isDelete = destination === 'trash';
    wrap.style.setProperty('--messages-swipe-row-h', wrap.offsetHeight + 'px');
    wrap.classList.remove('is-dragging', 'is-open-left', 'is-open-right');
    wrap.classList.add(isDelete ? 'is-deleting' : 'is-archiving');
    wrap.style.setProperty('--messages-swipe-right-width', max + 'px');
    wrap.classList.add('is-right-wide');
    if (track) track.style.transform = 'translateX(-' + max + 'px)';

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      if (callback) callback();
    }

    window.setTimeout(function () {
      wrap.classList.add('is-dismissing--collapse');
      function onCollapseEnd(e) {
        if (e.target !== wrap || e.propertyName !== 'max-height') return;
        wrap.removeEventListener('transitionend', onCollapseEnd);
        finish();
      }
      wrap.addEventListener('transitionend', onCollapseEnd);
      window.setTimeout(finish, 360);
    }, 280);
    window.setTimeout(finish, 720);
  }

  /*
   * Pin / mute / archive, applied optimistically then persisted.
   *
   * The row is updated in place rather than by reloading the list, so acting
   * on a conversation never re-orders or re-scrolls what the user is looking
   * at. A failed write puts the previous value back and says so.
   */
  function commitMessagesRowAction(root, state, render, id, action) {
    var row = findThread(id);
    if (!row) return;

    var previous = { pinned: row.pinned, muted: row.muted, archived: row.archived };
    var changes = null;
    var message = '';

    if (action === 'pin') {
      row.pinned = !row.pinned;
      changes = { pinned: row.pinned };
      message = row.pinned ? 'Conversation pinned' : 'Conversation unpinned';
    } else if (action === 'mute') {
      row.muted = !row.muted;
      // null = mute indefinitely, 0 = unmute.
      changes = { muteMinutes: row.muted ? null : 0 };
      message = row.muted ? 'Conversation muted' : 'Conversation unmuted';
    } else if (action === 'archive') {
      row.archived = !row.archived;
      changes = { archived: row.archived };
      message = row.archived ? 'Conversation archived' : 'Conversation unarchived';
    } else if (action === 'read') {
      row.unread = 0;
      row.markedUnread = false;
      render();
      syncTabBarBadges();
      window.TMAMessagingAPI.markRead(id).catch(function () {});
      return;
    } else if (action === 'unread') {
      row.unread = row.unread || 1;
      row.markedUnread = true;
      render();
      syncTabBarBadges();
      window.TMAMessagingAPI.markUnread(id).catch(function () {});
      return;
    }

    if (!changes) return;

    render();
    showMessagesToast(root, message);
    syncTabBarBadges();

    window.TMAMessagingAPI.updateConversation(id, changes).catch(function () {
      row.pinned = previous.pinned;
      row.muted = previous.muted;
      row.archived = previous.archived;
      render();
      showMessagesToast(root, 'That change could not be saved');
    });
  }

  function syncTabBarBadges() {
    var dash = document.querySelector('.tma-dash');
    if (dash && typeof dash._syncTabBarBadges === 'function') dash._syncTabBarBadges();
  }

  function applyMessagesRowAction(root, state, render, id, action, wrap) {
    if (!id || (wrap && (wrap.classList.contains('is-deleting') || wrap.classList.contains('is-archiving')))) {
      return;
    }
    closeMessagesRowSwipes(root);
    if ((action === 'trash' || action === 'archive') && wrap) {
      animateMessagesRowDismiss(wrap, action, function () {
        commitMessagesRowAction(root, state, render, id, action);
      });
      return;
    }
    commitMessagesRowAction(root, state, render, id, action);
  }

  function bindMessagesInboxSwipes(root, state, render) {
    if (!isMessagesMobile() || isMessagesReading(state)) return;

    var listBody = root.querySelector('.tma-dash__messages-list-body');

    root.querySelectorAll('[data-messages-row-swipe]').forEach(function (wrap) {
      if (wrap.dataset.swipeBound) return;
      wrap.dataset.swipeBound = '1';

      var track = wrap.querySelector('[data-messages-row-swipe-track]');
      if (!track) return;

      var startX = 0;
      var startOffset = 0;
      var dragging = false;
      var moved = false;
      var wheelEndTimer = null;

      function swipeMaxWidth() {
        return wrap.offsetWidth || 0;
      }

      function getCurrentOffset() {
        var match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform || '');
        return match ? parseFloat(match[1]) : 0;
      }

      function clearWheelEndTimer() {
        if (wheelEndTimer) {
          clearTimeout(wheelEndTimer);
          wheelEndTimer = null;
        }
      }

      function leftSnapWidth() {
        return 168;
      }

      function rightSnapWidth() {
        return 168;
      }

      function syncLeftReveal(revealPx) {
        var max = swipeMaxWidth();
        var width = Math.max(0, Math.min(max, revealPx));
        if (width < 1) {
          wrap.style.removeProperty('--messages-swipe-left-width');
          wrap.classList.remove('is-left-wide');
          return 0;
        }
        wrap.style.setProperty('--messages-swipe-left-width', width + 'px');
        wrap.classList.toggle('is-left-wide', width >= max * 0.92);
        return width;
      }

      function resetLeftReveal() {
        wrap.style.removeProperty('--messages-swipe-left-width');
        wrap.classList.remove('is-left-wide');
      }

      function syncRightReveal(revealPx) {
        var max = swipeMaxWidth();
        var width = Math.max(0, Math.min(max, revealPx));
        if (width < 1) {
          wrap.style.removeProperty('--messages-swipe-right-width');
          wrap.classList.remove('is-right-wide');
          return 0;
        }
        wrap.style.setProperty('--messages-swipe-right-width', width + 'px');
        wrap.classList.toggle('is-right-wide', width >= max * 0.92);
        return width;
      }

      function resetRightReveal() {
        wrap.style.removeProperty('--messages-swipe-right-width');
        wrap.classList.remove('is-right-wide');
      }

      function setOffset(px) {
        var max = swipeMaxWidth();
        var clamped = Math.max(-max, Math.min(max, px));

        if (Math.abs(clamped) < 1) {
          track.style.transform = '';
          resetRightReveal();
          resetLeftReveal();
          wrap.classList.remove('is-open-left', 'is-open-right');
          return 0;
        }

        if (clamped > 0) {
          resetRightReveal();
          var leftReveal = syncLeftReveal(clamped);
          track.style.transform = 'translateX(' + leftReveal + 'px)';
          wrap.classList.toggle('is-open-left', leftReveal > 8);
          wrap.classList.remove('is-open-right');
          return leftReveal;
        }

        resetLeftReveal();
        var rightReveal = syncRightReveal(Math.abs(clamped));
        track.style.transform = 'translateX(-' + rightReveal + 'px)';
        wrap.classList.remove('is-open-left');
        wrap.classList.toggle('is-open-right', rightReveal > 8);
        return -rightReveal;
      }

      function snapOpen(direction) {
        closeMessagesRowSwipes(root, wrap);
        if (direction === 'left') {
          var snap = leftSnapWidth();
          syncLeftReveal(snap);
          track.style.transform = 'translateX(' + snap + 'px)';
          wrap.classList.add('is-open-left');
        } else if (direction === 'right') {
          var deleteSnap = rightSnapWidth();
          syncRightReveal(deleteSnap);
          track.style.transform = 'translateX(-' + deleteSnap + 'px)';
          wrap.classList.add('is-open-right');
        }
      }

      function closeSwipe() {
        wrap.classList.remove(
          'is-open-left',
          'is-open-right',
          'is-right-wide',
          'is-left-wide',
          'is-dragging'
        );
        resetRightReveal();
        resetLeftReveal();
        track.style.transform = '';
      }

      function resolveInboxSwipe() {
        wrap.classList.remove('is-dragging');
        if (listBody) listBody.classList.remove('is-swipe-dragging');

        var current = getCurrentOffset();
        var max = swipeMaxWidth();
        var id = wrap.getAttribute('data-messages-row-swipe');

        if (current >= max * 0.75) {
          applyMessagesRowAction(root, state, render, id, 'pin', wrap);
          return true;
        }
        if (current <= -max * 0.75) {
          closeMessagesRowSwipes(root);
          runConversationAction(root, state, render, id, 'leave');
          return true;
        }

        if (current > max * 0.35) snapOpen('left');
        else if (current < -max * 0.35) snapOpen('right');
        else closeSwipe();
        return false;
      }

      function finishWheelSwipe() {
        clearWheelEndTimer();
        if (!track.isConnected) return;
        moved = true;
        resolveInboxSwipe();
      }

      function scheduleWheelEnd() {
        clearWheelEndTimer();
        wheelEndTimer = setTimeout(finishWheelSwipe, 160);
      }

      track.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        clearWheelEndTimer();
        dragging = true;
        moved = false;
        startX = e.clientX;
        startOffset = getCurrentOffset();
        wrap.classList.add('is-dragging');
        track.setPointerCapture(e.pointerId);
      });

      track.addEventListener(
        'pointermove',
        function (e) {
          if (!dragging) return;
          var delta = e.clientX - startX;
          if (Math.abs(delta) > 6) moved = true;
          setOffset(startOffset + delta);
        },
        { passive: false }
      );

      function openThreadFromSwipe(id) {
        openConversation(root, state, render, id);
      }

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        clearWheelEndTimer();
        if (e && track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);

        var wasTap = !moved;
        if (resolveInboxSwipe()) return;

        if (
          moved &&
          (wrap.classList.contains('is-open-left') || wrap.classList.contains('is-open-right'))
        ) {
          wrap.dataset.swipeMoved = '1';
          window.requestAnimationFrame(function () {
            delete wrap.dataset.swipeMoved;
          });
          return;
        }

        if (!wasTap) return;
        if (wrap.classList.contains('is-open-left') || wrap.classList.contains('is-open-right')) {
          closeMessagesRowSwipes(root);
          return;
        }
        wrap.dataset.tapHandled = '1';
        window.requestAnimationFrame(function () {
          delete wrap.dataset.tapHandled;
        });
        openThreadFromSwipe(wrap.getAttribute('data-messages-row-swipe'));
      }

      track.addEventListener('pointerup', endDrag);
      track.addEventListener('pointercancel', endDrag);

      track.addEventListener(
        'wheel',
        function (e) {
          if (dragging) return;

          var dx = messagesWheelDeltaX(e, track.clientWidth || wrap.offsetWidth || 320);
          var dy = e.deltaY;
          if (Math.abs(dx) < 0.5) return;

          var current = getCurrentOffset();
          var movement = -dx;

          if (Math.abs(dx) <= Math.abs(dy) * 0.85 && Math.abs(current) < 1) return;

          e.preventDefault();
          moved = true;
          wrap.classList.add('is-dragging');
          if (listBody) listBody.classList.add('is-swipe-dragging');
          setOffset(current + movement);
          scheduleWheelEnd();
        },
        { passive: false }
      );
    });

    root.querySelectorAll('[data-messages-row-swipe-action]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var action = btn.getAttribute('data-messages-row-swipe-action');
        var id = btn.getAttribute('data-messages-row-id');
        var wrap = btn.closest('[data-messages-row-swipe]');
        // 'delete' is a real delete now — it leaves the conversation for
        // this user — so route it through the confirming action.
        if (action === 'delete') {
          closeMessagesRowSwipes(root);
          runConversationAction(root, state, render, id, 'leave');
          return;
        }
        applyMessagesRowAction(root, state, render, id, action, wrap);
      });
    });

    if (!root.dataset.messagesSwipeDismissBound) {
      root.dataset.messagesSwipeDismissBound = '1';
      document.addEventListener('click', function (e) {
        if (!e.target.closest('[data-messages-row-swipe]')) closeMessagesRowSwipes(root);
      });
    }
  }

  /* ------------------------------------------------------------------
   * Scroll preservation
   *
   * render() replaces the whole subtree, which resets every scroll container
   * to the top. That was why picking a conversation near the bottom of the
   * list threw the list back to the start. Snapshots are taken before each
   * render and reapplied after, so scroll position survives sending,
   * receiving, marking read, presence ticks and profile loads alike.
   * ---------------------------------------------------------------- */

  /* Within this many px of the bottom counts as "pinned to the bottom", so a
   * new message keeps following the conversation. */
  var STICK_TO_BOTTOM_PX = 48;

  /*
   * Which field had focus, and where the caret was.
   *
   * The search fields re-render on every keystroke, and a full re-render
   * replaces the element the user is typing into — without this the field
   * loses focus after one character and the caret jumps to the start.
   */
  var FOCUSABLE_KEYS = [
    'data-messages-search',
    'data-messages-compose-search',
    'data-messages-emoji-search',
    // The composer matters most: it is contenteditable, so losing focus
    // mid-sentence sends the next keystrokes to the document. That is how a
    // typed "/" reached the search shortcut and ate the slashes out of a URL.
    'data-messages-composer-input',
  ];

  function captureFocus(root) {
    var active = document.activeElement;
    if (!active || !root.contains(active)) return null;

    for (var i = 0; i < FOCUSABLE_KEYS.length; i++) {
      if (!active.hasAttribute(FOCUSABLE_KEYS[i])) continue;

      // A contenteditable has no selectionStart; measure the caret as a
      // character offset into its text so it can be put back.
      if (active.isContentEditable) {
        return { key: FOCUSABLE_KEYS[i], caret: caretOffset(active) };
      }

      return {
        key: FOCUSABLE_KEYS[i],
        start: active.selectionStart,
        end: active.selectionEnd,
      };
    }

    return null;
  }

  /* Characters between the start of `el` and the caret. */
  function caretOffset(el) {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;

    var range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) return null;

    var measure = range.cloneRange();
    measure.selectNodeContents(el);
    measure.setEnd(range.startContainer, range.startOffset);

    return measure.toString().length;
  }

  function placeCaret(el, offset) {
    if (offset === null || offset === undefined) return;

    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var remaining = offset;
    var node = walker.nextNode();

    while (node) {
      if (remaining <= node.length) {
        var range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      remaining -= node.length;
      node = walker.nextNode();
    }

    // Past the end (or no text at all): land at the end of the field.
    var end = document.createRange();
    end.selectNodeContents(el);
    end.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(end);
  }

  function restoreFocus(root, focus) {
    if (!focus) return;

    var el = root.querySelector('[' + focus.key + ']');
    if (!el) return;

    el.focus();

    if (el.isContentEditable) {
      placeCaret(el, focus.caret);
      return;
    }

    try {
      if (focus.start !== null && focus.start !== undefined) {
        el.setSelectionRange(focus.start, focus.end);
      }
    } catch (err) {
      // Some input types refuse setSelectionRange; focus alone is enough.
    }
  }

  function captureScroll(root) {
    var list = root.querySelector('[data-messages-list-body]');
    var chat = root.querySelector('[data-messages-chat-body]');

    return {
      listTop: list ? list.scrollTop : null,
      focus: captureFocus(root),
      chat: chat
        ? {
            top: chat.scrollTop,
            height: chat.scrollHeight,
            atBottom:
              chat.scrollHeight - chat.scrollTop - chat.clientHeight <= STICK_TO_BOTTOM_PX,
          }
        : null,
    };
  }

  function restoreScroll(root, snapshot, intent) {
    intent = intent || {};

    restoreFocus(root, snapshot.focus);

    var list = root.querySelector('[data-messages-list-body]');
    if (list && snapshot.listTop !== null && snapshot.listTop !== undefined) {
      list.scrollTop = snapshot.listTop;
    }

    var chat = root.querySelector('[data-messages-chat-body]');
    if (!chat) return;

    // Opening a conversation starts at the newest message.
    if (intent.chatToBottom) {
      chat.scrollTop = chat.scrollHeight;
      return;
    }

    if (!snapshot.chat) {
      chat.scrollTop = chat.scrollHeight;
      return;
    }

    if (snapshot.chat.atBottom) {
      chat.scrollTop = chat.scrollHeight;
      return;
    }

    // Older messages were prepended: shift by exactly how much taller the
    // content became, so the message the user was reading stays put.
    chat.scrollTop = snapshot.chat.top + (chat.scrollHeight - snapshot.chat.height);
  }

  /* ------------------------------------------------------------------
   * Data loading
   * ---------------------------------------------------------------- */

  /*
   * Load a conversation's stored draft into the composer, unless the user has
   * already typed something here in this session — local keystrokes are always
   * newer than the copy the server last heard about.
   */
  function seedComposerDraft(state, conversationId) {
    if (!conversationId) return;
    if (state.composerDrafts && state.composerDrafts[conversationId]) return;

    var row = findThread(conversationId);
    if (!state.composerDrafts) state.composerDrafts = {};
    state.composerDrafts[conversationId] = (row && row.draft) || '';
  }

  function loadConversations(root, state, render, options) {
    options = options || {};

    return window.TMAMessagingAPI.conversations()
      .then(function (data) {
        STORE.threads = data.conversations || [];
        STORE.me = data.me || null;
        STORE.settings = data.settings || {};
        STORE.realtime = data.realtime || null;
        STORE.limits = data.limits || {};
        STORE.loaded = true;
        STORE.loadError = null;

        // Keep the open conversation if it still exists; otherwise fall back
        // to the first row on desktop, where an empty pane looks broken.
        if (state.selectedId && !findThread(state.selectedId)) {
          state.selectedId = null;
        }
        // Deliberately no auto-select. Opening the newest conversation on load
        // marked it read on the user's behalf — they never looked at it — which
        // sent a false read receipt and wiped the unread badge. The chat column
        // starts in its empty state instead, the same one the close button
        // returns to.

        // Seed the composer from the stored draft for whichever conversation
        // ends up open. Without this a draft only reappeared when the user
        // switched *into* a conversation, so the one already open on load —
        // usually the one they were last typing in — came back empty.
        seedComposerDraft(state, state.selectedId);

        render();
        startRealtime(root, state, render);

        // Having the list *is* delivery: this account demonstrably holds these
        // messages now, whether or not any conversation is open. One call
        // covers every conversation.
        window.TMAMessagingAPI.markAllDelivered();

        if (state.selectedId) {
          loadThread(root, state, render, state.selectedId, { toBottom: true });
        }
      })
      .catch(function (err) {
        STORE.loaded = true;
        STORE.loadError = err;
        render();
        if (!options.silent) showMessagesToast(root, 'Conversations could not be loaded');
      });
  }

  /* The newest page of a conversation, or an older page when `before` is set. */
  function loadThread(root, state, render, conversationId, options) {
    options = options || {};
    var bucket = threadBucket(conversationId);

    if (bucket.loading) return Promise.resolve();
    bucket.loading = true;
    if (options.before) bucket.loadingOlder = true;
    bucket.error = null;

    if (options.before) render();

    return window.TMAMessagingAPI.messages(conversationId, options.before)
      .then(function (data) {
        bucket.loading = false;
        bucket.loadingOlder = false;
        bucket.loaded = true;
        bucket.hasMore = !!data.hasMore;

        mergeMessages(conversationId, data.messages || [], !!options.before);

        // The conversation row can have moved on while history was in flight.
        if (data.conversation) replaceThread(data.conversation);

        // A conversation the user is looking at is a conversation they have
        // read — subject to their own read-receipt setting, enforced server side.
        if (state.selectedId === conversationId && !document.hidden) {
          markConversationRead(root, state, render, conversationId);
        }

        render({ chatToBottom: !options.before && options.toBottom });
      })
      .catch(function (err) {
        bucket.loading = false;
        bucket.loadingOlder = false;
        bucket.loaded = true;

        // A 404 means membership is gone; drop the row rather than error.
        if (err.gone) {
          STORE.threads = STORE.threads.filter(function (row) {
            return row.id !== conversationId;
          });
          if (state.selectedId === conversationId) state.selectedId = null;
        } else {
          bucket.error = err;
        }

        render();
      });
  }

  /* Swap one row in place, preserving its position in the list. */
  function replaceThread(row) {
    for (var i = 0; i < STORE.threads.length; i++) {
      if (STORE.threads[i].id === row.id) {
        // Preserve the local draft: the server copy lags what is being typed.
        var draft = STORE.threads[i].draft;
        STORE.threads[i] = row;
        if (draft !== undefined && draft !== null) STORE.threads[i].draft = draft;
        return;
      }
    }
    STORE.threads.unshift(row);
  }

  function markConversationRead(root, state, render, conversationId) {
    var row = findThread(conversationId);
    if (!row || (!row.unread && !row.markedUnread)) return;

    row.unread = 0;
    row.markedUnread = false;
    syncTabBarBadges();

    window.TMAMessagingAPI.markRead(conversationId).catch(function () {
      // Left unread server-side; the next load will show it again.
    });
  }

  /* ------------------------------------------------------------------
   * Sending
   * ---------------------------------------------------------------- */

  function sendMessage(root, state, render, text) {
    var conversationId = state.selectedId;
    if (!conversationId) return;

    var queued = pendingAttachments(state);
    var ready = queued.filter(function (item) {
      return item.status === 'done' && item.attachment;
    });

    // Nothing to send at all.
    if (!text.trim() && !ready.length) return;

    // Hold the send while uploads are still running, rather than silently
    // dropping the files that haven't finished.
    if (queued.some(function (item) { return item.status === 'uploading'; })) {
      showMessagesToast(root, 'Waiting for uploads to finish…');
      return;
    }

    var failed = queued.filter(function (item) { return item.status === 'failed'; });
    if (failed.length && !text.trim() && !ready.length) {
      showMessagesToast(root, 'Those files could not be uploaded');
      return;
    }

    var replyTo = state.replyTo && state.replyTo.threadId === conversationId
      ? state.replyTo.messageId
      : null;
    var replySource = replyTo ? findMessageById(conversationId, replyTo) : null;
    var nonce = window.TMAMessagingAPI.newNonce();

    // Optimistic bubble, shown immediately and reconciled on the response.
    var pending = {
      id: 'pending-' + nonce,
      nonce: nonce,
      seq: null,
      type: 'text',
      direction: 'out',
      body: text,
      deleted: false,
      edited: false,
      sender: STORE.me ? { id: STORE.me.id, name: STORE.me.name, photo: STORE.me.photo } : null,
      sentAt: new Date().toISOString(),
      time: new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
      replyTo: replySource
        ? {
            id: replySource.id,
            senderName: (replySource.sender && replySource.sender.name) || 'You',
            preview: messagePreview(replySource),
          }
        : null,
      // Show the real attachments straight away — they are already uploaded.
      attachments: ready.map(function (item) {
        return item.attachment;
      }),
      reactions: [],
      starred: false,
      status: null,
      pending: true,
      can: { edit: false, delete: false },
    };

    mergeMessages(conversationId, [pending], false);
    clearReplyTo(state);
    setComposerDraft(state, '');
    state.composerLinkUrl = null;
    state.composerLinkDismissed = null;

    // The tray empties as the message goes; anything that failed to upload
    // stays behind so it can be retried rather than vanishing silently.
    var attachmentIds = ready.map(function (item) {
      return item.attachment.id;
    });
    state.attachments[conversationId] = failed;

    render({ chatToBottom: true });

    window.TMAMessagingAPI.send(conversationId, {
      body: text,
      replyTo: replyTo,
      nonce: nonce,
      attachments: attachmentIds,
    })
      .then(function (data) {
        var bucket = threadBucket(conversationId);
        var confirmed = data.message;
        confirmed.nonce = nonce;

        // Replace the placeholder in place so the bubble does not jump.
        for (var i = 0; i < bucket.messages.length; i++) {
          if (bucket.messages[i].nonce === nonce) {
            bucket.messages[i] = confirmed;
            break;
          }
        }

        var row = findThread(conversationId);
        if (row) {
          row.preview = 'You: ' + messagePreview(confirmed);
          row.timestamp = confirmed.sentAt;
          row.draft = null;
        }

        render({ chatToBottom: true });
      })
      .catch(function (err) {
        // Mark the bubble failed and put the text back in the composer so a
        // failed send never silently loses what was written.
        var bucket = threadBucket(conversationId);
        for (var i = 0; i < bucket.messages.length; i++) {
          if (bucket.messages[i].nonce === nonce) {
            bucket.messages[i].pending = false;
            bucket.messages[i].failed = true;
            break;
          }
        }
        render();
        showMessagesToast(
          root,
          err.status === 403 ? 'You cannot send to this conversation' : 'Message not sent'
        );
      });
  }

  /* ------------------------------------------------------------------
   * Drafts — per conversation, saved server-side so they survive a reload.
   * ---------------------------------------------------------------- */

  var draftTimer = null;

  function scheduleDraftSave(conversationId, text) {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      draftTimer = null;
      window.TMAMessagingAPI.saveDraft(conversationId, text).catch(function () {});
    }, 600);
  }

  /* Flush immediately when leaving a conversation, so switching away can't
   * race the debounce and drop what was typed. */
  function flushDraft(conversationId, text) {
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = null;
    }
    if (conversationId) {
      window.TMAMessagingAPI.saveDraft(conversationId, text).catch(function () {});
    }
  }

  function openConversation(root, state, render, conversationId) {
    if (!conversationId || conversationId === state.selectedId) return;

    // Persist the outgoing conversation's draft before switching, so it stays
    // with the conversation it was written in.
    if (state.selectedId) flushDraft(state.selectedId, getComposerDraft(state));

    state.selectedId = conversationId;
    state.reading = true;
    clearReplyTo(state);
    state.emojiPickerOpen = false;

    // Seed the composer from whatever draft is stored for this row.
    var row = findThread(conversationId);
    setComposerDraft(state, (row && row.draft) || '');
    seedComposerDraft(state, conversationId);

    var bucket = threadBucket(conversationId);
    render({ chatToBottom: true });

    if (!bucket.loaded) {
      loadThread(root, state, render, conversationId, { toBottom: true });
    } else {
      markConversationRead(root, state, render, conversationId);
      subscribeToConversation(root, state, render, conversationId);
    }
  }

  /*
   * Leave the open conversation without picking another one.
   *
   * Everything about the inbox is deliberately left alone — scroll position,
   * search text, filters — so closing a chat returns you to exactly the list
   * you were looking at rather than a reset one.
   */
  function closeConversation(root, state, render) {
    if (!state.selectedId) return;

    flushDraft(state.selectedId, getComposerDraft(state));

    state.selectedId = null;
    state.reading = false;
    state.editing = null;
    clearReplyTo(state);
    closeMessageMenu();

    render();
  }

  /* ------------------------------------------------------------------
   * Realtime
   * ---------------------------------------------------------------- */

  var subscribed = {};

  function startRealtime(root, state, render) {
    var realtime = window.TMAMessagingRealtime;

    // No websocket configured at all — poll instead of going dead.
    if (!STORE.realtime || !realtime || !realtime.start(STORE.realtime)) {
      startPollingFallback(root, state, render);
      return;
    }

    // The socket can also be refused after connecting (a cluster that does not
    // allow this origin, for instance). That is not recoverable by retrying,
    // so fall back to polling rather than leaving the page frozen.
    if (!realtime._tmaStateBound) {
      realtime._tmaStateBound = true;
      realtime.onState(function (status) {
        if (status === 'refused') startPollingFallback(root, state, render);
      });
    }

    getThreads().forEach(function (row) {
      subscribeToConversation(root, state, render, row.id);
    });
  }

  /*
   * Fallback for when live updates are unavailable. Deliberately slower than
   * the socket - it exists so the page keeps working, not so it feels instant.
   * Skipped entirely while the tab is hidden.
   */
  var POLL_INTERVAL = 10000;
  var pollTimer = null;

  function startPollingFallback(root, state, render) {
    if (pollTimer) return;

    if (window.console) {
      console.warn('[messaging] live updates unavailable — falling back to polling.');
    }

    pollTimer = setInterval(function () {
      if (document.hidden || !root.isConnected) return;

      window.TMAMessagingAPI.conversations()
        .then(function (data) {
          var previous = {};
          getThreads().forEach(function (row) {
            previous[row.id] = row.timestamp;
          });

          STORE.threads = data.conversations || [];

          // Pull the open thread's newest page if it actually moved on.
          var open = state.selectedId;
          if (open) {
            var row = findThread(open);
            if (row && previous[open] !== row.timestamp) {
              return window.TMAMessagingAPI.messages(open).then(function (thread) {
                mergeMessages(open, thread.messages || [], false);
                render();
                if (!document.hidden) markConversationRead(root, state, render, open);
              });
            }
          }

          render();
        })
        .catch(function () {
          // A missed poll is not worth surfacing; the next one retries.
        });
    }, POLL_INTERVAL);
  }

  function subscribeToConversation(root, state, render, conversationId) {
    if (!conversationId || subscribed[conversationId]) return;
    if (!window.TMAMessagingRealtime || !STORE.realtime || !STORE.realtime.enabled) return;

    subscribed[conversationId] = true;
    var channel = 'private-conversation.' + conversationId;

    window.TMAMessagingRealtime.listen(channel, 'message.sent', function (payload) {
      onRemoteMessage(root, state, render, payload);
    });

    window.TMAMessagingRealtime.listen(channel, 'message.updated', function (payload) {
      var msg = findMessageById(payload.conversationId, payload.messageId);
      if (!msg) return;
      msg.body = payload.body;
      msg.edited = true;
      render();
    });

    window.TMAMessagingRealtime.listen(channel, 'message.deleted', function (payload) {
      var msg = findMessageById(payload.conversationId, payload.messageId);
      if (!msg) return;
      msg.deleted = true;
      msg.body = null;
      msg.attachments = [];
      render();
    });

    window.TMAMessagingRealtime.listen(channel, 'message.reacted', function (payload) {
      var msg = findMessageById(payload.conversationId, payload.messageId);
      if (!msg) return;

      // The event carries counts and names but not "mine" — that is per
      // viewer, so each client derives it from its own id.
      var me = (STORE.me || {}).id;
      msg.reactions = (payload.reactions || []).map(function (r) {
        return {
          emoji: r.emoji,
          count: r.count,
          users: r.users || [],
          mine: (r.users || []).some(function (u) {
            return u.id === me;
          }),
        };
      });
      render();
    });

    window.TMAMessagingRealtime.listen(channel, 'conversation.delivered', function (payload) {
      // My own acknowledgement says nothing about whether anyone else has the
      // message. Belt-and-braces alongside the X-Socket-ID header that lets
      // toOthers() filter these out server-side.
      if (STORE.me && payload.recipientId === STORE.me.id) return;

      // Somebody's client acknowledged receipt: our single tick becomes two.
      // 'read' must never be downgraded back to 'delivered'.
      var list = getMessages(payload.conversationId);
      var changed = false;
      list.forEach(function (msg) {
        if (
          msg.direction === 'out' &&
          msg.seq &&
          msg.seq <= payload.lastDeliveredSeq &&
          msg.status === 'sent'
        ) {
          msg.status = 'delivered';
          changed = true;
        }
      });
      if (changed) render();
    });

    window.TMAMessagingRealtime.listen(channel, 'conversation.read', function (payload) {
      // Same guard as delivery: my own read marker must not turn my own ticks
      // blue.
      if (STORE.me && payload.readerId === STORE.me.id) return;

      // Someone else read up to `lastReadSeq`; turn our ticks over.
      var list = getMessages(payload.conversationId);
      var changed = false;
      list.forEach(function (msg) {
        if (msg.direction === 'out' && msg.seq && msg.seq <= payload.lastReadSeq && msg.status !== 'read') {
          msg.status = 'read';
          changed = true;
        }
      });
      if (changed) render();
    });
  }

  /*
   * A message landed in a conversation we're subscribed to. Fetch the newest
   * page rather than trusting the broadcast payload: what a message looks like
   * differs per viewer, and the server is the only authority on that.
   */
  function onRemoteMessage(root, state, render, payload) {
    var conversationId = payload.conversationId;
    var isOpen = state.selectedId === conversationId;

    if (isOpen) {
      var bucket = threadBucket(conversationId);
      var newest = 0;
      bucket.messages.forEach(function (msg) {
        if (msg.seq && msg.seq > newest) newest = msg.seq;
      });

      if (payload.seq && payload.seq <= newest) return; // already have it

      window.TMAMessagingAPI.messages(conversationId).then(function (data) {
        mergeMessages(conversationId, data.messages || [], false);
        if (data.conversation) replaceThread(data.conversation);
        render();

        // Acknowledge receipt first — that is true the moment it arrives.
        // Marking it read is a separate, weaker claim and only holds if the
        // tab is actually visible.
        window.TMAMessagingAPI.markDelivered(conversationId).catch(function () {});
        if (!document.hidden) markConversationRead(root, state, render, conversationId);

        notifyNewMessage(root, conversationId, payload);
      });
      return;
    }

    // Not the open conversation, but it still arrived at this client.
    window.TMAMessagingAPI.markDelivered(conversationId).catch(function () {});
    refreshConversationRow(root, state, render, conversationId, payload);
  }

  function refreshConversationRow(root, state, render, conversationId, payload) {
    window.TMAMessagingAPI.messages(conversationId)
      .then(function (data) {
        if (data.conversation) {
          replaceThread(data.conversation);
          render();
          syncTabBarBadges();
        }
        notifyNewMessage(root, conversationId, payload);
      })
      .catch(function () {});
  }

  /* ------------------------------------------------------------------
   * Notifications
   * ---------------------------------------------------------------- */

  var lastNotifiedMessage = null;

  function notifyNewMessage(root, conversationId, payload) {
    // The sender's own message is not news to them.
    if (STORE.me && payload && payload.senderId === STORE.me.id) return;

    // Guard against the same message notifying twice when several code paths
    // observe the same arrival.
    if (payload && payload.messageId) {
      if (lastNotifiedMessage === payload.messageId) return;
      lastNotifiedMessage = payload.messageId;
    }

    var row = findThread(conversationId);
    if (!row || row.muted) return;

    if (STORE.settings.notificationSounds) playNotificationSound();

    if (
      STORE.settings.desktopNotifications &&
      window.Notification &&
      Notification.permission === 'granted' &&
      document.hidden
    ) {
      try {
        new Notification(row.name, {
          body: STORE.settings.notificationPreview ? row.preview : 'New message',
          tag: conversationId,
        });
      } catch (err) {
        /* notification failed; the in-app badge already updated */
      }
    }
  }

  var audioContext = null;

  /* A short tone, synthesised rather than shipped as an asset. */
  function playNotificationSound() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioContext) audioContext = new Ctx();

      var osc = audioContext.createOscillator();
      var gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);

      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.25);

      osc.start();
      osc.stop(audioContext.currentTime + 0.26);
    } catch (err) {
      /* sound is optional */
    }
  }

  /* ------------------------------------------------------------------
   * Message actions
   * ---------------------------------------------------------------- */

  /* Briefly highlight a message and bring it into view. */
  function jumpToMessage(root, messageId) {
    var target = root.querySelector('[data-messages-id="' + cssEscape(messageId) + '"]');
    if (!target) return;

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('is-jump-target');
    setTimeout(function () {
      target.classList.remove('is-jump-target');
    }, 1600);
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function copyMessageText(root, msg) {
    var text = msg.body || '';
    if (!text) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(function () {
          showMessagesToast(root, 'Message copied');
        })
        .catch(function () {
          showMessagesToast(root, 'Could not copy message');
        });
      return;
    }

    // Fallback for contexts without the async clipboard API.
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      showMessagesToast(root, 'Message copied');
    } catch (err) {
      showMessagesToast(root, 'Could not copy message');
    }
    document.body.removeChild(area);
  }

  function deleteMessage(root, state, render, msg) {
    var bucket = threadBucket(state.selectedId);
    var snapshot = { deleted: msg.deleted, body: msg.body };

    msg.deleted = true;
    msg.body = null;
    render();

    window.TMAMessagingAPI.deleteMessage(msg.id).catch(function () {
      msg.deleted = snapshot.deleted;
      msg.body = snapshot.body;
      render();
      showMessagesToast(root, 'Message could not be deleted');
    });
  }

  function startEditingMessage(root, state, render, msg) {
    state.editing = { id: msg.id, original: msg.body || '' };
    setComposerDraft(state, msg.body || '');
    clearReplyTo(state);
    render();
    focusComposerInput(root);
  }

  function commitEdit(root, state, render, text) {
    var editing = state.editing;
    if (!editing) return;

    var msg = findMessageById(state.selectedId, editing.id);
    state.editing = null;
    setComposerDraft(state, '');

    if (!msg || text === editing.original) {
      render();
      return;
    }

    var previous = msg.body;
    msg.body = text;
    msg.edited = true;
    render();

    window.TMAMessagingAPI.editMessage(msg.id, text).catch(function (err) {
      msg.body = previous;
      render();
      showMessagesToast(
        root,
        err.status === 403 ? 'This message can no longer be edited' : 'Edit not saved'
      );
    });
  }

  /* ------------------------------------------------------------------
   * Search, compose, settings
   * ---------------------------------------------------------------- */

  var peopleTimer = null;

  /*
   * Look up people for the search field and the new-message panel.
   *
   * Debounced, and the result is discarded if the query moved on while the
   * request was in flight — otherwise a slow response for "an" can land after
   * and overwrite the results for "andrew".
   */
  function searchPeople(state, render, term, target) {
    if (peopleTimer) clearTimeout(peopleTimer);

    var query = (term || '').trim();

    if (target === 'list' && !query) {
      state.peopleResults = [];
      render();
      return;
    }

    peopleTimer = setTimeout(function () {
      peopleTimer = null;

      if (target === 'compose') {
        state.composeLoading = true;
        state.composeError = null;
        render();
      }

      window.TMAMessagingAPI.contacts(query)
        .then(function (data) {
          var current = target === 'compose' ? state.composeQuery : state.search;
          if ((current || '').trim() !== query) return; // superseded

          var people = data.contacts || [];

          if (target === 'compose') {
            state.composeLoading = false;
            state.composeResults = people;
          } else {
            // In the main list, hide people who already have a conversation —
            // their existing thread is already shown above.
            var known = {};
            getThreads().forEach(function (row) {
              if (row.counterpartId) known[row.counterpartId] = true;
            });
            state.peopleResults = people.filter(function (p) {
              return !known[p.id];
            });
          }
          render();
        })
        .catch(function () {
          if (target === 'compose') {
            state.composeLoading = false;
            state.composeError = true;
          } else {
            state.peopleResults = [];
          }
          render();
        });
    }, 250);
  }

  function openComposePanel(root, state, render) {
    state.composeOpen = true;
    state.settingsOpen = false;
    state.composeQuery = '';
    state.composeResults = [];
    render();

    // Show the full list straight away rather than an empty panel.
    searchPeople(state, render, '', 'compose');

    var input = root.querySelector('[data-messages-compose-search]');
    if (input) input.focus();
  }

  function closePanels(state, render) {
    if (!state.composeOpen && !state.settingsOpen) return;
    state.composeOpen = false;
    state.settingsOpen = false;
    render();
  }

  /* Open (or reuse) a direct conversation with someone and select it. */
  function startConversationWith(root, state, render, userId) {
    state.composeOpen = false;
    state.search = '';
    state.peopleResults = [];
    render();

    window.TMAMessagingAPI.openDirect(userId)
      .then(function (data) {
        var conversation = data.conversation;
        replaceThread(conversation);

        // openConversation() bails when the id is already selected, so clear
        // it first to make sure the thread actually loads.
        state.selectedId = null;
        render();
        openConversation(root, state, render, conversation.id);
        subscribeToConversation(root, state, render, conversation.id);
      })
      .catch(function (err) {
        showMessagesToast(
          root,
          err.status === 403 ? 'You cannot message this person' : 'Conversation could not be opened'
        );
      });
  }

  /* Persist one messaging setting. Optimistic; reverted if the write fails. */
  function updateSetting(root, state, render, key, value) {
    var previous = STORE.settings[key];
    STORE.settings[key] = value;
    render();

    // Desktop notifications are useless without browser permission, so ask
    // at the moment the user turns them on.
    if (key === 'desktopNotifications' && value && window.Notification) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(function (result) {
          if (result !== 'granted') {
            STORE.settings[key] = false;
            window.TMAMessagingAPI.updateSettings({ desktopNotifications: false });
            render();
            showMessagesToast(root, 'Desktop notifications were blocked by the browser');
          }
        });
      } else if (Notification.permission === 'denied') {
        STORE.settings[key] = false;
        render();
        showMessagesToast(root, 'Desktop notifications are blocked in your browser settings');
        return;
      }
    }

    var payload = {};
    payload[key] = STORE.settings[key];

    window.TMAMessagingAPI.updateSettings(payload)
      .then(function (data) {
        STORE.settings = data.settings || STORE.settings;
      })
      .catch(function () {
        STORE.settings[key] = previous;
        render();
        showMessagesToast(root, 'That setting could not be saved');
      });
  }

  /* ------------------------------------------------------------------
   * Attachment uploads
   * ---------------------------------------------------------------- */

  var localAttachmentSeq = 0;

  function queueFiles(root, state, render, files) {
    if (!state.selectedId || !files || !files.length) return;

    var items = pendingAttachments(state);
    var room = MAX_ATTACHMENTS - items.length;

    if (room <= 0) {
      showMessagesToast(root, 'Up to ' + MAX_ATTACHMENTS + ' files per message');
      return;
    }

    var accepted = Array.prototype.slice.call(files, 0, room);
    if (files.length > room) {
      showMessagesToast(root, 'Only the first ' + room + ' files were added');
    }

    // Refuse an oversized file here rather than spending an upload on it. The
    // ceiling comes from the server because PHP's own upload_max_filesize can
    // be far lower than what messaging nominally allows.
    var maxBytes = STORE.limits.maxAttachmentBytes || 0;
    if (maxBytes) {
      var tooBig = accepted.filter(function (file) {
        return file.size > maxBytes;
      });
      if (tooBig.length) {
        showMessagesToast(
          root,
          (tooBig.length === 1 ? tooBig[0].name : tooBig.length + ' files') +
            ' exceed the ' + (STORE.limits.maxAttachmentLabel || 'size') + ' limit'
        );
        accepted = accepted.filter(function (file) {
          return file.size <= maxBytes;
        });
      }
    }

    accepted.forEach(function (file) {
      localAttachmentSeq += 1;
      var item = {
        localId: 'a' + localAttachmentSeq,
        conversationId: state.selectedId,
        file: file,
        name: file.name,
        size: file.size,
        status: 'uploading',
        progress: 0,
        attachment: null,
        // Shows an image immediately, before the server has it.
        previewUrl: /^image\//.test(file.type) ? URL.createObjectURL(file) : null,
      };
      items.push(item);
      startUpload(root, state, render, item);
    });

    render();
  }

  function startUpload(root, state, render, item) {
    item.status = 'uploading';
    item.progress = 0;
    item.error = null;

    var upload = window.TMAMessagingAPI.uploadAttachment(
      item.conversationId,
      item.file,
      function (percent) {
        item.progress = percent;
        // Repaint only the one bar; a full render on every progress tick
        // would fight the composer for focus.
        paintUploadProgress(root, item);
      }
    );

    item.abort = upload.abort;

    upload.promise
      .then(function (attachment) {
        item.status = 'done';
        item.attachment = attachment;
        item.progress = 100;
        render();
      })
      .catch(function (err) {
        if (err.aborted) return; // removed by the user; nothing to report
        item.status = 'failed';
        item.error = err.message || 'Upload failed';
        render();
      });
  }

  function paintUploadProgress(root, item) {
    var el = root.querySelector('[data-messages-tray-item="' + cssEscape(item.localId) + '"]');
    var bar = el && el.querySelector('.tma-dash__messages-tray-bar-fill');
    if (bar) bar.style.width = (item.progress || 0) + '%';
  }

  function removeAttachment(root, state, render, localId) {
    var items = pendingAttachments(state);
    var index = -1;
    items.forEach(function (item, i) {
      if (item.localId === localId) index = i;
    });
    if (index === -1) return;

    var item = items[index];

    if (item.status === 'uploading' && item.abort) item.abort();
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);

    // Discard the staged row server-side too, so an abandoned upload does not
    // linger in storage.
    if (item.attachment) {
      window.TMAMessagingAPI.removeAttachment(item.attachment.id).catch(function () {});
    }

    items.splice(index, 1);
    render();
  }

  function clearAttachments(state, conversationId) {
    if (!state.attachments || !state.attachments[conversationId]) return;
    state.attachments[conversationId].forEach(function (item) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    state.attachments[conversationId] = [];
  }

  /* ------------------------------------------------------------------
   * Voice note recording
   * ---------------------------------------------------------------- */

  var voiceRecorder = null;

  function startRecording(root, state, render) {
    if (!window.TMAVoiceRecorder || !window.TMAVoiceRecorder.isSupported()) {
      showMessagesToast(root, 'Recording is not supported by this browser');
      return;
    }

    voiceRecorder = window.TMAVoiceRecorder.create();

    state.recording = { stage: 'starting', elapsedMs: 0, livePeaks: [] };
    render();

    voiceRecorder
      .start(function (elapsed) {
        if (!state.recording) return;
        state.recording.elapsedMs = elapsed;
        // Repaint just the counter and bars — a full render on every tick
        // would fight the composer and the rest of the page.
        paintRecorder(root, state);
      })
      .then(function () {
        if (!state.recording) return;
        state.recording.stage = 'recording';
        render();
      })
      .catch(function (err) {
        state.recording = null;
        voiceRecorder = null;
        render();
        // getUserMedia failures are the common case here — the message is
        // already phrased for a person by the recorder.
        showMessagesToast(root, err.message || 'Recording could not start');
      });
  }

  /* Cheap in-place update of the live counter and waveform. */
  function paintRecorder(root, state) {
    var rec = state.recording;
    if (!rec) return;

    var time = root.querySelector('.tma-dash__messages-recorder-time');
    if (time) time.textContent = formatDuration(rec.elapsedMs);

    var wave = root.querySelector('.tma-dash__messages-wave--live');
    if (wave && voiceRecorder) {
      var peaks = voiceRecorder.peaks.slice(-40);
      wave.innerHTML = peaks
        .map(function (p) {
          return '<span class="tma-dash__messages-wave-bar" style="height:' +
            Math.max(8, Math.min(100, p)) + '%"></span>';
        })
        .join('');
    }
  }

  function togglePauseRecording(root, state, render) {
    if (!voiceRecorder || !state.recording) return;

    if (state.recording.stage === 'paused') {
      voiceRecorder.resume();
      state.recording.stage = 'recording';
    } else {
      voiceRecorder.pause();
      state.recording.stage = 'paused';
    }
    render();
  }

  function cancelRecording(root, state, render) {
    if (voiceRecorder) voiceRecorder.cancel();
    voiceRecorder = null;
    stopPreviewPlayback(state);
    state.recording = null;
    render();
  }

  /* Finish recording and hold the result for review before sending. */
  function stopRecording(root, state, render) {
    if (!voiceRecorder || !state.recording) return;

    voiceRecorder.stop().then(function (result) {
      voiceRecorder = null;

      if (!result || !result.blob || !result.blob.size) {
        state.recording = null;
        render();
        showMessagesToast(root, 'Nothing was recorded');
        return;
      }

      state.recording = {
        stage: 'review',
        blob: result.blob,
        durationMs: result.durationMs,
        waveform: result.waveform,
        mimeType: result.mimeType,
        previewUrl: URL.createObjectURL(result.blob),
        playing: false,
      };
      render();
    });
  }

  var previewAudio = null;

  function togglePreviewPlayback(root, state, render) {
    var rec = state.recording;
    if (!rec || rec.stage !== 'review') return;

    if (previewAudio && !previewAudio.paused) {
      previewAudio.pause();
      rec.playing = false;
      render();
      return;
    }

    if (!previewAudio) {
      previewAudio = new Audio(rec.previewUrl);
      previewAudio.addEventListener('ended', function () {
        if (state.recording) state.recording.playing = false;
        render();
      });
    }

    previewAudio.play().catch(function () {
      showMessagesToast(root, 'Could not play the recording');
    });
    rec.playing = true;
    render();
  }

  function stopPreviewPlayback(state) {
    if (previewAudio) {
      previewAudio.pause();
      previewAudio = null;
    }
    if (state.recording && state.recording.previewUrl) {
      URL.revokeObjectURL(state.recording.previewUrl);
    }
  }

  /*
   * Send the reviewed recording.
   *
   * Goes through the same staging path as any attachment, so it gets the same
   * upload progress, failure handling and retry.
   */
  function sendRecording(root, state, render) {
    var rec = state.recording;
    if (!rec || rec.stage !== 'review' || !rec.blob) return;

    var extension = /mp4/.test(rec.mimeType) ? 'm4a' : /ogg/.test(rec.mimeType) ? 'ogg' : 'webm';
    var file = new File([rec.blob], 'voice-note.' + extension, { type: rec.mimeType });

    var conversationId = state.selectedId;
    var durationMs = rec.durationMs;
    var waveform = rec.waveform;

    stopPreviewPlayback(state);
    state.recording = null;
    render();

    var upload = window.TMAMessagingAPI.uploadAttachment(
      conversationId,
      file,
      null,
      { voice: true, durationMs: durationMs, waveform: waveform }
    );

    upload.promise
      .then(function (attachment) {
        return window.TMAMessagingAPI.send(conversationId, {
          body: '',
          nonce: window.TMAMessagingAPI.newNonce(),
          attachments: [attachment.id],
        });
      })
      .then(function (data) {
        mergeMessages(conversationId, [data.message], false);
        var row = findThread(conversationId);
        if (row) {
          row.preview = 'You: Voice note';
          row.timestamp = data.message.sentAt;
        }
        render({ chatToBottom: true });
      })
      .catch(function () {
        showMessagesToast(root, 'Voice note could not be sent');
      });
  }

  /* ------------------------------------------------------------------
   * Voice note playback
   * ---------------------------------------------------------------- */

  var playingVoice = null;   // { id, audio }

  var SPEEDS = [1, 1.5, 2];

  function toggleVoicePlayback(root, state, render, el) {
    var id = el.getAttribute('data-messages-voice');
    var src = el.getAttribute('data-messages-voice-src');

    // Only one voice note plays at a time — overlapping playback is noise.
    if (playingVoice && playingVoice.id !== id) {
      playingVoice.audio.pause();
      playingVoice = null;
    }

    if (playingVoice && playingVoice.id === id) {
      if (playingVoice.audio.paused) playingVoice.audio.play();
      else playingVoice.audio.pause();
      paintVoice(root, el, playingVoice.audio);
      return;
    }

    var audio = new Audio(src);
    audio.playbackRate = STORE.settings.voicePlaybackSpeed || 1;

    audio.addEventListener('timeupdate', function () {
      paintVoice(root, el, audio);
    });
    audio.addEventListener('ended', function () {
      paintVoice(root, el, audio);
      playingVoice = null;
    });
    audio.addEventListener('play', function () {
      paintVoice(root, el, audio);
    });
    audio.addEventListener('pause', function () {
      paintVoice(root, el, audio);
    });

    playingVoice = { id: id, audio: audio };
    audio.play().catch(function () {
      showMessagesToast(root, 'Could not play this voice note');
      playingVoice = null;
    });
  }

  /* Progress, elapsed time and the play/pause glyph, without a full render. */
  /*
   * Seconds of audio, from the container when it knows and from the stored
   * recording length when it does not.
   *
   * A MediaRecorder WebM has no Duration element, so `audio.duration` is
   * Infinity until the file is seeked to its end — which is why progress sat
   * at zero for every recorded note.
   */
  function voiceDuration(el, audio) {
    if (audio && isFinite(audio.duration) && audio.duration > 0) {
      return audio.duration;
    }

    var stored = parseInt(el.getAttribute('data-messages-voice-duration'), 10);
    return stored > 0 ? stored / 1000 : 0;
  }

  function paintVoice(root, el, audio) {
    var progress = el.querySelector('[data-messages-voice-progress]');
    var time = el.querySelector('[data-messages-voice-time]');
    var button = el.querySelector('[data-messages-voice-play]');

    var duration = voiceDuration(el, audio);
    var ratio = duration ? audio.currentTime / duration : 0;

    if (progress) progress.style.width = Math.max(0, Math.min(100, ratio * 100)) + '%';
    if (button) button.textContent = audio.paused ? '▶' : '❚❚';

    if (time) {
      // Count up while playing; settle back to the total when idle at the start.
      time.textContent =
        audio.paused && !audio.currentTime
          ? formatDuration(duration * 1000)
          : formatDuration(audio.currentTime * 1000);
    }
  }

  function seekVoice(root, el, e) {
    if (!playingVoice || playingVoice.id !== el.getAttribute('data-messages-voice')) return;

    var track = el.querySelector('[data-messages-voice-seek]');
    if (!track) return;

    var box = track.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
    var audio = playingVoice.audio;
    var duration = voiceDuration(el, audio);

    if (duration > 0) {
      audio.currentTime = ratio * duration;
      paintVoice(root, el, audio);
    }
  }

  function cycleVoiceSpeed(root, el) {
    var current = STORE.settings.voicePlaybackSpeed || 1;
    var next = SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length];

    STORE.settings.voicePlaybackSpeed = next;
    if (playingVoice) playingVoice.audio.playbackRate = next;

    // Speed is a stored preference, so it holds for the next note too.
    window.TMAMessagingAPI.updateSettings({ voicePlaybackSpeed: next }).catch(function () {});

    root.querySelectorAll('[data-messages-voice-speed]').forEach(function (btn) {
      btn.textContent = next + '×';
    });
  }

  /* ------------------------------------------------------------------
   * Reactions
   * ---------------------------------------------------------------- */

  /*
   * Add or remove one of the viewer's own reactions.
   *
   * Applied optimistically against the grouped shape the bubble renders, then
   * reconciled with the server's authoritative copy. The server treats this as
   * a toggle, so the local prediction has to match that: same emoji again
   * removes it.
   */
  function toggleReaction(root, state, render, messageId, emoji) {
    var msg = findMessageById(state.selectedId, messageId);
    if (!msg || !emoji) return;

    var before = JSON.parse(JSON.stringify(msg.reactions || []));
    var me = STORE.me || {};
    msg.reactions = msg.reactions || [];

    var hadSame = msg.reactions.some(function (r) {
      return r.emoji === emoji && r.mine;
    });

    /*
     * One reaction per person: drop whatever this viewer had before adding the
     * new one, and treat re-picking the same emoji as clearing it. Mirrors what
     * the server does, so the optimistic state matches the response.
     */
    msg.reactions = msg.reactions
      .map(function (r) {
        if (!r.mine) return r;
        return Object.assign({}, r, {
          count: r.count - 1,
          mine: false,
          users: (r.users || []).filter(function (u) {
            return u.id !== me.id;
          }),
        });
      })
      .filter(function (r) {
        return r.count > 0;
      });

    if (!hadSame) {
      var group = null;
      msg.reactions.forEach(function (r) {
        if (r.emoji === emoji) group = r;
      });

      if (group) {
        group.count += 1;
        group.mine = true;
        group.users = (group.users || []).concat([{ id: me.id, name: me.name }]);
      } else {
        msg.reactions.push({
          emoji: emoji,
          count: 1,
          mine: true,
          users: [{ id: me.id, name: me.name }],
        });
      }
    }

    rememberEmoji(emoji);
    render();

    window.TMAMessagingAPI.react(messageId, emoji)
      .then(function (data) {
        // Trust the server's grouping over the local prediction.
        if (data && data.message) msg.reactions = data.message.reactions || [];
        render();
      })
      .catch(function (err) {
        msg.reactions = before;
        render();
        showMessagesToast(
          root,
          err.status === 422 ? 'That reaction is not allowed' : 'Reaction not saved'
        );
      });
  }

  /*
   * The reaction pill: one row of the six emoji people actually use, plus a
   * "+" that opens the full picker.
   *
   * Deliberately not the whole grid up front — reacting is a one-tap action,
   * and 700 emoji in the way of a thumbs-up is not a picker, it's an obstacle.
   */
  function openReactionPill(root, state, render, messageId, position, anchor) {
    closeMessageMenu();

    var msg = findMessageById(state.selectedId, messageId);
    if (!msg || msg.deleted) return;

    var mine = (msg.reactions || [])
      .filter(function (r) { return r.mine; })
      .map(function (r) { return r.emoji; });

    var pill = document.createElement('div');
    pill.className = 'tma-dash__messages-reaction-pill';
    pill.setAttribute('role', 'dialog');
    pill.setAttribute('aria-label', 'React to message');
    pill.innerHTML = renderQuickReactions(messageId, mine);

    document.body.appendChild(pill);
    positionFloating(pill, anchor, position);

    pill.querySelectorAll('[data-messages-quick-emoji]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeMessageMenu();
        toggleReaction(root, state, render, messageId, btn.getAttribute('data-messages-quick-emoji'));
      });
    });

    var more = pill.querySelector('[data-messages-react-open]');
    if (more) {
      more.addEventListener('click', function (e) {
        e.stopPropagation();
        // Keep the pill's own position so the grid opens where it was.
        var box = pill.getBoundingClientRect();
        closeMessageMenu();
        openReactionPicker(root, state, render, messageId, { x: box.left, y: box.top }, anchor);
      });
    }

    openMenuEl = pill;
    setTimeout(function () {
      document.addEventListener('click', closeMessageMenuOnce, true);
    }, 0);
  }

  /*
   * Full emoji picker opened for a *reaction* rather than the composer. Reuses
   * the same grid; the difference is only what a chosen emoji does.
   */
  function openReactionPicker(root, state, render, messageId, position, anchor) {
    closeMessageMenu();

    var panel = document.createElement('div');
    panel.className = 'tma-dash__messages-message-menu tma-dash__messages-reaction-picker';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Choose a reaction');

    var pickerState = { emojiSearch: '', emojiCategory: null, emojiPickerOpen: true };

    function paint() {
      panel.innerHTML = renderEmojiPicker(pickerState);

      var search = panel.querySelector('[data-messages-emoji-search]');
      if (search) {
        search.addEventListener('input', function () {
          pickerState.emojiSearch = search.value;
          var caret = search.selectionStart;
          paint();
          var again = panel.querySelector('[data-messages-emoji-search]');
          if (again) {
            again.focus();
            try {
              again.setSelectionRange(caret, caret);
            } catch (err) {
              /* ignore */
            }
          }
        });
      }

      panel.querySelectorAll('[data-messages-emoji-category]').forEach(function (tab) {
        tab.addEventListener('click', function () {
          pickerState.emojiCategory = tab.getAttribute('data-messages-emoji-category');
          paint();
        });
      });

      panel.querySelectorAll('[data-messages-emoji-char]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          closeMessageMenu();
          toggleReaction(root, state, render, messageId, btn.getAttribute('data-messages-emoji-char'));
        });
      });
    }

    document.body.appendChild(panel);
    paint();
    positionFloating(panel, anchor, position);

    openMenuEl = panel;
    setTimeout(function () {
      document.addEventListener('click', closeMessageMenuOnce, true);
    }, 0);
  }

  /*
   * Who reacted, grouped by emoji — opened by clicking a reaction pill.
   *
   * Each row is a button: the viewer's own reaction is marked and clicking it
   * removes it, which is how a reaction gets taken back without hunting for
   * the picker again.
   */
  function openReactionDetails(root, state, render, anchor, messageId) {
    closeMessageMenu();

    var msg = findMessageById(state.selectedId, messageId);
    if (!msg || !msg.reactions || !msg.reactions.length) return;

    var panel = document.createElement('div');
    panel.className = 'tma-dash__messages-message-menu tma-dash__messages-reaction-details';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Reactions');

    panel.innerHTML = msg.reactions
      .map(function (r) {
        return (
          '<button type="button" class="tma-dash__messages-reaction-detail' +
          (r.mine ? ' is-mine' : '') +
          '" data-reaction-detail="' + esc(r.emoji) + '">' +
          '<span class="tma-dash__messages-reaction-detail-emoji">' + esc(r.emoji) + '</span>' +
          '<span class="tma-dash__messages-reaction-detail-names">' +
          esc((r.users || []).map(function (u) { return u.name; }).join(', ')) +
          '</span>' +
          (r.mine ? '<span class="tma-dash__messages-reaction-detail-hint">Tap to remove</span>' : '') +
          '</button>'
        );
      })
      .join('');

    document.body.appendChild(panel);
    positionFloating(panel, anchor, null);

    panel.querySelectorAll('[data-reaction-detail]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeMessageMenu();
        toggleReaction(root, state, render, messageId, btn.getAttribute('data-reaction-detail'));
      });
    });

    openMenuEl = panel;
    setTimeout(function () {
      document.addEventListener('click', closeMessageMenuOnce, true);
    }, 0);
  }

  /* ------------------------------------------------------------------
   * Conversation menu
   *
   * One definition, shared by the chat header's three-dot button and a
   * right-click on a row in the list, so the two can never drift apart.
   * ---------------------------------------------------------------- */

  function conversationMenuItems(row) {
    var items = [
      { action: 'pin', label: row.pinned ? 'Unpin conversation' : 'Pin conversation' },
      { action: 'mute', label: row.muted ? 'Unmute notifications' : 'Mute notifications' },
      { action: 'archive', label: row.archived ? 'Unarchive conversation' : 'Archive conversation' },
      { action: 'unread', label: 'Mark as unread' },
      { action: 'export', label: 'Export chat' },
      { action: 'clear', label: 'Clear messages', danger: true },
    ];

    // Blocking only means anything between two people.
    if (row.type !== 'group') {
      items.push({
        action: 'block',
        label: row.blocked ? 'Unblock contact' : 'Block contact',
        danger: !row.blocked,
      });
    }

    items.push({
      action: 'leave',
      label: row.type === 'group' ? 'Leave group' : 'Delete conversation',
      danger: true,
    });

    return items;
  }

  function openConversationMenu(root, state, render, anchor, conversationId, position) {
    closeMessageMenu();

    var row = findThread(conversationId);
    if (!row) return;

    var menu = document.createElement('div');
    menu.className = 'tma-dash__messages-message-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = conversationMenuItems(row)
      .map(function (item) {
        return (
          '<button type="button" role="menuitem" class="tma-dash__messages-message-menu-item' +
          (item.danger ? ' tma-dash__messages-message-menu-item--danger' : '') +
          '" data-conv-action="' + item.action + '">' + esc(item.label) + '</button>'
        );
      })
      .join('');

    document.body.appendChild(menu);
    positionFloating(menu, anchor, position);

    menu.querySelectorAll('[data-conv-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.getAttribute('data-conv-action');
        closeMessageMenu();
        runConversationAction(root, state, render, conversationId, action);
      });
    });

    openMenuEl = menu;
    setTimeout(function () {
      document.addEventListener('click', closeMessageMenuOnce, true);
    }, 0);
  }

  function runConversationAction(root, state, render, conversationId, action) {
    var row = findThread(conversationId);
    if (!row) return;
    var api = window.TMAMessagingAPI;

    // Pin / mute / archive already have optimistic handling.
    if (action === 'pin' || action === 'mute' || action === 'archive') {
      commitMessagesRowAction(root, state, render, conversationId, action);
      return;
    }

    if (action === 'unread') {
      row.unread = row.unread || 1;
      row.markedUnread = true;
      render();
      syncTabBarBadges();
      api.markUnread(conversationId).catch(function () {
        showMessagesToast(root, 'Could not mark as unread');
      });
      return;
    }

    if (action === 'export') {
      // A normal download; the transcript is generated server-side.
      window.location.href = api.exportUrl(conversationId);
      return;
    }

    if (action === 'clear') {
      if (!window.confirm('Clear all messages in this conversation? This only clears your own copy.')) return;
      api
        .clearChat(conversationId)
        .then(function () {
          STORE.threadMessages[conversationId] = {
            messages: [], hasMore: false, loading: false, loaded: true,
          };
          row.preview = 'No messages yet';
          row.unread = 0;
          render();
          showMessagesToast(root, 'Messages cleared');
        })
        .catch(function () {
          showMessagesToast(root, 'Chat could not be cleared');
        });
      return;
    }

    if (action === 'block') {
      var blocking = !row.blocked;
      if (blocking && !window.confirm('Block this person? They will not be able to message you.')) return;
      row.blocked = blocking;
      render();
      api.setBlocked(conversationId, blocking).catch(function () {
        row.blocked = !blocking;
        render();
        showMessagesToast(root, 'That could not be saved');
      });
      return;
    }

    if (action === 'leave') {
      var isGroup = row.type === 'group';
      var prompt = isGroup
        ? 'Leave this group? You will stop receiving its messages.'
        : 'Delete this conversation? It is removed for you; the other person keeps their copy.';
      if (!window.confirm(prompt)) return;

      api
        .leaveConversation(conversationId)
        .then(function () {
          STORE.threads = STORE.threads.filter(function (r) {
            return r.id !== conversationId;
          });
          delete STORE.threadMessages[conversationId];
          if (state.selectedId === conversationId) closeConversation(root, state, render);
          else render();
          syncTabBarBadges();
          showMessagesToast(root, isGroup ? 'You left the group' : 'Conversation deleted');
        })
        .catch(function () {
          showMessagesToast(root, 'That could not be completed');
        });
    }
  }

  /* ------------------------------------------------------------------
   * Event wiring
   * ---------------------------------------------------------------- */

  function wireEvents(root, state, render) {
    if (!isMessagesMobile()) {
      root.querySelectorAll('[data-messages-row]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          openConversation(root, state, render, btn.getAttribute('data-messages-row'));
        });
      });
    }

    root.querySelectorAll('[data-messages-reply]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        var index = parseInt(btn.getAttribute('data-messages-reply'), 10);
        if (isNaN(index)) return;
        var msg = getMessages(state.selectedId)[index];
        if (!msg) return;
        setReplyTo(state, msg.id);
        render();
        focusComposerInput(root);
      });
    });

    // Clicking a reaction pill shows who reacted; the viewer's own reaction is
    // marked there and can be removed from the same panel.
    root.querySelectorAll('[data-messages-react-emoji]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openReactionDetails(root, state, render, btn, btn.getAttribute('data-messages-react'));
      });
    });

    // The bubble's react button opens the full picker.
    root.querySelectorAll('[data-messages-react-open]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openReactionPill(
          root, state, render,
          btn.getAttribute('data-messages-react-open'),
          null,
          btn
        );
      });
    });

    // Clicking a reply quote scrolls to, and flashes, the original.
    root.querySelectorAll('[data-messages-jump]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        jumpToMessage(root, btn.getAttribute('data-messages-jump'));
      });
    });

    root.querySelectorAll('[data-messages-load-more]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var messages = getMessages(state.selectedId);
        var oldest = null;
        for (var i = 0; i < messages.length; i++) {
          if (messages[i].seq) {
            oldest = messages[i].seq;
            break;
          }
        }
        if (oldest) loadThread(root, state, render, state.selectedId, { before: oldest });
      });
    });

    root.querySelectorAll('[data-messages-menu]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openMessageMenu(root, state, render, btn, btn.getAttribute('data-messages-menu'));
      });
    });

    /*
     * Right-click and long-press open the same menu at the pointer. Long press
     * is the mobile equivalent — there is no hover there — and it must not fire
     * when the finger is actually scrolling or swiping to reply.
     */
    root.querySelectorAll('[data-messages-id]').forEach(function (row) {
      var messageId = row.getAttribute('data-messages-id');
      if (!messageId || row.dataset.contextBound) return;
      row.dataset.contextBound = '1';

      row.addEventListener('contextmenu', function (e) {
        // Let the browser's own menu handle links and selected text.
        if (e.target.closest('a') || String(window.getSelection() || '')) return;
        e.preventDefault();
        openMessageMenu(root, state, render, row, messageId, { x: e.clientX, y: e.clientY });
      });

      var pressTimer = null;
      var pressOrigin = null;

      function cancelPress() {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = null;
        pressOrigin = null;
        row.classList.remove('is-actions-open');
      }

      row.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse') return; // right-click covers desktop
        pressOrigin = { x: e.clientX, y: e.clientY };
        pressTimer = setTimeout(function () {
          pressTimer = null;
          row.classList.add('is-actions-open');
          openMessageMenu(root, state, render, row, messageId, pressOrigin);
        }, 450);
      });

      row.addEventListener('pointermove', function (e) {
        if (!pressOrigin) return;
        // Any real movement means a scroll or a swipe, not a press.
        if (Math.abs(e.clientX - pressOrigin.x) > 8 || Math.abs(e.clientY - pressOrigin.y) > 8) {
          cancelPress();
        }
      });

      row.addEventListener('pointerup', cancelPress);
      row.addEventListener('pointercancel', cancelPress);
    });

    // The chat header's three-dot menu.
    var convMenuBtn = root.querySelector('[data-messages-conversation-menu]');
    if (convMenuBtn) {
      convMenuBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openConversationMenu(root, state, render, convMenuBtn, state.selectedId);
      });
    }

    var closeBtn = root.querySelector('[data-messages-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        closeConversation(root, state, render);
      });
    }

    // Desktop right-click on a conversation row gets the same actions the
    // mobile swipe reveals.
    root.querySelectorAll('[data-messages-row]').forEach(function (rowEl) {
      rowEl.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        openConversationMenu(
          root, state, render, rowEl,
          rowEl.getAttribute('data-messages-row'),
          { x: e.clientX, y: e.clientY }
        );
      });
    });

    var clearReplyBtn = root.querySelector('[data-messages-reply-clear]');
    if (clearReplyBtn) {
      clearReplyBtn.addEventListener('click', function () {
        clearReplyTo(state);
        render();
      });
    }

    var retry = root.querySelector('[data-messages-retry]');
    if (retry) {
      retry.addEventListener('click', function () {
        STORE.loaded = false;
        STORE.loadError = null;
        render();
        loadConversations(root, state, render);
      });
    }

    var threadRetry = root.querySelector('[data-messages-thread-retry]');
    if (threadRetry) {
      threadRetry.addEventListener('click', function () {
        loadThread(root, state, render, state.selectedId, { toBottom: true });
      });
    }

    // Paging upward: reaching the top of the thread pulls in older history.
    var chatBody = root.querySelector('[data-messages-chat-body]');
    if (chatBody) {
      chatBody.addEventListener('scroll', function () {
        if (chatBody.scrollTop > 80) return;
        var bucket = threadBucket(state.selectedId);
        if (!bucket.hasMore || bucket.loading) return;

        var messages = bucket.messages;
        for (var i = 0; i < messages.length; i++) {
          if (messages[i].seq) {
            loadThread(root, state, render, state.selectedId, { before: messages[i].seq });
            return;
          }
        }
      });
    }

    // --- chat-list search -------------------------------------------------
    var search = root.querySelector('[data-messages-search]');
    if (search) {
      search.addEventListener('input', function () {
        state.search = search.value;
        render();
        searchPeople(state, render, search.value, 'list');
      });
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          state.search = '';
          state.peopleResults = [];
          render();
        }
      });
    }

    var searchClear = root.querySelector('[data-messages-search-clear]');
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        state.search = '';
        state.peopleResults = [];
        render();
        var field = root.querySelector('[data-messages-search]');
        if (field) field.focus();
      });
    }

    // --- new message ------------------------------------------------------
    root.querySelectorAll('[data-messages-compose]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openComposePanel(root, state, render);
      });
    });

    var composeSearch = root.querySelector('[data-messages-compose-search]');
    if (composeSearch) {
      composeSearch.addEventListener('input', function () {
        state.composeQuery = composeSearch.value;
        render();
        searchPeople(state, render, composeSearch.value, 'compose');
      });
    }

    root.querySelectorAll('[data-messages-start]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.getAttribute('data-messages-start'), 10);
        if (!isNaN(id)) startConversationWith(root, state, render, id);
      });
    });

    // --- messages settings ------------------------------------------------
    root.querySelectorAll('[data-messages-settings]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var opening = !state.settingsOpen;
        state.settingsOpen = opening;
        state.composeOpen = false;
        render();
      });
    });

    root.querySelectorAll('[data-messages-setting]').forEach(function (field) {
      field.addEventListener('change', function () {
        var key = field.getAttribute('data-messages-setting');
        var value = field.type === 'checkbox' ? field.checked : field.value;
        updateSetting(root, state, render, key, value);
      });
    });

    root.querySelectorAll('[data-messages-panel-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closePanels(state, render);
      });
    });

    /*
     * Drag files anywhere over the open conversation to attach them.
     *
     * Bound on the chat column rather than the composer: aiming at a small
     * strip at the bottom of the window is needless precision when the whole
     * conversation is an obvious target. dragleave fires when crossing child
     * elements, so the highlight is tracked with a depth counter.
     */
    var dropZone = root.querySelector('.tma-dash__messages-chat');
    if (dropZone && state.selectedId) {
      var depth = 0;

      dropZone.addEventListener('dragenter', function (e) {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') === -1) return;
        e.preventDefault();
        depth += 1;
        dropZone.classList.add('is-drop-target');
      });

      dropZone.addEventListener('dragover', function (e) {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') === -1) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });

      dropZone.addEventListener('dragleave', function () {
        depth = Math.max(0, depth - 1);
        if (depth === 0) dropZone.classList.remove('is-drop-target');
      });

      dropZone.addEventListener('drop', function (e) {
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        e.preventDefault();
        depth = 0;
        dropZone.classList.remove('is-drop-target');
        queueFiles(root, state, render, e.dataTransfer.files);
      });
    }

    root.querySelectorAll('[data-messages-voice]').forEach(function (el) {
      var play = el.querySelector('[data-messages-voice-play]');
      if (play) {
        play.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          toggleVoicePlayback(root, state, render, el);
        });
      }

      var track = el.querySelector('[data-messages-voice-seek]');
      if (track) {
        track.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          seekVoice(root, el, e);
        });
      }

      var speed = el.querySelector('[data-messages-voice-speed]');
      if (speed) {
        speed.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          cycleVoiceSpeed(root, el);
        });
      }
    });

    // Opening an attachment in the shared lightbox.
    root.querySelectorAll('[data-messages-attachment]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openAttachment(state, el.getAttribute('data-messages-attachment'));
      });
    });

    bindMessageSwipes(root, state, render);
    bindMessagesInboxSwipes(root, state, render);
    bindComposer(root, state, render);

    var backBtn = root.querySelector('[data-messages-back]');
    if (backBtn && root._messagesOnBack) {
      backBtn.addEventListener('click', root._messagesOnBack);
    }
  }

  /*
   * Per-message menu, opened by the "more" button, a right-click, or a mobile
   * long press. Only actions that will actually work are listed — permissions
   * come from the server on each message (`msg.can`), never from hiding
   * buttons client-side alone.
   *
   * Attachment actions (open / download / save to library) and forward, star
   * and message info arrive with their phases; listing them now would put back
   * exactly the dead controls this work is removing.
   */
  function openMessageMenu(root, state, render, anchor, messageId, position) {
    closeMessageMenu();

    var msg = findMessageById(state.selectedId, messageId);
    if (!msg || msg.deleted) return;

    var items = [{ action: 'reply', label: 'Reply' }];
    if (msg.body) items.push({ action: 'copy', label: 'Copy text' });
    if (msg.can && msg.can.edit) items.push({ action: 'edit', label: 'Edit' });
    if (msg.can && msg.can.delete) items.push({ action: 'delete', label: 'Delete', danger: true });

    // Which emoji this viewer already holds on the message, so the row can
    // show them as active and a second tap removes them.
    var mine = (msg.reactions || [])
      .filter(function (r) { return r.mine; })
      .map(function (r) { return r.emoji; });

    var menu = document.createElement('div');
    menu.className = 'tma-dash__messages-message-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML =
      renderQuickReactions(msg.id, mine) +
      items
        .map(function (item) {
          return (
            '<button type="button" role="menuitem" class="tma-dash__messages-message-menu-item' +
            (item.danger ? ' tma-dash__messages-message-menu-item--danger' : '') +
            '" data-menu-action="' + item.action + '">' + esc(item.label) + '</button>'
          );
        })
        .join('');

    document.body.appendChild(menu);
    positionFloating(menu, anchor, position);

    menu.querySelectorAll('[data-messages-quick-emoji]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeMessageMenu();
        toggleReaction(root, state, render, msg.id, btn.getAttribute('data-messages-quick-emoji'));
      });
    });

    var moreBtn = menu.querySelector('[data-messages-react-open]');
    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        closeMessageMenu();
        openReactionPicker(root, state, render, msg.id, position || null, anchor);
      });
    }

    menu.querySelectorAll('[data-menu-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.getAttribute('data-menu-action');
        closeMessageMenu();
        if (action === 'reply') {
          setReplyTo(state, msg.id);
          render();
          focusComposerInput(root);
        } else if (action === 'copy') copyMessageText(root, msg);
        else if (action === 'edit') startEditingMessage(root, state, render, msg);
        else if (action === 'delete') deleteMessage(root, state, render, msg);
      });
    });

    openMenuEl = menu;
    setTimeout(function () {
      document.addEventListener('click', closeMessageMenuOnce, true);
    }, 0);
  }

  /*
   * Place a floating menu, clamped inside the viewport. `position` is an
   * explicit {x, y} for pointer-driven opens (right-click, long press);
   * otherwise it hangs off the anchor element.
   */
  function positionFloating(el, anchor, position) {
    el.style.position = 'fixed';

    var top;
    var left;

    if (position) {
      top = position.y;
      left = position.x;
    } else {
      var rect = anchor.getBoundingClientRect();
      top = rect.bottom + 4;
      left = rect.left;
    }

    el.style.top = Math.max(8, Math.min(top, window.innerHeight - el.offsetHeight - 8)) + 'px';
    el.style.left = Math.max(8, Math.min(left, window.innerWidth - el.offsetWidth - 8)) + 'px';
  }

  var openMenuEl = null;

  function closeMessageMenu() {
    if (openMenuEl && openMenuEl.parentNode) openMenuEl.parentNode.removeChild(openMenuEl);
    openMenuEl = null;
    document.removeEventListener('click', closeMessageMenuOnce, true);
  }

  /*
   * Dismiss on a click *outside* the open panel.
   *
   * This used to be a `{ once: true }` listener that closed unconditionally, so
   * interacting with the panel's own contents shut it — switching emoji
   * category closed the picker instead of changing category. Containment is
   * checked instead, and the listener persists until the panel actually closes.
   */
  function closeMessageMenuOnce(e) {
    if (!openMenuEl) return;
    if (e && openMenuEl.contains(e.target)) return;
    closeMessageMenu();
  }

  /* ------------------------------------------------------------------
   * Mount
   * ---------------------------------------------------------------- */

  function mount(root) {
    // messages.js is loaded from every portal shell; the API client has to be
    // loaded alongside it. Fail loudly here rather than part-way through a
    // render, which is how a missing shell script used to surface.
    if (!window.TMAMessagingAPI) {
      if (window.console) {
        console.error('[messages] js/messaging-api.js must be loaded before js/messages.js');
      }
      root.innerHTML =
        '<div class="tma-dash__messages-list-state tma-dash__messages-list-state--error">' +
        '<p>Messaging could not start.</p></div>';
      return;
    }

    var state = root._messagesState || {
      selectedId: null,
      reading: false,
      replyTo: null,
      editing: null,
      composerDrafts: {},
      composerAttachments: {},
      emojiPickerOpen: false,
      emojiSearch: '',
      emojiCategory: null,
      composerLinkUrl: null,
      composerLinkDismissed: null,
      recording: null,
      voiceRecording: false,
      search: '',
      peopleResults: [],
      composeOpen: false,
      composeQuery: '',
      composeResults: [],
      settingsOpen: false,
      tab: 'all',
    };
    root._messagesState = state;

    /*
     * One render pass. Scroll positions are captured before the subtree is
     * replaced and restored after, which is what keeps the chat list still
     * while conversations are opened, read, and updated underneath it.
     */
    function render(intent) {
      var snapshot = captureScroll(root);

      root.innerHTML = renderLayout(state, render);
      ensureMessagesMobileHeader(root, state);
      wireEvents(root, state, render);

      restoreScroll(root, snapshot, intent);
      syncTabBarBadges();
    }

    root._messagesOnBack = function () {
      state.reading = false;
      render();
    };

    if (root._messagesMounted) {
      render();
      return;
    }
    root._messagesMounted = true;

    var mobileMq = window.matchMedia(MESSAGES_MOBILE_MQ);
    function onMobileBreakpoint() {
      if (!isMessagesMobile()) state.reading = false;
      render();
    }
    if (typeof mobileMq.addEventListener === 'function') {
      mobileMq.addEventListener('change', onMobileBreakpoint);
    } else if (typeof mobileMq.addListener === 'function') {
      mobileMq.addListener(onMobileBreakpoint);
    }

    // "/" focuses search, Escape closes an open panel. Bound once, on the
    // document, because the elements themselves are replaced on every render.
    if (!root._messagesKeysBound) {
      root._messagesKeysBound = true;

      document.addEventListener('keydown', function (e) {
        if (!root.isConnected) return;

        var target = e.target;
        var typing =
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable ||
            // A keystroke that lands on the document while the composer holds
            // text is still typing as far as the user is concerned — treating
            // it as a shortcut is how "/" got eaten out of a pasted URL.
            !!(target.closest && target.closest('.tma-dash__messages-composer')));

        if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
          var field = root.querySelector('[data-messages-search]');
          if (field) {
            e.preventDefault();
            field.focus();
            field.select();
          }
          return;
        }

        if (e.key !== 'Escape') return;

        // Escape unwinds one layer at a time, outermost last: an open menu,
        // then a panel, then a reply draft, then the conversation itself.
        if (openMenuEl) {
          closeMessageMenu();
          return;
        }

        if (state.composeOpen || state.settingsOpen) {
          closePanels(state, render);
          return;
        }

        if (state.editing) {
          state.editing = null;
          setComposerDraft(state, '');
          render();
          return;
        }

        if (state.replyTo) {
          clearReplyTo(state);
          render();
          return;
        }

        // Never yank the conversation out from under someone mid-sentence.
        if (state.selectedId && !typing && !getComposerDraft(state).trim()) {
          closeConversation(root, state, render);
        }
      });

      // Clicking away from an open panel closes it, but a click inside it (or
      // on the button that opened it) must not.
      document.addEventListener('click', function (e) {
        if (!root.isConnected) return;
        if (!state.composeOpen && !state.settingsOpen) return;
        if (e.target.closest('[data-messages-panel]')) return;
        if (e.target.closest('[data-messages-compose]')) return;
        if (e.target.closest('[data-messages-settings]')) return;
        closePanels(state, render);
      });
    }

    // Presence heartbeat. Pauses on a hidden tab so a background tab does not
    // keep someone looking online after they have walked away.
    if (!root._messagesHeartbeat) {
      root._messagesHeartbeat = setInterval(function () {
        if (!document.hidden) window.TMAMessagingAPI.heartbeat();
      }, 30000);
      window.TMAMessagingAPI.heartbeat();
    }

    // Returning to the tab reconciles anything the socket missed while away.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || !root.isConnected) return;
      window.TMAMessagingAPI.heartbeat();
      loadConversations(root, state, render, { silent: true });
    });

    render();
    loadConversations(root, state, render);
  }

  window.TMAMessages = {
    mount: mount,
    clearMobileHeader: clearMessagesMobileHeader,
    getInboxUnreadCount: getInboxUnreadCount,
  };
})();
