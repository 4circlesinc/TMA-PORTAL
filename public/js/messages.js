/*
 * TMA - Messages page ( /social/messages )
 * Global: window.TMAMessages
 */
(function () {
  'use strict';

  /*
   * Keyed DOM reconciliation (js/dom-morph.js).
   *
   * render() replaces this view's markup on every state change, a delivery
   * tick, a reaction, a typing indicator. Assigning innerHTML for that threw
   * away and rebuilt the entire thread each time, which re-requested every
   * avatar and attachment, dropped scroll position, and interrupted typing.
   * MORPH.patch applies the same markup by updating the existing nodes instead.
   *
   * Because nodes now survive a render, the wiring below binds through
   * MORPH.unwired / unwiredOne / on, which register a listener once per element
   * rather than once per render. Without that, one click would fire as many
   * times as the view had rendered.
   *
   * The fallbacks keep the page working if the library fails to load: the old
   * destructive behaviour, which is degraded but not broken.
   */
  var MORPH = window.TMAMorph || {
    patch: function (root, html) { root.innerHTML = html; },
    unwired: function (root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); },
    unwiredOne: function (root, sel) { return root.querySelector(sel); },
    on: function (el, type, fn) { if (el) el.addEventListener(type, fn); },
  };

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
    FolderOpen: ICON + 'FolderOpen.svg',
    PushPin: ICON + 'PushPin.svg',
    PushPinSlash: ICON + 'PushPinSlash.svg',
    Star: ICON + 'Star.svg',
    StarFilled: ICON + 'StarFilled.svg',
    BellSlash: ICON + 'BellSlash.svg',
    Archive: ICON + 'Archive.svg',
    Trash: ICON + 'Trash.svg',
    CheckCircle: ICON + 'CheckCircle.svg',
    Images: ICON + 'Images.svg',
    ArrowLineDown: ICON + 'ArrowLineDown.svg',
    ChatCircleDots: ICON + 'ChatCircleDots.svg',
    PencilSimple: ICON + 'PencilSimple.svg',
    ShareNetwork: ICON + 'ShareNetwork.svg',
    Copy: ICON + 'Copy.svg',
    Translate: ICON + 'Translate.svg',
    X: ICON + 'X.svg',
    Bell: ICON + 'Bell.svg',
    ArchiveTray: ICON + 'ArchiveTray.svg',
    EnvelopeSimple: ICON + 'EnvelopeSimple.svg',
    EnvelopeSimpleOpen: ICON + 'EnvelopeSimpleOpen.svg',
    CheckSquare: ICON + 'CheckSquare.svg',
    ListChecks: ICON + 'ListChecks.svg',
  };

  var MESSAGES_MOBILE_MQ = '(max-width: 1024px)';

  function isMessagesMobile() {
    return window.matchMedia(MESSAGES_MOBILE_MQ).matches;
  }

  function isMessagesReading(state) {
    return isMessagesMobile() && !!state.reading && !!state.selectedId;
  }

  /*
   * One draggable divider sets the inbox column's width; the chat takes the
   * rest, so a single handle resizes both. Because the settings and new-message
   * panels live inside the inbox column, they follow the same width for free.
   * Default is the original 320px, so an untouched page looks exactly as before.
   */
  var INBOX_WIDTH_KEY = 'tma.messages.inboxWidth';
  var INBOX_WIDTH_DEFAULT = 320;
  var INBOX_WIDTH_MIN = 260;
  var INBOX_WIDTH_MAX = 600;

  function clampInboxWidth(px, layoutWidth) {
    var max = INBOX_WIDTH_MAX;
    // Never let the inbox crowd the chat below a readable width.
    if (layoutWidth) max = Math.min(max, layoutWidth - 380);
    if (max < INBOX_WIDTH_MIN) max = INBOX_WIDTH_MIN;
    return Math.max(INBOX_WIDTH_MIN, Math.min(px, max));
  }

  function loadInboxWidth() {
    try {
      var v = parseInt(localStorage.getItem(INBOX_WIDTH_KEY), 10);
      if (!isNaN(v)) return v;
    } catch (e) {}
    return INBOX_WIDTH_DEFAULT;
  }

  function saveInboxWidth(px) {
    try { localStorage.setItem(INBOX_WIDTH_KEY, String(Math.round(px))); } catch (e) {}
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
    // conversation id -> announcements waiting to go out, soonest first.
    // Only ever filled for a group the viewer runs: nobody else is told.
    scheduled: {},
    me: null,
    settings: {},
    realtime: null,
    limits: {},
    loaded: false,
    loadError: null,
    // Whether the SERVER has answered this session, as opposed to `loaded`,
    // which also goes true when a fetch fails so the spinner can come down.
    // Warm boot keys on this: a dead network must not outrank the snapshot.
    real: false,
  };

  function rememberMe() {
    if (window.TMAMessagingCalls && window.TMAMessagingCalls.setViewer && STORE.me) {
      window.TMAMessagingCalls.setViewer(STORE.me.id);
    }
  }

  function sameUserId(a, b) {
    return a != null && b != null && Number(a) === Number(b);
  }

  /* Who placed this call, from the viewer's point of view. initiatorId is
     the source of truth; actorId/actorName cover older rows that never
     recorded one (so a call you placed stopped reading as a missed incoming). */
  function isOutgoingCall(event) {
    if (!STORE.me) return false;
    var initiator = event && (event.initiatorId != null ? event.initiatorId : event.initiator_id);
    if (initiator != null) return sameUserId(initiator, STORE.me.id);
    if (event && event.event === 'call_missed' && event.actorId != null) {
      return sameUserId(event.actorId, STORE.me.id);
    }
    if (event && event.event === 'call_missed' && event.actorName && STORE.me.name) {
      return event.actorName === STORE.me.name;
    }
    return false;
  }

  /* Set by mount, so a warm snapshot landing after the view is up repaints
     it. Before mount there is nothing to repaint, the first render reads
     the hydrated STORE by itself. */
  var warmRerender = null;

  /*
   * ── Warm boot ────────────────────────────────────────────────────
   * The conversation list opens the way it was quit: rows, names, previews
   * and unread counts from the store's snapshot, corrected silently by the
   * fetch that was always going to run. Desktop-persistent, browser-memory —
   * the standing split. Runs after DCL because the store's reads are scoped
   * to the account current-user.js sets, and during deferred execution
   * readyState is already 'interactive' while DCL has not fired (the trap).
   */
  /* Put the kept list up. True when it did. */
  function adoptWarm(snap) {
    // Only the server's answer outranks the kept list. A first load that
    // failed (no connection) is "loaded" too, with nothing in it, and used
    // to throw the kept list away behind "could not be loaded".
    if (!snap || STORE.real || (STORE.threads || []).length || !(snap.threads || []).length) return false;
    STORE.threads = snap.threads || [];
    STORE.me = snap.me || null;
    rememberMe();
    STORE.settings = snap.settings || {};
    STORE.tabCounts = snap.tabCounts || {};
    STORE.loaded = true;
    STORE.loadError = null;
    if (warmRerender) warmRerender();

    return true;
  }

  function hydrateMessages() {
    if (!window.TMAStore) return;
    window.TMAStore.get('messages:warm').then(adoptWarm);
  }

  var messagesHydrated = false;
  var hydrateMessagesOnce = function () {
    if (messagesHydrated) return;
    messagesHydrated = true;
    hydrateMessages();
  };
  if (document.readyState === 'complete') {
    hydrateMessagesOnce();
  } else {
    document.addEventListener('DOMContentLoaded', hydrateMessagesOnce);
    window.addEventListener('load', hydrateMessagesOnce);
  }

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

    var adopted = {};
    var fresh = [];
    incoming.forEach(function (msg) {
      // A confirmed send replaces its own optimistic placeholder in place, so
      // the bubble never jumps position when the server answers.
      var existing = bySeq[msg.seq];
      if (existing === undefined && msg.nonce !== undefined) existing = byNonce[msg.nonce];

      // This person's own message, read back from the server before the send
      // that wrote it has answered (the arrival event reaches the sender too,
      // and a pulled page carries no nonce). It is the bubble already showing,
      // not a second message: without this a group send drew twice.
      if (existing === undefined && msg.seq && msg.direction === 'out') {
        existing = ownPlaceholderFor(bucket.messages, msg, adopted);
        if (existing !== undefined) {
          adopted[existing] = true;
          msg.nonce = bucket.messages[existing].nonce;
        }
      }

      if (existing !== undefined) {
        bucket.messages[existing] = msg;
        return;
      }
      fresh.push(msg);
    });

    if (fresh.length) {
      bucket.messages = atFront ? fresh.concat(bucket.messages) : bucket.messages.concat(fresh);
      bucket.messages.sort(function (a, b) {
        // Pending sends have no seq yet and belong last, in arrival order.
        var aSeq = a.seq || Number.MAX_SAFE_INTEGER;
        var bSeq = b.seq || Number.MAX_SAFE_INTEGER;
        return aSeq - bSeq;
      });
    }

    dropSeqDuplicates(bucket);

    if (bucket.loaded) persistThread(id);

    return bucket;
  }

  /* The unsent bubble (no seq yet) a server copy of the same words stands for. */
  function ownPlaceholderFor(messages, msg, adopted) {
    var body = (msg.body || '').trim();
    var files = (msg.attachments || []).length;
    for (var i = 0; i < messages.length; i++) {
      var held = messages[i];
      if (adopted[i] || held.seq || !held.nonce) continue;
      if (!held.pending && !held.queued) continue;
      if ((held.body || '').trim() !== body) continue;
      if ((held.attachments || []).length !== files) continue;

      return i;
    }

    return undefined;
  }

  /* One bubble per stored message, whichever way each copy arrived. */
  function dropSeqDuplicates(bucket) {
    var seen = {};
    var kept = [];
    for (var i = 0; i < bucket.messages.length; i++) {
      var msg = bucket.messages[i];
      if (msg.seq) {
        if (seen[msg.seq] !== undefined) {
          // Keep the copy carrying the nonce: it is the one sends reconcile on.
          if (msg.nonce && !kept[seen[msg.seq]].nonce) kept[seen[msg.seq]] = msg;
          continue;
        }
        seen[msg.seq] = kept.length;
      }
      kept.push(msg);
    }
    if (kept.length !== bucket.messages.length) bucket.messages = kept;
  }

  /* ------------------------------------------------------------------
   * Conversations kept on the device.
   *
   * A conversation's newest messages are kept in TMAStore (on disk in the
   * Mac, Windows, iPhone and Android apps, in this tab in a browser), so it
   * opens at once, and with no connection, from what was last seen, and only
   * what is new is fetched behind it. Messages written with no connection
   * live in the write queue (TMAQueue) until they are sent, and are drawn
   * from there, "Waiting to send", across a restart; the server's nonce makes
   * a replayed send land once.
   * ---------------------------------------------------------------- */

  var THREAD_KEEP = 100;
  var threadSaveTimers = {};

  function threadKey(id) {
    return 'messages:thread:' + id;
  }

  function persistThread(id) {
    if (!id || !window.TMAStore) return;
    if (threadSaveTimers[id]) clearTimeout(threadSaveTimers[id]);
    threadSaveTimers[id] = setTimeout(function () {
      delete threadSaveTimers[id];
      var bucket = STORE.threadMessages[id];
      if (!bucket || !bucket.loaded) return;
      // What the server has, not what is still on its way to it.
      var kept = bucket.messages.filter(function (m) {
        return m && !m.pending && !m.queued && !m.failed && String(m.id).indexOf('pending-') !== 0;
      });
      var tail = kept.slice(-THREAD_KEEP);
      try {
        Promise.resolve(window.TMAStore.put(threadKey(id), {
          messages: tail,
          hasMore: !!bucket.hasMore || kept.length > tail.length,
        })).catch(function () { /* a full disk costs the copy, not the thread */ });
      } catch (e) { /* as above */ }
    }, 800);
  }

  /*
   * Every recent chat there with no connection, not only the ones opened
   * before: what WhatsApp does. In the apps, a little after the list has
   * arrived, the newest page of each recent conversation is fetched quietly,
   * one at a time, and kept as if it had been opened. A copy kept in the
   * last few minutes is left alone; an open conversation keeps its own.
   */
  var WARM_THREADS = 50;
  var WARM_FRESH_MS = 10 * 60 * 1000;
  var warmingThreads = false;

  function warmThreads() {
    var store = window.TMAStore;
    if (warmingThreads || !store || !store.persistent || !window.TMAMessagingAPI) return;
    warmingThreads = true;
    var rows = (STORE.threads || []).slice(0, WARM_THREADS);
    var i = 0;
    var next = function () {
      if (i >= rows.length) {
        warmingThreads = false;
        return;
      }
      var id = rows[i++] && rows[i - 1].id;
      var open = id && STORE.threadMessages[id] && STORE.threadMessages[id].loaded;
      if (!id || open) {
        next();
        return;
      }
      store.get(threadKey(id)).then(function (kept) {
        if (kept && kept.keptAt && Date.now() - kept.keptAt < WARM_FRESH_MS) return null;

        return window.TMAMessagingAPI.messages(id).then(function (data) {
          var messages = (data && data.messages) || [];
          if (!messages.length) return null;

          return store.put(threadKey(id), {
            messages: messages.slice(-THREAD_KEEP),
            hasMore: !!(data && data.hasMore) || messages.length > THREAD_KEEP,
            keptAt: Date.now(),
          });
        });
      }).catch(function () { /* the next opening tries again */ }).then(function () {
        setTimeout(next, 250);
      });
    };
    next();
  }

  /*
   * The copy is kept under the signed-in account, so a read in the first
   * moments of a launch, before /me has said who that is, looks in the wrong
   * place and misses. Wait for it, briefly: usually it is already known (the
   * apps remember /me), and a slow /me must not hold the conversation back.
   */
  function accountReady(ms) {
    if (!window.TMAStore || typeof window.TMAStore.whenAccount !== 'function') return Promise.resolve();

    return Promise.race([
      Promise.resolve(window.TMAStore.whenAccount()),
      new Promise(function (resolve) { setTimeout(resolve, ms); }),
    ]);
  }

  /* The kept copy, painted before the network answers. Resolves either way. */
  function hydrateThread(id) {
    var bucket = threadBucket(id);
    if (bucket.loaded || !window.TMAStore) return Promise.resolve(false);

    return accountReady(1500).then(function () {
      return window.TMAStore.get(threadKey(id));
    }).then(function (snap) {
      if (bucket.loaded || !snap || !snap.messages || !snap.messages.length) return false;
      mergeMessages(id, snap.messages, false);
      bucket.hasMore = !!snap.hasMore;
      bucket.loaded = true;
      bucket.fromDevice = true;

      return true;
    }).catch(function () { return false; });
  }

  /* Messages this person wrote with no connection, back in their conversation. */
  function restoreQueued(id, render) {
    if (!window.TMAQueue) return;
    window.TMAQueue.all().then(function (entries) {
      var bubbles = entries.filter(function (entry) {
        return entry.kind === 'message' && entry.meta && entry.meta.conversation === id && entry.meta.bubble;
      }).map(function (entry) {
        var bubble = Object.assign({}, entry.meta.bubble);
        bubble.pending = false;
        bubble.queued = entry.state !== 'failed';
        bubble.failed = entry.state === 'failed';

        return bubble;
      });
      if (!bubbles.length) return;
      mergeMessages(id, bubbles, false);
      if (render) render();
    }).catch(function () { /* nothing waiting, or no queue */ });
  }

  /* Settle the bubble a queued send drew: sent, failed or discarded. */
  function settleQueued(detail, outcome) {
    if (!detail || detail.kind !== 'message' || !detail.meta) return;
    var id = detail.meta.conversation;
    var nonce = detail.meta.nonce;
    var bucket = STORE.threadMessages[id];
    if (!bucket) return;

    for (var i = 0; i < bucket.messages.length; i++) {
      if (bucket.messages[i].nonce !== nonce) continue;
      if (outcome === 'sent' && detail.response && detail.response.message) {
        var confirmed = detail.response.message;
        confirmed.nonce = nonce;
        bucket.messages[i] = confirmed;
        var row = findThread(id);
        if (row) {
          row.preview = 'You: ' + messagePreview(confirmed);
          row.timestamp = confirmed.sentAt;
          row.listed = true;
        }
      } else {
        bucket.messages[i].queued = false;
        bucket.messages[i].pending = false;
        bucket.messages[i].failed = true;
      }
      break;
    }

    persistThread(id);
    if (lastThreadRender) lastThreadRender();
  }

  // The Messages view's render, from the last thread it loaded: a queued send
  // can land while nothing else is asking it to draw.
  var lastThreadRender = null;

  document.addEventListener('tma:queue-applied', function (e) { settleQueued(e.detail, 'sent'); });
  document.addEventListener('tma:queue-failed', function (e) { settleQueued(e.detail, 'failed'); });
  document.addEventListener('tma:queue-discarded', function (e) { settleQueued(e.detail, 'failed'); });

  /*
   * Bring a thread that is held but not on screen up to its newest page.
   *
   * If the page does not reach back to what is held, the messages between
   * the two were never fetched. Keeping both would be a thread with a hole
   * in it and no way to fill it, so the older part is let go and comes back
   * through "Load earlier messages".
   */
  function mergeNewestPage(id, data) {
    var bucket = threadBucket(id);
    var incoming = (data && data.messages) || [];
    var more = !!(data && data.hasMore);

    var newestHeld = 0;
    bucket.messages.forEach(function (msg) {
      if (msg.seq && msg.seq > newestHeld) newestHeld = msg.seq;
    });

    if (!newestHeld) {
      // Nothing held yet: the page is the thread, and says how far it goes.
      bucket.hasMore = more;
    } else if (more && incoming.length && incoming[0].seq > newestHeld) {
      // Unsent bubbles carry no seq and stay where they are.
      bucket.messages = bucket.messages.filter(function (msg) {
        return !msg.seq;
      });
      bucket.hasMore = true;
    }

    mergeMessages(id, incoming, false);
    bucket.stale = false;
    return bucket;
  }

  /*
   * A conversation opened once is shown from memory the next time, without
   * asking. That only holds while what is held is the whole conversation, so
   * anything that learns a thread has moved on without having its messages
   * says so here, and the next opening asks again.
   */
  function markThreadStale(id) {
    var bucket = STORE.threadMessages[id];
    if (bucket && bucket.loaded) bucket.stale = true;
  }

  /* After the list is read again: every held thread whose row moved on. */
  function markMovedThreads(previous) {
    var before = {};
    (previous || []).forEach(function (row) {
      before[row.id] = row.timestamp;
    });
    (STORE.threads || []).forEach(function (row) {
      if (before[row.id] !== row.timestamp) markThreadStale(row.id);
    });
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
    return isDirectThread(row) ? { lastSeen: 'Last seen recently' } : {};
  }

  /*
   * Phone headers cannot fit "Offline · Tuesday at 12:18 AM". Drop the clock
   * and keep the weekday / relative clause, so the line ellipsizes instead of
   * wrapping through the thread.
   */
  function compactPresenceLabel(label) {
    return String(label || '')
      .replace(/\s+at\s+\d{1,2}:\d{2}(?:\s*[AP]M)?/i, '')
      .replace(/^Last seen /i, '');
  }

  function wrapPresence(cls, inner) {
    return (
      '<span class="tma-dash__messages-chat-presence' + (cls ? ' ' + cls : '') + '">' +
      inner +
      '</span>'
    );
  }

  function renderPresence(row) {
    var presence = threadPresence(row);
    var compact = isMessagesMobile();

    // A live typing / recording indicator outranks online-or-last-seen.
    // Live typing is not part of `row.presence`, it is transient socket
    // state that no reload should be able to bring back, so it is consulted
    // separately and takes precedence over the recording flag.
    var typing = typingLabel(row);

    if (typing || presence.typing) {
      return wrapPresence(
        'tma-dash__messages-chat-presence--typing',
        '<span>' + esc(typing || (presence.typing === 'recording' ? 'Recording voice note…' : 'Typing…')) + '</span>'
      );
    }

    if (!isDirectThread(row)) {
      // Case chats already name the firm on the line below. Don't stack a
      // generic "Group chat" (or a member count) on top of that.
      if (row.subtitle) return '';
      var groupLabel = groupCountLabel(row);
      return groupLabel
        ? wrapPresence('', '<span>' + esc(groupLabel) + '</span>')
        : '';
    }

    if (presence.statusLabel && window.TMAPresence) {
      var statusHtml = window.TMAPresence.iconHtml(presence.statusIcon || presence.status, 8);
      var statusLabel = window.TMAPresence.labelFor(presence);
      if (compact) statusLabel = compactPresenceLabel(statusLabel);
      return wrapPresence(
        'tma-dash__messages-chat-presence--status',
        statusHtml + '<span>' + esc(statusLabel) + '</span>'
      );
    }

    if (presence.online) {
      return wrapPresence(
        'tma-dash__messages-chat-presence--online',
        '<span class="tma-dash__messages-chat-presence-dot" aria-hidden="true"></span>' +
        '<span>Online</span>'
      );
    }

    var label = window.TMALastSeen
      ? window.TMALastSeen.forPresence(presence)
      : (presence.lastSeen || 'Last seen recently');
    if (!label || /^offline$/i.test(String(label).trim()) || /^group chat$/i.test(String(label).trim())) {
      label = 'Last seen recently';
    }
    if (compact) {
      var shortSeen = (presence.lastSeenAt || presence.last_seen_at) && window.TMALastSeen
        ? window.TMALastSeen.short(presence.lastSeenAt || presence.last_seen_at)
        : null;
      if (!shortSeen) {
        var stripped = compactPresenceLabel(label);
        if (stripped && !/^recently$/i.test(stripped)) shortSeen = stripped;
      }
      label = shortSeen ? 'Offline · ' + shortSeen : 'Offline';
    }
    return wrapPresence('', '<span>' + esc(label) + '</span>');
  }

  /* ------------------------------------------------------------- typing */

  /*
   * Typing is live-only state: who is typing right now, per conversation.
   * Nothing about it is persisted or reloaded, so it lives here rather than
   * on a row, a re-render must not resurrect an indicator that has expired.
   *
   *   typingBy[conversationId] = { userId: { name: 'Ada', at: 1690000000 } }
   */
  var typingBy = {};

  /*
   * A typist re-announces every TYPING_REFRESH_MS while they keep going, so
   * an entry older than TYPING_TTL_MS means their stop event never arrived —
   * a closed tab, a dropped socket. Expiring locally is what keeps a lost
   * stop from leaving "typing…" on screen forever.
   */
  var TYPING_TTL_MS = 7000;

  var TYPING_REFRESH_MS = 3000;

  /* Silence for this long counts as having stopped. */
  var TYPING_IDLE_MS = 4000;

  function typingNames(conversationId) {
    var entry = typingBy[conversationId];
    if (!entry) return [];

    var cutoff = Date.now() - TYPING_TTL_MS;
    var names = [];

    Object.keys(entry).forEach(function (userId) {
      if (entry[userId].at < cutoff) {
        delete entry[userId];
        return;
      }
      names.push(entry[userId].name);
    });

    return names;
  }

  /*
   * "typing…" in a direct thread, you know who. A group has to name them,
   * and past two people the names are longer than the information is worth.
   */
  function typingLabel(row) {
    var names = typingNames(row && row.id);
    if (!names.length) return '';

    if (!row || row.type !== 'group') return 'typing…';
    if (names.length === 1) return names[0] + ' is typing…';
    if (names.length === 2) return names[0] + ' and ' + names[1] + ' are typing…';
    return names.length + ' people are typing…';
  }

  function noteTyping(conversationId, userId, name, typing, render) {
    if (!conversationId || !userId) return;
    if (STORE.me && userId === STORE.me.id) return;   // never echo yourself

    var entry = (typingBy[conversationId] = typingBy[conversationId] || {});
    var had = Object.keys(entry).length > 0;

    if (typing) {
      entry[userId] = { name: String(name || 'Someone'), at: Date.now() };
    } else {
      delete entry[userId];
    }

    var has = Object.keys(entry).length > 0;

    // Only repaint when the indicator actually appears or disappears. A
    // typist refreshing every few seconds must not re-render the thread
    // under them, that would fight the scroll and caret restoration.
    if (had !== has && typeof render === 'function') render();

    scheduleTypingExpiry(conversationId, render);
  }

  var typingExpiry = {};

  function scheduleTypingExpiry(conversationId, render) {
    if (typingExpiry[conversationId]) clearTimeout(typingExpiry[conversationId]);

    typingExpiry[conversationId] = setTimeout(function () {
      delete typingExpiry[conversationId];
      var before = typingNames(conversationId).length;
      // typingNames prunes as it reads, so calling it twice tells us whether
      // anything actually dropped off.
      if (before !== typingNames(conversationId).length || before === 0) {
        if (typeof render === 'function') render();
      }
    }, TYPING_TTL_MS + 250);
  }

  /*
   * Outbound side. Throttled to one call per TYPING_REFRESH_MS: the composer
   * fires on every keystroke, and a request per character would be absurd.
   */
  var typingOut = { conversationId: null, sentAt: 0, idle: null };

  function announceTyping(conversationId) {
    if (!conversationId || !window.TMAMessagingAPI) return;

    // Switched threads mid-type: tell the old one you stopped.
    if (typingOut.conversationId && typingOut.conversationId !== conversationId) {
      stopTyping();
    }

    var now = Date.now();

    if (typingOut.conversationId !== conversationId || now - typingOut.sentAt > TYPING_REFRESH_MS) {
      typingOut.conversationId = conversationId;
      typingOut.sentAt = now;
      window.TMAMessagingAPI.typing(conversationId, true);
    }

    if (typingOut.idle) clearTimeout(typingOut.idle);
    typingOut.idle = setTimeout(stopTyping, TYPING_IDLE_MS);
  }

  function stopTyping() {
    if (typingOut.idle) {
      clearTimeout(typingOut.idle);
      typingOut.idle = null;
    }

    if (!typingOut.conversationId) return;

    var id = typingOut.conversationId;
    typingOut.conversationId = null;
    typingOut.sentAt = 0;

    if (window.TMAMessagingAPI) window.TMAMessagingAPI.typing(id, false);
  }

  function threadDisplayName(row) {
    return String(row.name || 'Chat');
  }

  function groupCountLabel(row) {
    var label = row.presence && row.presence.label;
    if (label && !/^group chat$/i.test(String(label).trim())) return label;
    var n = parseInt(row.memberCount, 10) || 0;
    if (!n) return '';
    return n === 1 ? '1 member' : n + ' members';
  }

  /*
   * A provider case is the group filed against one application. The client
   * uid is how /citizenship-applications/{uid} opens that file.
   */
  function applicationForThread(row) {
    row = resolveThread(row);
    if (!row || row.type !== 'group' || row.subject !== 'provider') return null;
    var about = row.about;
    if (!about || !about.clientUid) return null;
    return about;
  }

  function openApplication(row) {
    var about = applicationForThread(row);
    if (!about || !window.TMADashboard || !window.TMADashboard.navigate) return false;
    window.TMADashboard.navigate({
      navId: 'clients',
      view: 'clients',
      title: about.clientName || row.name || 'Application',
      crumb: 'CIP Applications',
      clientsScreen: 'detail',
      contactId: about.clientUid,
    });
    return true;
  }

  function renderOpenApplicationButton(row) {
    if (!applicationForThread(row)) return '';
    return (
      '<button type="button" class="tma-dash__messages-open-app" data-messages-open-application ' +
      'aria-label="Open application">' +
      '<img src="' + esc(ICONS.FolderOpen) + '" alt="">' +
      '<span>Open application</span></button>'
    );
  }

  function counterpartRole(row) {
    if (!row || row.type === 'group') return '';
    return row.counterpartRole || '';
  }

  function renderContactName(row) {
    // Opens the messaging profile *inside* the chat column, never the client
    // record, which is a separate, permissioned action in that panel.
    // The role sits on this same line. "Private" used to be a third line
    // under the status, which is not a role.
    var role = counterpartRole(row);
    return (
      '<span class="tma-dash__messages-chat-name-row">' +
      '<button type="button" class="tma-dash__messages-chat-name ' +
      'tma-dash__messages-chat-name-link" data-messages-open-profile ' +
      'aria-label="Conversation info">' + esc(threadDisplayName(row)) + '</button>' +
      (role ? '<span class="tma-dash__messages-chat-role">' + esc(role) + '</span>' : '') +
      '</span>'
    );
  }

  function renderChatContactText(row) {
    row = resolveThread(row);
    // Name (and role) then presence. A case thread still names the firm
    // underneath. A direct chat does not grow a "Private" line.
    var html = renderContactName(row);
    html += renderPresence(row);
    if (row.type === 'group' && row.subtitle && row.subtitle !== 'Private') {
      html += '<span class="tma-dash__messages-chat-subtitle">' + esc(row.subtitle) + '</span>';
    }
    return html;
  }

  function renderChatThreadIcon(row) {
    return (
      '<button type="button" class="tma-dash__messages-chat-avatar-link" ' +
      'data-messages-open-profile aria-label="Conversation info">' +
      threadIcon(resolveThread(row)) +
      '</button>'
    );
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
   * A group is drawn the way iOS Messages draws one: a soft disc with the
   * members' faces arranged inside it — one centred, two on a diagonal, three
   * in a triangle, four in a grid. Never a single tile: a lone initial reads
   * as one person. These helpers decide who fills the disc. Faces are ordered
   * online first, then most recently seen, then photographs before initials;
   * the reader's own face fills in when fewer than two others are available;
   * an uploaded group photo, where one exists, takes the first spot.
   */
  var GROUP_CLUSTER_MAX = 4;

  function selfClusterMember() {
    var me = STORE.me;
    if (!me || !me.name) return null;
    return { id: me.id, name: me.name, photo: me.photo || me.avatar, self: true };
  }

  function padClusterWithSelf(pool, min) {
    if (pool.length >= min) return pool;
    var me = selfClusterMember();
    if (!me) return pool;
    var present = pool.some(function (m) { return m.self || (me.id != null && m.id === me.id); });
    if (!present) pool.push(me);
    return pool;
  }

  function groupClusterMembers(row, members) {
    var pool = (members || row.members || []).slice().filter(function (m) { return m && m.name; });

    /*
     * A provider case thread is about one file, and the server sends exactly
     * the two faces that say which: the applicant's photo and the firm's
     * contact. Sorting them by who is online, padding with the reader, or
     * topping up from the room would put the staff in the disc — and they are
     * who the thread reaches, not what it is about.
     */
    if (row && row.subject === 'provider') {
      return pool.slice(0, GROUP_CLUSTER_MAX);
    }

    pool.sort(function (a, b) {
      var ao = a.online ? 0 : 1;
      var bo = b.online ? 0 : 1;
      if (ao !== bo) return ao - bo;
      var at = a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0;
      var bt = b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0;
      if (bt !== at) return bt - at;
      var ap = a.photo ? 0 : 1;
      var bp = b.photo ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return padClusterWithSelf(pool, 2).slice(0, GROUP_CLUSTER_MAX);
  }

  function presenceDotColor(presence) {
    if (window.TMAPresence && window.TMAPresence.dotColor) return window.TMAPresence.dotColor(presence);
    return presence && presence.online ? '#22c55e' : '#98a2b3';
  }

  function presenceDotSlug(presence) {
    if (window.TMAPresence && window.TMAPresence.dotSlug) return window.TMAPresence.dotSlug(presence);
    return presence && presence.online ? 'online' : 'offline';
  }

  function statusDotHtml(presence) {
    var slug = presenceDotSlug(presence);
    if (slug === 'offline') return '';
    return '<span class="tma-dash__messages-row-status-dot" style="background:' +
      presenceDotColor(presence) + '" aria-hidden="true"></span>';
  }

  function renderGroupClusterFace(member) {
    var face = member.photo
      ? '<img class="tma-dash__messages-cluster-img" src="' + esc(member.photo) + '" alt="" loading="lazy">'
      : '<span class="tma-dash__messages-cluster-initial tma-dash__messages-row-avatar--' +
        initialColourFor(member.name) + '">' + esc(initialsFor(member.name).charAt(0)) + '</span>';
    return (
      '<span class="tma-dash__messages-cluster-face" title="' + esc(member.name || '') + '">' +
      face +
      statusDotHtml(member) +
      '</span>'
    );
  }

  function renderGroupCluster(members, extraClass) {
    return (
      '<span class="tma-dash__messages-cluster tma-dash__messages-cluster--' + members.length +
      (extraClass ? ' ' + extraClass : '') + '">' +
      members.map(renderGroupClusterFace).join('') +
      '</span>'
    );
  }

  /*
   * Conversation avatar. Real photos only; where there is none the initials
   * tile stands in - the portal never shows a stock avatar for a real person.
   * A group that has been given a picture is that picture; one that has not
   * is the member-face cluster (see renderGroupCluster). The same in the
   * inbox, the chat head and search alike.
   */
  function threadIcon(row) {
    if (row.type === 'group' && !row.photo) {
      var members = groupClusterMembers(row);
      if (!members.length) {
        /* No members and no reader yet (a warm start before /me): the group's
         * own name still sits as one face in the disc, not a tile. */
        members = [{ name: row.name || 'Group', photo: null }];
      }
      return renderGroupCluster(members, 'tma-dash__messages-row-avatar tma-dash__messages-row-avatar--group');
    }

    if (row.photo) {
      return (
        '<span class="tma-dash__messages-row-avatar">' +
        '<img src="' + esc(row.photo) + '" alt="" loading="lazy">' +
        '</span>'
      );
    }

    return renderInitialAvatar(row.name);
  }

  function renderInboxThreadIcon(row) {
    var item = resolveThread(row);
    if (!isDirectThread(row)) {
      return threadIcon(item);
    }
    var icon = threadIcon(item);
    var presence = threadPresence(row);
    var slug = presenceDotSlug(presence);
    return (
      '<span class="tma-dash__messages-row-avatar-wrap tma-dash__messages-row-avatar-wrap--' +
      (slug === 'offline' ? 'offline' : 'online') +
      '">' +
      icon +
      '<span class="tma-dash__messages-row-status-dot" style="background:' +
      presenceDotColor(presence) + '" aria-hidden="true"></span>' +
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

  function renderMentionBadge() {
    var label = '<span class="tma-dash__messages-row-mention" title="You were mentioned" aria-label="You were mentioned">';
    if (window.TMABadge) {
      return label + window.TMABadge.renderBadge({ type: 'number', value: '@', color: 'blue' }) + '</span>';
    }
    return label + '<span class="tma-dash__messages-unread">@</span></span>';
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
      (value || state.searchMode
        ? '<button type="button" class="tma-dash__messages-search-clear" data-messages-search-exit ' +
          'aria-label="Exit search"><span aria-hidden="true">×</span></button>'
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
  /*
   * The archived shelf, revealed by pulling down at the top of the chat list.
   *
   * Rendered collapsed on every pass rather than added when it opens: this
   * page's render() rebuilds the whole column and resets its scroll position,
   * so opening the shelf through a re-render would yank the list out from
   * under the finger that just pulled it. It exists at zero height and the
   * gesture only toggles a class, see wireArchivedPull.
   *
   * It stays in the tab order even while collapsed, and opens on focus. Making
   * it a gesture removed the only visible way to reach archived chats, and a
   * control nobody can reach with a keyboard is not a control.
   */
  function renderArchivedReveal(state) {
    var count = getThreads().filter(function (row) { return row.archived; }).length;

    // Rendered even with nothing archived. Hiding it in that case meant the
    // pull produced no response at all on a mailbox that had never archived
    // anything, which reads as a broken gesture rather than an empty shelf,
    // and leaves no way to tell the two apart.
    var inner = count
      ? '<button type="button" class="tma-dash__messages-archived-reveal-btn" data-messages-archived>' +
        '<img src="' + ICONS.Archive + '" alt="">' +
        '<span class="tma-dash__messages-archived-reveal-label">Archived</span>' +
        '<span class="tma-dash__messages-archived-reveal-count">' + count + '</span>' +
        '</button>'
      // Nothing to open, so it is not a control, just the shelf saying it is
      // empty, which still confirms the pull worked.
      : '<span class="tma-dash__messages-archived-reveal-btn is-empty">' +
        '<img src="' + ICONS.Archive + '" alt="">' +
        '<span class="tma-dash__messages-archived-reveal-label">No archived chats</span>' +
        '</span>';

    return (
      '<div class="tma-dash__messages-archived-reveal" data-messages-archived-reveal>' +
      inner +
      '</div>'
    );
  }

  /*
   * Pull down at the top of the list to reveal the archived shelf.
   *
   * Two gestures, because the page is used on both: a finger drag (tracked
   * live, so the shelf follows the pull rather than snapping), and a trackpad
   * overscroll upward. Both only engage at scrollTop 0 and only when the
   * movement is clearly vertical, the rows have their own horizontal swipe
   * actions, and stealing those would break archiving from the list itself.
   *
   * Nothing here calls render(). The shelf is already in the DOM; this only
   * sets its height and a class.
   */
  function wireArchivedPull(root) {
    var body = root.querySelector('[data-messages-list-body]');
    var shelf = root.querySelector('[data-messages-archived-reveal]');
    if (!body || !shelf || body._archivePullBound) return;
    body._archivePullBound = true;

    var OPEN_HEIGHT = 46;
    // How far the pull has to travel before it latches open.
    var THRESHOLD = 40;
    // How long it stays before retracting on its own.
    var HIDE_AFTER = 4000;

    var startY = 0;
    var startX = 0;
    var pulling = false;
    var latched = false;
    var hideTimer = null;
    var wheelPull = 0;
    var wheelTimer = null;

    function clearHide() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }

    function scheduleHide() {
      clearHide();
      hideTimer = setTimeout(close, HIDE_AFTER);
    }

    function setHeight(px, animate) {
      shelf.classList.toggle('is-dragging', !animate);
      shelf.style.height = px > 0 ? px + 'px' : '';
    }

    function open() {
      latched = true;
      shelf.classList.add('is-open');
      setHeight(OPEN_HEIGHT, true);
      scheduleHide();
    }

    function close() {
      clearHide();
      latched = false;
      wheelPull = 0;
      shelf.classList.remove('is-open');
      setHeight(0, true);
    }

    // Hovering or focusing the shelf means it is being read or aimed at, so
    // the timer should not pull it away mid-reach.
    shelf.addEventListener('pointerenter', clearHide);
    shelf.addEventListener('pointerleave', function () { if (latched) scheduleHide(); });
    shelf.addEventListener('focusin', function () { clearHide(); open(); });
    shelf.addEventListener('focusout', function () { if (latched) scheduleHide(); });

    // --- finger drag ---
    body.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return; // desktop uses the wheel path
      if (body.scrollTop > 0) return;
      startY = e.clientY;
      startX = e.clientX;
      pulling = true;
    });

    body.addEventListener('pointermove', function (e) {
      if (!pulling) return;

      var dy = e.clientY - startY;
      var dx = e.clientX - startX;

      // Horizontal intent belongs to the row's own swipe actions.
      if (Math.abs(dx) > Math.abs(dy)) { pulling = false; return; }
      if (dy <= 0 || body.scrollTop > 0) { setHeight(0, false); return; }

      // Resistance, so the shelf trails the finger rather than matching it —
      // the pull should feel like it is being stretched open.
      setHeight(Math.min(OPEN_HEIGHT * 1.4, dy * 0.5), false);
    });

    function endDrag() {
      if (!pulling) return;
      pulling = false;

      var height = parseFloat(shelf.style.height || '0');
      if (height >= THRESHOLD) open();
      else close();
    }

    body.addEventListener('pointerup', endDrag);
    body.addEventListener('pointercancel', endDrag);

    // --- trackpad / wheel overscroll ---
    body.addEventListener('wheel', function (e) {
      // Only an upward push while already at the top counts as a pull.
      if (body.scrollTop > 0 || e.deltaY >= 0) {
        if (e.deltaY > 0 && latched) close();
        return;
      }

      if (latched) { scheduleHide(); return; }

      wheelPull += -e.deltaY;

      if (wheelTimer) clearTimeout(wheelTimer);
      // A trackpad emits momentum after the fingers lift; this settles the
      // gesture once the events stop rather than on every tick.
      wheelTimer = setTimeout(function () {
        if (!latched) { wheelPull = 0; setHeight(0, true); }
      }, 140);

      if (wheelPull >= THRESHOLD) open();
      else setHeight(Math.min(OPEN_HEIGHT, wheelPull * 0.7), false);
    }, { passive: true });

    // Scrolling into the list puts it away.
    body.addEventListener('scroll', function () {
      if (latched && body.scrollTop > 4) close();
    }, { passive: true });
  }

  /* A way back out of the archived tab. Without it the list looks like an
   * inbox that has lost most of its conversations. */
  function renderArchivedHead() {
    return (
      '<div class="tma-dash__messages-archived-head">' +
      '<span class="tma-dash__messages-archived-title">Archived</span>' +
      '<button type="button" class="tma-dash__messages-archived-back" data-messages-archived-exit>' +
      'Back to chats</button>' +
      '</div>'
    );
  }

  /*
   * The inbox column's navigation: which view the column is showing, plus the
   * two actions that are not views (New message, Settings).
   *
   * Each entry carries its name under the icon, a bar of unlabelled glyphs
   * is a guessing game.
   */
  /*
   * Badge text for a nav tab. Capped, because past a point the number stops
   * being information and starts being a wide pill in a narrow bar.
   */
  function navCount(n) {
    if (!n) return 0;
    return n > 99 ? '99+' : n;
  }

  /* "1 missed call", "2 missed calls", the badge is read aloud, not scanned. */
  function navCountLabel(n, singular, plural) {
    return n + ' ' + (n === 1 ? singular : plural);
  }

  function renderListFoot(state) {
    state = state || {};

    // Chats is summed from the visible rows, the same rule the sidebar badge
    // uses, so archived threads are excluded from both. Calls comes from the
    // server, which is the only place that knows what this user has already
    // looked at (see App\Support\Messaging\TabCounts).
    var counts = STORE.tabCounts || {};
    var unreadChats = getInboxUnreadCount(state);
    var missedCalls = counts.calls || 0;

    // Exactly one of these is the current view; "chats" is the default when no
    // takeover is active.
    var view = state.mediaMode ? 'media'
      : state.callsMode ? 'calls'
      : state.tab === 'archived' ? 'archived'
      : 'chats';

    var items = [
      { key: 'chats', icon: 'ChatCircleDots', label: 'Chats', attr: 'data-messages-nav-chats',
        count: navCount(unreadChats),
        countLabel: navCountLabel(unreadChats, 'unread message', 'unread messages') },
      { key: 'calls', icon: 'Phone', label: 'Calls', attr: 'data-messages-nav-calls',
        count: navCount(missedCalls),
        countLabel: navCountLabel(missedCalls, 'missed call', 'missed calls') },
      // Archived is not a nav entry: it lives behind the pull-down shelf at
      // the top of the list (see renderArchivedReveal), which is where it is
      // looked for and keeps the bar from crowding its labels into ellipses.
      { key: 'media', icon: 'Images', label: 'Media', attr: 'data-messages-media' },
      { key: 'settings', icon: 'GearSix', label: 'Settings', attr: 'data-messages-settings', action: true },
    ];

    var nav = items.map(function (item) {
      var active = item.action
        ? (item.key === 'settings' && state.settingsOpen)
        : view === item.key;

      return (
        '<button type="button" class="tma-dash__messages-nav-btn' + (active ? ' is-active' : '') + '"' +
        ' ' + item.attr +
        // The badge is a number beside an icon: without it in the label, a
        // screen reader announces "Calls" and stops (see colour and shape are
        // never the only carrier of state).
        ' aria-label="' + esc(item.label + (item.count ? ', ' + item.countLabel : '')) + '"' +
        ' title="' + esc(item.label) + '"' +
        (item.action
          ? ' aria-expanded="' + (active ? 'true' : 'false') + '"'
          : ' aria-current="' + (active ? 'page' : 'false') + '"') +
        '>' +
        '<span class="tma-dash__messages-nav-icon">' +
        '<img src="' + ICONS[item.icon] + '" alt="">' +
        (item.count
          ? '<span class="tma-dash__messages-nav-count">' + item.count + '</span>'
          : '') +
        '</span>' +
        '<span class="tma-dash__messages-nav-label">' + esc(item.label) + '</span>' +
        '</button>'
      );
    }).join('');

    // New message is not in here: it is an action, not a destination, and it
    // floats over the list instead (see renderComposeFab). That also leaves
    // the real destinations room for their labels.
    return (
      '<div class="tma-dash__messages-list-foot" role="tablist" aria-label="Messages sections">' +
      nav +
      '</div>'
    );
  }

  /*
   * The floating New message button, bottom-right of the inbox column.
   *
   * The slot around it is deliberately zero-height: it sits in the column's
   * flex flow directly above the navigation, so the button anchors itself just
   * clear of the bar without anyone having to hard-code the bar's height. Put
   * inside the scrolling list body instead, it would scroll away with the
   * conversations.
   */
  function renderComposeFab() {
    return (
      '<div class="tma-dash__messages-fab-slot">' +
      '<button type="button" class="tma-dash__messages-fab" data-messages-compose' +
      ' aria-label="New message" title="New message">' +
      '<img src="' + ICONS.NotePencil + '" alt="">' +
      '</button>' +
      '</div>'
    );
  }

  function renderListMobileHead(state) {
    return (
      '<div class="tma-dash__messages-list-mobile-head">' +
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
      // An unsent client/direct thread stays off the inbox until someone
      // writes. The open pane can still show it so the person who just
      // opened it can compose.
      if (row.listed === false && row.id !== state.selectedId) return false;

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
        (row.subtitle || '').toLowerCase().indexOf(term) !== -1 ||
        (row.preview || '').toLowerCase().indexOf(term) !== -1
      );
    });
  }

  /*
   * The chat's picture is also its checkbox, as in the mail inbox: a tap on
   * it picks the chat for a bulk action, and a picked chat keeps its photo
   * with a ring and a tick in the corner. Hidden from screen readers: the
   * row itself says whether it is picked (aria-pressed while picking), and
   * its menu carries Select.
   */
  function renderRowPicker(row, state) {
    var picked = isChatPicked(state, row.id);
    return (
      '<span class="tma-dash__messages-row-pick' + (picked ? ' is-checked' : '') + '"' +
      ' data-messages-row-pick="' + esc(row.id) + '" title="Select" aria-hidden="true">' +
      renderInboxThreadIcon(row) +
      '<span class="tma-dash__messages-row-pick-tick"></span>' +
      '</span>'
    );
  }

  function buildMessagesRowInner(row, state) {
    var item = resolveThread(row);
    var pinned = row.pinned;
    var muted = row.muted;
    return (
      renderRowPicker(row, state) +
      '<span class="tma-dash__messages-row-text">' +
      '<span class="tma-dash__messages-row-name">' +
      '<span class="tma-dash__messages-row-name-text">' + esc(item.name) + '</span>' +
      (function () {
        var about = counterpartRole(item);
        if (!about && item.subtitle && item.subtitle !== 'Private') about = item.subtitle;
        if (!about && item.type === 'group' && item.memberCount) about = groupCountLabel(item);
        return about
          ? '<span class="tma-dash__messages-row-about">' + esc(about) + '</span>'
          : '';
      })() +
      (pinned
        ? '<img class="tma-dash__messages-row-pin" src="' + ICONS.StarFilled + '" alt="" width="12" height="12" aria-hidden="true">'
        : '') +
      (muted
        ? '<img class="tma-dash__messages-row-mute" src="' + ICONS.BellSlash + '" alt="" width="12" height="12" aria-hidden="true">'
        : '') +
      '</span>' +
      '<span class="tma-dash__messages-row-preview">' +
      // Precedence in the preview slot: someone typing right now beats
      // anything already written, then an unsent draft (you were part way
      // through something), then a reaction newer than the last message,
      // then the message itself.
      (typingLabel(row)
        ? '<span class="tma-dash__messages-row-typing">' + esc(typingLabel(row)) + '</span>'
        : row.draft
          ? '<span class="tma-dash__messages-row-draft">Draft: </span>' + esc(row.draft)
          : row.reactionNote
            ? '<span class="tma-dash__messages-row-reaction">' + esc(row.reactionNote) + '</span>'
            : esc(row.preview || groupCountLabel(row) || '')) +
      '</span>' +
      '</span>' +
      '<span class="tma-dash__messages-row-time">' +
      esc(row.timestamp ? (listTime(row.timestamp) || row.time || '') : (row.time || '')) +
      '</span>' +
      (row.unread
        ? '<span class="tma-dash__messages-row-meta' +
          (row.mentioned ? ' tma-dash__messages-row-meta--mention' : '') + '">' +
          // Something unread in here is addressed to the reader.
          (row.mentioned ? renderMentionBadge() : '') +
          renderBadge(row.unread) + '</span>'
        : '<span class="tma-dash__messages-row-meta" aria-hidden="true"></span>')
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
      (muted ? ' tma-dash__messages-row--muted' : '') +
      (isChatPicked(state, row.id) ? ' tma-dash__messages-row--picked' : '');
    return (
      '<div class="' +
      rowCls +
      '" data-messages-row="' +
      esc(row.id) +
      '" role="button" tabindex="0"' + rowPickedAttr(row, state) + '>' +
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
      (pinned ? ICONS.PushPinSlash : ICONS.PushPin) +
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

  /*
   * The group-creation half of the new-message panel.
   *
   * Same panel, second step: pick people first (the panel is already a people
   * picker), then name it. Splitting it into a separate dialog would duplicate
   * the search that is already here.
   */
  function renderGroupPanel(state) {
    var chosen = state.groupMembers || [];
    var results = state.composeResults || [];

    return (
      '<div class="tma-dash__messages-panel" data-messages-panel role="dialog" aria-label="New group">' +
      '<div class="tma-dash__messages-panel-head">' +
      '<button type="button" class="tma-dash__messages-icon-btn" data-messages-group-back ' +
      'aria-label="Back"><img src="' + ICONS.CaretLeft + '" alt=""></button>' +
      '<span class="tma-dash__messages-panel-title">New group</span>' +
      '<button type="button" class="tma-dash__messages-icon-btn" data-messages-panel-close ' +
      'aria-label="Close"><span aria-hidden="true">×</span></button>' +
      '</div>' +

      '<div class="tma-dash__messages-group-name">' +
      '<input type="text" class="tma-dash__messages-search-input" data-messages-group-name ' +
      'placeholder="Group name" aria-label="Group name" maxlength="120" ' +
      'value="' + esc(state.groupName || '') + '">' +
      '</div>' +

      // Chosen people stay visible as removable chips while searching for more.
      (chosen.length
        ? '<div class="tma-dash__messages-chips">' +
          chosen
            .map(function (person) {
              return (
                '<button type="button" class="tma-dash__messages-chip" ' +
                'data-messages-group-drop="' + person.id + '" ' +
                'aria-label="Remove ' + esc(person.name) + '">' +
                esc(person.name) + ' <span aria-hidden="true">×</span></button>'
              );
            })
            .join('') +
          '</div>'
        : '') +

      '<div class="tma-dash__messages-search tma-dash__messages-search--panel" role="search">' +
      '<img src="' + ICONS.MagnifyingGlass + '" alt="">' +
      '<input type="search" class="tma-dash__messages-search-input" data-messages-compose-search ' +
      'placeholder="Add people" aria-label="Add people" value="' + esc(state.composeQuery || '') + '" ' +
      'autocomplete="off">' +
      '</div>' +

      '<div class="tma-dash__messages-panel-body">' +
      (state.composeLoading
        ? '<div class="tma-dash__messages-list-state" role="status">Searching…</div>'
        : results.length
          ? results
              .map(function (person) {
                var picked = chosen.some(function (p) {
                  return p.id === person.id;
                });
                return renderPersonRow(person, 'data-messages-group-pick').replace(
                  'class="tma-dash__messages-person"',
                  'class="tma-dash__messages-person' + (picked ? ' is-picked' : '') + '"'
                );
              })
              .join('')
          : '<div class="tma-dash__messages-list-state">No one else to add.</div>') +
      '</div>' +

      '<div class="tma-dash__messages-panel-foot">' +
      '<button type="button" class="tma-dash__messages-primary" data-messages-group-create' +
      (chosen.length && (state.groupName || '').trim() ? '' : ' disabled') +
      '>Create group' + (chosen.length ? ' (' + chosen.length + ')' : '') + '</button>' +
      '</div>' +
      '</div>'
    );
  }

  function renderComposePanel(state) {
    if (state.groupOpen) return renderGroupPanel(state);
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
      '<button type="button" class="tma-dash__messages-person tma-dash__messages-new-group" ' +
      'data-messages-new-group>' +
      '<span class="tma-dash__messages-row-avatar tma-dash__messages-row-avatar--group ' +
      'tma-dash__messages-new-group-icon">+</span>' +
      '<span class="tma-dash__messages-person-text">' +
      '<span class="tma-dash__messages-person-name">New group</span>' +
      '<span class="tma-dash__messages-person-meta">Message several people at once</span>' +
      '</span></button>' +
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

  /* Like renderSettingsChoice, but for a setting with its own option list. */
  function renderSettingsSelect(key, label, hint, options) {
    var value = STORE.settings[key] || options[0].value;
    return (
      '<label class="tma-dash__messages-setting">' +
      '<span class="tma-dash__messages-setting-text">' +
      '<span class="tma-dash__messages-setting-label">' + esc(label) + '</span>' +
      (hint ? '<span class="tma-dash__messages-setting-hint">' + esc(hint) + '</span>' : '') +
      '</span>' +
      '<select class="tma-dash__messages-setting-select" data-messages-setting="' + key + '">' +
      options
        .map(function (o) {
          return '<option value="' + esc(o.value) + '"' + (value === o.value ? ' selected' : '') + '>' +
            esc(o.label) + '</option>';
        })
        .join('') +
      '</select></label>'
    );
  }

  /*
   * What the browser says about this site, under the toggle.
   *
   * The setting is stored per account but the permission is per browser, so
   * the two can disagree: switched on here, never granted (or later revoked)
   * there, and nothing appears with nothing to explain why.
   */
  function desktopNotificationHint() {
    var desktop = window.TMADesktopNotify;
    if (!desktop || !desktop.isSupported()) return 'Not supported by this browser';

    var permission = desktop.permission();
    if (permission === 'denied') return 'Blocked for this site in your browser settings';
    if (permission === 'default') return 'Needs browser permission';
    return STORE.settings.desktopNotifications
      ? 'Shown when you are away from this window'
      : 'Allowed by this browser';
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
      // Picking one plays it, so the list can be heard rather than guessed at.
      renderSettingsSelect('messageTone', 'Message tone', 'Plays when a message arrives', [
        { value: 'chime', label: 'Chime' },
        { value: 'system', label: 'Notification' },
        { value: 'beep', label: 'Beep' },
        { value: 'none', label: 'Silent' },
      ]) +
      renderSettingsSelect('ringtone', 'Ringtone', 'Plays while a call rings', [
        { value: 'ringtone-1', label: 'Ringtone 1' },
        { value: 'ringtone-2', label: 'Ringtone 2' },
        { value: 'none', label: 'Silent' },
      ]) +
      renderSettingsToggle('desktopNotifications', 'Desktop notifications', desktopNotificationHint()) +
      renderSettingsToggle('notificationPreview', 'Show message text in notifications') +

      '<div class="tma-dash__messages-setting-group">Composing</div>' +
      renderSettingsToggle('enterToSend', 'Enter sends the message', 'Off: Enter adds a line, the send button sends') +

      '<div class="tma-dash__messages-setting-group">Media</div>' +
      renderSettingsToggle('mediaAutoDownload', 'Download media automatically') +

      '<div class="tma-dash__messages-setting-group">Calls</div>' +
      renderSettingsSelect('callDisplay', 'Active call display',
        'Where a call goes once it is answered. Incoming calls always ask first.', [
          { value: 'island', label: 'Dynamic Island' },
          { value: 'compact', label: 'Compact window' },
          { value: 'modal', label: 'Large window' },
        ]) +
      '</div>' +
      '<p class="tma-dash__messages-panel-note">These settings apply to your account only.</p>' +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------
   * Search mode
   *
   * Focusing the search field takes over the inbox column with grouped
   * results. Grouped rather than one ranked list because "a person called
   * Ana", "a message about invoices" and "a file named invoice.pdf" are
   * different kinds of answer, flattening them buries the useful one.
   * ---------------------------------------------------------------- */

  function renderSearchGroup(label, body) {
    if (!body) return '';
    return (
      '<div class="tma-dash__messages-search-group">' +
      '<div class="tma-dash__messages-list-group">' + esc(label) + '</div>' +
      body +
      '</div>'
    );
  }

  function renderSearchResults(state) {
    var results = state.searchResults;

    if (state.searchLoading && !results) {
      return '<div class="tma-dash__messages-list-state" role="status">Searching…</div>';
    }

    if (!results) {
      return (
        '<div class="tma-dash__messages-list-state">' +
        'Search people, conversations, messages, files and links.' +
        '</div>'
      );
    }

    var total =
      results.people.length + results.conversations.length + results.messages.length +
      results.files.length + results.links.length;

    if (!total) {
      return '<div class="tma-dash__messages-list-state">Nothing matches “' + esc(state.search) + '”.</div>';
    }

    var html = '';

    if (results.conversations.length) {
      html += renderSearchGroup(
        'Conversations',
        results.conversations
          .map(function (row) {
            return (
              '<button type="button" class="tma-dash__messages-person" ' +
              'data-messages-search-conversation="' + esc(row.id) + '">' +
              threadIcon(row) +
              '<span class="tma-dash__messages-person-text">' +
              '<span class="tma-dash__messages-person-name">' + esc(row.name) + '</span>' +
              '<span class="tma-dash__messages-person-meta">' + esc(row.preview || '') + '</span>' +
              '</span></button>'
            );
          })
          .join('')
      );
    }

    if (results.people.length) {
      html += renderSearchGroup(
        'People',
        results.people
          .map(function (person) {
            return renderPersonRow(person, 'data-messages-start');
          })
          .join('')
      );
    }

    if (results.messages.length) {
      html += renderSearchGroup(
        'Messages',
        results.messages
          .map(function (hit) {
            return (
              '<button type="button" class="tma-dash__messages-hit" ' +
              'data-messages-jump-to="' + esc(hit.conversationId) + '" ' +
              'data-messages-jump-seq="' + hit.seq + '">' +
              '<span class="tma-dash__messages-hit-head">' +
              '<span class="tma-dash__messages-hit-name">' + esc(hit.conversationName) + '</span>' +
              '<span class="tma-dash__messages-hit-date">' + esc(hit.date) + '</span>' +
              '</span>' +
              '<span class="tma-dash__messages-hit-text">' +
              esc(hit.senderName) + ': ' + esc(hit.excerpt) +
              '</span></button>'
            );
          })
          .join('')
      );
    }

    if (results.files.length) {
      html += renderSearchGroup(
        'Files',
        results.files
          .map(function (file) {
            return (
              '<button type="button" class="tma-dash__messages-person" ' +
              'data-messages-jump-to="' + esc(file.conversationId) + '" ' +
              'data-messages-jump-seq="' + file.seq + '">' +
              '<span class="tma-dash__messages-row-avatar">' +
              '<img class="tma-dash__messages-tray-icon" src="' +
              esc(attachmentIconSrc(file.name)) + '" alt=""></span>' +
              '<span class="tma-dash__messages-person-text">' +
              '<span class="tma-dash__messages-person-name">' + esc(file.name) + '</span>' +
              '<span class="tma-dash__messages-person-meta">' +
              esc(file.conversationName) + ' · ' + esc(file.date) + '</span>' +
              '</span></button>'
            );
          })
          .join('')
      );
    }

    if (results.links.length) {
      html += renderSearchGroup(
        'Links',
        results.links
          .map(function (link) {
            return (
              '<button type="button" class="tma-dash__messages-person" ' +
              'data-messages-jump-to="' + esc(link.conversationId) + '" ' +
              'data-messages-jump-seq="' + link.seq + '">' +
              '<span class="tma-dash__messages-person-text">' +
              '<span class="tma-dash__messages-person-name">' + esc(link.domain || link.url) + '</span>' +
              '<span class="tma-dash__messages-person-meta">' +
              esc(link.conversationName) + ' · ' + esc(link.date) + '</span>' +
              '</span></button>'
            );
          })
          .join('')
      );
    }

    return html;
  }

  /*
   * Loading / empty / error stand-ins. Never sample content.
   *
   * The two loading cases are skeletons rather than a line of centred text:
   * the shape of what is coming is already known, so the pane can hold it
   * instead of collapsing to a sentence and jumping when the data lands.
   * Both are aria-hidden behind one role="status" label, so a screen reader
   * hears "Loading conversations" once rather than reading out the bars.
   */
  function renderListSkeleton(label) {
    var rows = '';
    for (var i = 0; i < 7; i++) {
      rows +=
        '<div class="tma-dash__messages-row--skeleton" aria-hidden="true">' +
        '<span class="tma-skeleton tma-dash__messages-skeleton-avatar"></span>' +
        '<span class="tma-skeleton tma-dash__messages-skeleton-line' +
        ' tma-dash__messages-skeleton-line--name"></span>' +
        '<span class="tma-skeleton tma-dash__messages-skeleton-time"></span>' +
        '<span class="tma-skeleton tma-dash__messages-skeleton-line' +
        ' tma-dash__messages-skeleton-line--preview"></span>' +
        '<span></span>' +
        '</div>';
    }
    return '<div class="tma-dash__messages-list-skeleton" role="status"' +
      ' aria-label="' + esc(label || 'Loading conversations') + '">' + rows + '</div>';
  }

  /* Alternating sides and uneven widths: a stack of identical bars does not
     read as a conversation waiting to arrive. */
  var CHAT_SKELETON_SHAPE = [
    ['in', 'md'], ['out', 'sm'], ['in', 'lg'], ['out', 'md'], ['in', 'sm'],
  ];

  function renderChatSkeleton() {
    var bubbles = CHAT_SKELETON_SHAPE.map(function (shape) {
      return '<span class="tma-skeleton tma-dash__messages-skeleton-bubble' +
        ' tma-dash__messages-skeleton-bubble--' + shape[0] +
        ' tma-dash__messages-skeleton-bubble--' + shape[1] + '" aria-hidden="true"></span>';
    }).join('');
    return '<div class="tma-dash__messages-chat-skeleton" role="status"' +
      ' aria-label="Loading messages">' + bubbles + '</div>';
  }

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
      return renderListSkeleton();
    }

    if ((state.search || '').trim()) {
      return '<div class="tma-dash__messages-list-state">No conversations match that search.</div>';
    }

    if (state.tab === 'archived') {
      return '<div class="tma-dash__messages-list-state">No archived conversations.</div>';
    }

    return '<div class="tma-dash__messages-list-state">No conversations yet.</div>';
  }

  function renderInboxRow(row, state, mobile) {
    if (mobile) return buildMessagesRowSwipeWrap(row, state, buildMessagesRowHtml(row, state));
    var active = state.selectedId === row.id;
    return (
      '<button type="button" class="tma-dash__messages-row' +
      (active ? ' tma-dash__messages-row--active' : '') +
      (row.pinned ? ' tma-dash__messages-row--pinned' : '') +
      (row.muted ? ' tma-dash__messages-row--muted' : '') +
      (isChatPicked(state, row.id) ? ' tma-dash__messages-row--picked' : '') +
      '" data-messages-row="' +
      esc(row.id) +
      '"' + rowPickedAttr(row, state) + '>' +
      buildMessagesRowInner(row, state) +
      '</button>'
    );
  }

  /* While picking, a tap on a row picks it rather than opening it. */
  function rowPickedAttr(row, state) {
    if (!state.chatSelect) return '';
    return ' aria-pressed="' + (isChatPicked(state, row.id) ? 'true' : 'false') + '"';
  }

  /* ------------------------------------------------------------------
   * Picking chats for a bulk action
   *
   * `state.chatSelect` is null, or `{ ids: { <id>: true } }` while chats are
   * being picked. Picking starts from a chat's picture, from Select in a
   * chat's menu (hold a row on a phone, right-click it on a computer), and
   * ends when the last chat is let go, on Cancel, on Escape, or after an
   * action has been applied to them.
   * ---------------------------------------------------------------- */

  function isChatPicked(state, id) {
    return !!(state && state.chatSelect && state.chatSelect.ids[id]);
  }

  function pickedChatIds(state) {
    return state.chatSelect ? Object.keys(state.chatSelect.ids) : [];
  }

  function pickedChatRows(state) {
    return pickedChatIds(state).map(findThread).filter(Boolean);
  }

  function startChatSelect(root, state, render, id) {
    closeChatPeek();
    closeMessageMenu();
    closeMessagesRowSwipes(root);
    state.chatSelect = { ids: {} };
    if (id) state.chatSelect.ids[id] = true;
    render();
  }

  function toggleChatPicked(root, state, render, id) {
    if (!id) return;
    if (!state.chatSelect) {
      startChatSelect(root, state, render, id);
      return;
    }
    if (state.chatSelect.ids[id]) delete state.chatSelect.ids[id];
    else state.chatSelect.ids[id] = true;
    // Letting go of the last one is the end of picking, as in the mail inbox.
    if (!pickedChatIds(state).length) state.chatSelect = null;
    render();
  }

  function endChatSelect(state, render) {
    if (!state.chatSelect) return;
    state.chatSelect = null;
    render();
  }

  /* Every chat the list is showing: the tab and the search it is under. */
  function pickAllChats(root, state, render) {
    if (!state.chatSelect) state.chatSelect = { ids: {} };
    getVisibleThreads(state).forEach(function (row) { state.chatSelect.ids[row.id] = true; });
    closeChatPeek();
    render();
  }

  /*
   * A picked chat that has left the list (archived elsewhere, deleted, moved
   * to another tab) is no longer picked; picking ends with the last of them,
   * and whenever the column turns to search, Media or Calls.
   */
  function prunePickedChats(state, rows) {
    if (!state.chatSelect) return;
    if (state.searchMode || state.mediaMode || state.callsMode || state.settingsOpen || state.composeOpen || state.groupOpen) {
      state.chatSelect = null;
      return;
    }
    var shown = {};
    rows.forEach(function (row) { shown[row.id] = true; });
    Object.keys(state.chatSelect.ids).forEach(function (id) {
      if (!shown[id]) delete state.chatSelect.ids[id];
    });
    if (!pickedChatIds(state).length) state.chatSelect = null;
  }

  /*
   * What each bulk action would do to the chats picked. A mixed pick goes the
   * way that changes something: one chat not yet pinned makes the button
   * Pin, and only an all-pinned pick offers Unpin.
   */
  function chatBulkActions(state) {
    var rows = pickedChatRows(state);
    var anyUnpinned = rows.some(function (r) { return !r.pinned; });
    var anyUnread = rows.some(function (r) { return r.unread || r.markedUnread; });
    var anyUnmuted = rows.some(function (r) { return !r.muted; });
    var archived = state.tab === 'archived';
    return [
      anyUnread
        ? { id: 'read', label: 'Read', title: 'Mark as read', icon: 'EnvelopeSimpleOpen' }
        : { id: 'unread', label: 'Unread', title: 'Mark as unread', icon: 'EnvelopeSimple' },
      anyUnpinned
        ? { id: 'pin', label: 'Pin', title: 'Pin to the top', icon: 'PushPin' }
        : { id: 'unpin', label: 'Unpin', title: 'Unpin', icon: 'PushPinSlash' },
      anyUnmuted
        ? { id: 'mute', label: 'Mute', title: 'Mute notifications', icon: 'BellSlash' }
        : { id: 'unmute', label: 'Unmute', title: 'Unmute notifications', icon: 'Bell' },
      archived
        ? { id: 'unarchive', label: 'Unarchive', title: 'Move back to chats', icon: 'ArchiveTray' }
        : { id: 'archive', label: 'Archive', title: 'Archive', icon: 'Archive' },
      { id: 'delete', label: 'Delete', title: 'Delete or leave', icon: 'Trash', danger: true },
    ];
  }

  /* Takes the search bar's place at the top of the column while picking. */
  function renderChatPickHead(state) {
    var count = pickedChatIds(state).length;
    var all = getVisibleThreads(state).length;
    var everything = count > 0 && count >= all;
    return (
      '<div class="tma-dash__messages-pick-head" data-messages-pick-head>' +
      '<button type="button" class="tma-dash__messages-pick-cancel" data-messages-pick-cancel' +
      ' aria-label="Cancel selection" title="Cancel">' +
      '<img src="' + ICONS.X + '" alt="">' +
      '</button>' +
      '<span class="tma-dash__messages-pick-count" role="status" aria-live="polite">' +
      count + ' selected</span>' +
      '<button type="button" class="tma-dash__messages-pick-all" data-messages-pick-all="' +
      (everything ? 'none' : 'all') + '">' +
      (everything ? 'Deselect all' : 'Select all') +
      '</button>' +
      '</div>'
    );
  }

  /* Takes the navigation's place at the foot of the column while picking. */
  function renderChatPickActions(state) {
    return (
      '<div class="tma-dash__messages-list-foot tma-dash__messages-pick-actions" data-messages-pick-actions' +
      ' role="toolbar" aria-label="Actions for the selected chats">' +
      chatBulkActions(state).map(function (action) {
        return (
          '<button type="button" class="tma-dash__messages-nav-btn tma-dash__messages-pick-act' +
          (action.danger ? ' tma-dash__messages-pick-act--danger' : '') + '"' +
          ' data-messages-pick-action="' + action.id + '"' +
          ' aria-label="' + esc(action.title) + '" title="' + esc(action.title) + '">' +
          '<span class="tma-dash__messages-nav-icon"><img src="' + ICONS[action.icon] + '" alt=""></span>' +
          '<span class="tma-dash__messages-nav-label tma-dash__messages-pick-act-label">' + esc(action.label) + '</span>' +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function chatCountLabel(n) {
    return n + ' ' + (n === 1 ? 'chat' : 'chats');
  }

  /* At most `limit` requests in flight; resolves with how many failed. */
  function runLimited(tasks, limit) {
    return new Promise(function (resolve) {
      if (!tasks.length) { resolve(0); return; }
      var next = 0;
      var active = 0;
      var done = 0;
      var failed = 0;
      function pump() {
        while (active < limit && next < tasks.length) {
          var task = tasks[next++];
          active++;
          Promise.resolve()
            .then(task)
            .catch(function () { failed++; })
            .then(function () {
              active--;
              done++;
              if (done === tasks.length) resolve(failed);
              else pump();
            });
        }
      }
      pump();
    });
  }

  /*
   * One action on every picked chat. Applied on screen at once, then saved
   * chat by chat (a few at a time, through the same calls a single chat
   * uses, so other tabs hear about each change as usual). A chat whose save
   * fails goes back to how it was, and the toast says how many did.
   */
  function runChatBulkAction(root, state, render, action) {
    var rows = pickedChatRows(state);
    if (!rows.length) { endChatSelect(state, render); return; }
    var api = window.TMAMessagingAPI;
    var n = rows.length;
    var tasks = [];
    var message = '';

    function setFlag(field, value, changes) {
      rows.forEach(function (row) {
        if (!!row[field] === value) return;
        var before = row[field];
        row[field] = value;
        tasks.push(function () {
          return api.updateConversation(row.id, changes).catch(function (err) {
            row[field] = before;
            throw err;
          });
        });
      });
    }

    if (action === 'pin' || action === 'unpin') {
      var pin = action === 'pin';
      setFlag('pinned', pin, { pinned: pin });
      message = pin ? 'Pinned' : 'Unpinned';
    } else if (action === 'mute' || action === 'unmute') {
      var mute = action === 'mute';
      // null mutes until unmuted; 0 unmutes.
      setFlag('muted', mute, { muteMinutes: mute ? null : 0 });
      message = chatCountLabel(n) + (mute ? ' muted' : ' unmuted');
    } else if (action === 'archive' || action === 'unarchive') {
      var archive = action === 'archive';
      setFlag('archived', archive, { archived: archive });
      message = chatCountLabel(n) + (archive ? ' archived' : ' moved back to chats');
    } else if (action === 'read') {
      rows.forEach(function (row) {
        if (!row.unread && !row.markedUnread) return;
        var before = { unread: row.unread, markedUnread: row.markedUnread };
        row.unread = 0;
        row.markedUnread = false;
        tasks.push(function () {
          return api.markRead(row.id).catch(function (err) {
            row.unread = before.unread;
            row.markedUnread = before.markedUnread;
            throw err;
          });
        });
      });
      message = chatCountLabel(n) + ' marked as read';
    } else if (action === 'unread') {
      rows.forEach(function (row) {
        var before = { unread: row.unread, markedUnread: row.markedUnread };
        row.unread = row.unread || 1;
        row.markedUnread = true;
        tasks.push(function () {
          return api.markUnread(row.id).catch(function (err) {
            row.unread = before.unread;
            row.markedUnread = before.markedUnread;
            throw err;
          });
        });
      });
      message = chatCountLabel(n) + ' marked as unread';
    } else if (action === 'delete') {
      deletePickedChats(root, state, render, rows);
      return;
    } else {
      return;
    }

    state.chatSelect = null;
    render();
    syncTabBarBadges();
    showMessagesToast(root, message);

    runLimited(tasks, 4).then(function (failed) {
      if (!failed) {
        if (action === 'read' && window.TMANotifications && window.TMANotifications.refreshCount) {
          window.TMANotifications.refreshCount();
        }
        return;
      }
      render();
      syncTabBarBadges();
      showMessagesToast(root, failed === tasks.length
        ? 'That change could not be saved'
        : failed + ' of ' + tasks.length + ' could not be changed');
    });
  }

  /*
   * Delete leaves each chat for this user (the others keep theirs), as the
   * single Delete does; a group is left. Asked once for the lot. The firm's
   * own chat cannot be left; it stays, and the toast says so.
   */
  function deletePickedChats(root, state, render, rows) {
    var groups = rows.filter(function (r) { return r.type === 'group'; }).length;
    var n = rows.length;
    var prompt = n === 1
      ? (groups ? 'Leave this group? You will stop receiving its messages.'
        : 'Delete this conversation? It is removed for you; the other person keeps their copy.')
      : 'Delete ' + n + ' chats? They are removed for you; the others keep their copies.' +
        (groups === 1 ? ' One of them is a group, which you will leave.'
          : groups > 1 ? ' ' + groups + ' of them are groups, which you will leave.' : '');
    if (!window.confirm(prompt)) return;

    var api = window.TMAMessagingAPI;
    state.chatSelect = null;
    render();

    var gone = 0;
    var tasks = rows.map(function (row) {
      return function () {
        return api.leaveConversation(row.id).then(function () {
          gone++;
          STORE.threads = STORE.threads.filter(function (r) { return r.id !== row.id; });
          delete STORE.threadMessages[row.id];
          if (state.selectedId === row.id) closeConversation(root, state, render);
          else render();
        });
      };
    });

    runLimited(tasks, 4).then(function (failed) {
      syncTabBarBadges();
      if (!failed) {
        showMessagesToast(root, n === 1 ? (groups ? 'You left the group' : 'Conversation deleted') : chatCountLabel(gone) + ' deleted');
      } else {
        showMessagesToast(root, gone
          ? chatCountLabel(gone) + ' deleted; ' + failed + ' could not be'
          : (n === 1 ? 'That could not be completed' : 'Those chats could not be deleted'));
      }
    });
  }

  function renderList(state) {
    var mobile = isMessagesMobile();
    var rows = getVisibleThreads(state);
    prunePickedChats(state, rows);
    var picking = !!state.chatSelect;
    var favorites = rows.filter(function (row) { return row.pinned; });
    var chats = rows.filter(function (row) { return !row.pinned; });

    var body = '';
    if (!rows.length) {
      body = renderListPlaceholder(state);
    } else if (state.tab === 'archived' || (state.search || '').trim()) {
      body = rows.map(function (row) { return renderInboxRow(row, state, mobile); }).join('');
    } else {
      if (favorites.length) {
        body +=
          '<div class="tma-dash__messages-list-group">Pinned</div>' +
          favorites.map(function (row) { return renderInboxRow(row, state, mobile); }).join('');
      }
      if (chats.length) {
        body +=
          '<div class="tma-dash__messages-list-group">Chats</div>' +
          chats.map(function (row) { return renderInboxRow(row, state, mobile); }).join('');
      }
    }

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
      '<div class="tma-dash__messages-list' + (picking ? ' tma-dash__messages-list--picking' : '') + '">' +
      (picking
        ? renderChatPickHead(state)
        : (mobile ? renderListMobileHead(state) : renderListHead(state))) +
      renderComposePanel(state) +
      renderSettingsPanel(state) +
      // Only over the chat list: pulling down inside Media or Calls should
      // not produce a shelf belonging to a list that isn't on screen.
      (picking || state.searchMode || state.mediaMode ||
        state.callsMode || state.tab === 'archived'
        ? ''
        : renderArchivedReveal(state)) +
      '<div class="tma-dash__messages-list-body" data-messages-list-body>' +
      // Media takes over the column the way search does; the archived tab is
      // still the ordinary list, just filtered, so it only gains a header
      // saying what you are looking at and how to get back.
      (state.mediaMode
        ? renderMediaPanel(state)
        : state.callsMode
          ? renderCallsPanel(state)
          : (state.searchMode
            ? renderSearchResults(state)
            : (state.tab === 'archived' ? renderArchivedHead() : '') +
              (rows.length ? body : (people ? '' : body)) + people)) +
      '</div>' +
      // Between the scrolling body and the nav bar, so it floats clear of both.
      (picking ? '' : renderComposeFab()) +
      (picking ? renderChatPickActions(state) : renderListFoot(state)) +
      '</div>'
    );
  }

  /*
   * Opening a tab clears its badge. Cleared locally first so the number goes
   * the instant the tab does, then confirmed by the server, which decides
   * *what* was seen, so a call that lands mid-request is not swallowed.
   */
  function markTabSeen(root, state, render, tab) {
    if (!STORE.tabCounts) STORE.tabCounts = {};
    STORE.tabCounts[tab] = 0;
    render();
    // Clearing the Calls badge lowers the sidebar's Messages badge too.
    syncTabBarBadges();

    window.TMAMessagingAPI.markTabSeen(tab).then(function (data) {
      STORE.tabCounts = (data && data.tabCounts) || STORE.tabCounts;
      render();
      syncTabBarBadges();
    }).catch(function () {
      // The badge reappears on the next load, which is the honest outcome.
    });
  }

  /* Re-read the badges after something that could have changed them. */
  function refreshTabCounts(root, state, render) {
    return window.TMAMessagingAPI.tabCounts().then(function (data) {
      if (!data || !data.tabCounts) return;
      STORE.tabCounts = data.tabCounts;
      render();
      syncTabBarBadges();
    }).catch(function () { /* a stale badge is not worth surfacing */ });
  }

  function loadMessagesCalls(root, state, render) {
    if (state.callsLoading) return;

    state.callsLoading = true;
    state.callsError = null;
    render();

    window.TMAMessagingAPI.calls().then(function (data) {
      state.callLog = (data && data.calls) || [];
      state.callsLoading = false;
      render();
    }).catch(function (err) {
      state.callsLoading = false;
      state.callsError = (err && err.message) || 'Calls could not be loaded.';
      render();
    });
  }

  /* ------------------------------------------------------------------
   * Calls
   *
   * Recent call system messages across conversations, plus a quick start
   * from any open chat via the header phone / video buttons.
   * ---------------------------------------------------------------- */
  function renderCallsPanel(state) {
    // The log is server-backed (see loadMessagesCalls): show its loading and
    // error states rather than a misleading empty one while it is in flight.
    if (state.callsLoading && !(state.callLog || []).length) {
      // Call rows carry the same avatar-and-two-lines shape as the inbox, so
      // they wait on the same skeleton rather than a second one.
      return '<div class="tma-dash__messages-media">' +
        renderListSkeleton('Loading calls') + '</div>';
    }

    if (state.callsError) {
      return (
        '<div class="tma-dash__messages-media">' +
        '<div class="tma-dash__messages-media-note">' +
        '<strong>Calls could not be loaded</strong><br>' + esc(state.callsError) +
        '</div></div>'
      );
    }

    var calls = (state.callLog || []).slice(0, 40);

    if (!calls.length) {
      return (
        '<div class="tma-dash__messages-media">' +
        '<div class="tma-dash__messages-media-note">' +
        '<strong>No recent calls</strong><br>' +
        'Start a voice or video call from any conversation header.' +
        '</div></div>'
      );
    }

    return (
      '<div class="tma-dash__messages-media">' +
      calls.map(renderCallRow).join('') +
      '</div>'
    );
  }

  /*
   * One entry in the call log.
   *
   * The row is the person, not the event: their photo leads it exactly as it
   * does everywhere else in Messages, and the outcome is carried by a small
   * direction arrow beside the subtitle, the same shorthand every phone uses.
   * A large naked phone glyph in the avatar's place said "call" three times
   * over and left the log looking nothing like the chat list above it.
   *
   * The phone and camera on the right are the point of a call log: calling
   * back should not mean opening the conversation first.
   */
  function renderCallRow(call) {
    var outgoing = isOutgoingCall(call);
    var kind = call.media === 'video' ? 'Video' : 'Voice';
    var missed = call.event === 'call_missed';
    var dir, stateLabel;

    if (missed) {
      dir = outgoing ? 'out-missed' : 'in-missed';
      stateLabel = outgoing ? 'No answer' : 'Missed';
    } else if (call.event === 'call_started') {
      dir = outgoing ? 'out' : 'in';
      stateLabel = 'Ongoing';
    } else {
      dir = outgoing ? 'out' : 'in';
      stateLabel = outgoing ? 'Outgoing' : 'Incoming';
    }

    var name = call.name || 'Contact';
    var avatar = call.photo
      ? '<span class="tma-dash__messages-row-avatar"><img src="' + esc(call.photo) + '" alt="" loading="lazy"></span>'
      : renderInitialAvatar(name);

    function actionBtn(media, icon, label) {
      return (
        '<button type="button" class="tma-dash__call-action" ' +
        'data-calls-start="' + esc(call.conversationId) + '" data-calls-media="' + media + '" ' +
        'aria-label="' + esc(label + ' ' + name) + '" title="' + esc(label + ' ' + name) + '">' +
        '<img src="' + icon + '" alt="" width="18" height="18">' +
        '</button>'
      );
    }

    return (
      '<div class="tma-dash__call-row">' +
      '<button type="button" class="tma-dash__messages-person" data-calls-open="' +
      esc(call.conversationId) + '">' +
      avatar +
      '<span class="tma-dash__messages-person-text">' +
      // Time sits on the name line, as it does in the chat list, the subtitle
      // is narrow enough already once the call buttons take their room.
      '<span class="tma-dash__call-name-line">' +
      '<span class="tma-dash__messages-person-name">' + esc(name) + '</span>' +
      (call.time ? '<span class="tma-dash__call-time">' + esc(call.time) + '</span>' : '') +
      '</span>' +
      '<span class="tma-dash__messages-person-meta' + (missed ? ' is-missed' : '') + '">' +
      '<span class="tma-dash__call-dir tma-dash__call-dir--' + dir + '" aria-hidden="true"></span>' +
      esc(stateLabel + ' · ' + kind) +
      '</span></span></button>' +
      '<span class="tma-dash__call-actions">' +
      actionBtn('audio', ICONS.Phone, 'Voice call') +
      actionBtn('video', ICONS.VideoCamera, 'Video call') +
      '</span></div>'
    );
  }

  /* ------------------------------------------------------------------
   * Media
   *
   * Every photo and video the user can see, pooled across all of their
   * conversations, for finding a file you remember receiving without
   * remembering who sent it. The per-thread shelf in the profile panel stays
   * as it is; this is the same shelf without the thread filter.
   *
   * It takes over the inbox column exactly as search does, rather than opening
   * a separate overlay, so the reading pane keeps whatever conversation is open
   * behind it.
   * ---------------------------------------------------------------- */

  /* Media is fetched once per opening rather than kept in sync: it is a
   * browsing view, not a live one, and re-fetching on every render would make
   * scrolling it stutter. */
  function loadMessagesMedia(root, state, render) {
    if (state.mediaLoading) return;

    state.mediaLoading = true;
    state.mediaError = null;
    render();

    window.TMAMessagingAPI.media(state.mediaShelf || 'media').then(function (data) {
      state.mediaItems = (data && data.items) || [];
      state.mediaLoading = false;
      render();
    }).catch(function (err) {
      state.mediaLoading = false;
      state.mediaError = (err && err.message) || 'Media could not be loaded.';
      render();
    });
  }

  function renderMediaPanel(state) {
    var shelf = state.mediaShelf || 'media';

    var tabs =
      '<div class="tma-dash__messages-media-tabs" role="tablist">' +
      // Short labels: three tabs share a ~320px column, and "Photos & video"
      // only truncated to "Photos & v…" anyway.
      [
        { key: 'media', label: 'Photos' },
        { key: 'documents', label: 'Documents' },
        { key: 'links', label: 'Links' },
      ].map(function (t) {
        return (
          '<button type="button" class="tma-dash__messages-media-tab' +
          (shelf === t.key ? ' is-active' : '') +
          '" role="tab" aria-selected="' + (shelf === t.key ? 'true' : 'false') +
          '" data-messages-media-shelf="' + t.key + '">' + esc(t.label) + '</button>'
        );
      }).join('') +
      '</div>';

    var body;

    if (state.mediaLoading) {
      body = '<div class="tma-dash__messages-media-note">Loading…</div>';
    } else if (state.mediaError) {
      body = '<div class="tma-dash__messages-media-note" role="alert">' + esc(state.mediaError) + '</div>';
    } else if (!state.mediaItems || !state.mediaItems.length) {
      body =
        '<div class="tma-dash__messages-media-note">' +
        (shelf === 'documents'
          ? 'No documents have been shared yet.'
          : shelf === 'links'
            ? 'No links have been shared yet.'
            : 'No photos or videos have been shared yet.') +
        '</div>';
    } else if (shelf === 'links') {
      // Links open externally rather than in the lightbox, and are titled by
      // whatever the preview cache knows, falling back to the domain, then to
      // the raw URL, so a link with no cached preview is still readable.
      body =
        '<div class="tma-dash__messages-media-docs">' +
        state.mediaItems.map(function (item) {
          var title = item.title || item.domain || item.url;

          // A link with no cached preview is titled by its domain, so repeating
          // the domain underneath would print it twice in a row.
          var meta = [
            title === item.domain ? null : item.domain,
            item.conversationName,
            item.date,
          ].filter(Boolean).join(' · ');

          return (
            '<a class="tma-dash__messages-media-doc" href="' + esc(item.url) + '"' +
            ' target="_blank" rel="noopener noreferrer" title="' + esc(item.url) + '">' +
            '<span class="tma-dash__messages-media-doc-name">' + esc(title) + '</span>' +
            '<span class="tma-dash__messages-media-doc-meta">' + esc(meta) + '</span>' +
            '</a>'
          );
        }).join('') +
        '</div>';
    } else if (shelf === 'documents') {
      // Documents read better as rows than tiles, the filename is the point.
      body =
        '<div class="tma-dash__messages-media-docs">' +
        state.mediaItems.map(function (item, i) {
          return (
            '<button type="button" class="tma-dash__messages-media-doc" data-messages-media-open="' + i + '">' +
            '<span class="tma-dash__messages-media-doc-name">' + esc(item.name || 'File') + '</span>' +
            '<span class="tma-dash__messages-media-doc-meta">' +
            esc(item.conversationName || '') + ' · ' + esc(item.date || '') +
            '</span>' +
            '</button>'
          );
        }).join('') +
        '</div>';
    } else {
      body =
        '<div class="tma-dash__messages-media-grid">' +
        state.mediaItems.map(function (item, i) {
          var src = item.thumbUrl || item.url;
          return (
            '<button type="button" class="tma-dash__messages-media-tile"' +
            ' data-messages-media-open="' + i + '"' +
            ' title="' + esc((item.conversationName || '') + ' · ' + (item.date || '')) + '">' +
            // alt is deliberately empty: a thumbnail that fails to load should
            // fall back to the tile's own label (see wireMediaThumbFallbacks),
            // not to the browser's broken-image icon with a filename beside it.
            '<img src="' + esc(src) + '" alt="" loading="lazy" data-messages-media-thumb>' +
            '<span class="tma-dash__messages-media-tile-name" aria-hidden="true">' +
            esc(item.name || '') + '</span>' +
            (item.kind === 'video'
              ? '<span class="tma-dash__messages-media-tile-badge" aria-hidden="true">▶</span>'
              : '') +
            '</button>'
          );
        }).join('') +
        '</div>';
    }

    return (
      '<div class="tma-dash__messages-media">' +
      tabs +
      body +
      '</div>'
    );
  }

  /* Opens a media item in the shared portal lightbox, with the rest of the
   * shelf as its gallery, the same component the conversation gallery and the
   * File Library use, so a preview looks identical wherever it was opened. */
  function openMessagesMediaItem(state, index) {
    var items = state.mediaItems || [];
    var item = items[index];
    if (!item) return;

    // A document has no in-browser preview worth showing; hand it straight to
    // the browser to download rather than opening an empty viewer.
    if (item.shelf === 'documents' || item.kind === 'file') {
      window.open(item.url, '_blank', 'noopener');
      return;
    }

    if (!window.TMAPortalLightbox) return;

    var viewable = items.filter(function (i) {
      return i.kind === 'image' || i.kind === 'video';
    });
    var target = viewable.indexOf(item);

    window.TMAPortalLightbox.open(
      viewable.map(function (i) {
        return {
          url: i.url, name: i.name, mime: i.mime, size: i.size,
          downloadUrl: attachmentDownloadUrl(i),
          saveAttachment: i.id ? { kind: 'messaging', id: i.id } : null,
        };
      }),
      target < 0 ? 0 : target
    );
  }

  /* ------------------------------------------------------------------
   * Emoji
   *
   * Native Unicode characters, from the generated emoji-data.js. The previous
   * picker drew 21 SVG assets, 18 of which were malformed XML and rendered as
   * broken images, and 21 images could never satisfy categories or search.
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
      // Private browsing, or a corrupted value, recents are a nicety.
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
    // Read receipts: the eye takes the receipt line's own colour, so it has to
    // be drawn rather than loaded as an <img>.
    Eye:
      'M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z',
    Paperclip:
      'M209.66,122.34a8,8,0,0,1,0,11.32l-82.05,82a56,56,0,0,1-79.2-79.21L147.67,35.73a40,40,0,1,1,56.61,56.55L105,193A24,24,0,1,1,71,159L154.3,74.38A8,8,0,1,1,165.7,85.6L82.39,170.31a8,8,0,1,0,11.27,11.36L192.93,81A24,24,0,1,0,159,47L59.76,147.68a40,40,0,1,0,56.53,56.62l82.06-82A8,8,0,0,1,209.66,122.34Z',
    Microphone:
      'M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z',
    PaperPlaneRight:
      'M231.87,114l-168-95.89A16,16,0,0,0,40.92,37.34L71.55,128,40.92,218.67A16,16,0,0,0,56,240a16.15,16.15,0,0,0,7.93-2.1l167.92-96.05a16,16,0,0,0,.05-27.89ZM56,224a.56.56,0,0,0,0-.12L85.74,136H144a8,8,0,0,0,0-16H85.74L56.06,32.16A.46.46,0,0,0,56,32l168,95.83Z',
    // Inline copies of the Phosphor icons the call log uses as <img>. A call
    // bubble needs them to take the bubble's own colour, which an <img> cannot.
    Phone:
      'M222.37,158.46l-47.11-21.11-.13-.06a16,16,0,0,0-15.17,1.4,8.12,8.12,0,0,0-.75.56L134.87,160c-15.42-7.49-31.34-23.29-38.83-38.51l20.78-24.71c.2-.25.39-.5.57-.77a16,16,0,0,0,1.32-15.06l0-.12L97.54,33.64a16,16,0,0,0-16.62-9.52A56.26,56.26,0,0,0,32,80c0,79.4,64.6,144,144,144a56.26,56.26,0,0,0,55.88-48.92A16,16,0,0,0,222.37,158.46ZM176,208A128.14,128.14,0,0,1,48,80,40.2,40.2,0,0,1,82.87,40a.61.61,0,0,0,0,.12l21,47L83.2,111.86a6.13,6.13,0,0,0-.57.77,16,16,0,0,0-1,15.7c9.06,18.53,27.73,37.06,46.46,46.11a16,16,0,0,0,15.75-1.14,8.44,8.44,0,0,0,.74-.56L168.89,152l47,21.05h0s.08,0,.11,0A40.21,40.21,0,0,1,176,208Z',
    VideoCamera:
      'M251.77,73a8,8,0,0,0-8.21.39L208,97.05V72a16,16,0,0,0-16-16H32A16,16,0,0,0,16,72V184a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V159l35.56,23.71A8,8,0,0,0,248,184a8,8,0,0,0,8-8V80A8,8,0,0,0,251.77,73ZM192,184H32V72H192V184Zm48-22.95-32-21.33V116.28L240,95Z',
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
    if (msg.body) {
      // One plain line: the marks for bold and italic would only be stray
      // asterisks here.
      var plain = plainMessageText(msg.body).replace(/\s+/g, ' ').trim();
      return plain.length > 96 ? plain.slice(0, 96) + '…' : plain;
    }
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
    var name = (msg.sender && msg.sender.name) || 'them';
    // Quoted from a group into this one-to-one conversation.
    if (msg.fromGroup) return 'Replying privately to ' + name;
    return 'Replying to ' + name;
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
    // A private reply answers a message from another conversation. This
    // thread does not hold it, so it travels with the reply.
    return findMessageById(state.selectedId, state.replyTo.messageId) || state.replyTo.source || null;
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

  /* ------------------------------------------------------------------
   * @mentions
   *
   * In a group, "@Their Name" addresses a member and "@all" addresses
   * everyone. The server reads the names out of the message's own text, so
   * nothing here is sent alongside it: the composer's list only saves typing
   * the name, and a name typed out by hand counts the same.
   * ---------------------------------------------------------------- */

  // What follows the @ to address the whole group; the server's word for it.
  var MENTION_EVERYONE = 'all';
  var MENTION_LIST_MAX = 8;
  // The list is kept while a conversation stays in use, and asked for again
  // after this long so someone added to the group turns up in it.
  var MENTION_ROSTER_MS = 60000;

  function mentionRoster(conversationId) {
    return (STORE.mentionable || {})[conversationId] || null;
  }

  function loadMentionRoster(conversationId, render) {
    if (!STORE.mentionable) STORE.mentionable = {};

    var roster = STORE.mentionable[conversationId];
    if (roster && (roster.loading || Date.now() - roster.at < MENTION_ROSTER_MS)) return;

    // What is already known keeps showing while the fresh answer is fetched.
    roster = STORE.mentionable[conversationId] = {
      people: roster ? roster.people : [],
      everyone: roster ? roster.everyone : null,
      loaded: !!(roster && roster.loaded),
      loading: true,
      at: roster ? roster.at : 0,
    };

    window.TMAMessagingAPI.mentionable(conversationId)
      .then(function (data) {
        roster.people = (data && data.people) || [];
        roster.everyone = (data && data.everyone) || null;
        roster.loaded = true;
        roster.loading = false;
        roster.at = Date.now();
        render();
      })
      .catch(function () {
        roster.loading = false;
      });
  }

  /*
   * The "@term" the caret is sitting at the end of, if it is.
   *
   * Read from the text just before the caret, so an @ typed a sentence ago
   * does not reopen the list every time something else is typed.
   */
  function mentionTrigger(input) {
    var caret = caretOffset(input);
    if (caret === null || caret === undefined) return null;

    var before = (input.textContent || '').slice(0, caret);
    var match = /(^|[\s(])@([^\s@]{0,40})$/.exec(before);

    return match ? { term: match[2], caret: caret } : null;
  }

  function mentionResults(state) {
    var mention = state.mention;
    if (!mention || mention.dismissed || mention.threadId !== state.selectedId) return [];

    var roster = mentionRoster(state.selectedId);
    if (!roster || !roster.loaded || !roster.people.length) return [];

    var term = mention.term.toLowerCase();
    var results = [];

    if (roster.everyone && roster.everyone.indexOf(term) === 0) {
      results.push({ everyone: true, name: roster.everyone, meta: 'Everyone in this group' });
    }

    roster.people.forEach(function (person) {
      // The start of any part of the name: "mar" finds Ann Marie Joseph.
      var matches = !term || person.name.toLowerCase().split(/\s+/).some(function (part, i, parts) {
        return parts.slice(i).join(' ').indexOf(term) === 0;
      });
      if (matches) results.push(person);
    });

    return results.slice(0, MENTION_LIST_MAX);
  }

  function mentionFace(person) {
    if (person.photo) return person.photo;
    var store = window.TMACurrentUser;
    return store && store.initialsFor ? store.initialsFor(person.name, String(person.id)) : '';
  }

  /*
   * Always in the markup, hidden when there is nothing to offer: it sits
   * ahead of the message box, and a node that came and went there would
   * shift what the box is paired with on the next render.
   */
  function renderMentionMenu(state) {
    var results = mentionResults(state);
    var index = results.length ? Math.min(state.mention.index || 0, results.length - 1) : 0;

    return (
      '<div class="tma-dash__menu tma-dash__feed-mention-menu" data-key="mention-menu" ' +
      'data-messages-mention-menu role="listbox" aria-label="Mention"' +
      (results.length ? '' : ' hidden') + '>' +
      results.map(function (item, i) {
        var selected = i === index;
        return (
          '<button type="button" class="tma-dash__menu-item' +
          (selected ? ' tma-dash__menu-item--active' : '') + '" ' +
          'data-messages-mention-pick="' + i + '" role="option" aria-selected="' + selected + '">' +
          '<img class="tma-dash__feed-mention-avatar" src="' +
          esc(item.everyone ? ICON + 'At.svg' : mentionFace(item)) + '" alt="" width="22" height="22">' +
          '<span class="tma-dash__feed-mention-ident">' +
          '<span class="tma-dash__feed-mention-name">' + esc(item.everyone ? '@' + item.name : item.name) + '</span>' +
          (item.meta ? '<span class="tma-dash__feed-mention-meta">' + esc(item.meta) + '</span>' : '') +
          '</span>' +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  /* Open, move or close the list to match where the caret now is. */
  function syncMention(state, input, render) {
    var row = findThread(state.selectedId);
    var trigger = row && row.type === 'group' && !state.recording ? mentionTrigger(input) : null;

    if (!trigger) {
      if (state.mention) {
        state.mention = null;
        render();
      }
      return;
    }

    var same = state.mention && state.mention.threadId === state.selectedId && state.mention.term === trigger.term;
    if (same) {
      state.mention.caret = trigger.caret;
      return;
    }

    state.mention = { threadId: state.selectedId, term: trigger.term, index: 0, caret: trigger.caret };
    loadMentionRoster(state.selectedId, render);
    render();
  }

  /* Arrow, Enter, Tab and Escape while the list is open. True when it took the key. */
  function handleMentionKeys(e, root, state, render) {
    var results = mentionResults(state);
    if (!results.length) return false;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var step = e.key === 'ArrowDown' ? 1 : -1;
      state.mention.index = ((state.mention.index || 0) + step + results.length) % results.length;
      render();
      return true;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pickMention(root, state, Math.min(state.mention.index || 0, results.length - 1));
      return true;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      // Shut for this "@term": it stays shut until the term changes, rather
      // than reopening because the caret is still sitting after it.
      state.mention.dismissed = true;
      render();
      return true;
    }

    return false;
  }

  /*
   * Put the chosen name where "@term" was.
   *
   * As plain text, like everything else in the composer, with a space after
   * it so the next word does not run into the name.
   */
  function pickMention(root, state, index) {
    var item = mentionResults(state)[index];
    var input = root.querySelector('[data-messages-composer-input]');
    if (!item || !input) return;

    input.focus();

    var selection = window.getSelection();
    var range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;

    // A tap on a phone takes the caret out of the box before the choice
    // lands; put it back where the "@term" was being typed.
    if (!range || !input.contains(range.startContainer)) {
      placeCaret(input, state.mention.caret);
      selection = window.getSelection();
      range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    }

    var node = range && range.startContainer;
    if (!node || node.nodeType !== 3 || !input.contains(node)) return;

    var caret = range.startOffset;
    var match = /(^|[\s(])@([^\s@]{0,40})$/.exec(node.textContent.slice(0, caret));
    if (!match) return;

    // Read the caret first: once the range has moved, its start is the new one.
    range.setStart(node, caret - match[2].length - 1);
    range.setEnd(node, caret);
    range.deleteContents();

    var text = document.createTextNode('@' + item.name + ' ');
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    // The composer's own input handler keeps the draft; with the caret now
    // past the name, it also finds no "@term" left and closes the list.
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /*
   * Who a piece of text addresses, worked out the way the server will.
   *
   * Only for the bubble shown while a send is still in flight; the answer
   * that comes back with the stored message replaces it.
   */
  function guessMentions(conversationId, text) {
    var roster = mentionRoster(conversationId);
    var found = { mentions: [], mentionsAll: false };
    if (!roster || !roster.loaded || String(text).indexOf('@') === -1) return found;

    var rest = String(text);

    roster.people
      .slice()
      .sort(function (a, b) { return b.name.length - a.name.length; })
      .forEach(function (person) {
        var pattern = mentionPattern([person.name], false);
        if (!pattern || !pattern.test(rest)) return;
        found.mentions.push({ id: person.id, name: person.name });
        rest = rest.replace(mentionPattern([person.name], false), '$1 ');
      });

    var all = roster.everyone ? mentionPattern([roster.everyone], false) : null;
    found.mentionsAll = !!(all && all.test(rest));

    return found;
  }

  /* ── "/" commands ──────────────────────────────────────────────────
   *
   * Typed at the very start of the message box, the way an AI chat offers
   * its shortcuts: "/" lists what can be done from here, typing narrows the
   * list, Enter or a tap runs the command and the "/word" goes. Drawn as the
   * @ list is (the same menu and rows), with the command's icon where a face
   * would be. Request files is the first.
   */
  var SLASH_COMMANDS = [
    {
      id: 'request-files',
      name: 'Request files',
      meta: 'Ask for documents for an application, or files for a folder',
      icon: 'FileArrowUp',
      can: canRequestFiles,
    },
  ];

  /* The server decides; this only keeps the command off the list of the
     people it would refuse (an applicant, a client). */
  function canRequestFiles() {
    var store = window.TMACurrentUser;
    var me = (store && store.get && store.get()) || STORE.me || {};
    return !!(me.isStaff || me.isAdmin || me.isProviderContact || me.isServiceProviderAdmin);
  }

  function slashTrigger(input) {
    var caret = caretOffset(input);
    if (caret === null || caret === undefined) return null;

    var before = (input.textContent || '').slice(0, caret);
    var match = /^\/([^\n\/]{0,30})$/.exec(before);

    return match ? { term: match[1], caret: caret } : null;
  }

  function slashResults(state) {
    var slash = state.slash;
    if (!slash || slash.dismissed || slash.threadId !== state.selectedId) return [];

    var term = slash.term.trim().toLowerCase();

    return SLASH_COMMANDS.filter(function (command) {
      if (command.can && !command.can()) return false;
      if (!term) return true;
      return command.name.toLowerCase().split(/\s+/).some(function (part, i, parts) {
        return parts.slice(i).join(' ').indexOf(term) === 0;
      });
    });
  }

  function renderSlashMenu(state) {
    var results = slashResults(state);
    var index = results.length ? Math.min(state.slash.index || 0, results.length - 1) : 0;

    return (
      '<div class="tma-dash__menu tma-dash__feed-mention-menu" data-key="slash-menu" ' +
      'data-messages-slash-menu role="listbox" aria-label="Commands"' +
      (results.length ? '' : ' hidden') + '>' +
      results.map(function (command, i) {
        var selected = i === index;
        return (
          '<button type="button" class="tma-dash__menu-item' +
          (selected ? ' tma-dash__menu-item--active' : '') + '" ' +
          'data-messages-slash-pick="' + i + '" role="option" aria-selected="' + selected + '">' +
          '<img class="tma-dash__feed-mention-avatar" src="' + esc(ICON + command.icon + '.svg') + '" alt="" width="22" height="22">' +
          '<span class="tma-dash__feed-mention-ident">' +
          '<span class="tma-dash__feed-mention-name">' + esc(command.name) + '</span>' +
          '<span class="tma-dash__feed-mention-meta">' + esc(command.meta) + '</span>' +
          '</span>' +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function syncSlash(state, input, render) {
    var trigger = state.editing || state.recording ? null : slashTrigger(input);

    if (!trigger) {
      if (state.slash) {
        state.slash = null;
        render();
      }
      return;
    }

    var same = state.slash && state.slash.threadId === state.selectedId && state.slash.term === trigger.term;
    if (same) {
      state.slash.caret = trigger.caret;
      return;
    }

    state.slash = {
      threadId: state.selectedId,
      term: trigger.term,
      index: 0,
      caret: trigger.caret,
      dismissed: !!(state.slash && state.slash.dismissed && state.slash.threadId === state.selectedId),
    };
    render();
  }

  function handleSlashKeys(e, root, state, render) {
    var results = slashResults(state);
    if (!results.length) return false;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var step = e.key === 'ArrowDown' ? 1 : -1;
      state.slash.index = ((state.slash.index || 0) + step + results.length) % results.length;
      render();
      return true;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pickSlash(root, state, render, Math.min(state.slash.index || 0, results.length - 1));
      return true;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      state.slash.dismissed = true;
      render();
      return true;
    }

    return false;
  }

  /* Run the command; the "/word" that summoned it goes from the box. */
  function pickSlash(root, state, render, index) {
    var command = slashResults(state)[index];
    if (!command) return;

    var input = root.querySelector('[data-messages-composer-input]');
    if (input) {
      input.textContent = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    state.slash = null;
    render();

    if (command.id === 'request-files') openFileRequestFlow(root, state, render);
  }

  /*
   * "@name" standing on its own: not inside a word or an address, and not
   * the start of a longer word. The character before it is captured rather
   * than looked behind at, which older Safari cannot do.
   */
  function mentionPattern(names, escaped) {
    var alternatives = names
      .slice()
      .sort(function (a, b) { return b.length - a.length; })
      .map(function (name) {
        return (escaped ? esc(name) : String(name)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('|');

    if (!alternatives) return null;

    try {
      return new RegExp('(^|[^\\p{L}\\p{N}_@])@(' + alternatives + ')(?![\\p{L}\\p{N}_])', 'giu');
    } catch (e) {
      return new RegExp('(^|[^A-Za-z0-9_@])@(' + alternatives + ')(?![A-Za-z0-9_])', 'gi');
    }
  }

  /*
   * A message's text, with its links live and the people it names marked.
   *
   * The names are wrapped after escaping and linking, and only in the text
   * between tags and outside a link, so a name can never land inside an
   * attribute or split an address in two.
   */
  function renderMessageText(msg) {
    var names = (msg.mentions || []).map(function (m) { return m.name; });
    if (msg.mentionsAll) names.push(MENTION_EVERYONE);

    var pattern = names.length ? mentionPattern(names, true) : null;

    return formatMessageBody(msg.body, function (text) {
      return inlineMessageHtml(text, pattern);
    });
  }

  /*
   * Bold and italic, written the way people already write them in a chat:
   * *bold* (or **bold**, or __bold__) and _italic_.
   *
   * A mark opens at the start of the text or after a space, an opening
   * bracket or a quote, with a character straight after it, and closes
   * straight after a character and before anything that is not a letter or
   * a digit. That is what leaves 2*3*4, snake_case_name, a correction like
   * *their and the underscores in an address alone: none of them opens after
   * a space and closes before one. MessageText::plain on the server takes
   * the same marks out of one-line previews; keep the two in step.
   */
  var EMPHASIS_LEAD = '(^|[\\s(\\[{"\u201c\u2018\'])';
  var EMPHASIS_BODY = '(\\*\\*|__|\\*|_)(\\S|\\S.*?\\S)\\2';

  function emphasisPattern() {
    try {
      return new RegExp(EMPHASIS_LEAD + EMPHASIS_BODY + '(?![\\p{L}\\p{N}_*])', 'gu');
    } catch (e) {
      return new RegExp(EMPHASIS_LEAD + EMPHASIS_BODY + '(?![A-Za-z0-9_*])', 'g');
    }
  }

  /* The marked stretches of one line, in order. */
  function emphasisRuns(text) {
    var pattern = emphasisPattern();
    var runs = [];
    var match;

    while ((match = pattern.exec(text))) {
      // Marks around nothing but marks are punctuation, not emphasis.
      if (!/[^*_]/.test(match[3])) continue;

      runs.push({
        start: match.index + match[1].length,
        end: match.index + match[0].length,
        tag: match[2] === '_' ? 'em' : 'strong',
        inner: match[3],
      });
    }

    return runs;
  }

  /* The same line with the marks taken out, for a preview that is one plain line. */
  function plainMessageText(text) {
    var plain = String(text == null ? '' : text);

    // Marks can sit inside marks, a level at a time.
    for (var level = 0; level < 3; level++) {
      var next = plain.replace(emphasisPattern(), function (whole, lead, mark, inner) {
        return /[^*_]/.test(inner) ? lead + inner : whole;
      });
      if (next === plain) break;
      plain = next;
    }

    return plain;
  }

  /*
   * One line's worth: bold and italic drawn, links live, and the people it
   * names marked. Emphasis is read from the text before anything is escaped
   * or linked, so a stretch of it can hold a link or a name whole.
   */
  function inlineMessageHtml(text, pattern, depth) {
    text = String(text == null ? '' : text);
    depth = depth || 0;

    var html = '';
    var from = 0;

    (depth < 3 ? emphasisRuns(text) : []).forEach(function (run) {
      html += plainInlineHtml(text.slice(from, run.start), pattern) +
        '<' + run.tag + '>' + inlineMessageHtml(run.inner, pattern, depth + 1) + '</' + run.tag + '>';
      from = run.end;
    });

    return html + plainInlineHtml(text.slice(from), pattern);
  }

  /* Text with no emphasis left in it: links live, names marked. */
  function plainInlineHtml(text, pattern) {
    if (!text) return '';

    var html = linkify(text);
    if (!pattern) return html;

    var inLink = false;

    return html.split(/(<[^>]+>)/).map(function (part) {
      if (part.charAt(0) === '<') {
        if (/^<a\b/i.test(part)) inLink = true;
        else if (/^<\/a>/i.test(part)) inLink = false;
        return part;
      }
      if (inLink) return part;

      return part.replace(pattern, function (whole, lead, name) {
        return lead + '<span class="tma-dash__messages-mention">@' + name + '</span>';
      });
    }).join('');
  }

  /*
   * A message laid out the way it was typed.
   *
   * The lines somebody broke stay broken, a blank line stays a gap, and lines
   * that begin with a bullet or a number are set as a list: the marker in a
   * column of its own and the text beside it, so a long item wraps under its
   * own first word and not under its marker. Bullets that follow a numbered
   * line sit under it, as the points of that heading.
   *
   * Bubbles used to collapse all of it: a message is one inline run, and
   * HTML folds every line break in one into a space. So an announcement
   * written as five numbered sections arrived as a single paragraph with the
   * asterisks left in.
   *
   * The number shown is the number typed. Nothing is renumbered, so a list
   * that starts at 3, or skips, says what its author wrote. And a message of
   * one line is left exactly as it is: "- ok" is somebody talking, not a list.
   *
   * Everything here is a span. The text sits inside a <p>, and a real list
   * or div would close that paragraph the moment the markup was parsed.
   *
   * Their classes are tma-dash__messages-copy-*, after the bubble's text
   * they sit in. They were first called tma-dash__messages-list…, which is
   * the inbox column's own class: the rule that made a message's list a
   * block made the whole column one, and its bar came loose from the bottom.
   */
  var BULLET_LINE = /^([ \t]*)[*\-\u2022\u2013\u2014\u00b7][ \t]+(\S.*)$/;
  var NUMBER_LINE = /^([ \t]*)(\d{1,3}[.)])[ \t]+(\S.*)$/;

  function formatMessageBody(body, inline) {
    var lines = String(body == null ? '' : body).replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    while (lines.length && !lines[0].trim()) lines.shift();

    if (lines.length <= 1) return inline(lines[0] || '');

    var blocks = [];
    // Bullets straight after a numbered line belong to it.
    var underNumber = false;

    lines.forEach(function (line) {
      var last = blocks[blocks.length - 1];

      if (!line.trim()) {
        underNumber = false;
        if (last && last.type !== 'gap') blocks.push({ type: 'gap' });
        return;
      }

      var bullet = BULLET_LINE.exec(line);
      var number = bullet ? null : NUMBER_LINE.exec(line);

      if (bullet || number) {
        var indent = (bullet || number)[1].replace(/\t/g, '  ').length;
        var item = bullet
          ? { mark: '\u2022', text: bullet[2], nested: indent >= 2 || underNumber, bullet: true }
          : { mark: number[2], text: number[3], nested: indent >= 2, bullet: false };

        if (number) underNumber = true;

        if (last && last.type === 'list') last.items.push(item);
        else blocks.push({ type: 'list', items: [item] });
        return;
      }

      underNumber = false;
      if (last && last.type === 'text') last.lines.push(line);
      else blocks.push({ type: 'text', lines: [line] });
    });

    return blocks.map(function (block) {
      if (block.type === 'gap') return '<span class="tma-dash__messages-copy-gap"></span>';

      if (block.type === 'text') return block.lines.map(inline).join('<br>');

      return (
        '<span class="tma-dash__messages-copy-list" role="list">' +
        block.items.map(function (item) {
          return (
            '<span class="tma-dash__messages-copy-item' +
            (item.nested ? ' tma-dash__messages-copy-item--nested' : '') +
            '" role="listitem">' +
            '<span class="tma-dash__messages-copy-mark' +
            (item.bullet ? ' tma-dash__messages-copy-mark--bullet" aria-hidden="true' : '') + '">' +
            esc(item.mark) + '</span>' +
            '<span class="tma-dash__messages-copy-text">' + inline(item.text) + '</span>' +
            '</span>'
          );
        }).join('') +
        '</span>'
      );
    }).join('');
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

  /* How many waiting announcements the chat shows before "N more". */
  var SCHEDULED_SHOWN = 2;

  function scheduledFor(conversationId) {
    return STORE.scheduled[conversationId] || [];
  }

  /*
   * Announcements waiting to go out, above the message box.
   *
   * In the chat, where the person who wrote them is looking, and not only
   * inside the dialog that wrote them: something scheduled and out of sight
   * is something forgotten. It is the reply preview's own row with a Cancel
   * on it. The wrapper is always rendered, keyed and hidden when empty,
   * because it sits before the message box (see the mention menu).
   */
  function renderScheduledStrip(state) {
    var items = scheduledFor(state.selectedId);
    var shown = items.slice(0, SCHEDULED_SHOWN);
    var more = items.length - shown.length;
    var portal = window.TMAPortalUI;

    return (
      '<div class="tma-dash__messages-scheduled-strip" data-key="scheduled-strip" data-messages-scheduled-strip' +
      (items.length && portal ? '' : ' hidden') + '>' +
      (portal
        ? shown.map(function (item) {
            return (
              '<div class="tma-dash__messages-reply-preview" data-key="scheduled-' + esc(item.id) + '">' +
              '<span class="tma-dash__messages-reply-preview-bar" aria-hidden="true"></span>' +
              '<span class="tma-dash__messages-reply-preview-body">' +
              '<span class="tma-dash__messages-reply-preview-label">' +
              esc(item.failed ? 'Not sent' : 'Scheduled for ' + scheduledWhen(item.sendAt)) +
              '</span>' +
              '<span class="tma-dash__messages-reply-preview-text">' +
              esc(item.failed && item.failedReason ? item.failedReason : item.body) +
              '</span></span>' +
              portal.btn({
                label: item.failed ? 'Remove' : 'Cancel',
                variant: 'ghost',
                small: true,
                attrs: ' data-messages-strip-cancel="' + esc(item.id) + '"',
              }) +
              '</div>'
            );
          }).join('') +
          (more > 0
            ? portal.btn({
                label: more + ' more scheduled',
                variant: 'ghost',
                small: true,
                attrs: ' data-messages-strip-all',
              })
            : '')
        : '') +
      '</div>'
    );
  }

  /*
   * Read what is waiting in a group the viewer runs. Asked when the
   * conversation is opened and whenever something could have changed it:
   * one written or withdrawn here, or an announcement arriving, which is
   * what a scheduled one becomes.
   */
  function loadScheduled(root, state, render, conversationId) {
    var row = findThread(conversationId);

    if (!row || row.type !== 'group' || !row.canManage) {
      if (STORE.scheduled[conversationId]) {
        delete STORE.scheduled[conversationId];
        if (state.selectedId === conversationId) render();
      }
      return;
    }

    window.TMAMessagingAPI.scheduled(conversationId)
      .then(function (data) {
        STORE.scheduled[conversationId] = (data && data.scheduled) || [];
        if (state.selectedId === conversationId) render();
      })
      .catch(function () {
        // What is shown stays: a failed refresh is not an empty list.
      });
  }

  /*
   * Times are formatted HERE, from the ISO instant, never taken from the
   * server's pre-formatted string.
   *
   * A message fans out to everyone in the conversation at once, so no single
   * server-rendered clock time can be right for all of them, it used to be
   * rendered in the app's zone (UTC), which is nobody's. toLocale* honours
   * the reader's zone, and i18n.js redirects it to a manually chosen zone
   * and language. The server's string stays as the fallback for any payload
   * that predates the ISO field.
   */
  function clockTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  /* Chat-list stamps compress with age, judged on the READER's calendar day
     (toLocaleDateString resolves in the display zone, so a message sent at
     23:30 UTC is "Yesterday" only if it is yesterday where you are). */
  function listTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';

    var now = new Date();
    var day = d.toLocaleDateString();
    if (day === now.toLocaleDateString()) return clockTime(iso);

    var yesterday = new Date(now.getTime() - 86400000);
    if (day === yesterday.toLocaleDateString()) return 'Yesterday';

    var sameYear = d.toLocaleDateString(undefined, { year: 'numeric' }) ===
      now.toLocaleDateString(undefined, { year: 'numeric' });

    return d.toLocaleDateString(undefined, sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function resolveMessageTime(msg, row) {
    if (msg && msg.sentAt) return clockTime(msg.sentAt) || msg.time || '';
    if (msg && msg.time) return msg.time;
    if (row && row.timestamp) return listTime(row.timestamp) || row.time || '';
    if (row && row.time) return row.time;
    return '';
  }

  function messageDeliveryState(msg) {
    return msg.failed ? 'failed' : msg.queued ? 'queued' : msg.pending ? 'pending' : msg.status || 'sent';
  }

  /*
   * Sender-side only, an incoming message never carries a delivery state.
   *
   * The words replace the pair of nested ticks messengers usually draw: one
   * tick versus two is a convention you have to be taught, and it is read
   * wrong as often as it is read right. The label says what happened.
   *
   *   pending    the optimistic bubble, not yet confirmed by the server
   *   sent       stored, but nobody's client has acknowledged it
   *   delivered  every other participant's client has it
   *   read       drawn *outside* the bubble instead, see renderBubbleReceipt
   *   failed     the send errored and can be retried
   */
  function renderBubbleStatus(msg) {
    if (msg.direction !== 'out') return '';

    var state = messageDeliveryState(msg);

    // Faces under the bubble already say who has seen it.
    if (state === 'read' || (msg.seenBy && msg.seenBy.length)) return '';

    var label = {
      pending: 'Sending',
      // Kept on this device until there is a connection, then sent.
      queued: 'Waiting to send',
      failed: 'Not sent',
      sent: 'Sent',
      delivered: 'Delivered',
    }[state] || 'Sent';

    var title = state === 'failed'
      ? 'Not sent, tap to retry'
      : state === 'queued' ? 'Saved on this device. It sends when you are back online.' : label;

    return (
      '<span class="tma-dash__messages-bubble-status tma-dash__messages-bubble-status--' + state +
      '" title="' + esc(title) + '">' +
      esc(label) +
      '</span>'
    );
  }

  /*
   * "Seen", under the bubble and outside it, the way iMessage and Teams both
   * place it.
   *
   * A person appears once, under the newest message they have read. Everything
   * above that has been read too, so repeating their face on each bubble would
   * say the same thing once per message.
   */
  function receiptSeenTitle(person) {
    var when = '';
    if (person.seenAt) {
      var d = new Date(person.seenAt);
      if (!isNaN(d.getTime())) {
        when = d.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
      }
    }
    return (person.name || 'Someone') + (when ? ' · Seen ' + when : ' · Seen');
  }

  function renderReceiptFace(person) {
    var title = receiptSeenTitle(person);
    if (person.avatar) {
      return (
        '<span class="tma-dash__messages-bubble-receipt-face" title="' + esc(title) + '">' +
        '<img src="' + esc(person.avatar) + '" alt="" loading="lazy"></span>'
      );
    }
    return (
      '<span class="tma-dash__messages-bubble-receipt-face tma-dash__messages-bubble-receipt-face--initial ' +
      'tma-dash__messages-row-avatar--' + initialColourFor(person.name) +
      '" title="' + esc(title) + '">' +
      esc(initialsFor(person.name)) +
      '</span>'
    );
  }

  function renderReceiptFaces(people) {
    var list = (people || []).filter(function (person) {
      return person && (person.name || person.avatar);
    });
    if (!list.length) return '';
    return (
      '<div class="tma-dash__messages-bubble-receipt" aria-label="' +
      esc(list.map(receiptSeenTitle).join(', ')) + '">' +
      list.map(renderReceiptFace).join('') +
      '</div>'
    );
  }

  function renderBubbleReceipt(msg, opts) {
    opts = opts || {};
    var faces = renderReceiptFaces(opts.receiptPeople || []);
    if (faces) return faces;

    if (!opts.showReceipt || msg.direction !== 'out') return '';
    if (messageDeliveryState(msg) !== 'read') return '';

    return (
      '<div class="tma-dash__messages-bubble-receipt">' +
      renderMessagesIcon('Eye') +
      '<span>Seen</span>' +
      '</div>'
    );
  }

  /*
   * Who a bubble's photo belongs to.
   *
   * The message carries its own sender, but not every message has one, a
   * system line has no author, and older or optimistically-rendered rows can
   * reach the renderer before the server has filled it in. The conversation
   * always knows: a direct chat *is* the other person, and a group lists its
   * members. Falling through to it is what stops an unresolved sender being
   * drawn as a "?" tile.
   */
  function bubbleAvatarPerson(msg, row) {
    var sender = msg.sender || {};
    var thread = resolveThread(row);
    var member = null;

    if (sender.id != null) {
      member = (thread.members || []).filter(function (m) {
        return m.id === sender.id;
      })[0];
    }

    // A direct conversation only has one other person in it, so its own photo
    // and name are that person's, the same ones the inbox row shows.
    var direct = isDirectThread(thread) ? thread : {};

    return {
      name: sender.name || (member && member.name) || direct.name || '',
      photo: sender.photo || (member && member.photo) || direct.photo || '',
    };
  }

  /*
   * The sender's photo beside their bubble.
   *
   * It sits on the *last* bubble of a run, next to the message that finished
   * the thought, and the earlier bubbles in that run keep an empty slot of the
   * same width so the whole run stays in one column, which is how WhatsApp
   * and Teams both draw a group of messages from one person.
   *
   * `side` is the side the bubble is *drawn* on, which is not always
   * `msg.direction`: a call you placed is written by whichever client logged
   * it, so an outgoing call can arrive as an incoming row. The photo has to
   * follow the bubble, or your own call ends up wearing the other person's
   * face.
   */
  function renderBubbleAvatar(msg, row, side, show) {
    if (side === 'out') return '';

    var person = show ? bubbleAvatarPerson(msg, row) : null;

    // An empty slot rather than a placeholder: nobody wants a wall of "?".
    if (!person || (!person.photo && !person.name)) {
      return (
        '<span class="tma-dash__messages-bubble-avatar tma-dash__messages-bubble-avatar--blank"' +
        ' aria-hidden="true"></span>'
      );
    }

    if (person.photo) {
      return (
        '<span class="tma-dash__messages-bubble-avatar" title="' + esc(person.name) + '">' +
        '<img src="' + esc(person.photo) + '" alt="" loading="lazy"></span>'
      );
    }

    return (
      '<span class="tma-dash__messages-bubble-avatar tma-dash__messages-bubble-avatar--initial ' +
      'tma-dash__messages-row-avatar--' + initialColourFor(person.name) +
      '" title="' + esc(person.name) + '">' +
      esc(initialsFor(person.name)) +
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

    // A private reply quotes what was said in a group, and says which.
    var from = quoted.from && quoted.from.id ? quoted.from : null;

    return (
      '<button type="button" class="tma-dash__messages-bubble-quote" data-messages-jump="' +
      esc(quoted.id) +
      '"' +
      (from
        ? ' data-messages-jump-in="' + esc(from.id) + '" data-messages-jump-seq="' + esc(quoted.seq || '') + '"'
        : '') +
      '>' +
      '<span class="tma-dash__messages-bubble-quote-bar" aria-hidden="true"></span>' +
      '<span class="tma-dash__messages-bubble-quote-body">' +
      '<span class="tma-dash__messages-bubble-quote-name">' +
      esc(quoted.senderName) +
      (from && from.name ? ' · ' + esc(from.name) : '') +
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
      // The favicon comes from Google's lookup service, which 404s for any
      // domain it has no icon for, a broken image plus a console error on a
      // perfectly good link. Removing itself on error leaves just the domain
      // name, which is all the favicon was decorating anyway.
      (card.faviconUrl
        ? '<img class="tma-dash__messages-link-favicon" src="' + esc(card.faviconUrl) + '" alt=""' +
          ' onerror="this.remove()">'
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
   * Waits for the URL to look finished, a trailing space, or a short pause —
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
   * icon plus name and size, the File Library's icons, not a second set.
   * ---------------------------------------------------------------- */

  /* Where a file came down from, as a download rather than a tab. */
  function attachmentDownloadUrl(attachment) {
    var url = (attachment && attachment.url) || '';
    if (!url) return '';

    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'download=1';
  }

  function renderAttachment(msg, attachment) {
    // Every kind carries its id, so a right-click on it can offer that file's
    // Download and Save to Application Folder — videos and audio included,
    // which play in place and have no "open" of their own.
    var open = ' data-messages-attachment="' + esc(attachment.id) + '" data-messages-attachment-id="' + esc(attachment.id) + '"';
    var tag = ' data-messages-attachment-id="' + esc(attachment.id) + '"';

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
        '<div class="tma-dash__messages-attachment tma-dash__messages-attachment--video"' + tag + '>' +
        '<video src="' + esc(attachment.url) + '" controls preload="metadata" playsinline></video>' +
        '</div>'
      );
    }

    if (attachment.kind === 'voice') {
      return renderVoiceNote(msg, attachment);
    }

    if (attachment.kind === 'audio') {
      return (
        '<div class="tma-dash__messages-attachment tma-dash__messages-attachment--audio"' + tag + '>' +
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
          downloadUrl: attachmentDownloadUrl(a),
          saveAttachment: { kind: 'messaging', id: a.id },
        });
      });
    });

    if (all.length) window.TMAPortalLightbox.open(all, index);
  }

  /* A day separator, inserted between messages sent on different dates. */
  function renderDayDivider(label) {
    return '<div class="tma-dash__messages-divider">' + esc(label) + '</div>';
  }

  var CALL_EVENTS = ['call_started', 'call_ended', 'call_missed'];

  function isCallMessage(msg) {
    var event = (msg.systemEvent || {}).event;
    return CALL_EVENTS.indexOf(event) !== -1;
  }

  /*
   * A call is a message, not an announcement.
   *
   * Calls are stored as system lines, so they used to render as the same
   * centred pill as "Ana added Ben", a column of identical grey lozenges that
   * said nothing about who called whom, and read as chrome rather than as part
   * of the conversation. They get a bubble on the caller's side instead.
   *
   * The wording, the direction arrow and its colours are the call log's, reused
   * verbatim, so an entry means the same thing in both places.
   */
  function renderCallMessage(msg, row) {
    var event = msg.systemEvent || {};
    var outgoing = isOutgoingCall(event);
    var missed = event.event === 'call_missed';
    var video = event.media === 'video';
    var side = outgoing ? 'out' : 'in';
    var dir, stateLabel;

    if (missed) {
      dir = outgoing ? 'out-missed' : 'in-missed';
      stateLabel = outgoing ? 'No answer' : 'Missed';
    } else if (event.event === 'call_started') {
      dir = outgoing ? 'out' : 'in';
      stateLabel = 'Ongoing';
    } else {
      dir = outgoing ? 'out' : 'in';
      stateLabel = outgoing ? 'Outgoing' : 'Incoming';
    }

    var time = resolveMessageTime(msg, row);

    return (
      '<div class="tma-dash__messages-bubble-row tma-dash__messages-bubble-row--' + side +
      '" data-messages-id="' + esc(msg.id) + '">' +
      // A call is always its own run, so an incoming one always carries the
      // caller's photo, which keeps it in the same column as the bubbles
      // around it. One you placed sits on your side and carries none, exactly
      // like every other message of yours.
      renderBubbleAvatar(msg, row, side, true) +
      '<div class="tma-dash__messages-bubble-main">' +
      '<div class="tma-dash__messages-bubble tma-dash__messages-bubble--' + side +
      ' tma-dash__messages-bubble--call' + (missed ? ' tma-dash__messages-bubble--call-missed' : '') + '">' +
      '<span class="tma-dash__messages-call-icon">' +
      renderMessagesIcon(video ? 'VideoCamera' : 'Phone') +
      '</span>' +
      '<span class="tma-dash__messages-call-body">' +
      '<span class="tma-dash__messages-call-label">' +
      esc(video ? 'Video call' : 'Voice call') +
      '</span>' +
      '<span class="tma-dash__messages-call-meta">' +
      '<span class="tma-dash__call-dir tma-dash__call-dir--' + dir + '" aria-hidden="true"></span>' +
      esc(time ? stateLabel + ' · ' + time : stateLabel) +
      '</span></span></div></div></div>'
    );
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
      case 'case_opened':
        return actor + ' opened a conversation about ' + (event.clientName || 'this applicant') +
          ' with ' + (event.companyName || 'the service provider');
      case 'member_added': return actor + ' added ' + subject;
      case 'member_removed': return actor + ' removed ' + subject;
      case 'member_left': return actor + ' left';
      case 'admin_granted': return actor + ' made ' + subject + ' an administrator';
      case 'admin_revoked': return actor + ' removed ' + subject + ' as administrator';
      case 'name_changed': return actor + ' changed the group name to "' + (event.name || '') + '"';
      case 'photo_changed': return actor + ' changed the group photo';
      case 'call_started': return (event.label || 'Call') + ' started';
      case 'call_ended': return (event.label || 'Call') + ' ended';
      case 'call_missed': return 'Missed ' + ((event.label || 'call').toLowerCase());
      default: return msg.body || 'Conversation updated';
    }
  }

  function renderBubble(msg, index, isReplyTarget, row, opts, render) {
    if (msg.type === 'system') {
      return isCallMessage(msg) ? renderCallMessage(msg, row) : renderSystemMessage(msg);
    }

    var showSender = opts.showSender;

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
    } else if (msg.type === 'file_request' && msg.fileRequest) {
      // "/" Request files: the request is the message. Its time sits under
      // the card the way it sits under a file-only bubble.
      inner =
        renderFileRequestCard(msg) +
        '<div class="tma-dash__messages-bubble-text tma-dash__messages-bubble-text--meta">' +
        '<p class="tma-dash__messages-bubble-line">' + timeHtml + '</p></div>';
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
       * isn't, which is how every messenger behaves, and the zero-width
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
          ? '<span class="tma-dash__messages-bubble-copy">' + renderMessageText(msg) + '</span>'
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
     * The photo sits beside the bubble; the bubble, its reactions and its read
     * receipt stack beneath it.
     *
     * The action tools are *not* part of this: they are pinned over the top
     * edge of the message and live outside the swipe wrapper, which clips its
     * overflow so the bubble can slide under the reply icon.
     */
    // Marked for the whole group by one of its admins.
    var announcementHtml =
      msg.announcement && !msg.deleted
        ? '<span class="tma-dash__messages-bubble-announcement">' +
          '<span class="tma-dash__messages-bubble-announcement-icon" aria-hidden="true"></span>' +
          'Announcement</span>'
        : '';

    var laneHtml =
      row && row.caseFile && msg.lane && !msg.deleted
        ? '<span class="tma-dash__messages-bubble-lane">' +
          (msg.lane === 'internal' ? 'Internal' : 'Service provider') +
          '</span>'
        : '';

    // Passed on from another conversation by whoever sent it here.
    var forwardedHtml =
      msg.forwarded && !msg.deleted
        ? '<span class="tma-dash__messages-bubble-forwarded">' +
          '<span class="tma-dash__messages-bubble-forwarded-icon" aria-hidden="true"></span>' +
          'Forwarded</span>'
        : '';

    var bubble =
      renderBubbleAvatar(msg, row, side, opts.showAvatar) +
      '<div class="tma-dash__messages-bubble-main">' +
      '<div class="tma-dash__messages-bubble tma-dash__messages-bubble--' + side +
      bubbleExtraClass +
      (announcementHtml ? ' tma-dash__messages-bubble--announcement' : '') +
      (isReplyTarget ? ' tma-dash__messages-bubble--reply-target' : '') +
      (msg.failed ? ' tma-dash__messages-bubble--failed' : '') +
      (msg.pending || msg.queued ? ' tma-dash__messages-bubble--pending' : '') +
      '">' +
      senderHtml +
      laneHtml +
      announcementHtml +
      forwardedHtml +
      renderQuotedReply(msg) +
      inner +
      '</div>' +
      renderReactions(msg) +
      renderBubbleReceipt(msg, opts) +
      '</div>';

    return (
      '<div class="tma-dash__messages-bubble-row tma-dash__messages-bubble-row--' +
      side +
      (opts.selecting ? ' is-selecting' : '') +
      '" data-messages-swipe="' +
      side +
      '" data-messages-index="' +
      index +
      /*
       * This is the bubble's reconciliation key (TMAMorph reads data-*-id), so
       * it has to stay identical for a given message across every render.
       *
       * Do not be tempted to key on the send nonce to keep the optimistic
       * bubble and its confirmed replacement as one node: the nonce is only
       * attached client-side when the send resolves, and a later refetch of the
       * thread returns the same message *without* it. The key would then
       * alternate between the nonce and the id from one render to the next,
       * rebuilding the bubble each time and closing any menu open on it.
       *
       * Confirming a send therefore replaces the bubble once, which is the same
       * as it has always been, and every render after that reuses it.
       */
      '" data-messages-id="' +
      esc(msg.id) +
      '">' +
      renderSwipeTrack(bubble, side) +
      renderBubbleActions(msg, index) +
      '</div>'
    );
  }

  /* Hover actions on a bubble: quick reacts, edit/reply, and the overflow menu. */
  function renderBubbleActions(msg, index) {
    if (msg.deleted || msg.pending || msg.queued) return '';
    var quick = (emojiData().quick || []).slice(0, 4);
    var mine = (msg.reactions || [])
      .filter(function (r) { return r.mine; })
      .map(function (r) { return r.emoji; });
    var canEdit = !!(msg.can && msg.can.edit);

    return (
      '<div class="tma-dash__messages-bubble-actions" role="toolbar" aria-label="Message actions">' +
      quick
        .map(function (char) {
          return (
            '<button type="button" class="tma-dash__messages-icon-btn tma-dash__messages-bubble-action tma-dash__messages-bubble-action--emoji' +
            (mine.indexOf(char) !== -1 ? ' is-mine' : '') +
            '" data-messages-quick-react="' + esc(msg.id) + '" data-messages-quick-emoji="' + esc(char) + '"' +
            ' aria-label="React with ' + esc(char) + '">' + esc(char) + '</button>'
          );
        })
        .join('') +
      '<button type="button" class="tma-dash__messages-icon-btn tma-dash__messages-bubble-action" ' +
      'data-messages-react-open="' + esc(msg.id) + '" aria-label="More reactions">+</button>' +
      '<span class="tma-dash__messages-bubble-action-sep" aria-hidden="true"></span>' +
      (canEdit
        ? '<button type="button" class="tma-dash__messages-icon-btn tma-dash__messages-bubble-action" ' +
          'data-messages-edit="' + esc(msg.id) + '" aria-label="Edit message">' +
          '<img src="' + ICONS.PencilSimple + '" alt="" width="16" height="16">' +
          '</button>'
        : '') +
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

  /* The stored key. The branded wallpaper ('tma') used to be the default;
   * it was retired for a plain light surface, so both "not chosen yet" and
   * any stored choice of it resolve to plain rather than resurrecting the
   * pattern. */
  function chatBackgroundKey() {
    var key = '';
    try { key = localStorage.getItem('tma.messages.chatBg') || ''; } catch (e) { /* ignore */ }
    return !key || key === 'tma' ? 'plain' : key;
  }

  function chatBackgroundClass() {
    var key = chatBackgroundKey();
    /* "Plain" is the absence of a background class, not a class of its own. */
    return key === 'plain' ? '' : ' tma-dash__messages-chat-body--bg-' + key;
  }

  function getInboxUnreadCount(state) {
    return getVisibleThreads(state || {}).reduce(function (total, row) {
      return total + (row.unread || 0);
    }, 0);
  }

  /*
   * Missed calls, for the badges outside this page.
   *
   * A missed call is deliberately *not* an unread message server-side, it has
   * no read state of its own, and counting system lines put a badge on threads
   * nobody had written in (see ConversationParticipant::unreadCount). But the
   * sidebar badge answers a broader question than the Chats one: "what is
   * waiting for me in Messages". A call nobody picked up is waiting there as
   * much as an unread message is, so it belongs in that number.
   */
  function getMissedCallCount() {
    return (STORE.tabCounts || {}).calls || 0;
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
   * a progress bar, a remove button and a retry possible, and it means a
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
          // lands, so an image previews immediately rather than after the round trip.
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
   * still sends immediately either way, nothing here blocks sending.
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
    // bar chart, just a flat one, better than an empty gap.
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
      // Category strip is hidden while searching, the results span categories.
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

  function caseLane(state, conversationId) {
    if (!state.caseLaneById) state.caseLaneById = {};
    return state.caseLaneById[conversationId] || 'internal';
  }

  function renderCaseLanes(state) {
    var thread = state.selectedId ? findThread(state.selectedId) : null;
    if (!thread || !thread.caseFile || state.editing || state.recording) return '';

    // The two choices name who reads the message; Messages carries no line
    // under them spelling it out (the application's own thread still does).
    var lane = caseLane(state, state.selectedId);

    function option(value, label) {
      return (
        '<label class="tma-portal-radio">' +
        '<input type="radio" name="messages-case-lane" value="' + value + '" data-messages-case-lane' +
        (lane === value ? ' checked' : '') + '>' +
        '<span class="tma-portal-radio__dot" aria-hidden="true"></span> ' + label +
        '</label>'
      );
    }

    return (
      '<div class="tma-dash__messages-composer-lanes">' +
      '<div class="tma-portal-radio-row" role="radiogroup" aria-label="Who this message is for">' +
      option('internal', 'Internal') +
      option('provider', 'Service provider') +
      '</div>' +
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
      renderCaseLanes(state) +
      renderMentionMenu(state) +
      renderSlashMenu(state) +
      renderEmojiPicker(state) +
      (editing
        ? '<div class="tma-dash__messages-composer-editing">Editing message, press Escape to cancel</div>'
        : '') +
      renderComposerLinkPreview(state) +
      renderComposerAttachments(state) +
      // Recording replaces the input row entirely, there is nothing else to
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

  /*
   * What is in the message box, as text.
   *
   * The box is contenteditable, which holds a typed line break as a <br> or
   * as a new <div>, depending on the key and the browser. textContent reads
   * straight through both, so two lines typed with Shift+Enter were sent as
   * one, without so much as a space between them. Only pasted text kept its
   * breaks, because that goes in as text with the newlines in it.
   */
  function composerPlainText(input) {
    if (!input) return '';
    var out = '';

    (function walk(node) {
      for (var child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          out += child.data;
          continue;
        }
        if (child.nodeType !== 1) continue;

        if (child.tagName === 'BR') {
          out += '\n';
          continue;
        }

        // A block starts on a line of its own and ends one.
        var block = /^(DIV|P|LI)$/.test(child.tagName);
        if (block && out && out.charAt(out.length - 1) !== '\n') out += '\n';
        walk(child);
        if (block && out.charAt(out.length - 1) !== '\n') out += '\n';
      }
    })(input);

    return out;
  }

  /* Cmd/Ctrl+B is bold and Cmd/Ctrl+I is italic; anything else is null. */
  function emphasisKey(e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null;
    var key = String(e.key || '').toLowerCase();
    if (key === 'b') return '*';
    if (key === 'i') return '_';
    return null;
  }

  /*
   * Put the marks for bold or italic round what is selected in the message
   * box, or an empty pair to type into.
   *
   * Left to the browser, Cmd+B makes the text in the box bold and nothing
   * more: the box is read as plain text, so the message looked styled while
   * it was written and went out plain. The marks are what the message is
   * read by, so they are what the key types.
   */
  function wrapComposerSelection(input, mark) {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    var range = selection.getRangeAt(0);
    if (!input.contains(range.commonAncestorContainer)) return;

    var caret = document.createRange();

    if (range.collapsed) {
      var pair = document.createTextNode(mark + mark);
      range.insertNode(pair);
      caret.setStart(pair, mark.length);
    } else {
      // The closing mark first: adding the opening one moves nothing after it.
      var close = document.createTextNode(mark);
      var end = range.cloneRange();
      end.collapse(false);
      end.insertNode(close);

      var start = range.cloneRange();
      start.collapse(true);
      start.insertNode(document.createTextNode(mark));

      caret.setStartAfter(close);
    }

    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* The same two keys in a dialog's text field (an announcement, a caption). */
  function bindEmphasisKeys(field) {
    if (!field) return;

    field.addEventListener('keydown', function (e) {
      var mark = emphasisKey(e);
      if (!mark) return;

      e.preventDefault();
      e.stopPropagation();

      var start = field.selectionStart;
      var end = field.selectionEnd;
      var picked = field.value.slice(start, end);

      field.setRangeText(mark + picked + mark, start, end, 'end');
      // Nothing selected: leave the caret between the pair.
      if (!picked) field.setSelectionRange(start + mark.length, start + mark.length);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
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

    composer.querySelectorAll('[data-messages-case-lane]').forEach(function (laneInput) {
      MORPH.on(laneInput, 'change', function () {
        if (!state.selectedId) return;
        if (!state.caseLaneById) state.caseLaneById = {};
        state.caseLaneById[state.selectedId] = laneInput.value;
      });
    });

    if (input) {
      syncComposerInputState(input);

      MORPH.on(input, 'input', function () {
        var text = composerPlainText(input);
        setComposerDraft(state, text);
        syncComposerInputState(input);

        // Keep the list row's "Draft:" preview in step without a re-render,
        // which would move the caret out from under the user.
        var row = findThread(state.selectedId);
        if (row && !state.editing) row.draft = text.trim() ? text : null;

        if (state.selectedId && !state.editing) scheduleDraftSave(state.selectedId, text);

        // Emptying the box is stopping, not typing, otherwise clearing a
        // draft leaves the other side watching a phantom.
        if (state.selectedId && !state.editing) {
          if (text.trim()) {
            announceTyping(state.selectedId);
          } else {
            stopTyping();
          }
        }

        // Look up a preview for the first link as it is typed. Debounced with
        // the draft save so a half-typed URL isn't fetched on every keystroke.
        scheduleLinkPreview(state, text, render);

        syncMention(state, input, render);
        syncSlash(state, input, render);
      });

      // The caret can leave an "@term" without anything being typed.
      MORPH.on(input, 'keyup', function (e) {
        if (/^(Arrow(Left|Right)|Home|End)$/.test(e.key)) {
          syncMention(state, input, render);
          syncSlash(state, input, render);
        }
      });
      MORPH.on(input, 'click', function () {
        syncMention(state, input, render);
        syncSlash(state, input, render);
      });

      MORPH.on(input, 'keydown', function (e) {
        // The lists take their keys first: Enter picks, it does not send.
        if (handleSlashKeys(e, root, state, render)) return;
        if (handleMentionKeys(e, root, state, render)) return;

        if (e.key === 'Escape' && state.editing) {
          e.preventDefault();
          state.editing = null;
          setComposerDraft(state, '');
          render();
          return;
        }

        var mark = emphasisKey(e);
        if (mark) {
          e.preventDefault();
          e.stopPropagation();
          wrapComposerSelection(input, mark);
          return;
        }

        if (e.key !== 'Enter') return;
        // The keyboard is still composing a word (predictive text, IME): this
        // Enter accepts it, it is not a send.
        if (e.isComposing) return;

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
      MORPH.on(input, 'paste', function (e) {
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
     * recently used emoji above all, and simply flipping `hidden` showed
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
      MORPH.on(emojiBtn, 'click', function (e) {
        e.stopPropagation();
        toggleEmojiPicker();
      });
    }

    if (picker) {
      // Inserting keeps the picker open, people usually add more than one —
      // and remembers the choice for the Recent tab.
      MORPH.unwired(picker, '[data-messages-emoji-char]').forEach(function (btn) {
        MORPH.on(btn, 'click', function (e) {
          e.stopPropagation();
          var char = btn.getAttribute('data-messages-emoji-char');
          rememberEmoji(char);
          insertComposerText(input, char);
        });
      });

      var emojiSearch = picker.querySelector('[data-messages-emoji-search]');
      if (emojiSearch) {
        MORPH.on(emojiSearch, 'click', function (e) {
          e.stopPropagation();
        });
        MORPH.on(emojiSearch, 'input', function () {
          state.emojiSearch = emojiSearch.value;
          render();
        });
      }

      MORPH.unwired(picker, '[data-messages-emoji-category]').forEach(function (tab) {
        MORPH.on(tab, 'click', function (e) {
          e.stopPropagation();
          state.emojiCategory = tab.getAttribute('data-messages-emoji-category');
          state.emojiSearch = '';
          render();
        });
      });
    }

    MORPH.unwired(composer, '[data-messages-slash-pick]').forEach(function (btn) {
      MORPH.on(btn, 'mousedown', function (e) { e.preventDefault(); });
      MORPH.on(btn, 'click', function (e) {
        e.stopPropagation();
        pickSlash(root, state, render, parseInt(btn.getAttribute('data-messages-slash-pick'), 10));
      });
    });

    MORPH.unwired(composer, '[data-messages-mention-pick]').forEach(function (btn) {
      // Not letting the press take focus is what keeps the caret where the
      // name is about to go.
      MORPH.on(btn, 'mousedown', function (e) { e.preventDefault(); });
      MORPH.on(btn, 'click', function (e) {
        e.stopPropagation();
        pickMention(root, state, parseInt(btn.getAttribute('data-messages-mention-pick'), 10));
      });
    });

    var attachBtn = composer.querySelector('[data-messages-composer-attach]');
    var fileInput = composer.querySelector('[data-messages-composer-file]');

    if (attachBtn && fileInput) {
      MORPH.on(attachBtn, 'click', function () {
        fileInput.click();
      });
      MORPH.on(fileInput, 'change', function () {
        queueFiles(root, state, render, fileInput.files);
        // Reset so choosing the same file twice still fires a change event.
        fileInput.value = '';
      });
    }

    var linkDismiss = composer.querySelector('[data-messages-link-dismiss]');
    if (linkDismiss) {
      MORPH.on(linkDismiss, 'click', function () {
        state.composerLinkDismissed = state.composerLinkUrl;
        render();
      });
    }

    MORPH.unwired(composer, '[data-messages-tray-remove]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        removeAttachment(root, state, render, btn.getAttribute('data-messages-tray-remove'));
      });
    });

    MORPH.unwired(composer, '[data-messages-tray-retry]').forEach(function (btn) {
      MORPH.on(btn, 'click', function () {
        var id = btn.getAttribute('data-messages-tray-retry');
        pendingAttachments(state).forEach(function (item) {
          if (item.localId === id) startUpload(root, state, render, item);
        });
        render();
      });
    });

    var voiceBtn = composer.querySelector('[data-messages-composer-voice]');
    if (voiceBtn) {
      MORPH.on(voiceBtn, 'click', function () {
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
      if (el) MORPH.on(el, 'click', pair[1]);
    });

    if (sendBtn) {
      MORPH.on(sendBtn, 'click', function () {
        var text = input ? composerPlainText(input).trim() : getComposerDraft(state).trim();

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

    // The Upload buttons on a "Requested files" card. Caught on the way down,
    // so a tap on one is not also a tap (or a hold) on its bubble.
    if (!root._chatRequestBound) {
      root._chatRequestBound = true;
      root.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest && e.target.closest('[data-chatreq-upload]');
        if (!btn || !root.contains(btn) || btn.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        uploadRequestedFiles(
          root, state, render,
          btn.getAttribute('data-chatreq-upload'),
          btn.getAttribute('data-chatreq-doc'),
          btn.hasAttribute('data-chatreq-multiple')
        );
      }, true);
    }

    if (!root._messagesComposerDocBound) {
      root._messagesComposerDocBound = true;
      document.addEventListener('click', function (e) {
        var activeComposer = root.querySelector('.tma-dash__messages-composer');
        if (activeComposer && activeComposer.contains(e.target)) return;

        if (state.mention) {
          state.mention = null;
          var menu = root.querySelector('[data-messages-mention-menu]');
          if (menu) menu.hidden = true;
        }
        if (state.slash) {
          state.slash = null;
          var slashMenu = root.querySelector('[data-messages-slash-menu]');
          if (slashMenu) slashMenu.hidden = true;
        }

        if (!state.emojiPickerOpen) return;
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

  /*
   * One face per reader, on the furthest message they have opened.
   *
   * The payload still lists them on every message the cursor passed. Drawing
   * that list as it arrives would put the same person under each bubble.
   */
  function latestReadReceipts(messages) {
    var furthest = Object.create(null);

    messages.forEach(function (msg, index) {
      (msg.seenBy || []).forEach(function (person) {
        if (!person || (!person.name && !person.avatar)) return;
        var key = person.id != null ? 'id:' + person.id : 'name:' + (person.name || '');
        var current = furthest[key];
        if (!current || index >= current.index) {
          furthest[key] = { index: index, person: person };
        }
      });
    });

    var byIndex = Object.create(null);
    Object.keys(furthest).forEach(function (key) {
      var entry = furthest[key];
      if (!byIndex[entry.index]) byIndex[entry.index] = [];
      byIndex[entry.index].push(entry.person);
    });

    Object.keys(byIndex).forEach(function (index) {
      byIndex[index].sort(function (a, b) {
        return String(a.seenAt || '').localeCompare(String(b.seenAt || ''));
      });
    });

    return byIndex;
  }

  function renderChatBody(state, row, render) {
    var bucket = threadBucket(state.selectedId);
    var messages = bucket.messages;

    if (!bucket.loaded && !messages.length) {
      return renderChatSkeleton();
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

    /*
     * Each reader is drawn once, on the newest message their cursor covers.
     * The word "Seen" is only the fallback for a fully-read outgoing bubble
     * that names nobody, and only when no later bubble already carries faces.
     */
    var receiptByIndex = latestReadReceipts(messages);
    var seenIndex = -1;
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction === 'out' && messageDeliveryState(messages[i]) === 'read') {
        seenIndex = i;
        break;
      }
    }
    var seenHasLaterFaces = false;
    if (seenIndex >= 0) {
      for (var j = seenIndex + 1; j < messages.length; j++) {
        if (receiptByIndex[j] && receiptByIndex[j].length) {
          seenHasLaterFaces = true;
          break;
        }
      }
    }

    var html = '';
    messages.forEach(function (msg, index) {
      var previous = messages[index - 1];
      var next = messages[index + 1];

      if (!previous || !sameDay(previous.sentAt, msg.sentAt)) {
        html += renderDayDivider(dayLabel(msg.sentAt));
      }

      var startsRun =
        !previous ||
        previous.type === 'system' ||
        previous.direction !== msg.direction ||
        !previous.sender ||
        !msg.sender ||
        previous.sender.id !== msg.sender.id ||
        !sameDay(previous.sentAt, msg.sentAt);

      // The photo goes on the bubble that *ends* a run, so it lines up with
      // the last thing the person said rather than the first.
      var endsRun =
        !next ||
        next.type === 'system' ||
        next.direction !== msg.direction ||
        !next.sender ||
        !msg.sender ||
        next.sender.id !== msg.sender.id ||
        !sameDay(msg.sentAt, next.sentAt);

      html += renderBubble(msg, index, replyId === msg.id, row, {
        // Only label the first bubble of a run by the same sender.
        showSender: isGroup && msg.direction === 'in' && startsRun,
        showAvatar: msg.direction === 'in' && endsRun,
        showReceipt: index === seenIndex && !seenHasLaterFaces,
        receiptPeople: receiptByIndex[index] || [],
        selecting: isTextSelecting(state, msg.id),
      }, render);
    });

    return head + html;
  }

  /* ------------------------------------------------------------------
   * Conversation profile
   *
   * Replaces the conversation *inside* the chat column, the inbox stays put
   * and the scroll position with it. Deliberately separate from the client
   * record: this is the messaging profile, and "Open client record" is an
   * explicit, permissioned action rather than what a name click does.
   * ---------------------------------------------------------------- */

  function renderProfileRow(label, value) {
    if (!value) return '';
    return (
      '<div class="tma-dash__messages-profile-row">' +
      '<span class="tma-dash__messages-profile-label">' + esc(label) + '</span>' +
      '<span class="tma-dash__messages-profile-value">' + esc(value) + '</span>' +
      '</div>'
    );
  }

  function renderGalleryItems(state) {
    var shelf = state.profileShelf || 'media';
    var items = (state.profileGallery && state.profileGallery[shelf]) || null;

    if (!items) {
      return '<div class="tma-dash__messages-list-state" role="status">Loading…</div>';
    }

    if (!items.length) {
      return (
        '<div class="tma-dash__messages-list-state">' +
        (shelf === 'media' ? 'No photos or videos yet.'
          : shelf === 'documents' ? 'No documents yet.'
          : 'No links yet.') +
        '</div>'
      );
    }

    if (shelf === 'media') {
      return (
        '<div class="tma-dash__messages-gallery-grid">' +
        items
          .map(function (item) {
            return (
              '<button type="button" class="tma-dash__messages-gallery-tile" ' +
              'data-messages-gallery-open="' + esc(item.id) + '" ' +
              'data-messages-gallery-seq="' + (item.seq || '') + '">' +
              (item.kind === 'video'
                ? '<span class="tma-dash__messages-gallery-video">▶</span>'
                : '') +
              '<img src="' + esc(item.thumbUrl || item.url) + '" alt="' + esc(item.name) + '" loading="lazy">' +
              '</button>'
            );
          })
          .join('') +
        '</div>'
      );
    }

    if (shelf === 'links') {
      return items
        .map(function (item) {
          return (
            '<button type="button" class="tma-dash__messages-person" ' +
            'data-messages-jump-to="' + esc(state.selectedId) + '" ' +
            'data-messages-jump-seq="' + (item.seq || '') + '">' +
            '<span class="tma-dash__messages-person-text">' +
            '<span class="tma-dash__messages-person-name">' +
            esc(item.title || item.domain || item.url) + '</span>' +
            '<span class="tma-dash__messages-person-meta">' +
            esc(item.senderName) + ' · ' + esc(item.date) + '</span>' +
            '</span></button>'
          );
        })
        .join('');
    }

    return items
      .map(function (item) {
        return (
          '<button type="button" class="tma-dash__messages-person" ' +
          'data-messages-gallery-open="' + esc(item.id) + '" ' +
          'data-messages-gallery-seq="' + (item.seq || '') + '">' +
          '<span class="tma-dash__messages-row-avatar">' +
          '<img class="tma-dash__messages-tray-icon" src="' +
          esc(attachmentIconSrc(item.name)) + '" alt=""></span>' +
          '<span class="tma-dash__messages-person-text">' +
          '<span class="tma-dash__messages-person-name">' + esc(item.name) + '</span>' +
          '<span class="tma-dash__messages-person-meta">' +
          esc(formatBytes(item.size)) + ' · ' + esc(item.senderName) + ' · ' + esc(item.date) +
          '</span></span></button>'
        );
      })
      .join('');
  }

  /*
   * Group administration: what an admin opens this panel to do, so it sits
   * straight under the name.
   *
   * What is offered depends on the server's own verdict (`canManage`), not on
   * a guess here, the organization chat is administrator-only however the
   * participant roles happen to be set.
   */
  function renderGroupActions(info) {
    if (!info.conversation.canManage) return '';

    return (
      '<div class="tma-dash__messages-profile-section" data-key="group-actions">' +
      '<button type="button" class="tma-dash__messages-profile-action" ' +
      'data-messages-group-rename>Rename group</button>' +
      '<button type="button" class="tma-dash__messages-profile-action" ' +
      'data-messages-group-photo>Change group photo</button>' +
      '<input type="file" accept="image/*" hidden data-messages-group-photo-file>' +
      '</div>'
    );
  }

  /*
   * Who is in the group: the last section of the panel, under everything
   * about the conversation itself. Nobody can leave the organization chat.
   */
  function renderGroupMembers(state, info, row) {
    var members = info.profile.members || [];
    var canManage = !!info.conversation.canManage;
    // The staff list decides who is in an auto-join group, so there is
    // nobody to add and nobody to take out.
    var canCurate = canManage && !info.conversation.autoJoin;
    var me = (STORE.me || {}).id;

    return (
      '<div class="tma-dash__messages-profile-section tma-dash__messages-profile-section--members" ' +
      'data-key="group-members" data-messages-group-members>' +
      '<div class="tma-dash__messages-list-group">' +
      members.length + ' member' + (members.length === 1 ? '' : 's') +
      (info.conversation.isDefault ? ' · Organization chat' : '') +
      '</div>' +

      (canCurate
        ? '<button type="button" class="tma-dash__messages-profile-action" ' +
          'data-messages-group-add>Add people</button>'
        : '') +

      members
        .map(function (member) {
          var isMe = member.id === me;
          var isAdmin = member.role === 'admin';

          return (
            '<div class="tma-dash__messages-member">' +
            (member.photo
              ? '<span class="tma-dash__messages-row-avatar">' +
                '<img src="' + esc(member.photo) + '" alt="" loading="lazy"></span>'
              : renderInitialAvatar(member.name || '?')) +
            '<span class="tma-dash__messages-person-text">' +
            '<span class="tma-dash__messages-person-name">' +
            esc(member.name || 'Unknown') + (isMe ? ' (you)' : '') + '</span>' +
            '<span class="tma-dash__messages-person-meta">' +
            esc(
              (member.workStatus && member.workStatus.label)
                ? member.workStatus.label
                : (isAdmin ? 'Administrator' : 'Member')
            ) + '</span>' +
            '</span>' +
            // No management controls against yourself: leaving is its own
            // action, and self-demotion is the last-admin trap.
            (canManage && !isMe
              ? '<button type="button" class="tma-dash__messages-member-btn" ' +
                'data-messages-member-role="' + member.id + '" ' +
                'data-messages-member-next="' + (isAdmin ? 'member' : 'admin') + '">' +
                (isAdmin ? 'Demote' : 'Make admin') + '</button>' +
                (canCurate
                  ? '<button type="button" class="tma-dash__messages-member-btn ' +
                    'tma-dash__messages-member-btn--danger" data-messages-member-remove="' + member.id + '" ' +
                    'aria-label="Remove ' + esc(member.name || '') + '">Remove</button>'
                  : '')
              : '') +
            '</div>'
          );
        })
        .join('') +

      (info.conversation.canLeave
        ? '<button type="button" class="tma-dash__messages-profile-action ' +
          'tma-dash__messages-profile-action--danger" data-messages-group-leave>Leave group</button>'
        : info.conversation.isDefault
          ? '<p class="tma-dash__messages-profile-note">' +
            'Everyone at the firm is a member of this conversation.</p>'
          : '') +
      '</div>'
    );
  }

  function renderProfile(state) {
    var info = state.profile;

    if (!info) {
      return (
        '<div class="tma-dash__messages-chat">' +
        '<div class="tma-dash__messages-chat-state" role="status">Loading…</div>' +
        '</div>'
      );
    }

    var p = info.profile;
    var row = findThread(state.selectedId) || {};
    var shelf = state.profileShelf || 'media';

    var presence = window.TMALastSeen
      ? window.TMALastSeen.forPresence(p.presence)
      : (p.presence.online ? 'Online' : (p.presence.lastSeen || p.presence.label || ''));
    if (/^group chat$/i.test(String(presence).trim()) || /^offline$/i.test(String(presence).trim())) {
      presence = row.type === 'group' ? groupCountLabel(row) : (p.presence && p.presence.online ? 'Online' : 'Last seen recently');
    }

    return (
      '<div class="tma-dash__messages-chat tma-dash__messages-chat--profile">' +
      '<div class="tma-dash__messages-chat-head">' +
      '<button type="button" class="tma-dash__messages-icon-btn" data-messages-profile-back ' +
      'aria-label="Back to conversation"><img src="' + ICONS.CaretLeft + '" alt=""></button>' +
      '<span class="tma-dash__messages-chat-contact-text">' +
      '<span class="tma-dash__messages-chat-name">Conversation info</span>' +
      '</span>' +
      '</div>' +

      '<div class="tma-dash__messages-profile" data-messages-profile-body>' +

      // Cover + avatar. The avatar opens in the lightbox, but only when there
      // is a real photo, an initials tile has nothing to enlarge.
      '<div class="tma-dash__messages-profile-cover"></div>' +
      '<div class="tma-dash__messages-profile-head">' +
      (row.type === 'group' && !p.photo
        // A group nobody has given a picture is its people: the same circle
        // cluster as the list, at profile size, rather than an initials tile.
        ? '<span class="tma-dash__messages-profile-avatar tma-dash__messages-profile-avatar--group">' +
          renderGroupCluster(groupClusterMembers({ name: p.name }, p.members)) +
          '</span>'
        : p.photo
          ? '<button type="button" class="tma-dash__messages-profile-avatar" ' +
            'data-messages-profile-photo="' + esc(p.photo) + '" aria-label="View photo">' +
            '<img src="' + esc(p.photo) + '" alt=""></button>'
          : '<span class="tma-dash__messages-profile-avatar">' +
            renderInitialAvatar(p.name, 'tma-dash__messages-profile-initial') + '</span>') +
      '<h2 class="tma-dash__messages-profile-name">' + esc(p.name) + '</h2>' +
      (presence
        ? '<p class="tma-dash__messages-profile-presence">' + esc(presence) + '</p>'
        : '') +
      '</div>' +

      (row.type === 'group' ? renderGroupActions(info) : '') +

      '<div class="tma-dash__messages-profile-section">' +
      renderProfileRow('Email', p.email) +
      renderProfileRow('Description', info.conversation.description) +
      renderProfileRow('Role', p.accountType) +
      renderProfileRow('Job title', p.jobTitle) +
      renderProfileRow('About', p.about) +
      (info.profile.memberCount && row.type === 'group'
        ? renderProfileRow('Members', info.profile.memberCount + ' people')
        : '') +
      '</div>' +

      // Per-user controls, mirroring the conversation menu rather than
      // duplicating its logic.
      '<div class="tma-dash__messages-profile-section">' +
      '<label class="tma-dash__messages-setting">' +
      '<span class="tma-dash__messages-setting-text">' +
      '<span class="tma-dash__messages-setting-label">Mute notifications</span></span>' +
      '<input type="checkbox" class="tma-dash__messages-setting-input" ' +
      'data-messages-profile-mute' + (row.muted ? ' checked' : '') + '></label>' +
      '<label class="tma-dash__messages-setting">' +
      '<span class="tma-dash__messages-setting-text">' +
      '<span class="tma-dash__messages-setting-label">Pin conversation</span></span>' +
      '<input type="checkbox" class="tma-dash__messages-setting-input" ' +
      'data-messages-profile-pin' + (row.pinned ? ' checked' : '') + '></label>' +
      '<label class="tma-dash__messages-setting">' +
      '<span class="tma-dash__messages-setting-text">' +
      '<span class="tma-dash__messages-setting-label">Chat background</span></span>' +
      '<select class="tma-dash__messages-setting-input" data-messages-chat-bg>' +
      [
        { value: 'plain', label: 'Plain' },
        { value: 'soft', label: 'Soft wash' },
        { value: 'grid', label: 'Light grid' },
        { value: 'dots', label: 'Dots' },
      ]
        .map(function (opt) {
          var current = chatBackgroundKey();
          return (
            '<option value="' + opt.value + '"' +
            (current === opt.value ? ' selected' : '') +
            '>' + esc(opt.label) + '</option>'
          );
        })
        .join('') +
      '</select></label>' +
      '</div>' +

      // Shared content.
      '<div class="tma-dash__messages-profile-section">' +
      '<div class="tma-dash__messages-gallery-tabs" role="tablist">' +
      [
        { key: 'media', label: 'Media', count: info.counts.media },
        { key: 'documents', label: 'Documents', count: info.counts.documents },
        { key: 'links', label: 'Links', count: info.counts.links },
      ]
        .map(function (tab) {
          return (
            '<button type="button" role="tab" class="tma-dash__messages-gallery-tab' +
            (tab.key === shelf ? ' is-active' : '') +
            '" data-messages-gallery-tab="' + tab.key + '" ' +
            'aria-selected="' + (tab.key === shelf ? 'true' : 'false') + '">' +
            esc(tab.label) + ' <span>' + (tab.count || 0) + '</span></button>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="tma-dash__messages-gallery-body">' + renderGalleryItems(state) + '</div>' +
      '</div>' +

      // Privacy note, then the destructive actions last.
      '<p class="tma-dash__messages-profile-note">' +
      'Messages are stored on the portal and visible only to this conversation’s participants.' +
      '</p>' +

      '<div class="tma-dash__messages-profile-section tma-dash__messages-profile-actions">' +
      (info.can.openClientRecord
        ? '<button type="button" class="tma-dash__messages-profile-action" ' +
          'data-messages-open-client>' +
          (applicationForThread(row) ? 'Open application' : 'Open client record') +
          '</button>'
        : '') +
      '<button type="button" class="tma-dash__messages-profile-action" ' +
      'data-messages-profile-clear>Clear messages</button>' +
      (info.can.block
        ? '<button type="button" class="tma-dash__messages-profile-action ' +
          'tma-dash__messages-profile-action--danger" data-messages-profile-block>' +
          (row.blocked ? 'Unblock contact' : 'Block contact') + '</button>'
        : '') +
      '</div>' +

      (row.type === 'group' ? renderGroupMembers(state, info, row) : '') +

      '</div></div>'
    );
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
      renderOpenApplicationButton(row) +
      [
        { icon: 'Phone', label: 'Voice call', attr: ' data-messages-call="audio"' },
        { icon: 'VideoCamera', label: 'Video call', attr: ' data-messages-call="video"' },
        {
          icon: 'DotsThree',
          label: 'Conversation menu',
          attr: ' data-messages-conversation-menu aria-haspopup="menu"',
        },
      ]
        .map(function (action) {
          return (
            '<button type="button" class="tma-dash__messages-icon-btn"' +
            ' aria-label="' + esc(action.label) + '"' +
            (action.attr || '') +
            '>' +
            '<img src="' + esc(ICONS[action.icon]) + '" alt="">' +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__messages-chat-body' +
      chatBackgroundClass() +
      '" data-messages-chat-body>' +
      renderChatBody(state, row, render) +
      '</div>' +
      renderTextSelectBar(state) +
      '<div class="tma-dash__messages-composer' +
      (state.replyTo && state.replyTo.threadId === state.selectedId ? ' tma-dash__messages-composer--reply' : '') +
      '">' +
      renderScheduledStrip(state) +
      renderReplyPreview(state) +
      renderComposer(state) +
      '</div>' +
      '</div>'
    );
  }

  function renderMessagesResizer(state) {
    if (isMessagesMobile()) return '';
    var w = typeof state.inboxWidth === 'number' ? state.inboxWidth : INBOX_WIDTH_DEFAULT;
    return (
      '<div class="tma-dash__messages-resizer" data-messages-resizer role="separator"' +
      ' aria-orientation="vertical" aria-label="Resize inbox and chat" tabindex="0"' +
      ' aria-valuemin="' + INBOX_WIDTH_MIN + '" aria-valuemax="' + INBOX_WIDTH_MAX + '"' +
      ' aria-valuenow="' + Math.round(w) + '"></div>'
    );
  }

  function renderLayout(state, render) {
    var layoutCls = 'tma-dash__messages-layout';
    var layoutStyle = '';
    if (isMessagesMobile()) {
      layoutCls += ' tma-dash__messages-layout--mobile';
      if (isMessagesReading(state)) layoutCls += ' tma-dash__messages-layout--mobile-reading';
    } else {
      if (typeof state.inboxWidth !== 'number') state.inboxWidth = loadInboxWidth();
      layoutStyle = ' style="--messages-inbox-w:' + Math.round(state.inboxWidth) + 'px"';
    }
    var html =
      '<div class="' + layoutCls + '"' + layoutStyle + '>' +
      renderList(state) +
      renderMessagesResizer(state) +
      (state.profileOpen && state.selectedId ? renderProfile(state) : renderChat(state, render)) +
      '</div>';
    return html;
  }

  /* Drag/keyboard wiring for the inbox↔chat divider. Mirrors the mailbox split
   * resizer: it sets the width CSS variable live during a drag rather than
   * re-rendering, and only persists on release. Re-run after each render; the
   * stored cleanup prevents listeners from stacking. */
  function attachMessagesResizer(root, state) {
    if (root._messagesResizeCleanup) {
      root._messagesResizeCleanup();
      root._messagesResizeCleanup = null;
    }
    if (isMessagesMobile()) return;

    var layout = root.querySelector('.tma-dash__messages-layout');
    var resizer = root.querySelector('[data-messages-resizer]');
    if (!layout || !resizer) return;

    if (typeof state.inboxWidth !== 'number') state.inboxWidth = loadInboxWidth();

    function apply(px) {
      layout.style.setProperty('--messages-inbox-w', Math.round(px) + 'px');
      resizer.setAttribute('aria-valuenow', String(Math.round(px)));
    }

    function widthFrom(clientX) {
      var rect = layout.getBoundingClientRect();
      if (rect.width <= 0) return state.inboxWidth;
      return clampInboxWidth(clientX - rect.left, rect.width);
    }

    var dragging = false;

    function onPointerDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      resizer.classList.add('tma-dash__messages-resizer--dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      if (typeof resizer.setPointerCapture === 'function') resizer.setPointerCapture(e.pointerId);
      state.inboxWidth = widthFrom(e.clientX);
      apply(state.inboxWidth);
    }

    function onPointerMove(e) {
      if (!dragging) return;
      e.preventDefault();
      state.inboxWidth = widthFrom(e.clientX);
      apply(state.inboxWidth);
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('tma-dash__messages-resizer--dragging');
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      if (typeof resizer.releasePointerCapture === 'function' &&
          resizer.hasPointerCapture && resizer.hasPointerCapture(e.pointerId)) {
        resizer.releasePointerCapture(e.pointerId);
      }
      saveInboxWidth(state.inboxWidth);
    }

    function onKeyDown(e) {
      var step = 24;
      var w = layout.getBoundingClientRect().width;
      if (e.key === 'ArrowLeft') state.inboxWidth = clampInboxWidth((state.inboxWidth || INBOX_WIDTH_DEFAULT) - step, w);
      else if (e.key === 'ArrowRight') state.inboxWidth = clampInboxWidth((state.inboxWidth || INBOX_WIDTH_DEFAULT) + step, w);
      else if (e.key === 'Home') state.inboxWidth = INBOX_WIDTH_MIN;
      else if (e.key === 'End') state.inboxWidth = clampInboxWidth(INBOX_WIDTH_MAX, w);
      else return;
      e.preventDefault();
      apply(state.inboxWidth);
      saveInboxWidth(state.inboxWidth);
    }

    resizer.addEventListener('pointerdown', onPointerDown);
    resizer.addEventListener('pointermove', onPointerMove);
    resizer.addEventListener('pointerup', onPointerUp);
    resizer.addEventListener('pointercancel', onPointerUp);
    resizer.addEventListener('keydown', onKeyDown);

    root._messagesResizeCleanup = function () {
      resizer.removeEventListener('pointerdown', onPointerDown);
      resizer.removeEventListener('pointermove', onPointerMove);
      resizer.removeEventListener('pointerup', onPointerUp);
      resizer.removeEventListener('pointercancel', onPointerUp);
      resizer.removeEventListener('keydown', onKeyDown);
    };
  }

  function getMessagesDashRoot() {
    return document.querySelector('.tma-dash');
  }

  function ensureMessagesMobileHeader(root, state) {
    var dash = getMessagesDashRoot();
    if (!dash) return;

    /*
     * The modifier reshapes the whole shell for full-bleed chat: it strips
     * .tma-dash__main's side gutters and swaps its scroll for `overflow:
     * hidden`. That is only ever right while Messages is the visible view.
     *
     * render() runs in the background too, realtime events, resizes, badge
     * syncs, so toggling on viewport width alone stamped the modifier on
     * every narrow load. The Dashboard then lost its gutters entirely and
     * could not scroll past the fold.
     */
    var view = root && root.closest ? root.closest('.tma-dash__view') : null;
    if (view && view.hidden) {
      clearMessagesMobileHeader();
      return;
    }

    dash.classList.toggle('tma-dash--messages-mobile', isMessagesMobile());
    dash.classList.toggle('tma-dash--messages-mobile-reading', isMessagesReading(state));
    // Picking chats on a phone: the bar of actions takes the tab bar's place.
    dash.classList.toggle('tma-dash--messages-picking',
      isMessagesMobile() && !!state.chatSelect && !isMessagesReading(state));

    if (typeof dash._syncSidebarToggleIcon === 'function') dash._syncSidebarToggleIcon();
  }

  function clearMessagesMobileHeader() {
    var dash = getMessagesDashRoot();
    if (!dash) return;
    dash.classList.remove('tma-dash--messages-mobile', 'tma-dash--messages-mobile-reading', 'tma-dash--messages-picking');
    if (typeof dash._syncSidebarToggleIcon === 'function') dash._syncSidebarToggleIcon();
  }

  function bindMessageSwipes(root, state, render) {
    var chatBody = root.querySelector('.tma-dash__messages-chat-body');

    root.querySelectorAll('[data-messages-swipe]').forEach(function (row) {
      // A JS property, not a data attribute: TMAMorph syncs attributes
      // from the rendered markup and would strip an imperative flag,
      // resetting the guard and re-binding this row on every render.
      if (row._messagesSwipeBound) return;
      row._messagesSwipeBound = true;

      var side = row.getAttribute('data-messages-swipe');
      var swipe = row.querySelector('.tma-dash__messages-bubble-swipe');
      var track = row.querySelector('[data-messages-swipe-track]');
      var replyIcon = row.querySelector('.tma-dash__messages-bubble-swipe-reply');
      if (!track || !swipe || side !== 'in' && side !== 'out') return;

      var startX = 0;
      var startY = 0;
      var startOffset = 0;
      var dragging = false;
      var moved = false;
      var armed = false;
      var wheelEndTimer = null;
      // When a trackpad swipe fires the reply, its momentum keeps emitting
      // wheel events; without a cooldown those re-open the gesture and fire
      // the same reply again before the fingers have even lifted.
      var wheelFiredAt = 0;

      function getCurrentOffset() {
        if (pendingOffset !== null) return banded(pendingOffset);
        var match = /translate(?:X|3d)\((-?\d+(?:\.\d+)?)px/.exec(track.style.transform || '');
        return match ? parseFloat(match[1]) : 0;
      }

      /*
       * Where the bubble sits for a finger `px` along. It goes with the finger
       * one for one up to the reply point, then follows with resistance, the
       * way a bubble is pulled in WhatsApp, rather than stopping dead at a
       * wall the finger keeps moving past.
       */
      function banded(px) {
        var forward = side === 'in' ? Math.max(0, px) : Math.max(0, -px);
        var limit = REPLY_SWIPE_MAX;
        var shown = forward <= limit ? forward : limit + (forward - limit) * 0.3;
        shown = Math.min(shown, limit + 36);
        return side === 'in' ? shown : -shown;
      }

      /* One write per frame: pointer events arrive faster than the screen
         draws on some phones, and every write is a style recalculation. */
      var pendingOffset = null;
      var frame = 0;
      function paintOffset() {
        frame = 0;
        if (pendingOffset === null) return;
        var px = pendingOffset;
        pendingOffset = null;
        var shown = banded(px);
        var progress = Math.min(1, Math.abs(shown) / getReplySwipeTrigger());

        if (Math.abs(shown) < 1) {
          track.style.transform = '';
          swipe.classList.remove('is-replying');
          if (replyIcon) { replyIcon.style.opacity = ''; replyIcon.style.transform = ''; }
          return;
        }

        track.style.transform = 'translate3d(' + shown.toFixed(1) + 'px,0,0)';
        swipe.classList.toggle('is-replying', progress >= 1);
        if (replyIcon) {
          replyIcon.style.opacity = String(progress);
          // The arrow grows into place as the reply point nears.
          replyIcon.style.transform = 'translateY(-50%) scale(' + (0.6 + 0.4 * progress).toFixed(3) + ')';
        }
      }

      function setOffset(px) {
        pendingOffset = px;
        if (!frame) frame = window.requestAnimationFrame(paintOffset);
        return banded(px);
      }

      function resetSwipe() {
        if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
        pendingOffset = null;
        armed = false;
        track.classList.remove('is-dragging');
        swipe.classList.remove('is-replying');
        if (replyIcon) { replyIcon.style.opacity = ''; replyIcon.style.transform = ''; }
        if (chatBody) chatBody.classList.remove('is-swipe-dragging');
        // With the transition back on, the bubble springs home from wherever
        // the finger left it.
        track.style.transform = '';
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
        var current = pendingOffset !== null ? banded(pendingOffset) : getCurrentOffset();
        var trigger = getReplySwipeTrigger();

        if (side === 'in' && current >= trigger) {
          triggerReply();
          return;
        }
        if (side === 'out' && current <= -trigger) {
          triggerReply();
          return;
        }

        resetSwipe();
      }

      function scheduleWheelEnd() {
        clearWheelEndTimer();
        wheelEndTimer = setTimeout(finishSwipeGesture, 160);
      }

      function triggerReply() {
        clearWheelEndTimer();

        // Read the index off the LIVE attribute at trigger time, never the
        // bind-time capture: paging older history prepends messages and
        // shifts every bubble's position. The morph layer keeps the
        // attribute current while a captured variable stays stale, which
        // quietly quoted a message a whole page older than the one swiped.
        var index = parseInt(row.getAttribute('data-messages-index'), 10);

        // setReplyTo takes a message *id*. This passed the bubble's numeric
        // index, a leftover from when replies were tracked by position, so
        // the swipe stored a reply target no message could ever match and the
        // preview never appeared.
        var msg = getMessages(state.selectedId)[index];
        if (!msg) {
          resetSwipe();
          return;
        }

        setReplyTo(state, msg.id);
        resetSwipe();
        render();
        focusComposerInput(root);
      }

      function wheelDeltaX(e) {
        return messagesWheelDeltaX(e, track.clientWidth || wrap.offsetWidth || 320);
      }

      /* Nothing is held or locked until the gesture is known to be a swipe
         (moveDrag commits it): taking the pointer and switching selection
         off on touch-down is what made a message's words impossible to
         highlight. */
      function beginDrag(clientX, clientY) {
        clearWheelEndTimer();
        dragging = true;
        moved = false;
        startX = clientX;
        startY = clientY;
        startOffset = getCurrentOffset();
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
            // actually scrolls, holding capture here left the gesture dead.
            dragging = false;
            track.classList.remove('is-dragging');
            if (pointerId !== undefined && track.hasPointerCapture(pointerId)) {
              track.releasePointerCapture(pointerId);
            }
            setOffset(0);
            return;
          }

          moved = true;
          track.classList.add('is-dragging');
          if (pointerId !== undefined && !track.hasPointerCapture(pointerId)) {
            try { track.setPointerCapture(pointerId); } catch (err) { /* pointer already gone */ }
          }
          // The chat stays still under a sideways drag through touchmove
          // below. Switching its overflow off for the drag, as it used to,
          // relaid the whole list out mid-gesture, and the bubble stuttered.
        }

        if (prevent) prevent();

        var trigger = getReplySwipeTrigger();
        var offset = setOffset(startOffset + dx);

        /*
         * The reply is the lift, the way it is in WhatsApp: past the reply
         * point the phone knocks once and the arrow fills, and letting go
         * there replies. It used to fire the moment the point was reached,
         * mid-drag, and snap the bubble back out from under a finger that
         * was still moving, which is the roughness people felt. Drawing
         * back before lifting calls it off.
         */
        var past = side === 'in' ? offset >= trigger : offset <= -trigger;
        if (past && !armed) haptic('light');
        armed = past;
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
        // A mouse drag across a message is someone highlighting its words,
        // the way it is everywhere else on a computer. The trackpad's swipe
        // to reply comes through the wheel path below, untouched.
        if (e.pointerType === 'mouse') return;
        // A message being picked from (Select text) belongs to the finger
        // moving its selection handles, not to a swipe.
        if (track.closest('.is-selecting')) return;
        // Interactive controls inside a bubble (react / reply / menu, and a
        // quoted reply) must keep their click. Starting a swipe here would
        // capture the pointer and the click would never arrive.
        if (e.target.closest(INTERACTIVE_IN_BUBBLE)) return;
        beginDrag(e.clientX, e.clientY);
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

      // Once the drag is sideways the chat must not scroll under it.
      track.addEventListener('touchmove', function (e) {
        if (dragging && moved && e.cancelable) e.preventDefault();
      }, { passive: false });

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

          // Momentum tail of a swipe that already fired: swallow it whole, or
          // it re-opens the gesture and replies to the same bubble twice.
          if (Date.now() - wheelFiredAt < 500) {
            if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
            return;
          }

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
          var offsetNow = setOffset(current + movement);

          // Same rule as the pointer path: crossing the trigger fires the
          // reply immediately. The end-of-scroll timer only remains to snap
          // back a swipe that never made it that far, it is no longer what
          // decides the reply, so the 160 ms wait it imposed is gone.
          var wheelTrigger = getReplySwipeTrigger();
          if (side === 'in' ? offsetNow >= wheelTrigger : offsetNow <= -wheelTrigger) {
            wheelFiredAt = Date.now();
            if (chatBody) chatBody.classList.remove('is-swipe-dragging');
            triggerReply();
            return;
          }

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

  /*
   * "Call Sarah?", the chooser between a voice and a video call.
   *
   * Both header buttons open it: pressing a small glyph is a slight target
   * for an action that immediately rings another person, so the kind of call
   * is confirmed as an explicit step rather than inferred from which icon the
   * pointer happened to land on. Imperative like the toast, not part of
   * render(), a call is a moment, not state worth re-rendering the page for.
   */
  function closeCallChooser() {
    var open = document.querySelector('[data-messages-callask]');
    if (open) {
      if (open._onKey) document.removeEventListener('keydown', open._onKey, true);
      open.remove();
    }
  }

  function openCallChooser(root, row) {
    if (!row || !window.TMAMessagingCalls) return;
    closeCallChooser();

    var dash = root.closest('.tma-dash') || document.body;
    var name = row.name || 'Contact';

    var wrap = document.createElement('div');
    wrap.className = 'tma-dash__messages-callask';
    wrap.setAttribute('data-messages-callask', '');
    wrap.innerHTML =
      '<div class="tma-dash__messages-callask-scrim" data-callask-cancel></div>' +
      '<div class="tma-dash__messages-callask-card" role="dialog" aria-modal="true"' +
      ' aria-label="' + esc('Call ' + name) + '">' +
      '<div class="tma-dash__messages-callask-title">' + esc('Call ' + name + '?') + '</div>' +
      '<div class="tma-dash__messages-callask-actions">' +
      '<button type="button" class="tma-dash__messages-callask-btn" data-callask-start="audio">' +
      '<img src="' + esc(ICONS.Phone) + '" alt="">Voice Call</button>' +
      '<button type="button" class="tma-dash__messages-callask-btn" data-callask-start="video">' +
      '<img src="' + esc(ICONS.VideoCamera) + '" alt="">Video Call</button>' +
      '<button type="button" class="tma-dash__messages-callask-btn tma-dash__messages-callask-btn--cancel"' +
      ' data-callask-cancel>Cancel</button>' +
      '</div></div>';

    wrap.addEventListener('click', function (e) {
      var start = e.target.closest('[data-callask-start]');
      if (start) {
        var kind = start.getAttribute('data-callask-start') || 'audio';
        closeCallChooser();
        window.TMAMessagingCalls.start(row.id, kind, name, row.photo || null, (STORE.me || {}).id);
        return;
      }
      if (e.target.closest('[data-callask-cancel]')) closeCallChooser();
    });

    // Capture phase, so the chat's own Escape handling never sees the press
    // that was meant for this dialog.
    wrap._onKey = function (e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeCallChooser();
    };
    document.addEventListener('keydown', wrap._onKey, true);

    dash.appendChild(wrap);
    var first = wrap.querySelector('[data-callask-start="audio"]');
    if (first) first.focus();
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
      message = row.pinned ? 'Pinned' : 'Unpinned';
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
      var track = wrap.querySelector('[data-messages-row-swipe-track]');
      if (!track) return;
      // Flag the track, not the wrap. Morph can replace the track while
      // keeping the wrap; a wrap-level flag then skipped rebinding and the
      // row stopped opening chats after Back.
      if (track._swipeBound) return;
      track._swipeBound = true;

      var startX = 0;
      var startY = 0;
      var startOffset = 0;
      var dragging = false;
      var moved = false;
      var startedOnPick = false;
      var wheelEndTimer = null;
      /*
       * Same axis gate as bubble swipe-to-reply. The inbox used to treat any
       * lift with |dx| ≤ 6 as a tap, so a vertical scroll left moved=false and
       * pointerup opened the chat under the thumb. DEAD_ZONE keeps a real tap
       * from committing a swipe; AXIS_RATIO requires horizontal to clearly
       * dominate before we capture the gesture.
       */
      var DEAD_ZONE = 8;
      var AXIS_RATIO = 1.3;

      function swipeMaxWidth() {
        return wrap.offsetWidth || 0;
      }

      function getCurrentOffset() {
        if (pendingRow !== null) {
          var max = swipeMaxWidth();
          return Math.max(-max, Math.min(max, pendingRow));
        }
        var match = /translate(?:X|3d)\((-?\d+(?:\.\d+)?)px/.exec(track.style.transform || '');
        return match ? parseFloat(match[1]) : 0;
      }

      /* One write per frame, as the bubble's swipe does: a 120 Hz screen
         sends twice the moves it can draw, and each write lays the row's
         actions out again. */
      var pendingRow = null;
      var rowFrame = 0;
      function setOffset(px) {
        pendingRow = px;
        if (!rowFrame) {
          rowFrame = window.requestAnimationFrame(function () {
            rowFrame = 0;
            if (pendingRow === null) return;
            var next = pendingRow;
            pendingRow = null;
            applyOffset(next);
          });
        }
        var max = swipeMaxWidth();
        return Math.max(-max, Math.min(max, px));
      }
      function settleFrame() {
        if (rowFrame) { window.cancelAnimationFrame(rowFrame); rowFrame = 0; }
        pendingRow = null;
      }

      /* How fast the finger was going as it lifted, px/ms, from the last
         stretch of the drag: a flick opens the actions as a long drag does. */
      var samples = [];
      function sample(e) {
        samples.push({ t: e.timeStamp || Date.now(), x: e.clientX });
        if (samples.length > 6) samples.shift();
      }
      function velocity() {
        if (samples.length < 2) return 0;
        var last = samples[samples.length - 1];
        var first = samples[0];
        for (var i = samples.length - 2; i >= 0; i--) {
          if (last.t - samples[i].t > 90) break;
          first = samples[i];
        }
        var dt = last.t - first.t;
        var dist = last.x - first.x;
        // Moves the system delivered together are as fast as a flick gets.
        if (dt <= 0) return dist === 0 ? 0 : (dist > 0 ? 10 : -10);
        return dist / dt;
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

      function applyOffset(px) {
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
          track.style.transform = 'translate3d(' + leftReveal + 'px,0,0)';
          wrap.classList.toggle('is-open-left', leftReveal > 8);
          wrap.classList.remove('is-open-right');
          return leftReveal;
        }

        resetLeftReveal();
        var rightReveal = syncRightReveal(Math.abs(clamped));
        track.style.transform = 'translate3d(-' + rightReveal + 'px,0,0)';
        wrap.classList.remove('is-open-left');
        wrap.classList.toggle('is-open-right', rightReveal > 8);
        return -rightReveal;
      }

      function snapOpen(direction) {
        closeMessagesRowSwipes(root, wrap);
        if (direction === 'left') {
          var snap = leftSnapWidth();
          syncLeftReveal(snap);
          track.style.transform = 'translate3d(' + snap + 'px,0,0)';
          wrap.classList.add('is-open-left');
        } else if (direction === 'right') {
          var deleteSnap = rightSnapWidth();
          syncRightReveal(deleteSnap);
          track.style.transform = 'translate3d(-' + deleteSnap + 'px,0,0)';
          wrap.classList.add('is-open-right');
        }
      }

      function closeSwipe() {
        settleFrame();
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
        var current = getCurrentOffset();
        settleFrame();
        // The finger's last position is drawn before the glide takes over.
        applyOffset(current);
        wrap.classList.remove('is-dragging');
        if (listBody) listBody.classList.remove('is-swipe-dragging');

        var max = swipeMaxWidth();
        var id = wrap.getAttribute('data-messages-row-swipe');
        var v = velocity();
        samples = [];

        // A hidden or not-yet-laid-out row reports width 0. 0 >= 0 would
        // treat a tap as a completed pin swipe and never open the chat.
        if (max > 0 && current >= max * 0.75) {
          applyMessagesRowAction(root, state, render, id, 'pin', wrap);
          return true;
        }
        if (max > 0 && current <= -max * 0.75) {
          closeMessagesRowSwipes(root);
          runConversationAction(root, state, render, id, 'leave');
          return true;
        }

        // A flick decides by its direction; a slow drag by how far it got.
        if (current > 8 && v > 0.45) snapOpen('left');
        else if (current < -8 && v < -0.45) snapOpen('right');
        else if ((current > 0 && v < -0.45) || (current < 0 && v > 0.45)) closeSwipe();
        else if (current > max * 0.3) snapOpen('left');
        else if (current < -max * 0.3) snapOpen('right');
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
        startY = e.clientY;
        startOffset = getCurrentOffset();
        // The pointer is held from here on, so later events say the track,
        // not what was under the finger: note now whether it was the
        // picture (a tap there picks the chat).
        startedOnPick = !!(e.target.closest && e.target.closest('[data-messages-row-pick]'));
        wrap._peeked = false;
        // A prior scroll on this row left swipeMoved set so the synthetic
        // click after lift could not open the chat. Clear it for a fresh
        // gesture so a real tap still works.
        delete wrap.dataset.swipeMoved;
        samples = [];
        sample(e);
        // Nothing about the row changes yet: a tap or a scroll that starts
        // here must not lay the row's actions out (is-dragging is added once
        // the drag is known to be sideways).
        track.setPointerCapture(e.pointerId);
      });

      track.addEventListener(
        'pointermove',
        function (e) {
          if (!dragging) return;
          // Held long enough to open the preview: the row stays put under it.
          if (wrap._peeked) return;
          var dx = e.clientX - startX;
          var dy = e.clientY - startY;

          if (!moved) {
            if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;

            // While chats are being picked a row does not swipe: any real
            // movement is the list scrolling, as below.
            if (state.chatSelect || Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) {
              // A scroll, not a swipe. Give the pointer back so the list
              // actually scrolls; holding capture here left the gesture dead
              // and the later pointerup opened the row as a "tap".
              dragging = false;
              wrap.classList.remove('is-dragging');
              if (listBody) listBody.classList.remove('is-swipe-dragging');
              if (track.hasPointerCapture(e.pointerId)) {
                track.releasePointerCapture(e.pointerId);
              }
              wrap.dataset.swipeMoved = '1';
              return;
            }

            moved = true;
            wrap.classList.add('is-dragging');
            // The list stays still under a sideways drag through touchmove
            // below; switching its overflow off relaid the whole inbox out.
          }

          sample(e);
          e.preventDefault();
          // A row swiped open closes on the way back and stops there: one
          // gesture never carries on through closed into the other side's
          // actions (a quick swipe back used to land on Delete).
          var nextOffset = startOffset + dx;
          if (startOffset > 0) nextOffset = Math.max(0, nextOffset);
          else if (startOffset < 0) nextOffset = Math.min(0, nextOffset);
          setOffset(nextOffset);
        },
        { passive: false }
      );

      track.addEventListener('touchmove', function (e) {
        if (dragging && moved && e.cancelable) e.preventDefault();
      }, { passive: false });

      function openThreadFromSwipe(id) {
        openConversation(root, state, render, id);
      }

      function endDrag(e) {
        // Scroll abort already set swipeMoved and released capture; a late
        // click after lift must not open the conversation (cleared on the
        // next pointerdown).
        if (!dragging) return;
        dragging = false;
        clearWheelEndTimer();
        if (e && track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);

        var wasTap = !moved;

        // The lift after a press-and-hold: the preview is open, nothing else.
        if (wrap._peeked) {
          wrap._peeked = false;
          closeSwipe();
          markTapHandled();
          return;
        }

        // A tap on the picture, or on any row while picking, picks the chat.
        if (wasTap && (state.chatSelect || startedOnPick) &&
          !wrap.classList.contains('is-open-left') && !wrap.classList.contains('is-open-right')) {
          closeSwipe();
          markTapHandled();
          toggleChatPicked(root, state, render, wrap.getAttribute('data-messages-row-swipe'));
          return;
        }

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
        markTapHandled();
        openThreadFromSwipe(wrap.getAttribute('data-messages-row-swipe'));
      }

      // The click that follows the lift must not act on the tap a second time.
      function markTapHandled() {
        wrap.dataset.tapHandled = '1';
        window.requestAnimationFrame(function () {
          delete wrap.dataset.tapHandled;
        });
      }

      track.addEventListener('pointerup', endDrag);
      track.addEventListener('pointercancel', endDrag);

      track.addEventListener(
        'wheel',
        function (e) {
          if (dragging || state.chatSelect) return;

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

    MORPH.unwired(root, '[data-messages-row-swipe-action]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var action = btn.getAttribute('data-messages-row-swipe-action');
        var id = btn.getAttribute('data-messages-row-id');
        var wrap = btn.closest('[data-messages-row-swipe]');
        // 'delete' is a real delete now, it leaves the conversation for
        // this user, so route it through the confirming action.
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
   * replaces the element the user is typing into, without this the field
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

  /*
   * Jump to the newest message and *stay* there. Setting scrollTop once is not
   * enough: opening a conversation, the bubbles' images and link previews are
   * still loading, so the scroll height keeps growing after the first paint and
   * the view drifts up off the last message. So we pin now, again next frame,
   * and once more each time an image inside the thread finishes loading.
   */
  function pinChatToBottom(chat) {
    if (!chat) return;

    function pin() {
      chat.scrollTop = chat.scrollHeight;
    }
    pin();
    requestAnimationFrame(pin);

    // Re-pin as late-loading media changes the content height. Listeners are
    // one-shot and only bound to images not already complete, so this stays
    // cheap and never fights the user once everything has settled.
    var media = chat.querySelectorAll('img, video');
    media.forEach(function (el) {
      var done = el.tagName === 'IMG' ? el.complete : el.readyState >= 1;
      if (done) return;
      var evt = el.tagName === 'IMG' ? 'load' : 'loadedmetadata';
      var onReady = function () {
        el.removeEventListener(evt, onReady);
        el.removeEventListener('error', onReady);
        // Only chase the bottom while the reader is still near it, if they
        // scrolled up to read history, leave them be.
        if (chat.scrollHeight - chat.scrollTop - chat.clientHeight <= 240) pin();
      };
      el.addEventListener(evt, onReady);
      el.addEventListener('error', onReady);
    });
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
      pinChatToBottom(chat);
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
   * already typed something here in this session, local keystrokes are always
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
        var previousThreads = STORE.threads || [];
        STORE.threads = data.conversations || [];
        STORE.me = data.me || null;
        rememberMe();
        STORE.settings = data.settings || {};
        STORE.tabCounts = data.tabCounts || STORE.tabCounts || {};
        publishCallSettings();
        publishDesktopSettings();
        STORE.realtime = data.realtime || null;
        STORE.limits = data.limits || {};
        STORE.loaded = true;
        STORE.loadError = null;
        STORE.real = true;
        // Behind the screen, once it has settled: every recent chat kept.
        setTimeout(warmThreads, 3000);

        retainOpenThread(previousThreads, state.selectedId);
        markMovedThreads(previousThreads);

        if (window.TMAStore) {
          window.TMAStore.put('messages:warm', {
            // The whole list, as WhatsApp keeps it (rows are small).
            threads: (STORE.threads || []).slice(0, 300),
            me: STORE.me,
            settings: STORE.settings,
            tabCounts: STORE.tabCounts,
          });
        }

        // Needs STORE.me and STORE.realtime, so it cannot happen at boot.
        // Guarded internally, so calling it on every load is free.
        subscribeToOwnChannel(root, state, render);

    // Keep the open conversation if it still exists; otherwise fall back
        // to the first row on desktop, where an empty pane looks broken.
        if (state.selectedId && !findThread(state.selectedId)) {
          state.selectedId = null;
        }
        // Deliberately no auto-select. Opening the newest conversation on load
        // marked it read on the user's behalf, they never looked at it, which
        // sent a false read receipt and wiped the unread badge. The chat column
        // starts in its empty state instead, the same one the close button
        // returns to.

        // Seed the composer from the stored draft for whichever conversation
        // ends up open. Without this a draft only reappeared when the user
        // switched *into* a conversation, so the one already open on load —
        // usually the one they were last typing in, came back empty.
        seedComposerDraft(state, state.selectedId);

        render();
        // The sidebar badge counts missed calls alongside unread messages, so
        // it has to be re-read whenever the tab counts land, not only when a
        // conversation changes.
        syncTabBarBadges();
        startRealtime(root, state, render);

        // Having the list *is* delivery: this account demonstrably holds these
        // messages now, whether or not any conversation is open. One call
        // covers every conversation.
        window.TMAMessagingAPI.markAllDelivered();

        if (state.selectedId) {
          loadThread(root, state, render, state.selectedId, { toBottom: true, quiet: !!options.silent });
          loadScheduled(root, state, render, state.selectedId);
        }
      })
      .catch(function (err) {
        STORE.loaded = true;
        // The server answered that the list could not be built. Rows already
        // on screen stay; an empty first load still says so.
        if (err && err.unavailable && (STORE.threads || []).length) return;
        // Rows already on screen, the warm snapshot, or a previous answer —
        // beat an error card: they are the last known truth, and replacing
        // them with "could not be loaded" because a refresh failed is the
        // File Library lesson unlearned.
        if ((STORE.threads || []).length) {
          render();
          return;
        }
        // Nothing up yet: the kept list may still be on its way from the
        // disk, and a dead network answers faster than the disk does. Only
        // when there is nothing kept is it a list that could not be loaded.
        var kept = window.TMAStore ? window.TMAStore.get('messages:warm') : Promise.resolve(null);
        return kept.then(adoptWarm, function () { return false; }).then(function (adopted) {
          if (adopted || (STORE.threads || []).length) {
            render();
            return;
          }
          STORE.loadError = err;
          render();
          if (!options.silent) showMessagesToast(root, 'Conversations could not be loaded');
        });
      });
  }

  /* The newest page of a conversation, or an older page when `before` is set. */
  function loadThread(root, state, render, conversationId, options) {
    options = options || {};
    var bucket = threadBucket(conversationId);
    lastThreadRender = render;

    if (bucket.loading) return Promise.resolve();
    bucket.loading = true;
    if (options.before) bucket.loadingOlder = true;
    bucket.error = null;

    if (options.before) render();

    // The copy kept on the device first: the conversation is on screen before
    // the network answers, and is still there if it never does.
    var kept = options.before ? Promise.resolve(false) : hydrateThread(conversationId).then(function (painted) {
      if (painted) render({ chatToBottom: true });
      restoreQueued(conversationId, render);

      return painted;
    });

    return kept.then(function () { return window.TMAMessagingAPI.messages(conversationId, options.before); })
      .then(function (data) {
        bucket.loading = false;
        bucket.loadingOlder = false;
        var fromDevice = !!bucket.fromDevice;
        bucket.fromDevice = false;

        if ((options.quiet || fromDevice) && bucket.loaded && !options.before) {
          // Catching up on a thread already held. How far back it reaches
          // is still what it was, unless the page no longer joins up with it.
          mergeNewestPage(conversationId, data);
        } else {
          bucket.hasMore = !!data.hasMore;
          mergeMessages(conversationId, data.messages || [], !!options.before);
          // The newest page is in: what is held is the conversation again.
          if (!options.before) bucket.stale = false;
        }
        bucket.loaded = true;
        // Kept from its first opening. mergeMessages keeps a thread only once
        // it is loaded, and the first page is merged before that, so a
        // conversation opened and then read offline used to have no copy at
        // all until a new message happened to arrive in it.
        persistThread(conversationId);

        // The conversation row can have moved on while history was in flight.
        if (data.conversation) replaceThread(data.conversation);

        // A conversation the user is looking at is a conversation they have
        // read, subject to their own read-receipt setting, enforced server side.
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
        } else if ((options.quiet || bucket.fromDevice) && bucket.messages.length) {
          // A refresh behind a thread that is already up, or one painted from
          // the device with no connection. What is on screen is the last known
          // truth; an error card in its place would not be.
          bucket.fromDevice = false;
          bucket.stale = true;
        } else if (!(err && err.status) && window.TMAStore) {
          // No connection and nothing up yet: the kept copy may still be on
          // its way from the disk, which answers slower than a dead network
          // fails. Only with nothing kept is it a thread that could not load.
          window.TMAStore.get(threadKey(conversationId)).then(function (snap) {
            if (!bucket.messages.length && snap && snap.messages && snap.messages.length) {
              mergeMessages(conversationId, snap.messages, false);
              bucket.hasMore = !!snap.hasMore;
              bucket.loaded = true;
              bucket.stale = true;
            } else if (!bucket.messages.length) {
              bucket.error = err;
            }
            render();
          }, function () {
            bucket.error = err;
            render();
          });
          return;
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

  /*
   * An unsent client chat is omitted from the inbox. If the viewer still has
   * it open (they just pressed Message on the file), keep the local row so
   * a list refresh does not close the composer.
   */
  function retainOpenThread(previous, selectedId) {
    if (!selectedId || findThread(selectedId)) return;
    for (var i = 0; i < previous.length; i++) {
      if (previous[i].id === selectedId) {
        STORE.threads.unshift(previous[i]);
        return;
      }
    }
  }

  function markConversationRead(root, state, render, conversationId) {
    var row = findThread(conversationId);
    if (!row || (!row.unread && !row.markedUnread)) return;

    row.unread = 0;
    row.markedUnread = false;
    syncTabBarBadges();

    window.TMAMessagingAPI.markRead(conversationId).then(function () {
      // Reading the thread also settles its bell notifications server-side;
      // pull the new total so the badge in this tab agrees straight away.
      if (window.TMANotifications && window.TMANotifications.refreshCount) {
        window.TMANotifications.refreshCount();
      }
    }).catch(function () {
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

    var thread = findThread(conversationId);
    var lane = thread && thread.caseFile ? caseLane(state, conversationId) : null;
    if (lane === 'internal' && ready.length) {
      showMessagesToast(root, 'An internal note can’t include files.');
      return;
    }

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

    // The message itself is about to say everything the indicator was for.
    stopTyping();

    var replyTo = state.replyTo && state.replyTo.threadId === conversationId
      ? state.replyTo.messageId
      : null;
    var replySource = replyTo
      ? (findMessageById(conversationId, replyTo) || state.replyTo.source || null)
      : null;
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
            seq: replySource.seq,
            senderName: (replySource.sender && replySource.sender.name) || 'You',
            preview: messagePreview(replySource),
            from: replySource.fromGroup || null,
          }
        : null,
      // Show the real attachments straight away, they are already uploaded.
      attachments: ready.map(function (item) {
        return item.attachment;
      }),
      reactions: [],
      starred: false,
      status: null,
      pending: true,
      lane: lane,
      can: { edit: false, delete: false },
    };

    var guessed = guessMentions(conversationId, text);
    pending.mentions = guessed.mentions;
    pending.mentionsAll = guessed.mentionsAll;
    state.mention = null;

    mergeMessages(conversationId, [pending], false);
    playSentMessageSound();
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

    var payload = {
      body: text,
      replyTo: replyTo,
      nonce: nonce,
      attachments: attachmentIds,
    };
    if (lane) payload.lane = lane;

    window.TMAMessagingAPI.send(conversationId, payload)
      .then(function (data) {
        var bucket = threadBucket(conversationId);
        var confirmed = data.message;
        confirmed.nonce = nonce;

        // Replace the placeholder in place so the bubble does not jump. A copy
        // the arrival event already brought in goes, so the message shows once.
        for (var i = 0; i < bucket.messages.length; i++) {
          if (bucket.messages[i].nonce === nonce) {
            bucket.messages[i] = confirmed;
            break;
          }
        }
        dropSeqDuplicates(bucket);
        persistThread(conversationId);

        var row = findThread(conversationId);
        if (row) {
          row.preview = (confirmed.announcement ? 'Announcement: ' : 'You: ') + messagePreview(confirmed);
          row.timestamp = confirmed.sentAt;
          row.draft = null;
          row.listed = true;
        }

        render({ chatToBottom: true });
      })
      .catch(function (err) {
        // The answer was lost but the message is already here from the server
        // (the arrival event brought it): it was sent, nothing to retry.
        var landed = threadBucket(conversationId).messages.some(function (m) {
          return m.nonce === nonce && m.seq;
        });
        if (landed) {
          render();
          return;
        }

        // No connection (no status: the request never reached the server):
        // the message waits on this device and sends when the connection is
        // back, the server's nonce making a repeat land once.
        if (!err.status && window.TMAQueue && window.TMAQueue.usable()) {
          var parts = [{ name: 'body', value: text }, { name: 'nonce', value: nonce }];
          if (replyTo) parts.push({ name: 'replyTo', value: replyTo });
          if (lane) parts.push({ name: 'lane', value: lane });
          attachmentIds.forEach(function (attachmentId) { parts.push({ name: 'attachments[]', value: attachmentId }); });
          var waiting = Object.assign({}, pending, { pending: false, queued: true });
          var title = thread && (thread.name || thread.title);

          window.TMAQueue.add({
            kind: 'message',
            label: title ? 'Message to ' + title : 'Message',
            url: '/portal/messaging/conversations/' + encodeURIComponent(conversationId) + '/messages',
            parts: parts,
            meta: { conversation: conversationId, nonce: nonce, bubble: waiting },
          }).then(function () {
            var held = threadBucket(conversationId);
            for (var q = 0; q < held.messages.length; q++) {
              if (held.messages[q].nonce === nonce) {
                held.messages[q].pending = false;
                held.messages[q].queued = true;
                break;
              }
            }
            render();
          }).catch(function () {
            markSendFailed();
          });
          return;
        }
        markSendFailed();

        function markSendFailed() {
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
        }
      });
  }

  /* ------------------------------------------------------------------
   * Drafts, per conversation, saved server-side so they survive a reload.
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

  /*
   * Open a conversation by id, even when it is not in the inbox yet.
   *
   * Staff landing from a client file's Message button get an unsent thread
   * that the inbox omits on purpose. History still loads, so they can compose.
   */
  /* `media` ('audio' | 'video') rings once the thread is open — how "Call
     back" on a missed-call notification places the call rather than just
     showing the conversation it was missed in. */
  function openConversationFromId(root, state, render, conversationId, media) {
    if (!conversationId) return;
    showMessagesChats(state);
    if (findThread(conversationId)) {
      openConversation(root, state, render, conversationId);
      subscribeToConversation(root, state, render, conversationId);
      ringConversation(conversationId, media);
      return;
    }
    window.TMAMessagingAPI.messages(conversationId)
      .then(function (data) {
        if (data.conversation) replaceThread(data.conversation);
        openConversation(root, state, render, conversationId);
        subscribeToConversation(root, state, render, conversationId);
        ringConversation(conversationId, media);
      })
      .catch(function () {
        // No answer (no connection): open it from what this device kept.
        openFromDevice(root, state, render, conversationId);
      });
  }

  /*
   * A conversation opened by its link (a notification, a reopened app) with
   * no answer from the server: its row from the kept list, its messages from
   * the kept copy. Nothing kept, nothing opened, as before.
   */
  function openFromDevice(root, state, render, conversationId) {
    if (!window.TMAStore) return;
    accountReady(1500).then(function () {
      if (findThread(conversationId)) return null;

      return window.TMAStore.get('messages:warm');
    }).then(function (snap) {
      var rows = (snap && snap.threads) || [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].id === conversationId && !findThread(conversationId)) {
          STORE.threads.push(rows[i]);
          break;
        }
      }

      return hydrateThread(conversationId);
    }).then(function (painted) {
      if (!painted && !findThread(conversationId)) return;
      openConversation(root, state, render, conversationId);
      render({ chatToBottom: true });
    }).catch(function () { /* nothing kept to open */ });
  }

  /* The same start the call buttons use; see startConversationWith. */
  function ringConversation(conversationId, media) {
    if (!media || !window.TMAMessagingCalls) return;
    var row = findThread(conversationId);
    if (!row) return;
    window.TMAMessagingCalls.start(
      conversationId,
      media === 'video' ? 'video' : 'audio',
      row.name || 'Contact',
      row.photo || null,
      (STORE.me || {}).id
    );
  }

  function openConversation(root, state, render, conversationId) {
    if (!conversationId) return;
    // Same thread while already reading it is a no-op. After Back, selectedId
    // can still name that row so the list highlight stays put; a tap must
    // open it again rather than looking like the row is dead.
    if (conversationId === state.selectedId && state.reading) return;

    // Persist the outgoing conversation's draft before switching, so it stays
    // with the conversation it was written in.
    if (state.selectedId) flushDraft(state.selectedId, getComposerDraft(state));

    // Words being picked from a message belong to the thread they are in.
    state.textSelect = null;
    // Opening a chat ends picking chats in the list, and puts the preview away.
    state.chatSelect = null;
    closeChatPeek();

    // Leaving a thread retracts the indicator there; announceTyping would do
    // it on the next keystroke, but only if there is one.
    stopTyping();

    /*
     * On a phone a chat is a screen over the inbox, the way it is in every
     * messaging app: back is one step, to the list. The iPhone's edge swipe,
     * Android's back and the header's arrow all mean that. Without a history
     * entry of its own the edge swipe opened the menu over the chat and
     * Android's back left Messages altogether. Opened before the chat is
     * drawn, so the snapshot the iPhone keeps for the swipe is the inbox.
     */
    if (isMessagesMobile() && !state.reading && !state.chatScreen && window.TMAPhoneScreens) {
      var screenFor = conversationId;
      state.chatScreen = window.TMAPhoneScreens.open(function () {
        state.chatScreen = null;
        closeConversation(root, state, render, { fromHistory: true });
      }, function (screen) {
        state.chatScreen = screen;
        openConversation(root, state, render, screenFor);
      });
    }

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
    loadScheduled(root, state, render, conversationId);

    if (!bucket.loaded) {
      loadThread(root, state, render, conversationId, { toBottom: true });
    } else {
      markConversationRead(root, state, render, conversationId);
      subscribeToConversation(root, state, render, conversationId);
      // What is held fell behind while this conversation was closed. Show
      // it, and bring the rest in behind it.
      if (bucket.stale) loadThread(root, state, render, conversationId, { toBottom: true, quiet: true });
    }
  }

  /*
   * Leave the open conversation without picking another one.
   *
   * Everything about the inbox is deliberately left alone, scroll position,
   * search text, filters, so closing a chat returns you to exactly the list
   * you were looking at rather than a reset one.
   */
  function closeConversation(root, state, render, opts) {
    // The chat's screen goes with it: the header's arrow or a closing chat
    // takes its history entry, so the next back is not spent on nothing.
    if (state.chatScreen && !(opts && opts.fromHistory) && window.TMAPhoneScreens) {
      var screen = state.chatScreen;
      state.chatScreen = null;
      window.TMAPhoneScreens.closed(screen);
    }
    if (!state.selectedId) return;

    flushDraft(state.selectedId, getComposerDraft(state));

    state.selectedId = null;
    state.reading = false;
    state.editing = null;
    clearReplyTo(state);
    closeMessageMenu();
    closeMessagesRowSwipes(root);
    var listBody = root.querySelector('.tma-dash__messages-list-body');
    if (listBody) listBody.classList.remove('is-swipe-dragging');

    render();
  }

  /* ------------------------------------------------------------------
   * Realtime
   * ---------------------------------------------------------------- */

  var subscribed = {};

  /* The own-channel subscription is one per session, not one per thread. */
  var subscribedSelf = false;

  function startRealtime(root, state, render) {
    var realtime = window.TMAMessagingRealtime;

    // Runs either way. It stands down while the socket is delivering, and
    // is what keeps the page moving whenever it is not.
    startPollingFallback(root, state, render);

    // No websocket configured at all: the poll is all there is.
    if (!STORE.realtime || !realtime || !realtime.start(STORE.realtime)) return;

    if (!realtime._tmaStateBound) {
      realtime._tmaStateBound = true;
      realtime.onState(function (status, detail) {
        /*
         * The list is read before its subscriptions take effect, on first
         * load and again after every reconnect, and whatever is sent in
         * between reaches nobody. Once this page's channels are confirmed,
         * read once more; from there the socket has it.
         */
        if (status !== 'subscribed') return;
        var ours = ((detail && detail.channels) || []).some(function (name) {
          return name.indexOf('private-conversation.') === 0 || name.indexOf('private-messaging.user.') === 0;
        });
        if (ours) refreshInbox(root, state, render);
      });
    }

    getThreads().forEach(function (row) {
      subscribeToConversation(root, state, render, row.id);
    });
  }

  /* Is the socket delivering right now? Refused, down, parked or silent is no. */
  function socketIsLive() {
    var realtime = window.TMAMessagingRealtime;
    if (!realtime || !STORE.realtime || !STORE.realtime.enabled) return false;
    if (typeof realtime.isHealthy === 'function') return realtime.isHealthy();
    return !!(realtime.connected && realtime.socketId);
  }

  /*
   * Read the list again behind what is on screen, and bring the open thread
   * up to date if its row moved on. The same pass serves the poll and the
   * catch-up after a socket comes back.
   */
  var inboxRefresh = null;
  var inboxRefreshAgain = false;

  function refreshInbox(root, state, render) {
    // Asked for again while one is in flight: that answer may already be
    // behind, so run once more after it instead of beside it.
    if (inboxRefresh) {
      inboxRefreshAgain = true;
      return inboxRefresh;
    }

    inboxRefresh = window.TMAMessagingAPI.conversations()
      .then(function (data) {
        var previous = STORE.threads || [];
        var open = state.selectedId;
        var wasOpen = open ? findThread(open) : null;

        STORE.threads = data.conversations || [];
        retainOpenThread(previous, open);
        markMovedThreads(previous);

        // A conversation that appeared since the list was last read.
        getThreads().forEach(function (row) {
          subscribeToConversation(root, state, render, row.id);
        });

        // Opening a thread reads it here before the server has heard, and
        // this list may have been counted in between. A conversation with
        // nothing new in it cannot have gained unread messages.
        var isOpen = open ? findThread(open) : null;
        if (wasOpen && isOpen && !wasOpen.unread && wasOpen.timestamp === isOpen.timestamp) {
          isOpen.unread = 0;
        }

        render();
        syncTabBarBadges();

        // Pull the open thread's newest page if it moved on. Asked of the
        // thread, not of the row: a pull that failed is still owed on the
        // next pass, when the row no longer looks any different.
        var held = open ? STORE.threadMessages[open] : null;
        if (held && held.loaded && held.stale && !held.loading) {
          return window.TMAMessagingAPI.messages(open).then(function (thread) {
            mergeMessages(open, thread.messages || [], false);
            held.stale = false;
            render();
            window.TMAMessagingAPI.markDelivered(open).catch(function () {});
            if (!document.hidden) markConversationRead(root, state, render, open);
          });
        }
      })
      .catch(function () {
        // A missed pass is not worth surfacing; the next one retries.
      })
      .then(function () {
        inboxRefresh = null;
        if (!inboxRefreshAgain) return;
        inboxRefreshAgain = false;
        return refreshInbox(root, state, render);
      });

    return inboxRefresh;
  }

  /*
   * Fallback for when live updates are not arriving: no socket configured,
   * the cluster refusing this tab, or a connection that is down. Deliberately
   * slower than the socket - it exists so the page keeps working, not so it
   * feels instant. Skipped while the tab is hidden, and a pass in six while
   * Messages is not the page on show: the nav badge still has to move.
   *
   * It used to start only when a refusal was heard, and the shell opens the
   * socket long before this page listens to it. A tab the cluster had turned
   * away got neither live updates nor this, until it was reloaded.
   */
  var POLL_INTERVAL = 10000;
  var POLL_AWAY_EVERY = 6;
  var pollTimer = null;
  var pollTick = 0;
  var pollWarned = false;

  function startPollingFallback(root, state, render) {
    if (pollTimer) return;

    pollTimer = setInterval(function () {
      if (document.hidden || !root.isConnected) return;
      if (socketIsLive()) return;

      pollTick += 1;
      // No boxes at all while the Messages view is not the one showing.
      if (!root.getClientRects().length && pollTick % POLL_AWAY_EVERY !== 0) return;

      if (!pollWarned && window.console) {
        pollWarned = true;
        console.warn('[messaging] live updates unavailable, falling back to polling.');
      }

      refreshInbox(root, state, render);
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

    window.TMAMessagingRealtime.listen(channel, 'call.signal', function (payload) {
      if (window.TMAMessagingCalls) {
        // The caller's signal has no avatar, but the answerer already has this
        // conversation locally, hand the calls module the peer's name/photo so
        // the incoming call and pill can show their picture, not just initials.
        var row = payload && findThread(payload.conversationId);
        if (row) {
          payload._peerName = row.name;
          payload._peerPhoto = row.photo || null;
        }
        window.TMAMessagingCalls.onSignal(payload, (STORE.me || {}).id);
      }
    });

    window.TMAMessagingRealtime.listen(channel, 'message.updated', function (payload) {
      var msg = findMessageById(payload.conversationId, payload.messageId);
      if (!msg) return;
      // A requested file arrived: the card is redrawn, nothing was edited.
      if (payload.fileRequest) {
        msg.fileRequest = payload.fileRequest;
        persistThread(payload.conversationId);
        render();
        return;
      }
      msg.body = payload.body;
      msg.edited = true;
      if (payload.mentions) msg.mentions = payload.mentions;
      if (typeof payload.mentionsAll === 'boolean') msg.mentionsAll = payload.mentionsAll;
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

      // The event carries counts and names but not "mine", that is per
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
      var reader = payload.reader || {};
      var readerId = reader.id || payload.readerId;
      list.forEach(function (msg) {
        if (!(msg.direction === 'out' && msg.seq && msg.seq <= payload.lastReadSeq)) return;
        if (msg.status !== 'read') {
          msg.status = 'read';
          changed = true;
        }
        if (!readerId) return;
        if (!msg.seenBy) msg.seenBy = [];
        var known = msg.seenBy.some(function (person) { return person.id === readerId; });
        if (!known) {
          msg.seenBy.push({
            id: readerId,
            name: reader.name || 'Someone',
            avatar: reader.avatar || null,
            seenAt: payload.seenAt || new Date().toISOString(),
          });
          changed = true;
        }
      });
      if (changed) render();
    });

    window.TMAMessagingRealtime.listen(channel, 'messaging.typing', function (payload) {
      noteTyping(payload.conversationId, payload.userId, payload.name, payload.typing, render);
    });

    window.TMAMessagingRealtime.listen(channel, 'messaging.presence', function (payload) {
      if (STORE.me && payload.userId === STORE.me.id) return;
      applyPresence(payload, render);
    });
  }

  /*
   * Somebody came online or went offline. The event carries no conversation,
   * because one person's presence is the same fact in every thread they are
   * in, so it is applied to every row that resolves to them.
   */
  function applyPresence(payload, render) {
    var changed = false;
    // Said outright when the event carries it: a chosen status such as In
    // Office outlives the connection, so "not offline" is not "online".
    var online = typeof payload.online === 'boolean'
      ? payload.online
      : (payload.status ? payload.status !== 'offline' : false);

    (STORE.threads || []).forEach(function (row) {
      if (row.counterpartId && row.counterpartId === payload.userId) {
        if (payload.status) {
          row.presence = {
            online: online,
            status: payload.status,
            statusLabel: payload.label,
            statusSource: payload.source,
            statusMessage: payload.message,
            statusIcon: payload.icon,
          };
          if (!online) {
            row.presence.lastSeenAt = payload.lastSeenAt || null;
            row.presence.lastSeen = payload.lastSeenLabel || 'Last seen recently';
          }
        } else {
          row.presence = online
            ? { online: true, status: 'online', statusLabel: 'Online' }
            : { online: false, status: 'offline', statusLabel: 'Offline', lastSeen: payload.lastSeenLabel || 'Last seen recently' };
        }
        changed = true;
        return;
      }

      if (row.type !== 'group' || !Array.isArray(row.members)) return;

      var member = null;
      for (var i = 0; i < row.members.length; i++) {
        if (row.members[i] && row.members[i].id === payload.userId) {
          member = row.members[i];
          break;
        }
      }
      if (!member) return;

      var wasOnline = !!member.online;
      var statusChanged = !!(payload.status && member.status !== payload.status);
      if (payload.status) {
        member.status = payload.status;
        member.statusIcon = payload.icon || member.statusIcon || null;
      }
      if (wasOnline === online && !statusChanged) return;

      if (wasOnline !== online) {
        member.online = online;
        if (online) {
          member.lastSeenAt = new Date().toISOString();
        } else if (payload.lastSeenAt) {
          member.lastSeenAt = payload.lastSeenAt;
        }

        if (!row.presence) row.presence = {};
        var count = parseInt(row.presence.onlineCount, 10) || 0;
        count = online ? count + 1 : Math.max(0, count - 1);
        row.presence.onlineCount = count;
        row.presence.label = count > 0
          ? (count === 1 ? '1 online' : count + ' online')
          : (parseInt(row.memberCount, 10) === 1
            ? '1 member'
            : (parseInt(row.memberCount, 10) || 0) + ' members');
      }

      row.members.sort(function (a, b) {
        var ao = a.online ? 0 : 1;
        var bo = b.online ? 0 : 1;
        if (ao !== bo) return ao - bo;
        var at = a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0;
        var bt = b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0;
        if (bt !== at) return bt - at;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });

      changed = true;
    });

    // A typing indicator cannot outlive its typist's connection.
    if (!online) {
      Object.keys(typingBy).forEach(function (conversationId) {
        if (typingBy[conversationId][payload.userId]) {
          delete typingBy[conversationId][payload.userId];
          changed = true;
        }
      });
    }

    if (changed) render();
  }

  /*
   * The signed-in user's own fan-out channel.
   *
   * Conversation channels only cover the thread that happens to be open, so
   * this is what moves the unread badge when a message arrives somewhere
   * else, and what keeps two open tabs agreeing about pin, archive and read.
   */
  function subscribeToOwnChannel(root, state, render) {
    if (!STORE.me || !window.TMAMessagingRealtime) return;
    if (!STORE.realtime || !STORE.realtime.enabled) return;
    if (subscribedSelf) return;

    subscribedSelf = true;
    var channel = 'private-messaging.user.' + STORE.me.id;

    /*
     * Call signalling on this user's *own* channel.
     *
     * The conversation channel carries it too, but a client only subscribes to
     * the thread it currently has open, so a call rung into any other
     * conversation used to reach nobody. This is the subscription that makes an
     * incoming call actually arrive. Duplicates across the two channels are
     * settled by the signal id (see App\Events\CallSignal).
     */
    window.TMAMessagingRealtime.listen(channel, 'call.signal', function (payload) {
      if (!window.TMAMessagingCalls) return;
      var row = payload && findThread(payload.conversationId);
      if (row) {
        payload._peerName = row.name;
        payload._peerPhoto = row.photo || null;
      }
      window.TMAMessagingCalls.onSignal(payload, (STORE.me || {}).id);

      // A call that ended is a call that may have been missed. The server has
      // just written the history line, so read the badge back rather than
      // guessing at it here, only the server knows whether this one counts.
      if (payload && (payload.type === 'hangup' || payload.type === 'reject')) {
        setTimeout(function () { refreshTabCounts(root, state, render); }, 400);
      }
    });

    window.TMAMessagingRealtime.listen(channel, 'messaging.inbox', function (payload) {
      // payload.totalUnread is deliberately not stored. The badge is summed
      // from the visible rows, which excludes archived threads; the server
      // total counts them. Keeping both would be two answers to one question.
      var row = findThread(payload.conversationId);

      if (!row && payload.reason === 'message' && payload.conversationId) {
        // First real message on a thread that was not in the inbox yet
        // (opened from a client file, never written in). Pull it in.
        window.TMAMessagingAPI.messages(payload.conversationId).then(function (data) {
          if (data.conversation) {
            data.conversation.listed = true;
            replaceThread(data.conversation);
            subscribeToConversation(root, state, render, payload.conversationId);
            render();
            syncTabBarBadges();
          }
        }).catch(function () {});
        return;
      }

      if (row && payload.reason === 'state') {
        if (payload.detail && typeof payload.detail.pinned === 'boolean') row.pinned = payload.detail.pinned;
        if (payload.detail && typeof payload.detail.archived === 'boolean') row.archived = payload.detail.archived;
        if (payload.detail && typeof payload.detail.muted === 'boolean') row.muted = payload.detail.muted;
      }

      if (row && payload.reason === 'read') {
        row.unread = 0;
      }

      // Arriving messages are not announced here, the conversation channel
      // already covers them for every thread, open or not.
      syncTabBarBadges();
      render();
    });

    if (STORE.me && STORE.me.isStaff) {
      window.TMAMessagingRealtime.listen('private-portal.staff', 'presence.status', function (payload) {
        if (STORE.me && payload.userId === STORE.me.id) return;
        applyPresence(payload, render);
      });
    }
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

      pullArrival(root, state, render, conversationId, payload, 0);
      return;
    }

    // Not the open conversation, but it still arrived at this client.
    window.TMAMessagingAPI.markDelivered(conversationId).catch(function () {});
    refreshConversationRow(root, state, render, conversationId, payload);
  }

  function pullArrival(root, state, render, conversationId, payload, attempt) {
    window.TMAMessagingAPI.messages(conversationId)
      .then(function (data) {
        mergeMessages(conversationId, data.messages || [], false);
        if (data.conversation) replaceThread(data.conversation);
        render();

        // A scheduled announcement arrives as a message like any other, so
        // an arrival where one was waiting may be it going out.
        if (scheduledFor(conversationId).length) loadScheduled(root, state, render, conversationId);

        // Acknowledge receipt first, that is true the moment it arrives.
        // Marking it read is a separate, weaker claim and only holds if the
        // tab is actually visible.
        window.TMAMessagingAPI.markDelivered(conversationId).catch(function () {});
        if (!document.hidden) markConversationRead(root, state, render, conversationId);

        // An internal note shares the case channel. Someone who cannot see it
        // gets a page that does not contain the message, and should not be
        // told that something arrived.
        var arrived = !payload || !payload.messageId || (data.messages || []).some(function (m) {
          return m.id === payload.messageId;
        });
        if (arrived) notifyNewMessage(root, conversationId, payload);
      })
      .catch(function () {
        // The event is only the doorbell, and it rings once. Ask again
        // before leaving the message owed to the next pass over the list.
        if (attempt < 2) {
          setTimeout(function () {
            pullArrival(root, state, render, conversationId, payload, attempt + 1);
          }, 1500 * (attempt + 1));
          return;
        }
        markThreadStale(conversationId);
      });
  }

  function refreshConversationRow(root, state, render, conversationId, payload) {
    window.TMAMessagingAPI.messages(conversationId)
      .then(function (data) {
        // A thread read earlier is still held, and opening it again shows
        // what is held without asking. Moving only the row left the reply
        // out of its own conversation until the page was reloaded.
        var held = STORE.threadMessages[conversationId];
        if (held && held.loaded) mergeNewestPage(conversationId, data);

        if (data.conversation) {
          replaceThread(data.conversation);
          render();
          syncTabBarBadges();
        }
        notifyNewMessage(root, conversationId, payload);
      })
      .catch(function () {
        markThreadStale(conversationId);
      });
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

    /*
     * The desktop banner carries the sound whenever it is going to make one —
     * it is raised for every module and does not depend on this conversation
     * being loaded, so it is the reliable announcer while the app is in the
     * background. Playing here as well would be two sounds for one message.
     *
     * When it will not sound (app in front, notifications off or not granted,
     * sounds switched off) this is still the only tone there is, so the check
     * asks about *this* moment rather than assuming the background case.
     */
    var announced = !!(window.TMADesktopNotify
      && typeof window.TMADesktopNotify.willSound === 'function'
      && window.TMADesktopNotify.willSound());

    if (STORE.settings.notificationSounds && !announced) playIncomingMessageSound();

    /*
     * The desktop banner is not raised here.
     *
     * It used to be, which meant it only ever appeared on the two shells that
     * mount Messages, and only while the tab was hidden. It now belongs to the
     * notification store (notify-store.js), which runs on every page and gets
     * the same arrival over the portal notification channel, so being on the
     * Calendar, or in another application entirely, still notifies.
     */
  }

  /* ------------------------------------------------------------------
   * Sounds
   *
   * Keys, not paths, are what a preference stores; this is the only place
   * that maps one to a file. 'beep' is the synthesised tone this file has
   * always played and ships no asset, so it stays available as the lightest
   * option, and as the fallback if a key ever goes missing.
   *
   * Each sound is one <audio> element, reused. Building a new Audio() per
   * arrival leaves a pile of elements behind on a busy thread and re-fetches
   * the file before the second one can start.
   * ---------------------------------------------------------------- */

  var AUDIO_PATH = 'audio/';

  var MESSAGE_TONE_FILES = {
    chime: AUDIO_PATH + 'message-chime.mp3',
    system: AUDIO_PATH + 'notification-system.mp3',
  };

  var SENT_TONE_FILE = AUDIO_PATH + 'message-sent.mp3';

  var RINGTONE_FILES = {
    'ringtone-1': AUDIO_PATH + 'ringtone-1.mp3',
    'ringtone-2': AUDIO_PATH + 'ringtone-2.mp3',
  };

  var toneElements = {};

  function toneElement(src) {
    if (!toneElements[src]) {
      var el = new Audio(src);
      el.preload = 'auto';
      toneElements[src] = el;
    }
    return toneElements[src];
  }

  /*
   * Rewound before every play so two arrivals in quick succession both sound.
   * A blocked play() is not an error worth surfacing: browsers refuse audio
   * until the page has been interacted with, and the badge and the bubble have
   * already said the same thing.
   */
  function playTone(src, volume) {
    if (!src) return null;
    try {
      var el = toneElement(src);
      el.loop = false;
      el.volume = volume == null ? 1 : volume;
      el.currentTime = 0;
      var played = el.play();
      if (played && played.catch) played.catch(function () { /* autoplay blocked */ });
      return el;
    } catch (err) {
      return null;
    }
  }

  function messageToneKey() {
    var key = STORE.settings.messageTone;
    if (key === 'none' || key === 'beep') return key;
    return MESSAGE_TONE_FILES[key] ? key : 'chime';
  }

  /*
   * In the iPhone app the short tones play natively, as system sounds. Page
   * audio is media to iOS: a one-second chime put up the Now Playing panel
   * (title, scrubber, AirPlay) and could pause music. False anywhere else, or
   * for a tone the app does not carry, and the page plays it itself.
   */
  function playNativeTone(name) {
    var host = window.TMADesktop;
    try {
      return !!(host && typeof host.playTone === 'function' && host.playTone(name));
    } catch (err) {
      return false;
    }
  }

  function playMessageTone(key, volume) {
    if (key === 'none') return;
    if (playNativeTone(key)) return;
    if (key === 'beep') { playSynthesisedTone(); return; }
    playTone(MESSAGE_TONE_FILES[key], volume == null ? 0.7 : volume);
  }

  /* An arriving message, in a conversation that is not muted. */
  function playIncomingMessageSound() {
    playMessageTone(messageToneKey());
  }

  /*
   * The send confirmation. Deliberately not a separate preference: it is the
   * counterpart of the arrival tone, so it follows it, silence one and you
   * have silenced both.
   */
  function playSentMessageSound() {
    if (!STORE.settings.notificationSounds) return;
    if (messageToneKey() === 'none') return;
    if (playNativeTone('sent')) return;
    playTone(SENT_TONE_FILE, 0.45);
  }

  /*
   * Settings previews. A ringtone runs 7–16 seconds, which is right for a call
   * and far too long for "what does this one sound like", so a preview is cut
   * short, and any previous one stopped, so flicking through the list never
   * layers two tones over each other.
   */
  var previewTone = null;
  var previewTimer = null;

  function stopTonePreview() {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    if (previewTone) {
      try { previewTone.pause(); previewTone.currentTime = 0; } catch (err) { /* ignore */ }
      previewTone = null;
    }
  }

  function previewSetting(key, value) {
    stopTonePreview();

    if (key === 'messageTone') {
      playMessageTone(value === 'none' ? 'none' : value);
      return;
    }

    if (key === 'ringtone') {
      if (value === 'none') return;
      previewTone = playTone(RINGTONE_FILES[value] || RINGTONE_FILES['ringtone-1'], 0.7);
      previewTimer = setTimeout(stopTonePreview, 4000);
    }
  }

  var audioContext = null;

  /* A short tone, synthesised rather than shipped as an asset. */
  function playSynthesisedTone() {
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

  /* ------------------------------------------------------------------
   * Highlighting part of a message.
   *
   * On a computer the words are dragged over like any other text. On a
   * phone a press-and-hold opens the message menu, so the menu's "Select
   * text" puts that one message into a picking state: its words become
   * selectable, start out all highlighted, and the selection handles take
   * them in or out. A bar over the message box copies just what is
   * highlighted, or ends it. Copy text from the menu copies the highlight
   * too, when there is one, and the whole message only when there is not.
   * ---------------------------------------------------------------- */

  function isTextSelecting(state, messageId) {
    return !!(state.textSelect &&
      state.textSelect.threadId === state.selectedId &&
      state.textSelect.messageId === messageId);
  }

  function renderTextSelectBar(state) {
    if (!state.textSelect || state.textSelect.threadId !== state.selectedId) return '';

    return (
      '<div class="tma-dash__messages-select-bar" role="toolbar" aria-label="Choose words to copy">' +
      '<span class="tma-dash__messages-select-bar-hint">Drag to choose words</span>' +
      '<button type="button" class="tma-dash__messages-select-bar-btn tma-dash__messages-select-bar-btn--primary"' +
      ' data-messages-select-copy>Copy</button>' +
      '<button type="button" class="tma-dash__messages-select-bar-btn" data-messages-select-done>Done</button>' +
      '</div>'
    );
  }

  /* The words of this message that are highlighted right now, or ''. */
  function highlightedTextIn(root, messageId) {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
    var host = root.querySelector('[data-messages-id="' + cssEscape(messageId) + '"] .tma-dash__messages-bubble-copy');
    if (!host) return '';
    var range = sel.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer) && !range.intersectsNode(host)) return '';
    // Only the part of the selection that lies in this message's words.
    var clipped = range.cloneRange();
    var whole = document.createRange();
    whole.selectNodeContents(host);
    if (clipped.compareBoundaryPoints(Range.START_TO_START, whole) < 0) {
      clipped.setStart(whole.startContainer, whole.startOffset);
    }
    if (clipped.compareBoundaryPoints(Range.END_TO_END, whole) > 0) {
      clipped.setEnd(whole.endContainer, whole.endOffset);
    }
    return String(clipped.toString() || '').trim();
  }

  /*
   * The last highlight made inside a message. Tapping a button can drop the
   * page's selection before the click lands (iOS does), so the words are
   * remembered as they are chosen and Copy uses them.
   */
  var lastHighlight = null;

  document.addEventListener('selectionchange', function () {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    var node = sel.getRangeAt(0).commonAncestorContainer;
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    var row = el && el.closest ? el.closest('[data-messages-id]') : null;
    if (!row) return;
    var root = row.closest('[data-messages]') || document;
    var id = row.getAttribute('data-messages-id');
    var text = highlightedTextIn(root, id);
    if (text) lastHighlight = { messageId: id, text: text, at: Date.now() };
  });

  function rememberedHighlight(messageId) {
    if (!lastHighlight || lastHighlight.messageId !== messageId) return '';
    // A highlight from a while ago is not what this tap is about.
    return Date.now() - lastHighlight.at < 120000 ? lastHighlight.text : '';
  }

  function startTextSelect(root, state, render, msg) {
    state.textSelect = { threadId: state.selectedId, messageId: msg.id };
    lastHighlight = null;
    render();

    // Start with the whole message highlighted; the handles narrow it.
    var host = root.querySelector('[data-messages-id="' + cssEscape(msg.id) + '"] .tma-dash__messages-bubble-copy');
    var sel = window.getSelection ? window.getSelection() : null;
    if (!host || !sel) return;
    var range = document.createRange();
    range.selectNodeContents(host);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function endTextSelect(state, render) {
    if (!state.textSelect) return;
    state.textSelect = null;
    lastHighlight = null;
    var sel = window.getSelection ? window.getSelection() : null;
    if (sel) sel.removeAllRanges();
    if (render) render();
  }

  /* `text`, when given, is the part of the message that was highlighted. */
  function copyMessageText(root, msg, text) {
    var picked = !!text;
    text = text || msg.body || '';
    if (!text) return;
    var done = picked ? 'Copied' : 'Message copied';

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(function () {
          showMessagesToast(root, done);
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
      showMessagesToast(root, done);
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

  function toggleMessagePin(root, state, render, msg) {
    var next = !msg.starred;
    msg.starred = next;
    render();
    window.TMAMessagingAPI.starMessage(msg.id)
      .then(function (data) {
        msg.starred = !!(data && data.starred);
        render();
        showMessagesToast(root, msg.starred ? 'Message pinned' : 'Message unpinned');
      })
      .catch(function () {
        msg.starred = !next;
        render();
        showMessagesToast(root, 'Could not update pin');
      });
  }

  /* How many conversations one forward may go to. */
  var FORWARD_MAX = 10;

  /*
   * Forward a message: what goes with it, and where it goes, in one dialog.
   *
   * The text is the forwarder's to change on the way, and a file that came
   * with no caption can be given one. The files themselves go as they are;
   * the server copies them. This used to be a window.prompt asking for a
   * conversation's name, which the desktop app does not have, so there the
   * menu item did nothing at all.
   */
  function forwardMessage(root, state, render, msg) {
    var portal = window.TMAPortalUI;
    var api = window.TMAMessagingAPI;
    if (!portal) return;

    var targets = getThreads().filter(function (row) {
      return row.id !== state.selectedId && !row.archived && !row.blocked;
    });
    if (!targets.length) {
      showMessagesToast(root, 'No other conversations to forward to');
      return;
    }

    var files = msg.attachments || [];
    var isVoice = msg.type === 'voice';
    // A voice note is the whole message: there is nothing to caption.
    var editable = !isVoice;

    var filesLine = files.length ? portal.field('Forwarding', renderForwardPreview(files)) : '';

    portal.openModal({
      title: 'Forward',
      // Its own class: here the list is the part that scrolls, so the title
      // and the Forward button are on screen however long the list is.
      cls: 'tma-dash__messages-forward',
      body:
        filesLine +
        (editable
          ? portal.field(files.length ? 'Caption' : 'Message', portal.textarea({
              value: msg.body || '',
              attrs: 'data-messages-forward-body rows="3" maxlength="20000"',
            }))
          : '') +
        '<div class="tma-dash__messages-forward-to">' +
        portal.field(
          'Send to',
          portal.input({
            placeholder: 'Search',
            ariaLabel: 'Search conversations',
            attrs: 'data-messages-forward-search',
          }) +
          '<div class="tma-portal-check-list" data-messages-forward-list>' +
          targets.map(function (row) {
            return (
              '<label class="tma-portal-check-row" data-messages-forward-row="' +
              esc(String(row.name || '').toLowerCase()) + '">' +
              '<input type="checkbox" class="tma-dash__check" value="' + esc(row.id) + '">' +
              // The face the chat list gives it: a name alone is a lot to
              // ask of anyone choosing between two people called Peer.
              threadIcon(resolveThread(row)) +
              '<span>' + esc(row.name || 'Conversation') + '</span>' +
              '</label>'
            );
          }).join('') +
          '</div>'
        ) +
        '</div>' +
        '<div data-messages-forward-error hidden></div>' +
        '<div class="tma-portal-form-actions">' +
        portal.btn({ label: 'Forward', attrs: ' data-messages-forward-save', disabled: true }) +
        '</div>',
      onMount: function (host) {
        var body = host.querySelector('[data-messages-forward-body]');
        bindEmphasisKeys(body);
        var search = host.querySelector('[data-messages-forward-search]');
        var list = host.querySelector('[data-messages-forward-list]');
        var save = host.querySelector('[data-messages-forward-save]');
        var error = host.querySelector('[data-messages-forward-error]');

        // Said in the dialog itself: the page's toast sits under it.
        function fail(message) {
          error.innerHTML = portal.banner('warning', esc(message));
          error.hidden = false;
        }

        function settle() {
          error.hidden = true;
          error.innerHTML = '';
        }

        function chosen() {
          return Array.prototype.map.call(list.querySelectorAll('input:checked'), function (box) {
            return box.value;
          });
        }

        search.addEventListener('input', function () {
          var term = search.value.trim().toLowerCase();
          list.querySelectorAll('[data-messages-forward-row]').forEach(function (row) {
            // The row is a flex label, which outranks the hidden attribute.
            row.style.display = !term || row.getAttribute('data-messages-forward-row').indexOf(term) !== -1 ? '' : 'none';
          });
        });

        list.addEventListener('change', function (e) {
          var picked = chosen();
          if (picked.length > FORWARD_MAX && e.target && e.target.checked) {
            e.target.checked = false;
            fail('Forward to ' + FORWARD_MAX + ' conversations at most');
            return;
          }
          settle();
          save.disabled = !picked.length;
        });

        if (body) body.addEventListener('input', settle);

        save.addEventListener('click', function () {
          var picked = chosen();
          if (!picked.length) return;

          var text = body ? body.value : undefined;
          if (!files.length && !(text || '').trim()) {
            fail('A message needs some text');
            body.focus();
            return;
          }

          save.disabled = true;
          var sent = [];

          // One after another: each is its own message, and a failure part
          // way through has to be able to say how far it got.
          picked
            .reduce(function (chain, conversationId) {
              return chain.then(function () {
                return api.forwardMessage(msg.id, conversationId, text).then(function (data) {
                  absorbForward(root, state, render, conversationId, data);
                  sent.push(conversationId);
                });
              });
            }, Promise.resolve())
            .then(function () {
              portal.closeModal();
              render();
              syncTabBarBadges();
              var only = sent.length === 1 ? findThread(sent[0]) : null;
              showMessagesToast(
                root,
                only ? 'Forwarded to ' + only.name : 'Forwarded to ' + sent.length + ' conversations'
              );
            })
            .catch(function (err) {
              save.disabled = false;
              render();
              syncTabBarBadges();

              // What went is unticked, so trying again does not send it twice.
              sent.forEach(function (id) {
                var box = list.querySelector('input[value="' + id + '"]');
                if (box) box.checked = false;
              });

              var reason = err && err.status === 403
                ? 'You cannot send to this conversation'
                : (err && err.status === 422 && err.message) || 'Message not forwarded';
              fail(sent.length ? 'Forwarded to ' + sent.length + ', then stopped. ' + reason : reason);
            });
        });
      },
    });
  }

  /*
   * What is being forwarded, shown in the Forward dialog.
   *
   * A picture is shown as the picture, the way its bubble shows it, so what
   * is about to be sent can be seen and not only named. Anything else is the
   * card the composer shows for a file it has staged: its icon, name and size.
   */
  function renderForwardPreview(files) {
    var images = files.filter(function (file) { return file.kind === 'image'; });
    var others = files.filter(function (file) { return file.kind !== 'image'; });

    return (
      '<div class="tma-dash__messages-forward-preview" data-messages-forward-preview>' +
      (images.length
        ? '<div class="tma-dash__messages-forward-images">' +
          images.map(function (file) {
            return (
              '<span class="tma-dash__messages-attachment tma-dash__messages-attachment--image">' +
              '<img src="' + esc(file.thumbUrl || file.url) + '" alt="' + esc(file.name || '') + '">' +
              '</span>'
            );
          }).join('') +
          '</div>'
        : '') +
      (others.length
        ? '<div class="tma-dash__messages-tray">' +
          others.map(function (file) {
            var name = file.kind === 'voice' ? 'Voice note' : (file.name || 'File');
            return (
              '<div class="tma-dash__messages-tray-item">' +
              '<span class="tma-dash__messages-tray-thumb">' +
              (file.thumbUrl
                ? '<img src="' + esc(file.thumbUrl) + '" alt="">'
                : '<img class="tma-dash__messages-tray-icon" src="' +
                  esc(attachmentIconSrc(file.name || '')) + '" alt="">') +
              '</span>' +
              '<span class="tma-dash__messages-tray-text">' +
              '<span class="tma-dash__messages-tray-name" title="' + esc(name) + '">' + esc(name) + '</span>' +
              '<span class="tma-dash__messages-tray-meta">' + esc(formatBytes(file.size)) + '</span>' +
              '</span></div>'
            );
          }).join('') +
          '</div>'
        : '') +
      '</div>'
    );
  }

  /*
   * A forward is a message this tab sent into another conversation. Its row
   * moves, and a thread already read into memory has to be given the message
   * or it would be opened without it.
   */
  function absorbForward(root, state, render, conversationId, data) {
    if (!data) return;
    if (data.conversation) replaceThread(data.conversation);

    var held = STORE.threadMessages[conversationId];
    if (data.message && held && held.loaded) mergeMessages(conversationId, [data.message], false);

    subscribeToConversation(root, state, render, conversationId);
  }

  function translateMessage(root, state, render, msg) {
    if (!msg.body) {
      showMessagesToast(root, 'Nothing to translate');
      return;
    }

    var host = root.querySelector('[data-messages-id="' + msg.id + '"] .tma-dash__messages-bubble-copy');
    if (msg._translated) {
      if (host) host.innerHTML = renderMessageText(msg);
      msg._translated = false;
      showMessagesToast(root, 'Original text restored');
      return;
    }

    function apply(text) {
      msg._translated = true;
      if (host) host.innerHTML = renderMessageText({ body: text });
      showMessagesToast(root, 'Translated');
    }

    // Prefer the browser Translator API when present; otherwise open a translate tab.
    if (window.Translator && typeof window.Translator.create === 'function') {
      window.Translator.create({ sourceLanguage: 'auto', targetLanguage: 'en' })
        .then(function (translator) { return translator.translate(msg.body); })
        .then(apply)
        .catch(function () {
          window.open(
            'https://translate.google.com/?sl=auto&tl=en&text=' + encodeURIComponent(msg.body),
            '_blank',
            'noopener'
          );
        });
      return;
    }

    window.open(
      'https://translate.google.com/?sl=auto&tl=en&text=' + encodeURIComponent(msg.body),
      '_blank',
      'noopener'
    );
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
    var previousMentions = { mentions: msg.mentions, mentionsAll: msg.mentionsAll };
    var guessed = guessMentions(state.selectedId, text);
    msg.body = text;
    msg.edited = true;
    msg.mentions = guessed.mentions;
    msg.mentionsAll = guessed.mentionsAll;
    state.mention = null;
    render();

    window.TMAMessagingAPI.editMessage(msg.id, text).then(function (data) {
      // Who the new text addresses is the server's to say.
      if (!data || !data.message) return;
      msg.mentions = data.message.mentions || [];
      msg.mentionsAll = !!data.message.mentionsAll;
      render();
    }).catch(function (err) {
      msg.body = previous;
      msg.mentions = previousMentions.mentions;
      msg.mentionsAll = previousMentions.mentionsAll;
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
   * request was in flight, otherwise a slow response for "an" can land after
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
    // A ringtone preview must not outlive the panel it was started from.
    stopTonePreview();
    render();
  }

  /* Open (or reuse) a direct conversation with someone and select it. */
  /**
   * Open (or create) the direct conversation with one person.
   *
   * `media` places a call as soon as it is open. A call needs a *conversation*
   * id, which callers outside Messages never have, the Dashboard's People
   * board knows a user id and nothing else, so "call this person" has to
   * resolve the conversation first and then ring. Doing it here rather than in
   * each caller keeps the conversation lookup, the subscription and the call in
   * the order the rest of the page expects.
   */
  function startConversationWith(root, state, render, userId, media) {
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

        if (media && window.TMAMessagingCalls) {
          var row = findThread(conversation.id) || conversation;
          window.TMAMessagingCalls.start(
            conversation.id,
            media === 'video' ? 'video' : 'audio',
            row.name || 'Contact',
            row.photo || null,
            (STORE.me || {}).id
          );
        }
      })
      .catch(function (err) {
        showMessagesToast(
          root,
          err.status === 403 ? 'You cannot message this person' : 'Conversation could not be opened'
        );
      });
  }

  /*
   * Answer a group message one to one.
   *
   * Opens the direct conversation with whoever wrote it, with their message
   * already quoted in the composer. The quote is carried on the reply, with
   * the group it came from, because the direct thread does not hold it. The
   * server accepts it only for the message's own author, in a group the
   * sender is still in.
   */
  function replyPrivately(root, state, render, msg) {
    var group = findThread(state.selectedId);
    if (!group || !msg.sender || !msg.sender.id) return;

    var source = {
      id: msg.id,
      seq: msg.seq,
      type: msg.type,
      direction: 'in',
      body: msg.body,
      sender: msg.sender,
      attachments: msg.attachments || [],
      fromGroup: { id: group.id, name: group.name },
    };

    window.TMAMessagingAPI.openDirect(msg.sender.id)
      .then(function (data) {
        var conversation = data.conversation;
        replaceThread(conversation);

        // openConversation() bails when the id is already selected, and it
        // clears any reply in progress, so the quote goes on after it.
        state.selectedId = null;
        showMessagesChats(state);
        openConversation(root, state, render, conversation.id);
        subscribeToConversation(root, state, render, conversation.id);

        state.replyTo = { threadId: conversation.id, messageId: msg.id, source: source };
        render();
        focusComposerInput(root);
      })
      .catch(function (err) {
        showMessagesToast(
          root,
          err.status === 403 ? 'You cannot message this person' : 'Conversation could not be opened'
        );
      });
  }

  /*
   * The calls module lives outside this file and has no store of its own, so
   * the call-related settings are handed to it whenever settings load or
   * change, the display preference, and what to ring with. Devices are
   * deliberately not here: those are per-machine and the calls module keeps
   * them in localStorage.
   */
  function publishCallSettings() {
    window.TMAMessagingSettings = window.TMAMessagingSettings || {};
    window.TMAMessagingSettings.callDisplay = STORE.settings.callDisplay || 'island';
    window.TMAMessagingSettings.ringtone = STORE.settings.ringtone || 'ringtone-1';
    window.TMAMessagingSettings.notificationSounds = STORE.settings.notificationSounds !== false;
    // The calls module shows an incoming-call desktop notification. Passed
    // through raw (not coerced) so the calls side can treat "unset" as on, a
    // ringing call is high-priority, while still honouring an explicit off.
    window.TMAMessagingSettings.desktopNotifications = STORE.settings.desktopNotifications;
    if (window.TMAMessagingCalls && window.TMAMessagingCalls.setDisplayPreference) {
      window.TMAMessagingCalls.setDisplayPreference(window.TMAMessagingSettings.callDisplay);
    }
  }

  /*
   * The notification store raises the desktop banners and lives on every
   * shell, so it is told the moment either preference changes here rather than
   * waiting for the next page load to pick them up from /me.
   */
  function publishDesktopSettings() {
    if (!window.TMADesktopNotify) return;
    window.TMADesktopNotify.applyPrefs({
      enabled: !!STORE.settings.desktopNotifications,
      preview: STORE.settings.notificationPreview !== false,
    });
  }

  /*
   * A banner the user asked for by switching the setting on, so it is shown
   * whether or not the window is in the background, the whole point is that
   * they see it happen.
   */
  function showTestDesktopNotification() {
    try {
      var note = new Notification('Desktop notifications are on', {
        body: 'This is how a new message will appear.',
        tag: 'tma-desktop-test',
        silent: true,
      });
      setTimeout(function () {
        try { note.close(); } catch (err) { /* ignore */ }
      }, 5000);
    } catch (err) {
      /* the setting is still saved; the banner was only a demonstration */
    }
  }

  /* Persist one messaging setting. Optimistic; reverted if the write fails. */
  function updateSetting(root, state, render, key, value) {
    var previous = STORE.settings[key];
    STORE.settings[key] = value;
    render();

    // Desktop notifications are useless without browser permission, so ask at
    // the moment the user turns them on, the toggle is the user gesture the
    // browser requires before it will even show the prompt.
    if (key === 'desktopNotifications' && value) {
      var desktop = window.TMADesktopNotify;

      if (!desktop || !desktop.isSupported()) {
        STORE.settings[key] = false;
        render();
        showMessagesToast(root, 'This browser does not support desktop notifications');
        return;
      }

      if (desktop.permission() === 'denied') {
        STORE.settings[key] = false;
        render();
        showMessagesToast(root, 'Notifications are blocked for this site in your browser settings');
        return;
      }

      desktop.requestPermission().then(function (result) {
        if (result !== 'granted') {
          STORE.settings[key] = false;
          publishDesktopSettings();
          window.TMAMessagingAPI.updateSettings({ desktopNotifications: false });
          render();
          showMessagesToast(root, 'Desktop notifications were blocked by the browser');
          return;
        }
        publishDesktopSettings();
        // Proof that it works, at the one moment the user is looking for it.
        // Without this, switching it on and seeing nothing is indistinguishable
        // from switching it on and it being broken.
        showTestDesktopNotification();
      });
    }

    // Choosing a tone plays it. The change event is a user gesture, so this is
    // the one moment the browser is guaranteed to let the sound through.
    if (key === 'messageTone' || key === 'ringtone') previewSetting(key, value);

    publishCallSettings();
    publishDesktopSettings();

    var payload = {};
    payload[key] = STORE.settings[key];

    window.TMAMessagingAPI.updateSettings(payload)
      .then(function (data) {
        STORE.settings = data.settings || STORE.settings;
        publishCallSettings();
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

  function enqueueAcceptedFiles(root, state, render, accepted, caption) {
    if (!accepted || !accepted.length) return;
    var items = pendingAttachments(state);

    if (caption) {
      var draft = getComposerDraft(state);
      setComposerDraft(state, draft ? draft + '\n' + caption : caption);
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

    if (!accepted.length) return;

    var hasImages = accepted.some(function (file) {
      return /^image\//.test(file.type) && file.type !== 'image/svg+xml';
    });

    if (hasImages && window.TMAMessagingImageEditor) {
      window.TMAMessagingImageEditor.openMany(accepted, {
        onDone: function (edited, caption) {
          enqueueAcceptedFiles(root, state, render, edited, caption);
        },
      });
      return;
    }

    enqueueAcceptedFiles(root, state, render, accepted, '');
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
        // Repaint just the counter and bars, a full render on every tick
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
        // getUserMedia failures are the common case here, the message is
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
    var voiceThread = findThread(conversationId);
    if (voiceThread && voiceThread.caseFile && caseLane(state, conversationId) === 'internal') {
      showMessagesToast(root, 'An internal note can’t include a voice message.');
      return;
    }
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
          row.listed = true;
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

    // Only one voice note plays at a time, overlapping playback is noise.
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
   * Infinity until the file is seeked to its end, which is why progress sat
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
   * Deliberately not the whole grid up front, reacting is a one-tap action,
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
   * Who reacted, grouped by emoji, opened by clicking a reaction pill.
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
   * Search mode, profile and gallery behaviour
   * ---------------------------------------------------------------- */

  var searchTimer = null;

  function runSearch(state, render, term) {
    if (searchTimer) clearTimeout(searchTimer);

    if (!term || term.trim().length < 2) {
      state.searchResults = null;
      state.searchLoading = false;
      render();
      return;
    }

    state.searchLoading = true;
    render();

    searchTimer = setTimeout(function () {
      searchTimer = null;

      window.TMAMessagingAPI.search(term)
        .then(function (data) {
          // Discard a response the user has already typed past.
          if ((state.search || '') !== term) return;
          state.searchResults = data.results;
          state.searchLoading = false;
          render();
        })
        .catch(function () {
          state.searchResults = null;
          state.searchLoading = false;
          render();
        });
    }, 280);
  }

  function exitSearchMode(state, render) {
    if (!state.searchMode) return;
    state.searchMode = false;
    state.search = '';
    state.searchResults = null;
    state.peopleResults = [];
    render();
  }

  /*
   * Open a conversation at a specific message.
   *
   * Loads a window *around* the target rather than the newest page, so the
   * message arrives with the context it was sent in, then scrolls to it and
   * flashes it.
   */
  function jumpToConversationMessage(root, state, render, conversationId, seq) {
    exitSearchMode(state, render);

    var bucket = threadBucket(conversationId);
    bucket.messages = [];
    bucket.loaded = false;

    state.selectedId = conversationId;
    state.reading = true;
    state.profileOpen = false;
    clearReplyTo(state);
    render();
    loadScheduled(root, state, render, conversationId);

    window.TMAMessagingAPI.messagesAround(conversationId, seq)
      .then(function (data) {
        mergeMessages(conversationId, data.messages || [], false);
        bucket.loaded = true;
        bucket.hasMore = !!data.hasMore;
        if (data.conversation) replaceThread(data.conversation);
        render();

        // Wait for the repaint before measuring where the bubble landed.
        window.requestAnimationFrame(function () {
          var target = (data.messages || []).filter(function (m) {
            return m.seq === seq;
          })[0];
          if (target) jumpToMessage(root, target.id);
        });

        markConversationRead(root, state, render, conversationId);
        subscribeToConversation(root, state, render, conversationId);
      })
      .catch(function () {
        showMessagesToast(root, 'That message could not be opened');
      });
  }

  function openProfile(root, state, render) {
    if (!state.selectedId) return;

    state.profileOpen = true;
    state.profile = null;
    state.profileGallery = null;
    state.profileShelf = 'media';
    render();

    window.TMAMessagingAPI.info(state.selectedId)
      .then(function (data) {
        state.profile = data;
        render();
        loadGallery(root, state, render, 'media');
      })
      .catch(function () {
        state.profileOpen = false;
        render();
        showMessagesToast(root, 'Conversation info could not be loaded');
      });
  }

  function closeProfile(state, render) {
    state.profileOpen = false;
    state.profile = null;
    state.profileGallery = null;
    render();
  }

  function loadGallery(root, state, render, shelf) {
    state.profileShelf = shelf;

    if (!state.profileGallery) state.profileGallery = {};

    // Already fetched, switching tabs should not refetch.
    if (state.profileGallery[shelf]) {
      render();
      return;
    }

    render();

    window.TMAMessagingAPI.gallery(state.selectedId, shelf)
      .then(function (data) {
        state.profileGallery[shelf] = data.items || [];
        render();
      })
      .catch(function () {
        state.profileGallery[shelf] = [];
        render();
      });
  }

  /* Open a gallery item in the lightbox, media, and documents too now that
   * the lightbox previews PDFs and text itself. */
  function openGalleryItem(state, attachmentId) {
    var shelf = state.profileShelf || 'media';
    var items = (state.profileGallery && state.profileGallery[shelf]) || [];

    var index = 0;
    var all = items
      .filter(function (i) {
        return i.url;
      })
      .map(function (i, n) {
        if (i.id === attachmentId) index = n;
        return {
          name: i.name, mime: i.mime, size: i.size, url: i.url,
          downloadUrl: attachmentDownloadUrl(i),
          saveAttachment: i.id ? { kind: 'messaging', id: i.id } : null,
        };
      });

    if (all.length && window.TMAPortalLightbox) {
      window.TMAPortalLightbox.open(all, index);
    }
  }


  /* ------------------------------------------------------------------
   * Groups
   * ---------------------------------------------------------------- */

  function openGroupPanel(root, state, render) {
    state.groupOpen = true;
    state.composeOpen = false;
    state.settingsOpen = false;
    state.groupMembers = [];
    state.groupName = '';
    state.composeQuery = '';
    state.composeResults = [];
    render();
    searchPeople(state, render, '', 'compose');
  }

  function toggleGroupMember(state, render, person) {
    var chosen = state.groupMembers || (state.groupMembers = []);
    var index = -1;
    chosen.forEach(function (p, i) {
      if (p.id === person.id) index = i;
    });

    if (index === -1) chosen.push(person);
    else chosen.splice(index, 1);

    render();
  }

  function createGroup(root, state, render) {
    var name = (state.groupName || '').trim();
    var members = state.groupMembers || [];

    if (!name || !members.length) return;

    window.TMAMessagingAPI.createGroup({
      name: name,
      memberIds: members.map(function (p) {
        return p.id;
      }),
    })
      .then(function (data) {
        var conversation = data.conversation;
        replaceThread(conversation);

        state.groupOpen = false;
        state.groupMembers = [];
        state.groupName = '';
        state.selectedId = null;
        render();

        openConversation(root, state, render, conversation.id);
        subscribeToConversation(root, state, render, conversation.id);
        showMessagesToast(root, 'Group created');
      })
      .catch(function (err) {
        showMessagesToast(root, err.message || 'Group could not be created');
      });
  }

  /* Reload the profile after any change, so members and roles stay truthful. */
  function refreshProfile(root, state, render) {
    if (!state.profileOpen || !state.selectedId) return;

    window.TMAMessagingAPI.info(state.selectedId)
      .then(function (data) {
        state.profile = data;
        replaceThread(data.conversation);
        render();
      })
      .catch(function () {});
  }

  /*
   * The portal's photo cropper, fetched the first time a group photo is
   * chosen: the shell does not carry it. Resolves with nothing if it cannot
   * be had, and the photo then goes up as it was picked.
   */
  var avatarCropperLoad = null;

  function loadAvatarCropper() {
    if (window.TMAAvatarCropper) return Promise.resolve(window.TMAAvatarCropper);
    if (avatarCropperLoad) return avatarCropperLoad;

    avatarCropperLoad = new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = 'js/avatar-cropper.js';
      script.onload = function () { resolve(window.TMAAvatarCropper || null); };
      script.onerror = function () {
        avatarCropperLoad = null;
        resolve(null);
      };
      document.head.appendChild(script);
    });

    return avatarCropperLoad;
  }

  /*
   * Ask for the group's new name in the portal's own dialog.
   *
   * It used to be window.prompt, which the desktop app does not have: there
   * the button did nothing at all, with no error to say why.
   */
  function openGroupRename(root, state, render) {
    var portal = window.TMAPortalUI;
    var conversationId = state.selectedId;
    var current = (findThread(conversationId) || {}).name || '';
    if (!portal || !conversationId) return;

    portal.openModal({
      title: 'Rename group',
      body:
        portal.field('Group name', portal.input({
          value: current,
          attrs: 'data-messages-group-name maxlength="120"',
        })) +
        '<div class="tma-portal-form-actions">' +
        portal.btn({ label: 'Save', attrs: ' data-messages-group-name-save' }) +
        '</div>',
      onMount: function (host) {
        var field = host.querySelector('[data-messages-group-name]');

        var save = function () {
          var name = (field.value || '').trim();
          if (!name) return;
          portal.closeModal();
          // Saving the name it already has is not a rename.
          if (name === current) return;
          groupAction(
            root, state, render,
            window.TMAMessagingAPI.updateGroup(conversationId, { name: name }),
            'The group could not be renamed'
          );
        };

        host.querySelector('[data-messages-group-name-save]').addEventListener('click', save);
        field.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          save();
        });
        // The dialog focuses the field after this runs; select once it has.
        setTimeout(function () { field.select(); }, 0);
      },
    });
  }

  /* A datetime-local input wants "YYYY-MM-DDTHH:MM" in local time. */
  function toLocalInput(date) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function scheduledWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function renderScheduledRow(item) {
    var text = item.body.length > 60 ? item.body.slice(0, 60) + '…' : item.body;
    return (
      '<div class="tma-portal-check-row" data-messages-scheduled="' + esc(item.id) + '">' +
      '<span>' +
      esc(item.failed ? 'Not sent. ' + (item.failedReason || '') : scheduledWhen(item.sendAt)) +
      '<br>' + esc(text) +
      '</span>' +
      window.TMAPortalUI.btn({
        label: item.failed ? 'Remove' : 'Cancel',
        variant: 'ghost',
        small: true,
        attrs: ' data-messages-scheduled-cancel="' + esc(item.id) + '"',
      }) +
      '</div>'
    );
  }

  /*
   * An announcement: a message a group's admins address to all of it, posted
   * now or at a time they set. One dialog writes it, and lists the ones still
   * waiting so they can be withdrawn.
   */
  function openAnnouncement(root, state, render, conversationId) {
    var portal = window.TMAPortalUI;
    var api = window.TMAMessagingAPI;
    if (!portal || !conversationId) return;

    // The next whole hour: a time somebody might mean, and never in the past.
    var soon = new Date();
    soon.setHours(soon.getHours() + 1, 0, 0, 0);

    portal.openModal({
      title: 'Announcement',
      body:
        portal.field('Message', portal.textarea({
          attrs: 'data-messages-announce-body rows="4" maxlength="20000"',
        })) +
        portal.field('Send', portal.select(
          [{ value: 'now', label: 'Now' }, { value: 'later', label: 'At a set time' }],
          'now',
          'data-messages-announce-when',
          'When to send'
        )) +
        '<div data-messages-announce-at-field hidden>' +
        portal.field('Date and time', portal.input({
          type: 'datetime-local',
          value: toLocalInput(soon),
          attrs: 'data-messages-announce-at min="' + toLocalInput(new Date()) + '"',
        })) +
        '</div>' +
        '<div data-messages-announce-error hidden></div>' +
        '<div class="tma-portal-form-actions">' +
        portal.btn({ label: 'Post', attrs: ' data-messages-announce-save' }) +
        '</div>' +
        '<div data-messages-announce-waiting hidden>' +
        portal.field('Scheduled', '<div class="tma-portal-check-list" data-messages-announce-list></div>') +
        '</div>',
      onMount: function (host) {
        var body = host.querySelector('[data-messages-announce-body]');
        bindEmphasisKeys(body);
        var when = host.querySelector('[data-messages-announce-when]');
        var atField = host.querySelector('[data-messages-announce-at-field]');
        var at = host.querySelector('[data-messages-announce-at]');
        var save = host.querySelector('[data-messages-announce-save]');
        var waiting = host.querySelector('[data-messages-announce-waiting]');
        var list = host.querySelector('[data-messages-announce-list]');
        var error = host.querySelector('[data-messages-announce-error]');

        // Said in the dialog itself: the page's toast sits under it.
        function fail(message) {
          error.innerHTML = portal.banner('warning', esc(message));
          error.hidden = false;
        }

        function settle() {
          error.hidden = true;
          error.innerHTML = '';
        }

        body.addEventListener('input', settle);
        at.addEventListener('input', settle);

        when.addEventListener('change', function () {
          var later = when.value === 'later';
          atField.hidden = !later;
          save.querySelector('span').textContent = later ? 'Schedule' : 'Post';
          settle();
        });

        function drawWaiting(items) {
          list.innerHTML = items.map(renderScheduledRow).join('');
          waiting.hidden = !items.length;
        }

        api.scheduled(conversationId)
          .then(function (data) { drawWaiting((data && data.scheduled) || []); })
          .catch(function () { /* the list is a convenience; writing still works */ });

        list.addEventListener('click', function (e) {
          var btn = e.target.closest('[data-messages-scheduled-cancel]');
          if (!btn) return;
          btn.disabled = true;
          api.cancelScheduled(btn.getAttribute('data-messages-scheduled-cancel'))
            .then(function () {
              var row = btn.closest('[data-messages-scheduled]');
              if (row) row.remove();
              waiting.hidden = !list.children.length;
              loadScheduled(root, state, render, conversationId);
            })
            .catch(function () {
              btn.disabled = false;
              fail('That could not be cancelled');
            });
        });

        save.addEventListener('click', function () {
          var text = (body.value || '').trim();
          if (!text) {
            body.focus();
            return;
          }

          if (when.value !== 'later') {
            save.disabled = true;
            postAnnouncement(root, state, render, conversationId, text)
              .then(function () { portal.closeModal(); })
              .catch(function (err) {
                save.disabled = false;
                fail(announcementError(err, 'Announcement not posted'));
              });
            return;
          }

          var chosen = at.value ? new Date(at.value) : null;
          if (!chosen || isNaN(chosen.getTime()) || chosen.getTime() <= Date.now()) {
            fail('Choose a time that has not passed');
            at.focus();
            return;
          }

          save.disabled = true;
          api.schedule(conversationId, { body: text, sendAt: chosen.toISOString() })
            .then(function () {
              portal.closeModal();
              showMessagesToast(root, 'Announcement scheduled for ' + scheduledWhen(chosen.toISOString()));
              loadScheduled(root, state, render, conversationId);
            })
            .catch(function (err) {
              save.disabled = false;
              fail(announcementError(err, 'Announcement not scheduled'));
            });
        });
      },
    });
  }

  /* Withdraw one from the strip above the message box. */
  function cancelScheduledFromChat(root, state, render, scheduledId) {
    var conversationId = state.selectedId;
    var item = scheduledFor(conversationId).filter(function (s) { return s.id === scheduledId; })[0];
    if (!item) return;

    // One that could not be sent is only being cleared away.
    if (!item.failed && !window.confirm('Cancel this scheduled announcement?')) return;

    window.TMAMessagingAPI.cancelScheduled(scheduledId)
      .then(function () {
        STORE.scheduled[conversationId] = scheduledFor(conversationId).filter(function (s) {
          return s.id !== scheduledId;
        });
        render();
        if (!item.failed) showMessagesToast(root, 'Scheduled announcement cancelled');
      })
      .catch(function () {
        showMessagesToast(root, 'That could not be cancelled');
        loadScheduled(root, state, render, conversationId);
      });
  }

  /* The server's own sentence when it gave one (a time already past, no right to post). */
  function announcementError(err, fallback) {
    if (err && (err.status === 403 || err.status === 422) && err.message) return err.message;
    return fallback;
  }

  /* Post now. The author has no local copy until the server answers. */
  function postAnnouncement(root, state, render, conversationId, text) {
    var nonce = window.TMAMessagingAPI.newNonce();

    return window.TMAMessagingAPI.send(conversationId, { body: text, nonce: nonce, announcement: true })
      .then(function (data) {
        var confirmed = data.message;
        var bucket = STORE.threadMessages[conversationId];
        if (bucket && bucket.loaded) mergeMessages(conversationId, [confirmed], false);

        var row = findThread(conversationId);
        if (row) {
          row.preview = 'Announcement: ' + messagePreview(confirmed);
          row.timestamp = confirmed.sentAt;
          row.listed = true;
        }

        playSentMessageSound();
        render({ chatToBottom: state.selectedId === conversationId });
      });
  }

  function groupAction(root, state, render, promise, failure) {
    promise
      .then(function (data) {
        if (data && data.conversation) replaceThread(data.conversation);
        // The change lands as a system message too, so pull the thread.
        loadThread(root, state, render, state.selectedId, {});
        refreshProfile(root, state, render);
      })
      .catch(function (err) {
        showMessagesToast(root, err.message || failure);
      });
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
      // Names what it is about to do, as the swipe's button does.
      row.unread || row.markedUnread
        ? { action: 'read', label: 'Mark as read' }
        : { action: 'unread', label: 'Mark as unread' },
      { action: 'export', label: 'Export chat' },
      { action: 'clear', label: 'Clear messages', danger: true },
    ];

    if (applicationForThread(row)) {
      items.unshift({ action: 'application', label: 'Open application' });
    }

    // The group's admins speak to all of it, now or at a set time.
    if (row.type === 'group' && row.canManage) {
      items.unshift({ action: 'announce', label: 'New announcement' });
    }

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

  function openConversationMenu(root, state, render, anchor, conversationId, position, extra) {
    closeMessageMenu();

    var row = findThread(conversationId);
    if (!row) return;

    var menu = document.createElement('div');
    menu.className = 'tma-dash__messages-message-menu';
    menu.setAttribute('role', 'menu');
    // A row in the list adds what only makes sense there (Select).
    menu.innerHTML = (extra || []).concat(conversationMenuItems(row))
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

  /* ------------------------------------------------------------------
   * Press and hold a chat: a look inside, and its menu
   *
   * A finger held still on a row for a moment opens a small box with the
   * chat's latest messages over a dimmed screen, and the chat's actions
   * under it, Select first. Looking does not read it: the box is filled
   * from what this device already holds, or from the history call, which
   * has no side effects; nothing here marks the chat read. A tap on the box
   * opens the chat (and that does read it), a tap outside puts it away.
   * ---------------------------------------------------------------- */

  /*
   * How long a finger rests on a chat or a message before its menu opens.
   * 450 ms was as long as the phone's own press-to-select, so the two raced:
   * the menu opened over a word already highlighted, and the hold felt slow.
   * WhatsApp's is about a third of a second.
   */
  var CHAT_PEEK_HOLD_MS = 300;
  var MESSAGE_HOLD_MS = 300;

  /* The small knock a phone gives when a hold or a swipe takes. The iPhone
     app has the Taptic Engine; a browser on Android has vibrate. */
  function haptic(style) {
    var host = window.TMADesktop;
    if (host && typeof host.haptic === 'function') {
      try { host.haptic(style || 'light'); } catch (err) { /* older app */ }
      return;
    }
    if (navigator.vibrate) {
      try { navigator.vibrate(style === 'medium' ? 12 : 8); } catch (err) { /* not allowed here */ }
    }
  }

  /* A hold is not a request to pick words: whatever the system began to
     highlight under the finger goes as the menu opens. */
  function dropTouchSelection() {
    try {
      var sel = window.getSelection && window.getSelection();
      if (sel && sel.rangeCount) sel.removeAllRanges();
    } catch (err) { /* nothing selected */ }
  }
  var CHAT_PEEK_MESSAGES = 8;
  var chatPeekEl = null;
  var chatPeekId = null;
  /* The click that follows the lift of a hold must not land on anything. */
  var peekSwallowClicksUntil = 0;

  function closeChatPeek() {
    if (!chatPeekEl) return;
    var el = chatPeekEl;
    chatPeekEl = null;
    chatPeekId = null;
    el.classList.remove('is-open');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 160);
  }

  function peekLineText(msg) {
    if (msg.type === 'system') return systemMessageText(msg);
    if (msg.deleted) return 'This message was deleted';
    var body = (msg.body || '').trim();
    if (body) return body;
    var files = (msg.attachments || []).length;
    if (!files) return '';
    var image = (msg.attachments || []).every(function (a) { return /^image\//.test(a.mime || ''); });
    if (files === 1) return image ? 'Photo' : 'File';
    return files + (image ? ' photos' : ' files');
  }

  function renderPeekMessages(row, messages) {
    var shown = (messages || []).filter(function (m) { return !!peekLineText(m); }).slice(-CHAT_PEEK_MESSAGES);
    if (!shown.length) {
      return '<p class="tma-dash__messages-peek-empty">No messages yet</p>';
    }
    var group = row.type === 'group';
    var lastSender = null;
    return shown.map(function (msg) {
      if (msg.type === 'system') {
        lastSender = null;
        return '<p class="tma-dash__messages-peek-system">' + esc(peekLineText(msg)) + '</p>';
      }
      var out = msg.direction === 'out';
      var senderId = msg.sender ? msg.sender.id : null;
      var sender = group && !out && msg.sender && senderId !== lastSender
        ? '<span class="tma-dash__messages-peek-sender">' + esc(msg.sender.name || '') + '</span>'
        : '';
      lastSender = out ? null : senderId;
      var text = peekLineText(msg);
      if (text.length > 280) text = text.slice(0, 279) + '…';
      return (
        '<div class="tma-dash__messages-peek-msg tma-dash__messages-peek-msg--' + (out ? 'out' : 'in') + '">' +
        sender +
        '<span class="tma-dash__messages-peek-bubble' + (msg.deleted ? ' is-deleted' : '') + '">' +
        esc(text) + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function chatPeekMenuItems(row) {
    var unread = row.unread || row.markedUnread;
    return [
      { action: 'select', label: 'Select', icon: 'CheckCircle' },
      { action: 'select-all', label: 'Select all', icon: 'ListChecks' },
      unread
        ? { action: 'read', label: 'Mark as read', icon: 'EnvelopeSimpleOpen' }
        : { action: 'unread', label: 'Mark as unread', icon: 'EnvelopeSimple' },
      { action: 'pin', label: row.pinned ? 'Unpin' : 'Pin', icon: row.pinned ? 'PushPinSlash' : 'PushPin' },
      { action: 'mute', label: row.muted ? 'Unmute' : 'Mute', icon: row.muted ? 'Bell' : 'BellSlash' },
      { action: 'archive', label: row.archived ? 'Unarchive' : 'Archive', icon: row.archived ? 'ArchiveTray' : 'Archive' },
      { action: 'leave', label: row.type === 'group' ? 'Leave group' : 'Delete conversation', icon: 'Trash', danger: true },
    ];
  }

  function openChatPeek(root, state, render, id) {
    closeChatPeek();
    closeMessageMenu();
    var row = findThread(id);
    if (!row) return;
    var item = resolveThread(row);
    var about = counterpartRole(item) || (item.type === 'group' && item.memberCount ? groupCountLabel(item) : '');

    var held = STORE.threadMessages[id];
    var have = held && held.loaded && held.messages && held.messages.length ? held.messages : null;

    var el = document.createElement('div');
    el.className = 'tma-dash__messages-peek';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Preview of ' + (item.name || 'conversation'));
    el.innerHTML =
      '<div class="tma-dash__messages-peek-scrim" data-peek-close></div>' +
      '<div class="tma-dash__messages-peek-stack">' +
      '<div class="tma-dash__messages-peek-card" data-peek-open role="button" tabindex="0"' +
      ' aria-label="Open conversation with ' + esc(item.name || '') + '">' +
      '<div class="tma-dash__messages-peek-head">' +
      threadIcon(item) +
      '<span class="tma-dash__messages-peek-title">' +
      '<span class="tma-dash__messages-peek-name">' + esc(item.name || '') + '</span>' +
      (about ? '<span class="tma-dash__messages-peek-about">' + esc(about) + '</span>' : '') +
      '</span>' +
      (row.unread ? '<span class="tma-dash__messages-peek-unread">' + esc(row.unread) + ' unread</span>' : '') +
      '</div>' +
      '<div class="tma-dash__messages-peek-body" data-peek-body>' +
      (have ? renderPeekMessages(row, have) : '<p class="tma-dash__messages-peek-empty">Loading…</p>') +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__messages-peek-menu" role="menu">' +
      chatPeekMenuItems(row).map(function (it) {
        return (
          '<button type="button" role="menuitem" class="tma-dash__messages-peek-item' +
          (it.danger ? ' tma-dash__messages-peek-item--danger' : '') + '" data-peek-action="' + it.action + '">' +
          '<span class="tma-dash__messages-peek-item-label">' + esc(it.label) + '</span>' +
          '<img src="' + ICONS[it.icon] + '" alt="">' +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '</div>';

    document.body.appendChild(el);
    chatPeekEl = el;
    chatPeekId = id;

    function scrollToEnd() {
      var body = el.querySelector('[data-peek-body]');
      if (body) body.scrollTop = body.scrollHeight;
    }
    scrollToEnd();
    window.requestAnimationFrame(function () { el.classList.add('is-open'); });

    // Not on the device yet: ask for the newest page. Reading history is not
    // reading the chat; only opening it is.
    if (!have) {
      window.TMAMessagingAPI.messages(id).then(function (data) {
        if (chatPeekEl !== el) return;
        var body = el.querySelector('[data-peek-body]');
        if (body) body.innerHTML = renderPeekMessages(row, (data && data.messages) || []);
        scrollToEnd();
      }).catch(function () {
        if (chatPeekEl !== el) return;
        var body = el.querySelector('[data-peek-body]');
        if (body) body.innerHTML = '<p class="tma-dash__messages-peek-empty">The messages could not be loaded</p>';
      });
    }

    el.addEventListener('click', function (e) {
      if (Date.now() < peekSwallowClicksUntil) return;
      if (e.target.closest('[data-peek-close]')) {
        closeChatPeek();
        return;
      }
      var action = e.target.closest('[data-peek-action]');
      if (action) {
        var what = action.getAttribute('data-peek-action');
        closeChatPeek();
        runConversationAction(root, state, render, id, what);
        return;
      }
      if (e.target.closest('[data-peek-open]')) {
        closeChatPeek();
        openConversation(root, state, render, id);
      }
    });

    el.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-peek-open]')) {
        e.preventDefault();
        closeChatPeek();
        openConversation(root, state, render, id);
      }
    });

    // The list behind does not scroll while the box is up.
    el.querySelector('[data-peek-close]').addEventListener('touchmove', function (e) {
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    var first = el.querySelector('[data-peek-action]');
    if (first) {
      try { first.focus({ preventScroll: true }); } catch (err) { /* older WebKit */ }
    }
  }

  /*
   * The hold itself, read once for the whole column. A finger (or pen) held
   * on a row without moving for CHAT_PEEK_HOLD_MS opens the preview; a mouse
   * has right-click instead. Pointer events reach here even while a phone's
   * row holds the pointer for its swipe, so one reader serves both layouts.
   */
  function wireChatPeek(root, state, render) {
    if (root._chatPeekBound) return;
    root._chatPeekBound = true;

    var press = null;

    function cancel() {
      if (press && press.timer) clearTimeout(press.timer);
      press = null;
    }

    function fire(p) {
      if (!p || !p.rowEl.isConnected) return;
      p.fired = true;
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
      var wrap = p.rowEl.closest('[data-messages-row-swipe]');
      if (wrap) wrap._peeked = true;
      haptic('medium');
      dropTouchSelection();
      openChatPeek(root, state, render, p.id);
    }

    root.addEventListener('pointerdown', function (e) {
      cancel();
      root._chatPeekPointer = e.pointerType || 'mouse';
      if (e.pointerType === 'mouse' || e.button > 0) return;
      if (state.chatSelect || state.searchMode) return;
      var rowEl = e.target.closest && e.target.closest('[data-messages-row]');
      if (!rowEl || !rowEl.closest('[data-messages-list-body]')) return;
      if (e.target.closest('[data-messages-row-swipe-action]')) return;
      var wrap = rowEl.closest('[data-messages-row-swipe]');
      if (wrap && (wrap.classList.contains('is-open-left') || wrap.classList.contains('is-open-right'))) return;
      press = {
        id: rowEl.getAttribute('data-messages-row'),
        rowEl: rowEl,
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        fired: false,
      };
      var mine = press;
      press.timer = setTimeout(function () { if (press === mine) fire(mine); }, CHAT_PEEK_HOLD_MS);
    }, true);

    root.addEventListener('pointermove', function (e) {
      if (!press || press.fired || e.pointerId !== press.pointerId) return;
      // Any real movement is a scroll or a swipe, not a hold.
      if (Math.abs(e.clientX - press.x) > 8 || Math.abs(e.clientY - press.y) > 8) cancel();
    }, true);

    function lift(e) {
      if (!press || e.pointerId !== press.pointerId) return;
      if (press.fired) peekSwallowClicksUntil = Date.now() + 450;
      cancel();
    }
    root.addEventListener('pointerup', lift, true);
    root.addEventListener('pointercancel', function (e) {
      // A cancel after the box is up is the system taking the touch back
      // (the box now lies over it); the box stays.
      lift(e);
    }, true);

    // Android reports a long press as a right-click: open the box at once
    // rather than wait for the timer, which that right-click may cancel.
    root._chatPeekNow = function (rowEl) {
      if (press && press.rowEl === rowEl && !press.fired) fire(press);
      else if (!chatPeekEl && !state.chatSelect && rowEl.closest('[data-messages-list-body]')) {
        fire({ id: rowEl.getAttribute('data-messages-row'), rowEl: rowEl });
      }
    };
  }

  function runConversationAction(root, state, render, conversationId, action) {
    var row = findThread(conversationId);
    if (!row) return;
    var api = window.TMAMessagingAPI;

    // Pin / mute / archive already have optimistic handling.
    if (action === 'pin' || action === 'mute' || action === 'archive' || action === 'read') {
      commitMessagesRowAction(root, state, render, conversationId, action);
      return;
    }

    if (action === 'select') {
      startChatSelect(root, state, render, conversationId);
      return;
    }

    if (action === 'select-all') {
      startChatSelect(root, state, render, conversationId);
      pickAllChats(root, state, render);
      return;
    }

    if (action === 'announce') {
      openAnnouncement(root, state, render, conversationId);
      return;
    }

    if (action === 'application') {
      if (!openApplication(row)) {
        showMessagesToast(root, 'This conversation is no longer attached to an application.');
      }
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
    attachMessagesResizer(root, state);

    MORPH.unwired(root, '[data-messages-row]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        // The lift that ends a press-and-hold is not a tap on the row.
        if (Date.now() < peekSwallowClicksUntil) { e.preventDefault(); return; }
        var wrap = btn.closest('[data-messages-row-swipe]');
        if (!wrap && state.chatSelect) {
          e.preventDefault();
          toggleChatPicked(root, state, render, btn.getAttribute('data-messages-row'));
          return;
        }
        if (wrap) {
          if (wrap.dataset.tapHandled || wrap.dataset.swipeMoved) return;
          // A phone's rows are picked in the swipe handler's tap (above).
          if (state.chatSelect) return;
          if (
            wrap.classList.contains('is-open-left') ||
            wrap.classList.contains('is-open-right') ||
            wrap.classList.contains('is-dragging')
          ) {
            e.preventDefault();
            closeMessagesRowSwipes(root);
            return;
          }
        }
        openConversation(root, state, render, btn.getAttribute('data-messages-row'));
      });
    });

    // A chat's picture picks it (a computer's click; a phone's tap on it is
    // read by the swipe handler, which holds the pointer).
    MORPH.unwired(root, '[data-messages-row-pick]').forEach(function (pick) {
      pick.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (Date.now() < peekSwallowClicksUntil) return;
        var wrap = pick.closest('[data-messages-row-swipe]');
        if (wrap && (wrap.dataset.tapHandled || wrap.dataset.swipeMoved)) return;
        toggleChatPicked(root, state, render, pick.getAttribute('data-messages-row-pick'));
      });
    });

    var pickCancel = MORPH.unwiredOne(root, '[data-messages-pick-cancel]');
    if (pickCancel) {
      pickCancel.addEventListener('click', function () { endChatSelect(state, render); });
    }

    var pickAll = MORPH.unwiredOne(root, '[data-messages-pick-all]');
    if (pickAll) {
      pickAll.addEventListener('click', function () {
        // Read at click time: the same button turns into Deselect all.
        if (pickAll.getAttribute('data-messages-pick-all') === 'none') endChatSelect(state, render);
        else pickAllChats(root, state, render);
      });
    }

    MORPH.unwired(root, '[data-messages-pick-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        runChatBulkAction(root, state, render, btn.getAttribute('data-messages-pick-action'));
      });
    });

    if (!root._messagesPickKeys) {
      root._messagesPickKeys = true;
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (chatPeekEl) { closeChatPeek(); return; }
        if (state.chatSelect && !document.querySelector('.tma-dash__messages-message-menu')) {
          endChatSelect(state, render);
        }
      });
    }

    wireChatPeek(root, state, render);

    MORPH.unwired(root, '[data-messages-reply]').forEach(function (btn) {
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

    MORPH.unwired(root, '[data-messages-edit]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        var msg = findMessageById(state.selectedId, btn.getAttribute('data-messages-edit'));
        if (msg) startEditingMessage(root, state, render, msg);
      });
    });

    MORPH.unwired(root, '[data-messages-quick-react]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        toggleReaction(
          root,
          state,
          render,
          btn.getAttribute('data-messages-quick-react'),
          btn.getAttribute('data-messages-quick-emoji')
        );
      });
    });

    MORPH.unwired(root, '[data-messages-call]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var row = findThread(state.selectedId);
        if (!row || !window.TMAMessagingCalls) return;
        // Whichever icon was pressed, the kind is chosen in the dialog, one
        // prompt owns the decision (see openCallChooser).
        openCallChooser(root, row);
      });
    });

    var chatBg = MORPH.unwiredOne(root, '[data-messages-chat-bg]');
    if (chatBg) {
      chatBg.addEventListener('change', function () {
        try { localStorage.setItem('tma.messages.chatBg', chatBg.value || ''); } catch (err) { /* ignore */ }
        render();
      });
    }

    // Clicking a reaction pill shows who reacted; the viewer's own reaction is
    // marked there and can be removed from the same panel.
    MORPH.unwired(root, '[data-messages-react-emoji]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openReactionDetails(root, state, render, btn, btn.getAttribute('data-messages-react'));
      });
    });

    // The bubble's react button opens the full picker.
    MORPH.unwired(root, '[data-messages-react-open]').forEach(function (btn) {
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
    MORPH.unwired(root, '[data-messages-jump]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        // Quoted from a group: the original is there, not in this thread.
        // Read at click time, because a reconciled node can change its quote.
        var elsewhere = btn.getAttribute('data-messages-jump-in');
        if (elsewhere) {
          var seq = parseInt(btn.getAttribute('data-messages-jump-seq'), 10);
          if (seq && findThread(elsewhere)) {
            jumpToConversationMessage(root, state, render, elsewhere, seq);
          }
          return;
        }

        jumpToMessage(root, btn.getAttribute('data-messages-jump'));
      });
    });

    MORPH.unwired(root, '[data-messages-load-more]').forEach(function (btn) {
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

    MORPH.unwired(root, '[data-messages-menu]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openMessageMenu(root, state, render, btn, btn.getAttribute('data-messages-menu'));
      });
    });

    /*
     * Right-click and long-press open the same menu at the pointer. Long press
     * is the mobile equivalent, there is no hover there, and it must not fire
     * when the finger is actually scrolling or swiping to reply.
     */
    MORPH.unwired(root, '[data-messages-id]').forEach(function (row) {
      var messageId = row.getAttribute('data-messages-id');
      if (!messageId || row._contextBound) return;
      row._contextBound = true;

      row.addEventListener('contextmenu', function (e) {
        // Let the browser's own menu handle links and selected text.
        if (e.target.closest('a') || String(window.getSelection() || '')) return;
        e.preventDefault();
        root.querySelectorAll('.tma-dash__messages-bubble-row.is-highlighted').forEach(function (el) {
          el.classList.remove('is-highlighted', 'is-actions-open');
        });
        row.classList.add('is-highlighted', 'is-actions-open');
        var onFile = e.target.closest('[data-messages-attachment-id]');
        openMessageMenu(root, state, render, row, messageId, { x: e.clientX, y: e.clientY },
          onFile ? onFile.getAttribute('data-messages-attachment-id') : null);
      });

      var pressTimer = null;
      var pressOrigin = null;

      function cancelPress(clearHighlight) {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = null;
        pressOrigin = null;
        row.classList.remove('is-pressing');
        if (clearHighlight) {
          row.classList.remove('is-actions-open', 'is-highlighted');
        }
      }

      row.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse') return; // right-click covers desktop
        // Picking words from this message (Select text): a hold here moves
        // the selection, it is not a request for the menu.
        if (row.classList.contains('is-selecting')) return;
        pressOrigin = { x: e.clientX, y: e.clientY };
        // While the finger is down the hold is ours: the system's own
        // long-press selection would otherwise open on top of the menu.
        row.classList.add('is-pressing');
        pressTimer = setTimeout(function () {
          pressTimer = null;
          root.querySelectorAll('.tma-dash__messages-bubble-row.is-highlighted').forEach(function (el) {
            el.classList.remove('is-highlighted', 'is-actions-open');
          });
          row.classList.add('is-actions-open', 'is-highlighted');
          haptic('medium');
          dropTouchSelection();
          openMessageMenu(root, state, render, row, messageId, pressOrigin);
        }, MESSAGE_HOLD_MS);
      });

      row.addEventListener('pointermove', function (e) {
        if (!pressOrigin) return;
        // Any real movement means a scroll or a swipe, not a press.
        if (Math.abs(e.clientX - pressOrigin.x) > 8 || Math.abs(e.clientY - pressOrigin.y) > 8) {
          cancelPress(true);
        }
      });

      row.addEventListener('pointerup', function () { cancelPress(false); });
      row.addEventListener('pointercancel', function () { cancelPress(true); });
    });

    // Picking words from a message: Copy takes just what is highlighted.
    var selectCopy = MORPH.unwiredOne(root, '[data-messages-select-copy]');
    if (selectCopy) {
      // Keep the highlight where a mouse press on the button would clear it.
      selectCopy.addEventListener('mousedown', function (e) { e.preventDefault(); });
      selectCopy.addEventListener('click', function () {
        var picking = state.textSelect;
        var msg = picking && findMessageById(picking.threadId, picking.messageId);
        if (!msg) { endTextSelect(state, render); return; }
        var text = highlightedTextIn(root, msg.id) || rememberedHighlight(msg.id);
        copyMessageText(root, msg, text);
        endTextSelect(state, render);
      });
    }

    var selectDone = MORPH.unwiredOne(root, '[data-messages-select-done]');
    if (selectDone) {
      selectDone.addEventListener('click', function () {
        endTextSelect(state, render);
      });
    }

    if (!root._messagesTextSelectKeys) {
      root._messagesTextSelectKeys = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && state.textSelect) endTextSelect(state, render);
      });
    }

    // Announcements waiting above the message box. The id is read at click
    // time: a reconciled row can come to stand for a different one.
    MORPH.unwired(root, '[data-messages-strip-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        cancelScheduledFromChat(root, state, render, btn.getAttribute('data-messages-strip-cancel'));
      });
    });

    var allScheduledBtn = MORPH.unwiredOne(root, '[data-messages-strip-all]');
    if (allScheduledBtn) {
      allScheduledBtn.addEventListener('click', function () {
        openAnnouncement(root, state, render, state.selectedId);
      });
    }

    // The chat header's three-dot menu.
    var convMenuBtn = MORPH.unwiredOne(root, '[data-messages-conversation-menu]');
    if (convMenuBtn) {
      convMenuBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openConversationMenu(root, state, render, convMenuBtn, state.selectedId);
      });
    }

    var closeBtn = MORPH.unwiredOne(root, '[data-messages-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        closeConversation(root, state, render);
      });
    }

    // Desktop right-click on a conversation row gets the same actions the
    // mobile swipe reveals.
    MORPH.unwired(root, '[data-messages-row]', 'contextmenu').forEach(function (rowEl) {
      rowEl.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        // A finger's long press (Android sends it as a right-click) opens the
        // preview instead; see wireChatPeek.
        if (root._chatPeekPointer && root._chatPeekPointer !== 'mouse') {
          if (typeof root._chatPeekNow === 'function') root._chatPeekNow(rowEl);
          return;
        }
        var id = rowEl.getAttribute('data-messages-row');
        // While picking, a right-click picks too; the actions are in the bar.
        if (state.chatSelect) {
          toggleChatPicked(root, state, render, id);
          return;
        }
        openConversationMenu(
          root, state, render, rowEl, id,
          { x: e.clientX, y: e.clientY },
          [{ action: 'select', label: 'Select' }]
        );
      });
    });

    var clearReplyBtn = MORPH.unwiredOne(root, '[data-messages-reply-clear]');
    if (clearReplyBtn) {
      clearReplyBtn.addEventListener('click', function () {
        clearReplyTo(state);
        render();
      });
    }

    var retry = root.querySelector('[data-messages-retry]');
    if (retry) {
      MORPH.on(retry, 'click', function () {
        STORE.loaded = false;
        STORE.loadError = null;
        render();
        loadConversations(root, state, render);
      });
    }

    var threadRetry = MORPH.unwiredOne(root, '[data-messages-thread-retry]');
    if (threadRetry) {
      threadRetry.addEventListener('click', function () {
        loadThread(root, state, render, state.selectedId, { toBottom: true });
      });
    }

    // Paging upward: reaching the top of the thread pulls in older history.
    var chatBody = MORPH.unwiredOne(root, '[data-messages-chat-body]');
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
      // Focusing takes over the column: the field is a mode, not a filter.
      MORPH.on(search, 'focus', function () {
        if (state.searchMode) return;
        state.searchMode = true;
        render();
      });

      MORPH.on(search, 'input', function () {
        state.search = search.value;
        state.searchMode = true;
        render();
        runSearch(state, render, search.value);
      });

      MORPH.on(search, 'keydown', function (e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          exitSearchMode(state, render);
        }
      });
    }

    var searchExit = MORPH.unwiredOne(root, '[data-messages-search-exit]');
    if (searchExit) {
      searchExit.addEventListener('click', function () {
        exitSearchMode(state, render);
      });
    }

    MORPH.unwired(root, '[data-messages-search-conversation]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-messages-search-conversation');
        exitSearchMode(state, render);
        state.selectedId = null;
        openConversation(root, state, render, id);
      });
    });

    MORPH.unwired(root, '[data-messages-jump-to]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        jumpToConversationMessage(
          root, state, render,
          btn.getAttribute('data-messages-jump-to'),
          parseInt(btn.getAttribute('data-messages-jump-seq'), 10)
        );
      });
    });


    // --- groups ----------------------------------------------------------
    var newGroupBtn = MORPH.unwiredOne(root, '[data-messages-new-group]');
    if (newGroupBtn) {
      newGroupBtn.addEventListener('click', function () {
        openGroupPanel(root, state, render);
      });
    }

    var groupBack = MORPH.unwiredOne(root, '[data-messages-group-back]');
    if (groupBack) {
      groupBack.addEventListener('click', function () {
        state.groupOpen = false;
        openComposePanel(root, state, render);
      });
    }

    var groupName = MORPH.unwiredOne(root, '[data-messages-group-name]');
    if (groupName) {
      groupName.addEventListener('input', function () {
        state.groupName = groupName.value;
        // Repaint only the create button so the field keeps its caret.
        var create = root.querySelector('[data-messages-group-create]');
        if (create) create.disabled = !(state.groupName.trim() && (state.groupMembers || []).length);
      });
    }

    MORPH.unwired(root, '[data-messages-group-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.getAttribute('data-messages-group-pick'), 10);
        var person = (state.composeResults || []).filter(function (p) {
          return p.id === id;
        })[0];
        if (person) toggleGroupMember(state, render, person);
      });
    });

    MORPH.unwired(root, '[data-messages-group-drop]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.getAttribute('data-messages-group-drop'), 10);
        state.groupMembers = (state.groupMembers || []).filter(function (p) {
          return p.id !== id;
        });
        render();
      });
    });

    var groupCreate = MORPH.unwiredOne(root, '[data-messages-group-create]');
    if (groupCreate) {
      groupCreate.addEventListener('click', function () {
        createGroup(root, state, render);
      });
    }

    // --- group management from the profile panel --------------------------
    var groupRename = MORPH.unwiredOne(root, '[data-messages-group-rename]');
    if (groupRename) {
      groupRename.addEventListener('click', function () {
        openGroupRename(root, state, render);
      });
    }

    var groupPhotoBtn = root.querySelector('[data-messages-group-photo]');
    var groupPhotoFile = root.querySelector('[data-messages-group-photo-file]');
    if (groupPhotoBtn && groupPhotoFile) {
      MORPH.on(groupPhotoBtn, 'click', function () {
        groupPhotoFile.click();
      });
      MORPH.on(groupPhotoFile, 'change', function () {
        if (!groupPhotoFile.files || !groupPhotoFile.files.length) return;
        var picked = groupPhotoFile.files[0];
        // The crop can outlast a change of thread; the photo is for this one.
        var conversationId = state.selectedId;
        groupPhotoFile.value = '';

        var save = function (file) {
          groupAction(
            root, state, render,
            window.TMAMessagingAPI.updateGroupPhoto(conversationId, file),
            'The photo could not be saved'
          );
        };

        // The same square crop an account photo gets, so a phone picture
        // goes up framed and small rather than whole.
        loadAvatarCropper().then(function (cropper) {
          if (!cropper) { save(picked); return; }

          // The crop closes without a word on a file the browser cannot
          // draw, which would leave the button looking dead. Try it first.
          var url = URL.createObjectURL(picked);
          var probe = new Image();
          probe.onload = function () {
            URL.revokeObjectURL(url);
            cropper.open(picked, function (blob) {
              save(new File([blob], 'group.jpg', { type: 'image/jpeg' }));
            });
          };
          probe.onerror = function () {
            URL.revokeObjectURL(url);
            showMessagesToast(root, 'That picture could not be opened');
          };
          probe.src = url;
        });
      });
    }

    var groupAdd = MORPH.unwiredOne(root, '[data-messages-group-add]');
    if (groupAdd) {
      groupAdd.addEventListener('click', function () {
        // Reuses the people picker rather than a second search UI.
        state.groupAddMode = true;
        openComposePanel(root, state, render);
      });
    }

    MORPH.unwired(root, '[data-messages-member-role]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        groupAction(
          root, state, render,
          window.TMAMessagingAPI.setGroupMemberRole(
            state.selectedId,
            btn.getAttribute('data-messages-member-role'),
            btn.getAttribute('data-messages-member-next')
          ),
          'That role could not be changed'
        );
      });
    });

    MORPH.unwired(root, '[data-messages-member-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!window.confirm('Remove this person from the group?')) return;
        groupAction(
          root, state, render,
          window.TMAMessagingAPI.removeGroupMember(
            state.selectedId,
            btn.getAttribute('data-messages-member-remove')
          ),
          'They could not be removed'
        );
      });
    });

    var groupLeave = MORPH.unwiredOne(root, '[data-messages-group-leave]');
    if (groupLeave) {
      groupLeave.addEventListener('click', function () {
        runConversationAction(root, state, render, state.selectedId, 'leave');
      });
    }

    // --- profile ---------------------------------------------------------
    MORPH.unwired(root, '[data-messages-open-profile]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openProfile(root, state, render);
      });
    });

    var profileBack = MORPH.unwiredOne(root, '[data-messages-profile-back]');
    if (profileBack) {
      profileBack.addEventListener('click', function () {
        closeProfile(state, render);
      });
    }

    MORPH.unwired(root, '[data-messages-gallery-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        loadGallery(root, state, render, tab.getAttribute('data-messages-gallery-tab'));
      });
    });

    MORPH.unwired(root, '[data-messages-gallery-open]').forEach(function (tile) {
      tile.addEventListener('click', function () {
        openGalleryItem(state, tile.getAttribute('data-messages-gallery-open'));
      });
    });

    var profilePhoto = MORPH.unwiredOne(root, '[data-messages-profile-photo]');
    if (profilePhoto) {
      profilePhoto.addEventListener('click', function () {
        if (!window.TMAPortalLightbox) return;
        var name = (state.profile && state.profile.profile.name) || 'Photo';
        window.TMAPortalLightbox.open(
          [{
            name: name,
            mime: 'image/*',
            size: 0,
            url: profilePhoto.getAttribute('data-messages-profile-photo'),
            // A profile photo is someone else's picture; offering a download
            // button on it is not the portal's call to make.
            canDownload: false,
          }],
          0
        );
      });
    }

    var profileMute = MORPH.unwiredOne(root, '[data-messages-profile-mute]');
    if (profileMute) {
      profileMute.addEventListener('change', function () {
        commitMessagesRowAction(root, state, render, state.selectedId, 'mute');
      });
    }

    var profilePin = MORPH.unwiredOne(root, '[data-messages-profile-pin]');
    if (profilePin) {
      profilePin.addEventListener('change', function () {
        commitMessagesRowAction(root, state, render, state.selectedId, 'pin');
      });
    }

    var profileClear = MORPH.unwiredOne(root, '[data-messages-profile-clear]');
    if (profileClear) {
      profileClear.addEventListener('click', function () {
        runConversationAction(root, state, render, state.selectedId, 'clear');
      });
    }

    var profileBlock = MORPH.unwiredOne(root, '[data-messages-profile-block]');
    if (profileBlock) {
      profileBlock.addEventListener('click', function () {
        runConversationAction(root, state, render, state.selectedId, 'block');
      });
    }

    var openClient = MORPH.unwiredOne(root, '[data-messages-open-client]');
    if (openClient) {
      openClient.addEventListener('click', function () {
        var row = findThread(state.selectedId);
        if (applicationForThread(row)) {
          if (!openApplication(row)) {
            showMessagesToast(root, 'This conversation is no longer attached to an application.');
          }
          return;
        }
        var uid = row && row.about && row.about.clientUid;
        if (uid && window.TMADashboard && window.TMADashboard.navigate) {
          window.TMADashboard.navigate({
            navId: 'clients',
            view: 'clients',
            title: row.about.clientName || row.name || 'Client',
            crumb: 'CIP Applications',
            clientsScreen: 'detail',
            contactId: uid,
          });
        } else {
          showMessagesToast(root, 'No client record is linked to this conversation');
        }
      });
    }

    var openApplicationBtn = MORPH.unwiredOne(root, '[data-messages-open-application]');
    if (openApplicationBtn) {
      openApplicationBtn.addEventListener('click', function () {
        if (!openApplication(findThread(state.selectedId))) {
          showMessagesToast(root, 'This conversation is no longer attached to an application.');
        }
      });
    }

    var searchClear = MORPH.unwiredOne(root, '[data-messages-search-clear]');
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
    MORPH.unwired(root, '[data-messages-compose]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openComposePanel(root, state, render);
      });
    });

    var composeSearch = MORPH.unwiredOne(root, '[data-messages-compose-search]');
    if (composeSearch) {
      composeSearch.addEventListener('input', function () {
        state.composeQuery = composeSearch.value;
        render();
        searchPeople(state, render, composeSearch.value, 'compose');
      });
    }

    MORPH.unwired(root, '[data-messages-start]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.getAttribute('data-messages-start'), 10);
        if (isNaN(id)) return;

        // The same picker serves "message someone" and "add to this group".
        if (state.groupAddMode && state.selectedId) {
          state.groupAddMode = false;
          state.composeOpen = false;
          render();
          groupAction(
            root, state, render,
            window.TMAMessagingAPI.addGroupMembers(state.selectedId, [id]),
            'They could not be added'
          );
          return;
        }

        startConversationWith(root, state, render, id);
      });
    });

    /* One view owns the inbox column at a time. Every nav entry goes through
     * this so a new one can never forget to close the others, which is
     * exactly how two panels end up stacked on top of each other. */
    function showListView(view) {
      showMessagesChats(state);
      state.mediaMode = view === 'media';
      state.callsMode = view === 'calls';
      state.tab = view === 'archived' ? 'archived' : 'all';
    }

    // --- chats (the default view) -----------------------------------------
    MORPH.unwired(root, '[data-messages-nav-chats]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showListView('chats');
        render();
      });
    });

    // --- calls ------------------------------------------------------------
    MORPH.unwired(root, '[data-messages-nav-calls]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var opening = !state.callsMode;
        showListView(opening ? 'calls' : 'chats');
        render();
        if (opening) {
          loadMessagesCalls(root, state, render);
          markTabSeen(root, state, render, 'calls');
        }
      });
    });

    // Opening a call's conversation returns the column to chats, the way a
    // team channel does. Wired here rather than through [data-messages-row]
    // so it works on mobile too, where that handler is left to the swipe
    // machinery the call log does not use.
    MORPH.unwired(root, '[data-calls-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-calls-open');
        showListView('chats');
        if (id && id !== state.selectedId) openConversation(root, state, render, id);
        else render();
      });
    });

    // Call back straight from the log.
    MORPH.unwired(root, '[data-calls-start]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!window.TMAMessagingCalls) return;
        var id = btn.getAttribute('data-calls-start');
        var row = findThread(id);
        var label = btn.closest('.tma-dash__call-row');
        var nameEl = label && label.querySelector('.tma-dash__messages-person-name');
        window.TMAMessagingCalls.start(
          id,
          btn.getAttribute('data-calls-media') || 'audio',
          (row && row.name) || (nameEl && nameEl.textContent) || 'Contact',
          (row && row.photo) || null,
          (STORE.me || {}).id
        );
      });
    });

    // --- archived chats ---------------------------------------------------
    wireArchivedPull(root);

    MORPH.unwired(root, '[data-messages-archived]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showListView(state.tab === 'archived' ? 'chats' : 'archived');
        render();
      });
    });

    MORPH.unwired(root, '[data-messages-archived-exit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.tab = 'all';
        render();
      });
    });

    // --- media across all chats -------------------------------------------
    MORPH.unwired(root, '[data-messages-media]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var opening = !state.mediaMode;
        showListView(opening ? 'media' : 'chats');
        render();
        if (opening) loadMessagesMedia(root, state, render);
      });
    });

    MORPH.unwired(root, '[data-messages-media-shelf]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var shelf = btn.getAttribute('data-messages-media-shelf');
        if (shelf === (state.mediaShelf || 'media')) return;
        state.mediaShelf = shelf;
        state.mediaItems = [];
        loadMessagesMedia(root, state, render);
      });
    });

    MORPH.unwired(root, '[data-messages-media-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openMessagesMediaItem(state, parseInt(btn.getAttribute('data-messages-media-open'), 10));
      });
    });

    // A thumbnail whose file has gone (deleted, or storage unreachable) marks
    // its tile so the filename shows through instead of a broken-image icon.
    // Bound as a real listener rather than an inline onerror: `error` does not
    // bubble, so it has to be attached per image.
    MORPH.unwired(root, '[data-messages-media-thumb]').forEach(function (img) {
      if (img._fallbackWired) return;
      img._fallbackWired = true;
      img.addEventListener('error', function () {
        var tile = img.closest('.tma-dash__messages-media-tile');
        if (tile) tile.classList.add('is-missing');
      });
    });

    // --- messages settings ------------------------------------------------
    MORPH.unwired(root, '[data-messages-settings]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var opening = !state.settingsOpen;
        state.settingsOpen = opening;
        state.composeOpen = false;
        // Same exclusivity as above.
        state.mediaMode = false;
        render();
      });
    });

    MORPH.unwired(root, '[data-messages-setting]').forEach(function (field) {
      field.addEventListener('change', function () {
        var key = field.getAttribute('data-messages-setting');
        var value = field.type === 'checkbox' ? field.checked : field.value;
        updateSetting(root, state, render, key, value);
      });
    });

    MORPH.unwired(root, '[data-messages-panel-close]').forEach(function (btn) {
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

      MORPH.on(dropZone, 'dragenter', function (e) {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') === -1) return;
        e.preventDefault();
        depth += 1;
        dropZone.classList.add('is-drop-target');
      });

      MORPH.on(dropZone, 'dragover', function (e) {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') === -1) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });

      MORPH.on(dropZone, 'dragleave', function () {
        depth = Math.max(0, depth - 1);
        if (depth === 0) dropZone.classList.remove('is-drop-target');
      });

      MORPH.on(dropZone, 'drop', function (e) {
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        e.preventDefault();
        depth = 0;
        dropZone.classList.remove('is-drop-target');
        queueFiles(root, state, render, e.dataTransfer.files);
      });
    }

    MORPH.unwired(root, '[data-messages-voice]').forEach(function (el) {
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
    MORPH.unwired(root, '[data-messages-attachment]').forEach(function (el) {
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
      MORPH.on(backBtn, 'click', root._messagesOnBack);
    }
  }

  /*
   * Per-message menu, opened by the "more" button, a right-click, or a mobile
   * long press. Only actions that will actually work are listed, permissions
   * come from the server on each message (`msg.can`), never from hiding
   * buttons client-side alone.
   */
  /* ── Requested files ───────────────────────────────────────────────
   *
   * "/" Request files asks for an application's checklist documents, or for
   * files into a folder, and the request is posted as a card. Everyone in
   * the chat except the person who asked gets an Upload button on each
   * document still wanted; the server renames and files each one in its
   * slot exactly as the emailed upload link would, and every screen showing
   * the card ticks it off. Drawn from what the portal already has: the
   * application's checklist rows, its status chips and its small pill button.
   */
  function fileRequestDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderFileRequestCard(msg) {
    var fr = msg.fileRequest;
    var asker = String(fr.requestedBy) === String((STORE.me || {}).id);
    var answering = !asker && fr.open;
    var busy = (STORE.requestUploads || {})[msg.id] || {};
    var about = fr.application
      ? [fr.application.name, fr.application.number].filter(Boolean).join(' · ')
      : (fr.folder ? 'Into ' + fr.folder.name : '');

    function chip(tone, label) {
      return '<span class="tma-portal-status tma-portal-status--' + tone + ' tma-portal-status--inline">' + esc(label) + '</span>';
    }

    function uploadButton(docId, label) {
      var progress = busy[docId || '*'];
      return (
        '<button type="button" class="tma-dash__clients-edit-btn" data-chatreq-upload="' + esc(msg.id) + '"' +
        (docId ? ' data-chatreq-doc="' + esc(docId) + '"' : ' data-chatreq-multiple') +
        (progress != null ? ' disabled' : '') + '>' +
        esc(progress != null ? 'Uploading ' + progress + '%' : label) + '</button>'
      );
    }

    var rows;
    if (fr.kind === 'documents') {
      rows = (fr.documents || []).map(function (doc) {
        var end = doc.received ? chip('success', 'Received')
          : doc.closed ? chip('neutral', 'No longer needed')
            : answering ? uploadButton(doc.id, 'Upload')
              : chip('pending', 'Waiting');
        return (
          '<li class="tma-dash__clients-checklist-row">' +
          '<span class="tma-dash__clients-checklist-label">' + esc(doc.label) +
          (doc.person ? ' <span class="tma-dash__messages-person-meta">' + esc(doc.person) + '</span>' : '') +
          '</span>' + end + '</li>'
        );
      }).join('');
    } else {
      var got = fr.received || 0;
      rows =
        '<li class="tma-dash__clients-checklist-row">' +
        '<span class="tma-dash__clients-checklist-label">' + esc(fr.title || 'Files') + '</span>' +
        (got ? chip('success', got === 1 ? '1 received' : got + ' received') : '') +
        (answering ? uploadButton(null, 'Upload files') : (got ? '' : chip('pending', 'Waiting'))) +
        '</li>';
    }

    var foot = fr.open
      ? (fr.expiresAt ? 'Upload by ' + fileRequestDate(fr.expiresAt) : '')
      : (fr.closedReason === 'complete' ? 'Everything asked for has arrived' : 'This request has closed');

    return (
      '<div class="tma-dash__messages-request">' +
      '<span class="tma-dash__messages-bubble-lane">Requested files</span>' +
      (about
        ? '<p class="tma-dash__messages-bubble-line"><span class="tma-dash__messages-bubble-copy"><strong>' +
          esc(about) + '</strong></span></p>'
        : '') +
      (fr.message
        ? '<p class="tma-dash__messages-bubble-line"><span class="tma-dash__messages-bubble-copy">' +
          esc(fr.message) + '</span></p>'
        : '') +
      '<ul class="tma-dash__clients-checklist">' + rows + '</ul>' +
      (foot ? '<span class="tma-dash__messages-person-meta">' + esc(foot) + '</span>' : '') +
      '</div>'
    );
  }

  /* A file for one requested document (or several for a folder request). */
  function uploadRequestedFiles(root, state, render, messageId, docId, multiple) {
    var conversationId = state.selectedId;
    var msg = findMessageById(conversationId, messageId);
    if (!msg || !msg.fileRequest) return;

    var picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = !!multiple;
    picker.hidden = true;
    document.body.appendChild(picker);

    picker.addEventListener('change', function () {
      var files = Array.prototype.slice.call(picker.files || []);
      picker.remove();
      if (!files.length) return;

      var key = docId || '*';
      if (!STORE.requestUploads) STORE.requestUploads = {};
      var busy = STORE.requestUploads[messageId] = STORE.requestUploads[messageId] || {};
      var doc = docId ? (msg.fileRequest.documents || []).filter(function (d) { return d.id === docId; })[0] : null;
      var sent = 0;

      var paintProgress = function (pct) {
        busy[key] = pct;
        var selector = '[data-chatreq-upload="' + messageId + '"]' + (docId ? '[data-chatreq-doc="' + docId + '"]' : '');
        var btn = root.querySelector(selector);
        if (btn) btn.textContent = 'Uploading ' + pct + '%';
      };

      busy[key] = 0;
      render();

      files.reduce(function (chain, file) {
        return chain.then(function () {
          return window.TMAMessagingAPI.uploadRequestedFile(messageId, file, docId, paintProgress).then(function (res) {
            sent += 1;
            var current = findMessageById(conversationId, messageId) || msg;
            if (res && res.fileRequest) current.fileRequest = res.fileRequest;
          });
        });
      }, Promise.resolve()).then(function () {
        delete busy[key];
        persistThread(conversationId);
        render();
        showMessagesToast(root, doc ? doc.label + ' uploaded' : (sent === 1 ? 'File uploaded' : sent + ' files uploaded'));
      }).catch(function (err) {
        delete busy[key];
        render();
        showMessagesToast(root, (err && err.message) || 'The file could not be uploaded');
      });
    });

    picker.click();
  }

  function chatRequestJSON(url) {
    return fetch((window.__TMA_SITE_ROOT || '') + url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.message) || 'Request failed');
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function openFileRequestFlow(root, state, render) {
    var ui = window.TMAPortalUI;
    var conversationId = state.selectedId;
    if (!ui || !ui.openModal || !conversationId) return;

    window.TMAMessagingAPI.fileRequestOptions(conversationId).then(function (res) {
      if (!res || !res.canRequest) {
        showMessagesToast(root, 'Only staff and the service provider can request files');
        return;
      }
      var ctx = { root: root, state: state, render: render, conversationId: conversationId, fixed: res.fixed };
      if (res.fixed) openRequestChecklist(ctx, res.fixed);
      else openRequestPicker(ctx, res.applications || []);
    }).catch(function (err) {
      showMessagesToast(root, (err && err.message) || 'Request files could not be opened');
    });
  }

  /* Step one in a chat that is not about one application: which, or none. */
  function openRequestPicker(ctx, applications) {
    var ui = window.TMAPortalUI;

    ui.openModal({
      title: 'Request files',
      cls: 'tma-save-folder',
      body:
        '<p class="tma-portal-modal__text">Which application are these for? Only applications everyone in this chat can see are listed.</p>' +
        '<div class="tma-dash__clients-field">' +
        '<label class="tma-dash__clients-field-label" for="tma-chatreq-search">Find an application</label>' +
        '<input type="search" id="tma-chatreq-search" class="tma-dash__clients-field-input" data-chatreq-search' +
        ' placeholder="Search by name or number" autocomplete="off" spellcheck="false">' +
        '</div>' +
        '<div class="tma-portal-picker"><div class="tma-portal-picker__list" data-chatreq-list></div></div>' +
        '<div class="tma-portal-modal__foot">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-chatreq-cancel>Cancel</button>' +
        '</div>',
      onMount: function (host) {
        var list = host.querySelector('[data-chatreq-list]');
        var search = host.querySelector('[data-chatreq-search]');
        var seq = 0;
        var timer = null;

        function paint(apps) {
          list.innerHTML =
            '<button type="button" class="tma-portal-picker__folder" data-chatreq-none>' +
            '<img src="' + ICON + 'Folder.svg" alt="" width="20" height="20">' +
            '<span class="tma-save-folder__name">No application' +
            '<span class="tma-save-folder__path">Collect the files into a folder</span></span></button>' +
            (apps.length
              ? apps.map(function (a) {
                return (
                  '<button type="button" class="tma-portal-picker__folder" data-chatreq-app="' + esc(a.id) + '">' +
                  '<img src="' + ICON + 'UserList.svg" alt="" width="20" height="20">' +
                  '<span class="tma-save-folder__name">' + esc(a.name || a.number || 'Application') +
                  '<span class="tma-save-folder__path">' + esc([a.number, a.provider].filter(Boolean).join(' · ')) + '</span>' +
                  '</span></button>'
                );
              }).join('')
              : '<p class="tma-portal-picker__empty">No applications that everyone in this chat can see.</p>');

          list.querySelector('[data-chatreq-none]').addEventListener('click', function () {
            openRequestFolder(ctx, {});
          });
          list.querySelectorAll('[data-chatreq-app]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var id = btn.getAttribute('data-chatreq-app');
              var pick = apps.filter(function (a) { return a.id === id; })[0];
              if (pick) openRequestChecklist(ctx, pick);
            });
          });
        }

        paint(applications);
        host.querySelector('[data-chatreq-cancel]').addEventListener('click', function () { ui.closeModal(); });
        search.addEventListener('input', function () {
          clearTimeout(timer);
          timer = setTimeout(function () {
            var mine = ++seq;
            window.TMAMessagingAPI.fileRequestOptions(ctx.conversationId, search.value.trim()).then(function (res) {
              if (mine === seq) paint((res && res.applications) || []);
            }).catch(function () { /* the list on screen stays */ });
          }, 250);
        });
      },
    });
  }

  /* An application's outstanding documents, the ones the Request documents
     dialog on the application page offers. */
  function requestableDocs(docs) {
    return (docs || []).filter(function (d) {
      return d && d.id && d.type !== 'additional_documents'
        && (!d.status || d.status === 'pending_upload' || d.status === 'update_required');
    });
  }

  function requestFoot(ctx, sendLabel) {
    return (
      '<div class="tma-portal-modal__foot">' +
      (ctx.fixed ? '' : '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-chatreq-back>Back</button>') +
      '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-chatreq-cancel>Cancel</button>' +
      '<button type="button" class="tma-no-data__btn" data-chatreq-send>' + esc(sendLabel) + '</button>' +
      '</div>'
    );
  }

  function requestDetailsFields(values) {
    var expiry = values.expiresAt || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    return (
      '<div class="tma-dash__clients-field tma-dash__clients-field--stacked">' +
      '<label class="tma-dash__clients-field-label" for="tma-chatreq-message">Instructions</label>' +
      '<textarea id="tma-chatreq-message" class="tma-dash__clients-field-textarea" data-chatreq-message rows="3" maxlength="2000"' +
      ' placeholder="Anything they should know about these files">' + esc(values.message || '') + '</textarea>' +
      '</div>' +
      '<div class="tma-dash__clients-field">' +
      '<label class="tma-dash__clients-field-label" for="tma-chatreq-expiry">Upload by</label>' +
      '<input type="date" id="tma-chatreq-expiry" class="tma-dash__clients-field-input" data-chatreq-expiry value="' + esc(expiry) + '">' +
      '</div>'
    );
  }

  /* Send, post the card into the thread, and close. */
  function sendFileRequest(ctx, host, payload) {
    var ui = window.TMAPortalUI;
    var send = host.querySelector('[data-chatreq-send]');
    var message = host.querySelector('[data-chatreq-message]');
    var expiry = host.querySelector('[data-chatreq-expiry]');
    payload.message = message ? (message.value || '').trim() || null : null;
    payload.expiresAt = expiry ? expiry.value || null : null;

    send.disabled = true;
    send.textContent = 'Sending…';

    window.TMAMessagingAPI.createFileRequest(ctx.conversationId, payload).then(function (res) {
      ui.closeModal();
      var confirmed = res && res.message;
      if (!confirmed) return;
      mergeMessages(ctx.conversationId, [confirmed], false);
      var row = findThread(ctx.conversationId);
      if (row) {
        row.preview = 'You: ' + messagePreview(confirmed);
        row.timestamp = confirmed.sentAt;
        row.listed = true;
      }
      ctx.render({ chatToBottom: true });
    }).catch(function (err) {
      send.disabled = false;
      send.textContent = 'Send request';
      var errors = err && err.data && err.data.errors;
      var first = errors && Object.keys(errors).length ? errors[Object.keys(errors)[0]][0] : null;
      showMessagesToast(ctx.root, first || (err && err.message) || 'The request could not be sent');
    });
  }

  /* Step two for an application: tick its outstanding documents. */
  function openRequestChecklist(ctx, application) {
    var ui = window.TMAPortalUI;

    ui.openModal({
      title: 'Request files',
      cls: 'tma-cip-not-ready tma-cip-docreq',
      body: '<div data-chatreq-body>' + (ui.loading ? ui.loading({ count: 4 }) : '<p class="tma-portal-modal__text">Loading…</p>') + '</div>',
      onMount: function (host) {
        var body = host.querySelector('[data-chatreq-body]');

        chatRequestJSON('/portal/cip/applications/' + encodeURIComponent(application.id)).then(function (res) {
          var app = (res && res.application) || {};
          var people = [];
          if (app.applicant) people.push(app.applicant);
          if (app.sponsor) people.push(app.sponsor);
          (app.dependents || []).forEach(function (d) { people.push(d); });

          var groups = people.map(function (person) {
            return { person: person, docs: requestableDocs(person.documents) };
          }).filter(function (g) { return g.docs.length; });

          var heading =
            '<header class="tma-dash__clients-card-head tma-dash__clients-card-head--person">' +
            '<div class="tma-dash__clients-card-person-text">' +
            '<h3 class="tma-dash__clients-card-title">' + esc(application.name || application.number || 'Application') + '</h3>' +
            '<span class="tma-dash__clients-card-person-name">' +
            esc([application.number, application.provider].filter(Boolean).join(' · ')) + '</span>' +
            '</div></header>';

          if (!groups.length) {
            body.innerHTML = heading +
              '<p class="tma-portal-modal__text">Every document on this application has been uploaded.</p>' +
              '<div class="tma-portal-modal__foot">' +
              (ctx.fixed ? '' : '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-chatreq-back>Back</button>') +
              '<button type="button" class="tma-no-data__btn" data-chatreq-cancel>Close</button></div>';
          } else {
            body.innerHTML = heading +
              '<p class="tma-portal-modal__text">Tick the documents you need. Each one is renamed and filed in its place on the checklist when it arrives.</p>' +
              '<div class="tma-cip-not-ready__list">' +
              groups.map(function (group) {
                return (
                  '<section class="tma-cip-not-ready__group">' +
                  '<header class="tma-dash__clients-card-head tma-cip-docreq__person">' +
                  '<h3 class="tma-dash__clients-card-title">' + esc(group.person.name || group.person.label || 'Applicant') + '</h3>' +
                  '<span class="tma-tab__count">' + esc(String(group.docs.length)) + '</span>' +
                  '</header>' +
                  '<ul class="tma-dash__clients-checklist">' +
                  group.docs.map(function (d) {
                    return (
                      '<li class="tma-dash__clients-checklist-row">' +
                      '<label class="tma-portal-check-row tma-dash__clients-checklist-label">' +
                      '<input type="checkbox" class="tma-dash__check" data-chatreq-pick="' + esc(d.id) + '">' +
                      '<span>' + esc(d.label || 'Document') +
                      (d.required === false ? ' <span class="tma-dash__clients-checklist-optional">Optional</span>' : '') +
                      '</span></label>' +
                      '<span class="tma-portal-status tma-portal-status--' + esc(d.statusTone || 'neutral') +
                      ' tma-portal-status--inline">' + esc(d.statusLabel || 'Pending upload') + '</span>' +
                      '</li>'
                    );
                  }).join('') +
                  '</ul></section>'
                );
              }).join('') +
              '</div>' +
              requestDetailsFields({}) +
              requestFoot(ctx, 'Send request');

            host.querySelector('[data-chatreq-send]').addEventListener('click', function () {
              var picked = [];
              host.querySelectorAll('[data-chatreq-pick]').forEach(function (box) {
                if (box.checked) picked.push(box.getAttribute('data-chatreq-pick'));
              });
              if (!picked.length) {
                showMessagesToast(ctx.root, 'Tick at least one document to ask for');
                return;
              }
              sendFileRequest(ctx, host, { application: application.id, documents: picked });
            });
          }

          var back = host.querySelector('[data-chatreq-back]');
          if (back) back.addEventListener('click', function () { openFileRequestFlow(ctx.root, ctx.state, ctx.render); });
          host.querySelector('[data-chatreq-cancel]').addEventListener('click', function () { ui.closeModal(); });
        }).catch(function (err) {
          body.innerHTML = '<p class="tma-portal-modal__text">' + esc((err && err.message) || 'This application could not be loaded.') + '</p>';
        });
      },
    });
  }

  /*
   * Step two without an application: what is needed and which folder it
   * goes in. The folder is chosen in the library's own picker (Save to
   * Application Folder), which takes this dialog's place and hands back.
   */
  function openRequestFolder(ctx, values) {
    var ui = window.TMAPortalUI;

    ui.openModal({
      title: 'Request files',
      cls: 'tma-cip-docreq',
      body:
        '<div class="tma-dash__clients-field tma-dash__clients-field--stacked">' +
        '<label class="tma-dash__clients-field-label" for="tma-chatreq-title">What do you need?</label>' +
        '<input type="text" id="tma-chatreq-title" class="tma-dash__clients-field-input" data-chatreq-title maxlength="150"' +
        ' placeholder="For example, your October invoices" value="' + esc(values.title || '') + '">' +
        '</div>' +
        '<div class="tma-dash__clients-field tma-dash__clients-field--stacked">' +
        '<span class="tma-dash__clients-field-label">Where should the files go?</span>' +
        '<div class="tma-portal-picker__crumbs">' +
        (values.folder
          ? '<span>' + esc(values.folder.name) + '</span> '
          : '') +
        '<button type="button" class="tma-dash__clients-edit-btn" data-chatreq-folder>' +
        (values.folder ? 'Change folder' : 'Choose a folder') + '</button>' +
        '</div></div>' +
        requestDetailsFields(values) +
        requestFoot(ctx, 'Send request'),
      onMount: function (host) {
        var collect = function () {
          return {
            title: (host.querySelector('[data-chatreq-title]').value || '').trim(),
            message: host.querySelector('[data-chatreq-message]').value || '',
            expiresAt: host.querySelector('[data-chatreq-expiry]').value || '',
            folder: values.folder || null,
          };
        };

        host.querySelector('[data-chatreq-folder]').addEventListener('click', function () {
          var kept = collect();
          if (!window.TMASaveToFolder) return;
          window.TMASaveToFolder.open({
            choose: true,
            title: 'Where should the files go?',
            text: 'Find the applicant or folder, open the one the files belong in, then choose it.',
            okLabel: 'Choose this folder',
            onPick: function (folder) {
              kept.folder = folder;
              openRequestFolder(ctx, kept);
            },
            onCancel: function () { openRequestFolder(ctx, kept); },
          });
        });

        host.querySelector('[data-chatreq-send]').addEventListener('click', function () {
          var now = collect();
          if (!now.folder) {
            showMessagesToast(ctx.root, 'Choose the folder the files should go in');
            return;
          }
          sendFileRequest(ctx, host, { folder: now.folder.id, title: now.title || null });
        });

        var back = host.querySelector('[data-chatreq-back]');
        if (back) back.addEventListener('click', function () { openFileRequestFlow(ctx.root, ctx.state, ctx.render); });
        host.querySelector('[data-chatreq-cancel]').addEventListener('click', function () { ui.closeModal(); });
      },
    });
  }

  /* ── Message details ───────────────────────────────────────────────
   *
   * From a bubble's menu: when it was sent, who has seen it and when, who
   * has it but has not opened it, and who it has not reached yet. Drawn as
   * the group's member list is (face, name, the detail under it).
   */
  function openMessageDetails(root, msg) {
    var ui = window.TMAPortalUI;
    if (!ui || !ui.openModal || !msg || !msg.id) return;

    function person(face, detail) {
      return (
        '<div class="tma-dash__messages-member">' +
        (face.avatar
          ? '<span class="tma-dash__messages-row-avatar"><img src="' + esc(face.avatar) + '" alt="" loading="lazy"></span>'
          : renderInitialAvatar(face.name || '?')) +
        '<span class="tma-dash__messages-person-text">' +
        '<span class="tma-dash__messages-person-name">' + esc(face.name || 'Unknown') + '</span>' +
        (detail ? '<span class="tma-dash__messages-person-meta">' + esc(detail) + '</span>' : '') +
        '</span></div>'
      );
    }

    function section(title, inner) {
      return (
        '<div class="tma-dash__clients-field tma-dash__clients-field--stacked">' +
        '<span class="tma-dash__clients-field-label">' + esc(title) + '</span>' + inner + '</div>'
      );
    }

    ui.openModal({
      title: 'Message details',
      cls: 'tma-cip-docreq',
      body: '<div data-msginfo-body>' + (ui.loading ? ui.loading({ count: 3 }) : '<p class="tma-portal-modal__text">Loading…</p>') + '</div>',
      onMount: function (host) {
        var body = host.querySelector('[data-msginfo-body]');

        window.TMAMessagingAPI.messageInfo(msg.id).then(function (info) {
          var sent = info.sentAtLabel || '';
          if (!info.mine && info.sender) sent += ' by ' + info.sender;

          var read = (info.readBy || []).map(function (face) {
            return person(face, 'Seen ' + (face.seenAtLabel || ''));
          }).join('');
          var delivered = (info.deliveredTo || []).map(function (face) {
            return person(face, 'Delivered, not opened yet');
          }).join('');
          var waiting = (info.waiting || []).map(function (face) {
            return person(face, 'Not delivered yet');
          }).join('');

          body.innerHTML =
            section('Sent', '<p class="tma-portal-modal__text">' + esc(sent) + '</p>') +
            (info.editedAtLabel ? section('Edited', '<p class="tma-portal-modal__text">' + esc(info.editedAtLabel) + '</p>') : '') +
            section('Seen by', read || '<p class="tma-portal-modal__text">Nobody yet</p>') +
            (delivered ? section('Delivered to', delivered) : '') +
            (waiting ? section('Not delivered yet', waiting) : '') +
            '<div class="tma-portal-modal__foot">' +
            '<button type="button" class="tma-no-data__btn" data-msginfo-close>Close</button></div>';
          body.querySelector('[data-msginfo-close]').addEventListener('click', function () { ui.closeModal(); });
        }).catch(function (err) {
          body.innerHTML = '<p class="tma-portal-modal__text">' + esc((err && err.message) || 'The details could not be loaded.') + '</p>';
        });
      },
    });
  }

  function openMessageMenu(root, state, render, anchor, messageId, position, attachmentId) {
    closeMessageMenu();

    var msg = findMessageById(state.selectedId, messageId);
    if (!msg || msg.deleted) return;

    /*
     * The files on this message: the one right-clicked, or every one when
     * the menu was opened on the message. Each can be downloaded, or filed
     * straight into an applicant's folder without a trip through the
     * computer's Downloads.
     */
    var files = (msg.attachments || []).filter(function (a) {
      return a && a.url && (!attachmentId || a.id === attachmentId);
    });

    // Words of this message already highlighted, read before the menu's own
    // tap can clear them.
    var picked = msg.body ? (highlightedTextIn(root, messageId) || rememberedHighlight(messageId)) : '';

    var items = [{ action: 'reply', label: 'Reply' }];
    // A request belongs to this chat: a forwarded copy would carry its words
    // without its upload buttons.
    if (msg.type !== 'file_request') items.push({ action: 'forward', label: 'Forward' });
    // Take it up with whoever said it, away from the group. Only in a group,
    // and only on somebody else's message.
    var inGroup = (findThread(state.selectedId) || {}).type === 'group';
    if (inGroup && msg.direction === 'in' && msg.sender && msg.sender.id) {
      items.splice(1, 0, { action: 'reply-private', label: 'Reply privately' });
    }
    if (msg.body) {
      items.push({ action: 'copy', label: picked ? 'Copy selection' : 'Copy text' });
      items.push({ action: 'select', label: 'Select text' });
      items.push({ action: 'translate', label: 'Translate' });
    }
    if (files.length === 1) {
      items.push({ action: 'download', label: 'Download' });
      if (window.TMASaveToFolder) items.push({ action: 'save-folder', label: 'Save to Application Folder' });
    } else if (files.length > 1) {
      items.push({ action: 'download', label: 'Download all (' + files.length + ')' });
      if (window.TMASaveToFolder) {
        files.slice(0, 6).forEach(function (f, i) {
          items.push({ action: 'save-folder:' + i, label: 'Save ' + f.name + ' to Application Folder' });
        });
      }
    }
    items.push({ action: 'pin', label: msg.starred ? 'Unpin message' : 'Pin message' });
    // When it was sent, and who has seen it and when. Only once it is stored.
    if (msg.seq) items.push({ action: 'details', label: 'Details' });
    if (msg.can && msg.can.edit) items.push({ action: 'edit', label: 'Edit' });
    if (msg.can && msg.can.delete) {
      items.push({ action: 'delete', label: 'Delete for everyone', danger: true });
    }

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
        } else if (action === 'reply-private') replyPrivately(root, state, render, msg);
        else if (action === 'copy') copyMessageText(root, msg, picked);
        else if (action === 'select') startTextSelect(root, state, render, msg);
        else if (action === 'edit') startEditingMessage(root, state, render, msg);
        else if (action === 'delete') deleteMessage(root, state, render, msg);
        else if (action === 'forward') forwardMessage(root, state, render, msg);
        else if (action === 'pin') toggleMessagePin(root, state, render, msg);
        else if (action === 'translate') translateMessage(root, state, render, msg);
        else if (action === 'details') openMessageDetails(root, msg);
        else if (action === 'download') downloadAttachments(files);
        else if (action === 'save-folder' || action.indexOf('save-folder:') === 0) {
          var which = files[parseInt(action.split(':')[1] || '0', 10) || 0];
          if (which && window.TMASaveToFolder) {
            window.TMASaveToFolder.open({ kind: 'messaging', id: which.id, name: which.name });
          }
        }
      });
    });

    openMenuEl = menu;
    setTimeout(function () {
      document.addEventListener('click', closeMessageMenuOnce, true);
    }, 0);
  }

  /*
   * Save files to the computer. A link with `download` per file, fetched as
   * an attachment (?download=1) so a photo or a video is saved rather than
   * opened, in the desktop and phone apps as in a browser. Staggered: a
   * browser asked for several downloads at once drops all but the first.
   */
  function downloadAttachments(files) {
    (files || []).forEach(function (file, i) {
      setTimeout(function () {
        var a = document.createElement('a');
        a.href = attachmentDownloadUrl(file);
        a.download = file.name || '';
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { a.remove(); }, 1000);
      }, i * 350);
    });
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
    document.querySelectorAll('.tma-dash__messages-bubble-row.is-highlighted').forEach(function (el) {
      el.classList.remove('is-highlighted', 'is-actions-open');
    });
  }

  /*
   * Dismiss on a click *outside* the open panel.
   *
   * This used to be a `{ once: true }` listener that closed unconditionally, so
   * interacting with the panel's own contents shut it, switching emoji
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

  function mount(root, opts) {
    opts = opts || {};
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
      searchMode: false,
      searchResults: null,
      searchLoading: false,
      /* The pooled Media view over the inbox column: which shelf is showing,
       * what it holds, and whether it is still loading. Fetched once per
       * opening rather than kept live, it is a browsing view, and re-fetching
       * on every render would make scrolling it stutter. */
      mediaMode: false,
      mediaShelf: 'media',
      mediaItems: [],
      mediaLoading: false,
      mediaError: null,
      /* Calls: recent call history, fetched from the server when the tab is
       * opened (not scanned from whatever threads happen to be loaded). */
      callsMode: false,
      callLog: [],
      callsLoading: false,
      callsError: null,
      inboxWidth: loadInboxWidth(),
      profileOpen: false,
      profile: null,
      profileShelf: 'media',
      profileGallery: null,
      voiceRecording: false,
      search: '',
      peopleResults: [],
      composeOpen: false,
      composeQuery: '',
      composeResults: [],
      groupOpen: false,
      groupMembers: [],
      groupName: '',
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

      // Reconciled, not replaced. Unchanged bubbles, avatars and attachments
      // are left alone entirely, so the thread no longer flashes and reloads
      // its images on every send, tick and reaction.
      MORPH.patch(root, renderLayout(state, render));
      ensureMessagesMobileHeader(root, state);
      wireEvents(root, state, render);

      // Scroll is largely preserved by reconciliation itself now, the panes
      // are never destroyed. This still runs because it also handles the
      // deliberate moves: opening a conversation jumps to the newest message,
      // and loading older history holds the reader's place.
      restoreScroll(root, snapshot, intent);
      syncTabBarBadges();
    }

    root._messagesOnBack = function () {
      closeConversation(root, state, render);
    };

    if (root._messagesMounted) {
      render();
      // The list load held back for this page runs now.
      if (root._messagesBootPending) {
        var pendingBoot = root._messagesBootPending;
        root._messagesBootPending = null;
        pendingBoot();
      }
      if (opts.openDirectUserId) {
        startConversationWith(root, state, render, opts.openDirectUserId, opts.startCall);
        return;
      }
      // Re-entered from a notification link while the page was already up
      // (the shell mounts Messages on load, whichever view is showing).
      var reopen = opts.openConversationId || takePendingConversationId();
      if (reopen) {
        openConversationFromId(root, state, render, reopen, opts.startCall || takePendingCallMedia());
      }
      return;
    }
    root._messagesMounted = true;
    // A warm snapshot resolving after this point repaints the mounted list.
    warmRerender = render;

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

      /*
       * Registered in the capture phase so the Messages page gets first refusal
       * on these keys. The portal's global command palette also opens on "/",
       * and without capturing, one keypress both focused this search *and*
       * opened the palette, which then sat over the page swallowing clicks.
       */
      document.addEventListener('keydown', function (e) {
        if (!root.isConnected) return;

        // A dialog over the page owns its keys. Escape in the rename dialog
        // or the photo crop closes that, not the panel underneath it too.
        if (document.querySelector('.tma-portal-modal, .tma-cropper')) return;

        var target = e.target;
        var typing =
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable ||
            // A keystroke that lands on the document while the composer holds
            // text is still typing as far as the user is concerned, treating
            // it as a shortcut is how "/" got eaten out of a pasted URL.
            !!(target.closest && target.closest('.tma-dash__messages-composer')));

        if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
          var field = root.querySelector('[data-messages-search]');
          if (field) {
            e.preventDefault();
            // Claim the key outright: the global palette listens for it too.
            e.stopPropagation();
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

        if (state.searchMode) {
          exitSearchMode(state, render);
          return;
        }

        if (state.profileOpen) {
          closeProfile(state, render);
          return;
        }

        // Never yank the conversation out from under someone mid-sentence.
        if (state.selectedId && !typing && !getComposerDraft(state).trim()) {
          closeConversation(root, state, render);
        }
      }, true);

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
      if (document.hidden) {
        // Nobody types in a hidden tab. Retract it now rather than leaving
        // the other side waiting for the TTL to expire.
        stopTyping();
        return;
      }
      if (!root.isConnected) return;
      window.TMAMessagingAPI.heartbeat();
      // Nothing to reconcile before the first load has run.
      if (root._messagesBootPending) return;
      loadConversations(root, state, render, { silent: true });
    });

    /*
     * Coming back to the tab re-reads the badges, so the Calls count is
     * right the moment the page is looked at again rather than only at load.
     */
    if (!root._tabCountsFocusBound) {
      root._tabCountsFocusBound = true;
      window.addEventListener('focus', function () {
        if (document.hidden || !root.isConnected) return;
        refreshTabCounts(root, state, render);
      });
    }

    /*
     * The last open page closing says so, so the person turns grey within
     * the minute rather than after their whole lease. A reload sends this
     * too; the server only shortens the lease, and the page that comes
     * straight back renews it. Another tab still open keeps quiet.
     */
    if (!window._tmaPresenceLeavingBound) {
      window._tmaPresenceLeavingBound = true;
      window.addEventListener('pagehide', function (e) {
        if (!navigator.sendBeacon || (e && e.persisted)) return;
        var rt = window.TMAMessagingRealtime;
        if (rt && rt.hasOtherTab && rt.hasOtherTab()) return;
        var form = new FormData();
        var meta = document.querySelector('meta[name="csrf-token"]');
        form.append('_token', meta ? meta.getAttribute('content') : '');
        try { navigator.sendBeacon('/portal/messaging/presence/leaving', form); } catch (err) { /* ignore */ }
      });
    }

    // Closing the tab has to retract the indicator too, and a normal request
    // will not survive teardown, sendBeacon is the only thing that does.
    window.addEventListener('pagehide', function () {
      if (!typingOut.conversationId || !navigator.sendBeacon) return;

      var url = '/portal/messaging/conversations/' +
        encodeURIComponent(typingOut.conversationId) + '/typing';
      var form = new FormData();
      form.append('typing', '0');
      var meta = document.querySelector('meta[name="csrf-token"]');
      form.append('_token', meta ? meta.getAttribute('content') : '');
      navigator.sendBeacon(url, form);
    });

    render();
    var boot = function () {
      root._messagesBooted = true;
      root._messagesBootPending = null;
      loadConversations(root, state, render).then(function () {
        if (opts.openDirectUserId) {
          startConversationWith(root, state, render, opts.openDirectUserId, opts.startCall);
          return;
        }
        // Arriving from a message or missed-call notification: open the
        // conversation it came from. Read from the URL as well as the mount
        // options so a cold load of /social/messages?conversation=… lands in the
        // same place an in-shell navigation does.
        var wanted = opts.openConversationId || takePendingConversationId();
        if (wanted) {
          openConversationFromId(root, state, render, wanted, opts.startCall || takePendingCallMedia());
        }
      });
    };
    if (window.TMABoot && window.TMABoot.deferUnless && !opts.openDirectUserId && !opts.openConversationId) {
      // Messages mounts with the shell. The heartbeat above keeps presence
      // live from the first moment; the list itself loads when Messages is
      // entered, or once the shell has gone quiet.
      var runBoot = window.TMABoot.deferUnless(['messages'], boot);
      if (!root._messagesBooted) root._messagesBootPending = runBoot;
    } else {
      boot();
    }
  }

  /*
   * ?conversation=<uuid>, how a notification names the thread it is about.
   *
   * Read once, here at load, because the shell rewrites the address bar to the
   * bare page path as soon as it activates a view: by the time the inbox has
   * finished loading the parameter is long gone. Consumed on first use so a
   * later re-mount doesn't drag the user back to it.
   */
  var pendingConversationId = (function () {
    try {
      return new URLSearchParams(window.location.search).get('conversation') || '';
    } catch (e) {
      return '';
    }
  })();

  function takePendingConversationId() {
    var id = pendingConversationId;
    pendingConversationId = '';
    return id;
  }

  /*
   * ?call=audio|video, the "Call back" verb on a missed-call notification.
   *
   * Read here for the same reason the conversation id is: an in-shell
   * navigation hands this over as opts.startCall, but a cold load of
   * /social/messages?conversation=…&call=audio never passes through the
   * shell's router, and the address is rewritten before the inbox loads.
   */
  var pendingCallMedia = (function () {
    try {
      var v = new URLSearchParams(window.location.search).get('call') || '';
      return (v === 'audio' || v === 'video') ? v : '';
    } catch (e) {
      return '';
    }
  })();

  function takePendingCallMedia() {
    var media = pendingCallMedia;
    pendingCallMedia = '';
    return media;
  }

  /* Return the inbox column to the chat list, whatever panel is over it. */
  function showMessagesChats(state) {
    state.mediaMode = false;
    state.callsMode = false;
    state.tab = 'all';
    state.settingsOpen = false;
    state.composeOpen = false;
  }

  window.TMAMessages = {
    mount: mount,
    clearMobileHeader: clearMessagesMobileHeader,
    getInboxUnreadCount: getInboxUnreadCount,
    getMissedCallCount: getMissedCallCount,
    /*
     * A conversation's own face, as the chat list draws it: a person's photo
     * or initials, a group's picture or its members. For any other page that
     * lists conversations, so one is recognised there as it is here. Takes a
     * conversation as the server presents it.
     */
    avatarHtml: function (row) {
      return row ? threadIcon(resolveThread(row)) : '';
    },
    /*
     * A message as the chat draws it, arriving from `person` ({name, photo}),
     * for a page that shows one before it is sent (Templates > Welcome
     * Message). The same formatter as a real bubble: line breaks, lists,
     * bold, italic and links.
     */
    previewBubbleHtml: function (person, body) {
      var msg = { body: String(body == null ? '' : body), sender: person || {} };
      return '<div class="tma-dash__messages-bubble-row tma-dash__messages-bubble-row--in">' +
        renderBubbleAvatar(msg, {}, 'in', true) +
        '<div class="tma-dash__messages-bubble-main">' +
        '<div class="tma-dash__messages-bubble tma-dash__messages-bubble--in">' +
        '<div class="tma-dash__messages-bubble-text"><p class="tma-dash__messages-bubble-line">' +
        '<span class="tma-dash__messages-bubble-copy">' + renderMessageText(msg) + '</span>' +
        '</p></div></div></div></div>';
    },
    /* Ctrl or Cmd with B and I type *bold* and _italic_ in a textarea. */
    bindEmphasisKeys: bindEmphasisKeys,
    /** `opts.startCall` = 'audio' | 'video' rings once the thread is open. */
    openDirect: function (userId, opts) {
      var mountEl = document.querySelector('[data-messages]');
      if (!mountEl || !mountEl._messagesState) return;
      // Re-enter via mount so wiring/state stay consistent.
      mount(mountEl, { openDirectUserId: userId, startCall: opts && opts.startCall });
    },
  };
})();
