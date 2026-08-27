/*
 * TMA - Social Feed ( /social/feed )
 *
 * The internal communications module: channels, posts, drafts, scheduling,
 * comments, reactions, polls, announcements, search and analytics.
 *
 * Two rules shape everything here:
 *
 *  1. **Nothing reloads the feed.** Posting, commenting, reacting, voting and
 *     publishing all patch the affected card and nothing else (§22). Rendering
 *     goes through TMAMorph, so the DOM is reconciled rather than replaced —
 *     which is what keeps scroll position, open comment boxes and half-typed
 *     replies alive across a redraw.
 *  2. **The server decides.** Every payload carries a `can` object; the UI
 *     renders from that and never re-derives a permission rule. A button the
 *     server would refuse is not drawn.
 *
 * Global: window.TMAFeed
 */
(function () {
  'use strict';

  var API = null; // resolved on mount, so load order can't break the page
  var ICON = 'images/icons/phosphor/';

  /* ── constants ───────────────────────────────────────────── */

  var POST_TYPES = [
    { id: 'discussion', label: 'Discussion', icon: 'ChatTeardropText', tone: 'discussion' },
    { id: 'question', label: 'Question', icon: 'Question', tone: 'question' },
    { id: 'praise', label: 'Praise', icon: 'Medal', tone: 'praise' },
    { id: 'poll', label: 'Poll', icon: 'ChartBarHorizontal', tone: 'poll' },
    { id: 'announcement', label: 'Announcement', icon: 'Megaphone', tone: 'announcement' },
  ];

  /* The sidebar's non-channel views, in the order §1 lists them. */
  var VIEWS = [
    { id: 'all', label: 'All channels', icon: 'Newspaper' },
    { id: 'mine', label: 'My channels', icon: 'UsersThree' },
    { id: 'drafts', label: 'Drafts', icon: 'PencilSimple' },
    { id: 'scheduled', label: 'Scheduled posts', icon: 'ClockCountdown' },
    { id: 'archived', label: 'Archived posts', icon: 'Archive' },
    { id: 'bookmarks', label: 'Bookmarks', icon: 'BookmarkSimple' },
    { id: 'pinned', label: 'Pinned posts', icon: 'PushPin' },
    { id: 'mentions', label: 'Mentions', icon: 'At' },
  ];

  /* The reaction row's quick picks. Any emoji can still be chosen. */
  var QUICK_REACTIONS = ['👍', '❤️', '🎉', '👏', '😄', '🤔', '👀'];

  /*
   * Channel colours are design-system token names, never hex values, the
   * sidebar dot, the header badge and the post chip all resolve the same one.
   * Only colours that exist in tokens.css are offered; there is no purple in
   * this design system, and inventing one here would be the only place it
   * appeared.
   */
  var CHANNEL_COLOURS = ['blue', 'green', 'orange', 'red', 'pink', 'yellow'];

  var CHANNEL_ICONS = [
    'Hash', 'Megaphone', 'UsersThree', 'Buildings', 'Briefcase', 'Rocket',
    'ChartLine', 'Lightbulb', 'Handshake', 'Confetti', 'Target', 'Books',
  ];

  var CHANNEL_TYPES = [
    { id: 'company', label: 'Company-wide' },
    { id: 'department', label: 'Department' },
    { id: 'team', label: 'Team' },
    { id: 'project', label: 'Project' },
    { id: 'client', label: 'Client' },
    { id: 'private', label: 'Private' },
    { id: 'public', label: 'Public' },
  ];

  var EMAIL_AUDIENCES = [
    { id: 'none', label: 'Do not send email' },
    { id: 'members', label: 'Channel members' },
    { id: 'mentioned', label: 'Only mentioned people' },
    { id: 'everyone', label: 'Everyone', moderator: true },
    { id: 'groups', label: 'Selected groups', moderator: true },
  ];

  /* How often a draft autosaves while someone is typing. */
  var AUTOSAVE_MS = 2500;

  /* ── state ───────────────────────────────────────────────── */

  /*
   * One state object for the whole page. `view` and `channelId` together say
   * what the main column is showing; everything else is either loaded data or
   * transient UI (which composer is open, which post's comments are expanded).
   */
  var state = {
    el: null,
    loading: true,
    error: null,

    channels: [],
    can: {},

    view: 'all',
    channelId: null,
    channel: null,

    posts: [],
    pinned: [],
    postsLoading: false,
    hasMore: false,
    cursor: null,
    loadingMore: false,

    filters: { type: '', author: '', hashtag: '', from: '', to: '', hasAttachments: false, hasPoll: false },
    search: '',

    // Sidebar memory (§1). Persisted, so the page opens where it was left.
    sidebarOpen: true,
    groups: { views: true, channels: true, admin: true },
    sidebarScroll: 0,
    channelSearch: '',

    composer: null,       // the open composer, or null
    comments: {},         // postId => { open, loading, items, draft, replyTo, error }
    reactionPicker: null, // postId currently showing the emoji picker
    menuFor: null,        // postId whose overflow menu is open
    gallery: null,        // { postId, attachmentId }: the photo viewer, or null
    mention: null,        // the open @/# autocomplete: { host, el, kind, term, index, results }
    modal: null,          // { kind, ... }, channel form, members, analytics, ...
    analytics: null,
    searchResults: null,
    toastedGone: false,
  };

  /* ── small helpers ───────────────────────────────────────── */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function morph() {
    return window.TMAMorph || {
      patch: function (root, html) { root.innerHTML = html; },
      unwired: function (root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); },
      unwiredOne: function (root, sel) { return root.querySelector(sel); },
      on: function (el, type, handler) { el.addEventListener(type, handler); },
    };
  }

  function toast(message, tone) {
    if (window.TMAToast && window.TMAToast.showFloatingToast) {
      window.TMAToast.showFloatingToast(message, { state: tone || 'neutral' });
    }
  }

  function me() {
    var u = window.TMACurrentUser && window.TMACurrentUser.get && window.TMACurrentUser.get();
    return u || null;
  }

  var TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  /*
   * Faces come from the shell's one avatar resolver, never from a local
   * fallback.
   *
   * Most accounts here have no uploaded photo, and the portal's rule is that
   * they fall back to initials rather than to a system picture. Drawing a
   * transparent pixel instead, which is what a bespoke fallback here would do
   *, leaves a hole where every author's face should be.
   */
  function myAvatar() {
    var u = me();
    var store = window.TMACurrentUser;

    if (store && store.avatarSrc) return store.avatarSrc(u && u.avatar, u && u.name);

    return (u && u.avatar) || TRANSPARENT;
  }

  function avatarFor(person) {
    if (!person) return TRANSPARENT;

    var store = window.TMACurrentUser;

    // initialsFor seeds the colour per person, so one colleague keeps the same
    // initials tile everywhere they appear in the portal.
    if (store && store.initialsFor && !person.photo) {
      return store.initialsFor(person.name, person.id ? String(person.id) : person.name);
    }

    return person.photo || TRANSPARENT;
  }

  /* A short, human time, "3m", "2h", "Mon", "4 Mar". */
  function shortTime(iso) {
    if (!iso) return '';
    var then = new Date(iso);
    if (isNaN(then.getTime())) return '';

    var seconds = Math.floor((Date.now() - then.getTime()) / 1000);
    if (seconds < 60) return 'now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
    if (seconds < 604800) return then.toLocaleDateString(undefined, { weekday: 'short' });

    return then.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: then.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    });
  }

  /* The full timestamp, for a tooltip on the short one. */
  function fullTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function bytes(size) {
    if (window.TMAPortalLightbox && window.TMAPortalLightbox.formatBytes) {
      return window.TMAPortalLightbox.formatBytes(size);
    }
    if (!size) return '';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i += 1; }
    return (i === 0 ? size : size.toFixed(1)) + ' ' + units[i];
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : (many || one + 's'));
  }

  /* ── sidebar memory (§1) ─────────────────────────────────── */

  /*
   * Remembered per account, so two people sharing a browser profile do not
   * inherit each other's open groups or selected channel.
   *
   * `viewerId` is resolved from /me before the memory is read, and never from
   * window.TMACurrentUser here: that store fills in asynchronously, so reading
   * it at mount produced the key "tma.feed.anon" while every later save used
   * "tma.feed.7", the settings were written faithfully and then never found
   * again.
   */
  var viewerId = null;

  function memoryKey() {
    return 'tma.feed.' + (viewerId || 'anon');
  }

  function loadMemory() {
    try {
      var raw = window.localStorage.getItem(memoryKey());
      if (!raw) return;
      var saved = JSON.parse(raw);

      if (saved.view) state.view = saved.view;
      if (saved.channelId) state.channelId = saved.channelId;
      if (saved.groups) state.groups = Object.assign(state.groups, saved.groups);
      if (typeof saved.sidebarOpen === 'boolean') state.sidebarOpen = saved.sidebarOpen;
      if (typeof saved.sidebarScroll === 'number') state.sidebarScroll = saved.sidebarScroll;
      if (saved.filters) state.filters = Object.assign(state.filters, saved.filters);
      if (typeof saved.channelSearch === 'string') state.channelSearch = saved.channelSearch;
    } catch (e) {
      // A corrupt or unavailable store just means the page opens at defaults.
    }
  }

  function saveMemory() {
    try {
      window.localStorage.setItem(memoryKey(), JSON.stringify({
        view: state.view,
        channelId: state.channelId,
        groups: state.groups,
        sidebarOpen: state.sidebarOpen,
        sidebarScroll: state.sidebarScroll,
        filters: state.filters,
        channelSearch: state.channelSearch,
      }));
    } catch (e) {
      // Private-browsing quota errors must not break navigation.
    }
  }

  /* ── deep links ──────────────────────────────────────────── */

  /*
   * A notification or an email links to /social/feed?post={uuid} or
   * ?channel={uuid}. The parameter is read once on mount and then cleared from
   * the URL, so a refresh doesn't keep re-opening the same post.
   */
  function readDeepLink() {
    var params = new URLSearchParams(window.location.search);
    var post = params.get('post');
    var channel = params.get('channel');

    if (!post && !channel) return null;

    params.delete('post');
    params.delete('channel');
    var query = params.toString();
    window.history.replaceState(
      window.history.state, '',
      window.location.pathname + (query ? '?' + query : '')
    );

    return { post: post, channel: channel };
  }

  /* ── data loading ────────────────────────────────────────── */

  function loadChannels() {
    return API.channels({ includeArchived: true }).then(function (data) {
      state.channels = data.channels || [];
      state.can = data.can || {};

      // A remembered channel that has since been deleted or left must not
      // leave the page pointing at nothing.
      if (state.channelId && !findChannel(state.channelId)) {
        state.channelId = null;
        state.view = 'all';
      }

      state.channel = state.channelId ? findChannel(state.channelId) : null;
    });
  }

  function findChannel(id) {
    for (var i = 0; i < state.channels.length; i++) {
      if (state.channels[i].id === id) return state.channels[i];
    }
    return null;
  }

  /*
   * Load the stream for whatever the sidebar currently points at.
   *
   * `append` is the paging case: the new page is concatenated rather than
   * replacing what is on screen, so scrolling back never loses position.
   */
  var streamRequest = null;

  function loadPosts(append) {
    if (streamRequest && streamRequest.abort) streamRequest.abort();

    var controller = window.AbortController ? new AbortController() : null;
    streamRequest = controller;

    var params = {
      channel: state.channelId || '',
      view: streamView(),
      before: append ? state.cursor : '',
      q: state.search || '',
    };

    Object.keys(state.filters).forEach(function (key) {
      if (state.filters[key]) params[key] = state.filters[key];
    });

    if (append) state.loadingMore = true;
    else state.postsLoading = true;

    render();

    return API.posts(params, controller && controller.signal)
      .then(function (data) {
        state.posts = append ? state.posts.concat(data.posts || []) : (data.posts || []);
        state.pinned = append ? state.pinned : (data.pinned || []);
        state.hasMore = !!data.hasMore;
        state.cursor = data.cursor;
        state.error = null;
        state.real = true;
        /*
         * Warm boot keeps the plain first page of the stream, the screen a
         * launch lands on. A search, a filter or a page deep in history is a
         * place someone navigated to, not where they will land next time.
         */
        if (!append && !state.search && window.TMAStore) {
          window.TMAStore.put('feed:warm', {
            channelId: state.channelId || '',
            view: state.view,
            posts: (state.posts || []).slice(0, 10),
            pinned: state.pinned || [],
            channels: state.channels || [],
            viewer: state.viewer || null,
          });
        }
      })
      .catch(function (err) {
        if (err.name === 'AbortError') return;
        state.error = err.message;
      })
      .finally(function () {
        state.postsLoading = false;
        state.loadingMore = false;
        streamRequest = null;
        render();
      });
  }

  /*
   * The `view` parameter the API expects.
   *
   * "All channels" and "My channels" are both the ordinary published stream —
   * they differ in which channels are in scope, which the sidebar decides, not
   * the server.
   */
  function streamView() {
    if (state.view === 'all' || state.view === 'mine') return 'all';
    return state.view;
  }

  /* ── navigation ──────────────────────────────────────────── */

  function openChannel(id) {
    state.channelId = id;
    state.channel = findChannel(id);
    state.view = 'all';
    state.searchResults = null;
    resetStream();
    saveMemory();

    // Opening a channel is what clears its unread dot.
    if (state.channel && state.channel.isMember) {
      API.markChannelRead(id).then(function () {
        var channel = findChannel(id);
        if (channel) channel.unread = 0;
        render();
      }).catch(function () {});
    }

    subscribeRealtime();
    loadPosts(false);
  }

  function openView(view) {
    state.view = view;
    state.searchResults = null;

    // The cross-channel views are not scoped to one channel; keeping the
    // channel selected would silently filter "my bookmarks" down to one place.
    if (view !== 'all') state.channelId = null;
    state.channel = null;

    resetStream();
    saveMemory();
    loadPosts(false);
  }

  function resetStream() {
    state.posts = [];
    state.pinned = [];
    state.cursor = null;
    state.hasMore = false;
    state.comments = {};
    state.composer = null;
  }

  /* ── rendering ───────────────────────────────────────────── */

  var renderQueued = false;

  /*
   * Render on the next frame rather than immediately.
   *
   * A single action often touches state several times (optimistic update, then
   * the server's answer, then a counter). Coalescing means one DOM patch
   * instead of three, and no visible flicker between them.
   */
  function render() {
    if (renderQueued) return;
    renderQueued = true;

    window.requestAnimationFrame(function () {
      renderQueued = false;
      paint();
    });
  }

  function paint() {
    var root = state.el;
    if (!root) return;

    var M = morph();
    M.patch(root, layoutHtml());
    wire();
    restoreSidebarScroll();
  }

  function layoutHtml() {
    if (state.loading) return skeletonHtml();

    return (
      '<div class="tma-dash__feed-layout' +
      (state.sidebarOpen ? '' : ' tma-dash__feed-layout--collapsed') + '">' +
      sidebarHtml() +
      '<div class="tma-dash__feed-main" data-feed-main>' +
      mainHtml() +
      '</div>' +
      '</div>' +
      galleryHtml() +
      (state.modal ? modalHtml() : '')
    );
  }

  /* The first paint, before channels have arrived. */
  function skeletonHtml() {
    var rows = '';
    for (var i = 0; i < 5; i++) {
      rows += '<div class="tma-dash__feed-skel-row" aria-hidden="true"></div>';
    }

    return (
      '<div class="tma-dash__feed-layout">' +
      '<aside class="tma-dash__feed-sidebar">' + rows + '</aside>' +
      '<div class="tma-dash__feed-main">' +
      '<div class="tma-dash__feed-skel-card" aria-hidden="true"></div>' +
      '<div class="tma-dash__feed-skel-card" aria-hidden="true"></div>' +
      '</div>' +
      '</div>'
    );
  }

  /* ── sidebar (§1) ────────────────────────────────────────── */

  function sidebarHtml() {
    return (
      '<aside class="tma-dash__feed-sidebar" data-feed-sidebar aria-label="Feed">' +
      '<div class="tma-dash__feed-sidebar-head">' +
      '<h2 class="tma-dash__feed-sidebar-title">Feed</h2>' +
      (state.can.createChannel
        ? '<button type="button" class="tma-dash__tool-btn" data-feed-new-channel' +
          ' aria-label="New channel" title="New channel">' +
          '<img src="' + ICON + 'Plus.svg" alt="" width="16" height="16"></button>'
        : '') +
      '</div>' +

      sidebarGroupHtml('views', 'Views', VIEWS.map(viewRowHtml).join('')) +
      sidebarGroupHtml('channels', 'Channels', channelListHtml()) +
      adminGroupHtml() +
      '</aside>'
    );
  }

  function sidebarGroupHtml(key, label, body) {
    var open = state.groups[key] !== false;

    return (
      '<section class="tma-dash__feed-group" data-feed-group="' + esc(key) + '">' +
      '<button type="button" class="tma-dash__feed-group-title" data-feed-group-toggle="' + esc(key) + '"' +
      ' aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="tma-dash__feed-group-caret' + (open ? ' tma-dash__feed-group-caret--open' : '') + '"' +
      ' aria-hidden="true">' +
      '<svg viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '<span>' + esc(label) + '</span>' +
      '</button>' +
      (open ? '<div class="tma-dash__feed-group-body">' + body + '</div>' : '') +
      '</section>'
    );
  }

  function viewRowHtml(view) {
    // "All channels" and "My channels" are only active when no single channel
    // is open, otherwise the sidebar would show two things selected at once.
    var active = state.view === view.id && (view.id !== 'all' || !state.channelId);

    return (
      '<button type="button" class="tma-dash__feed-nav' +
      (active ? ' tma-dash__feed-nav--active' : '') + '" data-feed-view="' + esc(view.id) + '"' +
      (active ? ' aria-current="page"' : '') + '>' +
      '<img class="tma-dash__feed-nav-icon" src="' + ICON + view.icon + '.svg" alt="" width="16" height="16">' +
      '<span class="tma-dash__feed-nav-label">' + esc(view.label) + '</span>' +
      '</button>'
    );
  }

  function channelListHtml() {
    var term = state.channelSearch.trim().toLowerCase();

    var visible = state.channels.filter(function (channel) {
      if (channel.isArchived) return false;
      if (state.view === 'mine' && !channel.isMember) return false;
      if (!term) return true;
      return channel.name.toLowerCase().indexOf(term) !== -1;
    });

    var searchBox =
      '<label class="tma-dash__feed-channel-search">' +
      '<img src="images/icons/tma/Search-16.svg" alt="" width="16" height="16">' +
      '<input type="search" placeholder="Find a channel" data-feed-channel-search' +
      ' value="' + esc(state.channelSearch) + '" aria-label="Find a channel">' +
      '</label>';

    if (!visible.length) {
      return searchBox +
        '<p class="tma-dash__feed-sidebar-empty">' +
        (term ? 'No channels match.' : 'No channels yet.') +
        '</p>';
    }

    var mine = visible.filter(function (c) { return c.isMember; });
    var others = visible.filter(function (c) { return !c.isMember; });

    var html = searchBox;

    if (mine.length) {
      html += '<div class="tma-dash__feed-channel-list">' + mine.map(channelRowHtml).join('') + '</div>';
    }

    if (others.length) {
      html +=
        '<div class="tma-dash__feed-subgroup-title">Discover</div>' +
        '<div class="tma-dash__feed-channel-list">' + others.map(channelRowHtml).join('') + '</div>';
    }

    return html;
  }

  function channelRowHtml(channel) {
    var active = state.channelId === channel.id;
    var unread = channel.unread || 0;

    return (
      '<button type="button" class="tma-dash__feed-channel' +
      (active ? ' tma-dash__feed-channel--active' : '') + '"' +
      ' data-feed-channel="' + esc(channel.id) + '"' +
      (active ? ' aria-current="page"' : '') + '>' +
      channelBadgeHtml(channel, 'sm') +
      '<span class="tma-dash__feed-channel-name">' + esc(channel.name) + '</span>' +
      (unread
        ? '<span class="tma-dash__feed-channel-unread" aria-label="' +
          plural(unread, 'unread post') + '">' + (unread > 99 ? '99+' : unread) + '</span>'
        : '') +
      '</button>'
    );
  }

  /*
   * A channel's identity mark: its picture when it has one, otherwise its icon
   * on its colour. Rendered the same everywhere so a channel is recognisable
   * in the sidebar, the header and a post card without reading its name.
   */
  function channelBadgeHtml(channel, size) {
    if (!channel) return '';

    if (channel.avatar) {
      return (
        '<img class="tma-dash__feed-badge tma-dash__feed-badge--' + esc(size || 'sm') + '"' +
        ' src="' + esc(channel.avatar) + '" alt="" loading="lazy">'
      );
    }

    return (
      '<span class="tma-dash__feed-badge tma-dash__feed-badge--' + esc(size || 'sm') +
      ' tma-dash__feed-badge--' + esc(channel.colour || 'blue') + '" aria-hidden="true">' +
      '<img src="' + ICON + esc(channel.icon || 'Hash') + '.svg" alt="">' +
      '</span>'
    );
  }

  function adminGroupHtml() {
    var manageable = state.channels.filter(function (c) { return c.can && c.can.manage; });

    if (!state.can.analytics && !manageable.length) return '';

    var rows =
      '<button type="button" class="tma-dash__feed-nav' +
      (state.view === 'analytics' ? ' tma-dash__feed-nav--active' : '') + '" data-feed-analytics>' +
      '<img class="tma-dash__feed-nav-icon" src="' + ICON + 'ChartLine.svg" alt="" width="16" height="16">' +
      '<span class="tma-dash__feed-nav-label">Analytics</span>' +
      '</button>';

    if (manageable.length) {
      rows +=
        '<button type="button" class="tma-dash__feed-nav" data-feed-settings>' +
        '<img class="tma-dash__feed-nav-icon" src="' + ICON + 'GearSix.svg" alt="" width="16" height="16">' +
        '<span class="tma-dash__feed-nav-label">Channel settings</span>' +
        '</button>';
    }

    return sidebarGroupHtml('admin', 'Manage', rows);
  }

  function restoreSidebarScroll() {
    var sidebar = state.el && state.el.querySelector('[data-feed-sidebar]');
    if (sidebar && state.sidebarScroll) sidebar.scrollTop = state.sidebarScroll;
  }

  /* ── main column ─────────────────────────────────────────── */

  function mainHtml() {
    if (state.view === 'analytics') return analyticsHtml();
    if (state.searchResults) return searchResultsHtml();

    return (
      mainHeaderHtml() +
      toolbarHtml() +
      (canComposeHere() ? composerHtml() : '') +
      streamHtml()
    );
  }

  /*
   * A channel's header (§3), or a plain title for the cross-channel views.
   *
   * The cover is only drawn when the channel actually has one, an empty band
   * of grey says "this is broken", not "this channel has no cover".
   */
  function mainHeaderHtml() {
    var channel = state.channel;

    if (!channel) {
      var view = VIEWS.filter(function (v) { return v.id === state.view; })[0];
      return (
        '<header class="tma-dash__feed-head">' +
        '<div class="tma-dash__feed-head-text">' +
        '<h2 class="tma-dash__feed-head-title">' + esc(view ? view.label : 'Feed') + '</h2>' +
        '<p class="tma-dash__feed-head-desc">' + esc(viewDescription(state.view)) + '</p>' +
        '</div>' +
        '</header>'
      );
    }

    var meta = [
      plural(channel.memberCount || 0, 'member'),
      plural(channel.postsCount || 0, 'post'),
    ];
    if (channel.lastActivityAt) meta.push('Active ' + shortTime(channel.lastActivityAt));

    return (
      '<header class="tma-dash__feed-channel-head' +
      (channel.cover ? ' tma-dash__feed-channel-head--cover' : '') + '">' +

      (channel.cover
        ? '<div class="tma-dash__feed-cover">' +
          '<img src="' + esc(channel.cover) + '" alt="" loading="lazy">' +
          '</div>'
        : '') +

      '<div class="tma-dash__feed-channel-head-body">' +
      channelBadgeHtml(channel, 'lg') +

      '<div class="tma-dash__feed-head-text">' +
      '<h2 class="tma-dash__feed-head-title">' +
      esc(channel.name) +
      (channel.isArchived
        ? '<span class="tma-dash__feed-chip tma-dash__feed-chip--muted">Archived</span>'
        : '') +
      (channel.visibility === 'private'
        ? '<span class="tma-dash__feed-chip"><img src="' + ICON + 'Lock.svg" alt="" width="12" height="12">Private</span>'
        : '') +
      '</h2>' +
      (channel.description
        ? '<p class="tma-dash__feed-head-desc">' + esc(channel.description) + '</p>'
        : '') +
      '<p class="tma-dash__feed-head-meta">' + esc(meta.join(' · ')) + '</p>' +
      (channel.tags && channel.tags.length
        ? '<div class="tma-dash__feed-tags">' + channel.tags.map(function (tag) {
          return '<span class="tma-dash__feed-tag">' + esc(tag) + '</span>';
        }).join('') + '</div>'
        : '') +
      '</div>' +

      '<div class="tma-dash__feed-head-actions">' +
      (channel.can.join
        ? '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--primary" data-feed-join>Join</button>'
        : '') +
      (channel.can.leave
        ? '<button type="button" class="tma-dash__feed-btn" data-feed-leave>Leave</button>'
        : '') +
      (channel.isMember
        ? '<button type="button" class="tma-dash__tool-btn" data-feed-mute' +
          ' aria-pressed="' + (channel.membership && channel.membership.muted ? 'true' : 'false') + '"' +
          ' aria-label="' + (channel.membership && channel.membership.muted ? 'Unmute channel' : 'Mute channel') + '"' +
          ' title="' + (channel.membership && channel.membership.muted ? 'Unmute' : 'Mute') + '">' +
          '<img src="' + ICON + (channel.membership && channel.membership.muted ? 'BellSlash' : 'Bell') +
          '.svg" alt="" width="16" height="16"></button>'
        : '') +
      (channel.can.manage
        ? '<button type="button" class="tma-dash__tool-btn" data-feed-channel-settings' +
          ' aria-label="Channel settings" title="Channel settings">' +
          '<img src="' + ICON + 'GearSix.svg" alt="" width="16" height="16"></button>'
        : '') +
      '</div>' +

      '</div>' +
      '</header>'
    );
  }

  function viewDescription(view) {
    return {
      all: 'Everything published in the channels you can see.',
      mine: 'Channels you belong to.',
      drafts: 'Posts you have started but not published.',
      scheduled: 'Posts waiting to publish.',
      archived: 'Posts that have been archived.',
      bookmarks: 'Posts you saved.',
      pinned: 'Posts pinned across your channels.',
      mentions: 'Where you have been mentioned.',
    }[view] || '';
  }

  /* Search and filters (§14), above the stream. */
  function toolbarHtml() {
    var active = activeFilterCount();

    return (
      '<div class="tma-dash__feed-toolbar">' +
      '<label class="tma-dash__feed-search">' +
      '<img src="images/icons/tma/Search-16.svg" alt="" width="16" height="16">' +
      '<input type="search" placeholder="Search posts, people and files"' +
      ' data-feed-search value="' + esc(state.search) + '" aria-label="Search the feed">' +
      '</label>' +

      '<div class="tma-dash__feed-toolbar-actions">' +
      '<button type="button" class="tma-dash__tool-btn' +
      (active ? ' tma-dash__tool-btn--active' : '') + '" data-feed-filters' +
      ' aria-label="Filters" title="Filters">' +
      '<img src="' + ICON + 'FunnelSimple.svg" alt="" width="16" height="16">' +
      (active ? '<span class="tma-dash__feed-filter-count">' + active + '</span>' : '') +
      '</button>' +
      (active
        ? '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--ghost" data-feed-clear-filters>' +
          'Clear</button>'
        : '') +
      '</div>' +
      '</div>'
    );
  }

  function activeFilterCount() {
    var n = 0;
    Object.keys(state.filters).forEach(function (key) { if (state.filters[key]) n += 1; });
    return n;
  }

  /* Whether the composer belongs on screen at all. */
  function canComposeHere() {
    if (state.view === 'drafts' || state.view === 'scheduled') return false;
    if (state.channel) return !!(state.channel.can && state.channel.can.post);

    // Off a channel, composing needs somewhere to post to.
    return state.channels.some(function (c) { return c.can && c.can.post; });
  }

  /* ── composer (§4) ───────────────────────────────────────── */

  /*
   * Collapsed, the composer is a single prompt. Opening it builds a draft in
   * state; every field below writes into that object and nothing else, so
   * closing and reopening never resurrects half of a previous post.
   */
  function composerHtml() {
    if (!state.composer) {
      return (
        '<section class="tma-dash__feed-composer" aria-label="Create post">' +
        '<button type="button" class="tma-dash__feed-compose-prompt" data-feed-compose-open>' +
        '<img class="tma-dash__feed-compose-avatar" src="' + esc(myAvatar()) + '" alt="" width="40" height="40">' +
        '<span class="tma-dash__feed-compose-placeholder">Share thoughts, ideas, or updates</span>' +
        '</button>' +
        '<div class="tma-dash__feed-compose-divider" aria-hidden="true"></div>' +
        '<div class="tma-dash__feed-compose-actions">' +
        '<div class="tma-dash__feed-compose-types" role="group" aria-label="Post type">' +
        POST_TYPES.map(function (type) { return typeButtonHtml(type, null); }).join('') +
        '</div>' +
        '<button type="button" class="tma-dash__feed-compose-drafts" data-feed-view="drafts">' +
        '<img src="' + ICON + 'PencilSimple.svg" alt="" width="16" height="16"><span>Drafts</span>' +
        '</button>' +
        '</div>' +
        '</section>'
      );
    }

    var draft = state.composer;

    return (
      '<section class="tma-dash__feed-composer tma-dash__feed-composer--open" aria-label="Create post">' +

      '<div class="tma-dash__feed-compose-head">' +
      '<img class="tma-dash__feed-compose-avatar" src="' + esc(myAvatar()) + '" alt="" width="40" height="40">' +
      '<div class="tma-dash__feed-compose-head-meta">' +
      '<span class="tma-dash__feed-compose-name">' + esc((me() && me().name) || 'You') + '</span>' +
      composerChannelPickerHtml(draft) +
      '</div>' +
      '<div class="tma-dash__feed-compose-head-actions">' +
      (draft.savedAt
        ? '<span class="tma-dash__feed-compose-saved">Draft saved</span>'
        : (draft.saving ? '<span class="tma-dash__feed-compose-saved">Saving…</span>' : '')) +
      '<button type="button" class="tma-dash__tool-btn" data-feed-compose-close aria-label="Close composer">' +
      '<img src="' + ICON + 'X.svg" alt="" width="16" height="16"></button>' +
      '</div>' +
      '</div>' +

      '<div class="tma-dash__feed-compose-types" role="group" aria-label="Post type">' +
      POST_TYPES.map(function (type) { return typeButtonHtml(type, draft.type); }).join('') +
      '</div>' +

      (draft.type === 'announcement' || draft.title !== undefined
        ? '<input type="text" class="tma-dash__feed-compose-title" data-feed-title' +
          ' placeholder="Add a title" value="' + esc(draft.title || '') + '" aria-label="Post title">'
        : '') +

      editorHtml(draft) +
      mentionMenuHtml('post') +
      attachmentsTrayHtml(draft) +
      (draft.poll ? pollBuilderHtml(draft) : '') +
      (draft.showOptions ? composerOptionsHtml(draft) : '') +

      '<div class="tma-dash__feed-compose-bar">' +
      '<div class="tma-dash__feed-compose-tools">' +
      toolButton('feed-attach', 'Paperclip', 'Attach files') +
      toolButton('feed-toggle-poll', 'ChartBarHorizontal', draft.poll ? 'Remove poll' : 'Add poll', !!draft.poll) +
      toolButton('feed-emoji', 'Smiley', 'Emoji') +
      toolButton('feed-toggle-options', 'SlidersHorizontal', 'Post options', !!draft.showOptions) +
      '<input type="file" multiple hidden data-feed-file-input>' +
      '</div>' +

      '<div class="tma-dash__feed-compose-submit">' +
      (draft.error ? '<span class="tma-dash__feed-error">' + esc(draft.error) + '</span>' : '') +
      '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--ghost" data-feed-save-draft' +
      (draft.busy ? ' disabled' : '') + '>Save draft</button>' +
      (draft.scheduledFor
        ? '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--primary" data-feed-schedule' +
          (draft.busy ? ' disabled' : '') + '>Schedule</button>'
        : '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--primary" data-feed-publish' +
          (draft.busy ? ' disabled' : '') + '>' +
          (draft.pendingSubmit ? 'Uploading…' : (draft.id && draft.wasPublished ? 'Save changes' : 'Post')) + '</button>') +
      '</div>' +
      '</div>' +

      '</section>'
    );
  }

  function toolButton(action, icon, label, active) {
    return (
      '<button type="button" class="tma-dash__tool-btn' + (active ? ' tma-dash__tool-btn--active' : '') + '"' +
      ' data-' + action + ' aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
      '<img src="' + ICON + icon + '.svg" alt="" width="16" height="16"></button>'
    );
  }

  function typeButtonHtml(type, activeId) {
    var isActive = type.id === activeId;

    return (
      '<button type="button" class="tma-dash__feed-compose-type' +
      (isActive ? ' tma-dash__feed-compose-type--active' : '') + '"' +
      ' data-feed-type="' + esc(type.id) + '" aria-pressed="' + (isActive ? 'true' : 'false') + '">' +
      '<span class="tma-dash__feed-compose-type-icon tma-dash__feed-compose-type-icon--' + esc(type.tone) + '">' +
      '<img src="' + ICON + type.icon + '.svg" alt="" width="16" height="16">' +
      '</span>' +
      '<span class="tma-dash__feed-compose-type-label">' + esc(type.label) + '</span>' +
      '</button>'
    );
  }

  /*
   * Which channel the post goes to.
   *
   * Inside a channel this is fixed and shown as a label, a picker there
   * invites a post to land somewhere nobody meant. Off a channel it is a
   * required choice.
   */
  function composerChannelPickerHtml(draft) {
    if (state.channel) {
      return '<span class="tma-dash__feed-compose-target">Posting in ' + esc(state.channel.name) + '</span>';
    }

    var options = state.channels
      .filter(function (c) { return c.can && c.can.post; })
      .map(function (c) {
        return '<option value="' + esc(c.id) + '"' +
          (draft.channelId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      })
      .join('');

    return (
      '<label class="tma-dash__feed-compose-target">' +
      '<span class="tma-dash__feed-sr">Channel</span>' +
      '<select class="tma-dash__feed-select tma-dash__feed-select--inline" data-feed-channel-select>' +
      '<option value="">Choose a channel…</option>' + options +
      '</select>' +
      '</label>'
    );
  }

  /*
   * The rich-text surface (§4).
   *
   * A contenteditable with an explicit toolbar rather than a third-party
   * editor: the server's sanitiser allow-list is narrow and known, and every
   * button here maps onto something that survives it. `data-feed-editor` is
   * deliberately keyed so morph preserves the node across renders, replacing
   * it would drop the caret mid-sentence.
   */
  function editorHtml(draft) {
    var tools = [
      ['bold', 'TextB', 'Bold'],
      ['italic', 'TextItalic', 'Italic'],
      ['underline', 'TextUnderline', 'Underline'],
      ['insertUnorderedList', 'ListBullets', 'Bulleted list'],
      ['insertOrderedList', 'ListNumbers', 'Numbered list'],
      ['formatBlock:blockquote', 'Quotes', 'Quote'],
      ['formatBlock:pre', 'Code', 'Code block'],
      ['createLink', 'LinkSimple', 'Link'],
    ];

    return (
      '<div class="tma-dash__feed-editor-wrap">' +
      '<div class="tma-dash__feed-editor-tools" role="toolbar" aria-label="Formatting">' +
      tools.map(function (tool) {
        return '<button type="button" class="tma-dash__feed-editor-tool"' +
          ' data-feed-format="' + esc(tool[0]) + '" aria-label="' + esc(tool[2]) + '"' +
          ' title="' + esc(tool[2]) + '">' +
          '<img src="' + ICON + tool[1] + '.svg" alt="" width="16" height="16"></button>';
      }).join('') +
      '</div>' +
      /*
       * data-morph-skip is essential, not decorative. The rendered string for
       * this node is always empty, the browser owns its contents while
       * someone types, so without the skip, any render triggered mid-sentence
       * (the mention autocomplete answering, an upload finishing) would diff
       * the typed text against nothing and delete it.
       */
      '<div class="tma-dash__feed-editor" contenteditable="true" role="textbox" aria-multiline="true"' +
      ' data-feed-editor data-key="feed-editor" data-morph-skip aria-label="Write your post"' +
      ' data-placeholder="Write something worth reading…"></div>' +
      '</div>'
    );
  }

  /*
   * The @ and # autocomplete list (§16, §17), drawn under whichever field is
   * being typed in: `host` is 'post' for the editor, or 'comment:<postId>'
   * for a comment box, so only the field with the caret shows the list.
   */
  function mentionMenuHtml(host) {
    var mention = state.mention;
    if (!mention || mention.host !== host || !mention.results || !mention.results.length) return '';

    return (
      '<div class="tma-dash__menu tma-dash__feed-mention-menu" data-feed-mention-menu role="listbox">' +
      mention.results.map(function (item, i) {
        var selected = i === (mention.index || 0);

        if (mention.kind === 'hashtag') {
          return '<button type="button" class="tma-dash__menu-item' +
            (selected ? ' tma-dash__menu-item--active' : '') + '"' +
            ' data-feed-mention-pick="' + i + '" role="option" aria-selected="' + selected + '">' +
            '<span class="tma-dash__feed-hashtag">#' + esc(item.tag) + '</span>' +
            '<span class="tma-dash__feed-mention-meta">' + plural(item.count, 'post') + '</span>' +
            '</button>';
        }

        return '<button type="button" class="tma-dash__menu-item' +
          (selected ? ' tma-dash__menu-item--active' : '') + '"' +
          ' data-feed-mention-pick="' + i + '" role="option" aria-selected="' + selected + '">' +
          '<img class="tma-dash__feed-mention-avatar" src="' + esc(avatarFor(item)) + '" alt="">' +
          '<span class="tma-dash__feed-mention-name">' + esc(item.name) + '</span>' +
          (item.meta ? '<span class="tma-dash__feed-mention-meta">' + esc(item.meta) + '</span>' : '') +
          '</button>';
      }).join('') +
      '</div>'
    );
  }

  /*
   * Staged files, with their upload progress (§18).
   *
   * Photos tile at the size they will take in the post, a file still on its
   * way up shows its own local preview under the progress bar, so nothing
   * about attaching a picture is a surprise when it is published. Other
   * files stay as chips.
   */
  function attachmentsTrayHtml(draft) {
    var files = draft.attachments || [];
    var uploads = draft.uploads || [];

    if (!files.length && !uploads.length) return '';

    var images = files.filter(function (file) { return file.kind === 'image'; });
    var others = files.filter(function (file) { return file.kind !== 'image'; });

    var removeHtml = function (file) {
      return '<button type="button" class="tma-dash__feed-attach-remove" data-feed-attach-remove="' +
        esc(file.id) + '" aria-label="Remove ' + esc(file.name) + '">' +
        '<img src="' + ICON + 'X.svg" alt="" width="12" height="12"></button>';
    };

    var tiles = images.map(function (file) {
      return '<div class="tma-dash__feed-attach-tile" data-key="att-' + esc(file.id) + '">' +
        '<img src="' + esc(file.thumbUrl || file.url) + '" alt="' + esc(file.name) + '">' +
        removeHtml(file) +
        '</div>';
    }).concat(uploads.map(function (upload) {
      return '<div class="tma-dash__feed-attach-tile tma-dash__feed-attach-tile--uploading"' +
        ' aria-label="Uploading ' + esc(upload.name) + '">' +
        (upload.preview ? '<img src="' + esc(upload.preview) + '" alt="">' : '') +
        '<span class="tma-dash__feed-attach-uploading">' +
        '<span class="tma-dash__feed-attach-name">' + esc(upload.name) + '</span>' +
        '<span class="tma-dash__feed-attach-progress">' +
        '<span style="width:' + (upload.percent || 0) + '%"></span></span>' +
        '</span>' +
        '</div>';
    }));

    return (
      '<div class="tma-dash__feed-attach-tray">' +
      (tiles.length ? '<div class="tma-dash__feed-attach-grid">' + tiles.join('') + '</div>' : '') +
      (others.length
        ? '<div class="tma-dash__feed-attach-list">' +
          others.map(function (file) {
            return (
              '<div class="tma-dash__feed-attach" data-key="att-' + esc(file.id) + '">' +
              '<span class="tma-dash__feed-attach-icon">' +
              '<img src="' + ICON + fileIcon(file) + '.svg" alt="" width="16" height="16"></span>' +
              '<span class="tma-dash__feed-attach-meta">' +
              '<span class="tma-dash__feed-attach-name">' + esc(file.name) + '</span>' +
              '<span class="tma-dash__feed-attach-size">' + esc(bytes(file.size)) + '</span>' +
              '</span>' +
              removeHtml(file) +
              '</div>'
            );
          }).join('') +
          '</div>'
        : '') +
      '</div>'
    );
  }

  function fileIcon(file) {
    if (file.kind === 'video') return 'FilmSlate';
    if (file.kind === 'audio') return 'MusicNote';
    var ext = (file.extension || '').toLowerCase();
    if (ext === 'pdf') return 'FilePdf';
    if (['doc', 'docx'].indexOf(ext) !== -1) return 'FileDoc';
    if (['xls', 'xlsx', 'csv'].indexOf(ext) !== -1) return 'FileXls';
    if (['ppt', 'pptx'].indexOf(ext) !== -1) return 'FilePpt';
    if (['zip', 'rar', '7z'].indexOf(ext) !== -1) return 'FileZip';
    return 'File';
  }

  /* The poll builder (§13). */
  function pollBuilderHtml(draft) {
    var poll = draft.poll;

    return (
      '<div class="tma-dash__feed-poll-builder">' +
      '<div class="tma-dash__feed-poll-builder-head">' +
      '<span class="tma-dash__feed-poll-builder-title">Poll</span>' +
      '<button type="button" class="tma-dash__tool-btn" data-feed-toggle-poll aria-label="Remove poll">' +
      '<img src="' + ICON + 'Trash.svg" alt="" width="16" height="16"></button>' +
      '</div>' +

      '<input type="text" class="tma-dash__feed-input" data-feed-poll-question' +
      ' placeholder="Ask a question" value="' + esc(poll.question || '') + '" aria-label="Poll question">' +

      '<div class="tma-dash__feed-poll-options">' +
      poll.options.map(function (option, i) {
        return (
          '<div class="tma-dash__feed-poll-option-row">' +
          '<input type="text" class="tma-dash__feed-input" data-feed-poll-option="' + i + '"' +
          ' placeholder="Option ' + (i + 1) + '" value="' + esc(option) + '"' +
          ' aria-label="Poll option ' + (i + 1) + '">' +
          (poll.options.length > 2
            ? '<button type="button" class="tma-dash__tool-btn" data-feed-poll-remove="' + i + '"' +
              ' aria-label="Remove option ' + (i + 1) + '">' +
              '<img src="' + ICON + 'X.svg" alt="" width="16" height="16"></button>'
            : '') +
          '</div>'
        );
      }).join('') +
      '</div>' +

      (poll.options.length < 12
        ? '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--ghost" data-feed-poll-add>' +
          'Add option</button>'
        : '') +

      '<div class="tma-dash__feed-poll-settings">' +
      '<label class="tma-dash__feed-field tma-dash__feed-field--short">' +
      '<span class="tma-dash__feed-field-label">Closes</span>' +
      '<input type="datetime-local" class="tma-dash__feed-input" data-feed-poll-closes' +
      ' value="' + esc(poll.closesAt || '') + '">' +
      '</label>' +
      '<div class="tma-dash__feed-option-row tma-dash__feed-option-row--checks">' +
      checkboxHtml('feed-poll-multiple', 'Allow several answers', poll.multipleChoice) +
      checkboxHtml('feed-poll-anonymous', 'Hide who voted', poll.anonymous) +
      checkboxHtml('feed-poll-hide', 'Hide results until it closes', poll.hideResults) +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function checkboxHtml(action, label, checked) {
    return (
      '<label class="tma-dash__feed-check">' +
      '<input type="checkbox" data-' + action + (checked ? ' checked' : '') + '>' +
      '<span>' + esc(label) + '</span>' +
      '</label>'
    );
  }

  /* Scheduling, announcements and the email audience (§6, §7, §12). */
  function composerOptionsHtml(draft) {
    var channel = draft.channelId ? findChannel(draft.channelId) : state.channel;
    var canModerate = !!(channel && channel.can && channel.can.moderate);

    return (
      '<div class="tma-dash__feed-compose-options">' +

      '<div class="tma-dash__feed-option-row">' +
      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Schedule for</span>' +
      '<input type="datetime-local" class="tma-dash__feed-input" data-feed-scheduled' +
      ' value="' + esc(draft.scheduledFor || '') + '">' +
      '</label>' +
      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Time zone</span>' +
      '<input type="text" class="tma-dash__feed-input" data-feed-timezone readonly' +
      ' value="' + esc(draft.timezone || localZone()) + '">' +
      '</label>' +
      '</div>' +

      (draft.type === 'announcement'
        ? '<div class="tma-dash__feed-option-row">' +
          '<label class="tma-dash__feed-field tma-dash__feed-field--short">' +
          '<span class="tma-dash__feed-field-label">Expires</span>' +
          '<input type="datetime-local" class="tma-dash__feed-input" data-feed-expires' +
          ' value="' + esc(draft.expiresAt || '') + '">' +
          '</label>' +
          '</div>'
        : '') +

      '<div class="tma-dash__feed-option-row">' +
      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Email notification</span>' +
      '<select class="tma-dash__feed-select" data-feed-email-audience>' +
      EMAIL_AUDIENCES
        .filter(function (option) { return !option.moderator || canModerate; })
        .map(function (option) {
          return '<option value="' + esc(option.id) + '"' +
            (draft.emailAudience === option.id ? ' selected' : '') + '>' + esc(option.label) + '</option>';
        }).join('') +
      '</select>' +
      '</label>' +
      '</div>' +

      '<div class="tma-dash__feed-option-row tma-dash__feed-option-row--checks">' +
      (draft.type === 'announcement'
        ? checkboxHtml('feed-requires-ack', 'Ask people to acknowledge', draft.requiresAcknowledgement)
        : '') +
      checkboxHtml('feed-notify-portal', 'Notify in the portal', draft.notifyPortal !== false) +
      '</div>' +

      '</div>'
    );
  }

  function localZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
      return 'UTC';
    }
  }

  /* ── the stream ──────────────────────────────────────────── */

  function streamHtml() {
    if (state.postsLoading && !state.posts.length) {
      return '<div class="tma-dash__feed-stream">' +
        '<div class="tma-dash__feed-skel-card" aria-hidden="true"></div>' +
        '<div class="tma-dash__feed-skel-card" aria-hidden="true"></div></div>';
    }

    if (state.error) {
      return (
        '<div class="tma-dash__feed-stream">' +
        '<div class="tma-dash__feed-state">' +
        '<p class="tma-dash__feed-state-text">' + esc(state.error) + '</p>' +
        '<button type="button" class="tma-dash__feed-btn" data-feed-retry>Try again</button>' +
        '</div></div>'
      );
    }

    if (!state.posts.length && !state.pinned.length) {
      return '<div class="tma-dash__feed-stream">' + emptyStateHtml() + '</div>';
    }

    var pinned = state.pinned.length
      ? '<div class="tma-dash__feed-pinned-band">' +
        '<div class="tma-dash__feed-band-title">' +
        '<img src="' + ICON + 'PushPin.svg" alt="" width="14" height="14">Pinned</div>' +
        state.pinned.map(function (post) { return postCardHtml(post, true); }).join('') +
        '</div>'
      : '';

    return (
      '<div class="tma-dash__feed-stream" data-feed-stream aria-label="Feed posts">' +
      pinned +
      state.posts.map(function (post) { return postCardHtml(post, false); }).join('') +
      (state.hasMore
        ? '<button type="button" class="tma-dash__feed-more" data-feed-more' +
          (state.loadingMore ? ' disabled' : '') + '>' +
          (state.loadingMore ? 'Loading…' : 'Load more') + '</button>'
        : '') +
      '</div>'
    );
  }

  /*
   * Empty states (§23). Each says what is missing *and* what to do about it —
   * a bare "No posts" leaves someone looking for the button.
   *
   * Nothing here is ever a sample post.
   */
  function emptyStateHtml() {
    var copy = {
      drafts: ['No drafts', 'Anything you start writing is saved here.'],
      scheduled: ['No scheduled posts', 'Schedule a post and it will wait here until it publishes.'],
      archived: ['No archived posts', 'Archived posts stay readable and appear here.'],
      bookmarks: ['No bookmarks', 'Save a post and it will appear here.'],
      pinned: ['No pinned posts', 'Moderators can pin a post to keep it at the top.'],
      mentions: ['No mentions', 'You will see posts here when someone mentions you.'],
    }[state.view];

    if (!copy) {
      copy = state.search || activeFilterCount()
        ? ['Nothing matches', 'Try a different search or clear the filters.']
        : state.channel
          ? ['No posts yet', 'Be the first to post in this channel.']
          : state.channels.length
            ? ['No posts yet', 'Posts from your channels will appear here.']
            : ['No channels yet', 'Create a channel to start posting.'];
    }

    return (
      '<div class="tma-dash__feed-state">' +
      '<span class="tma-dash__feed-state-icon"><img src="' + ICON + 'Newspaper.svg" alt="" width="24" height="24"></span>' +
      '<p class="tma-dash__feed-state-title">' + esc(copy[0]) + '</p>' +
      '<p class="tma-dash__feed-state-text">' + esc(copy[1]) + '</p>' +
      (!state.channels.length && state.can.createChannel
        ? '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--primary" data-feed-new-channel>' +
          'Create a channel</button>'
        : '') +
      '</div>'
    );
  }

  /* ── one post card (§4) ──────────────────────────────────── */

  function postCardHtml(post, inPinnedBand) {
    var isAnnouncement = post.isAnnouncement && !post.isExpired;

    return (
      '<article class="tma-dash__feed-post' +
      (isAnnouncement ? ' tma-dash__feed-post--announcement' : '') +
      (post.status !== 'published' ? ' tma-dash__feed-post--' + esc(post.status) : '') +
      '" data-key="post-' + esc(post.id) + (inPinnedBand ? '-pinned' : '') + '"' +
      ' data-feed-post="' + esc(post.id) + '">' +

      postHeaderHtml(post, inPinnedBand) +
      postStatusBarHtml(post) +
      postBodyHtml(post) +
      (post.attachments && post.attachments.length ? attachmentGridHtml(post) : '') +
      (post.poll ? pollHtml(post) : '') +
      (post.hashtags && post.hashtags.length ? hashtagRowHtml(post) : '') +
      (post.requiresAcknowledgement ? acknowledgeBarHtml(post) : '') +
      postFooterHtml(post) +
      commentsHtml(post) +

      '</article>'
    );
  }

  function postHeaderHtml(post, inPinnedBand) {
    var author = post.author || {};
    var meta = [];

    if (author.role) meta.push(author.role);
    if (post.publishedAt) meta.push(shortTime(post.publishedAt));
    else if (post.scheduledFor) meta.push('Scheduled ' + shortTime(post.scheduledFor));
    if (post.edited) meta.push('Edited');

    var type = POST_TYPES.filter(function (t) { return t.id === post.type; })[0];

    return (
      '<header class="tma-dash__feed-post-head">' +
      '<img class="tma-dash__feed-post-avatar" src="' + esc(avatarFor(author)) + '" alt=""' +
      ' width="40" height="40" loading="lazy">' +

      '<div class="tma-dash__feed-post-meta">' +
      '<span class="tma-dash__feed-post-author">' + esc(author.name || 'Unknown') + '</span>' +
      '<span class="tma-dash__feed-post-sub" title="' + esc(fullTime(post.publishedAt || post.createdAt)) + '">' +
      esc(meta.join(' · ')) +
      '</span>' +
      '</div>' +

      '<div class="tma-dash__feed-post-badges">' +
      // The channel is only named when the reader is not already inside it.
      (!state.channel && post.channel
        ? '<button type="button" class="tma-dash__feed-post-channel"' +
          ' data-feed-channel="' + esc(post.channel.id) + '">' +
          channelBadgeHtml(post.channel, 'xs') +
          '<span>' + esc(post.channel.name) + '</span></button>'
        : '') +
      (type && type.id !== 'discussion'
        ? '<span class="tma-dash__feed-chip tma-dash__feed-chip--' + esc(type.tone) + '">' +
          '<img src="' + ICON + type.icon + '.svg" alt="" width="12" height="12">' + esc(type.label) + '</span>'
        : '') +
      (post.isPinned && !inPinnedBand
        ? '<span class="tma-dash__feed-chip"><img src="' + ICON + 'PushPin.svg" alt="" width="12" height="12">Pinned</span>'
        : '') +
      (post.visibility === 'private'
        ? '<span class="tma-dash__feed-chip"><img src="' + ICON + 'Lock.svg" alt="" width="12" height="12">Private</span>'
        : '') +
      postMenuHtml(post) +
      '</div>' +
      '</header>'
    );
  }

  /* The overflow menu: only the actions the server said this reader has. */
  function postMenuHtml(post) {
    var can = post.can || {};
    var open = state.menuFor === post.id;
    var items = [];

    items.push(['feed-copy-link', 'Copy link', 'link']);
    items.push(['feed-bookmark', post.bookmarked ? 'Remove bookmark' : 'Bookmark', 'bookmark']);

    if (can.pin) items.push(['feed-pin', post.isPinned ? 'Unpin' : 'Pin to top', 'pin']);
    if (can.lock) {
      items.push(['feed-lock', post.commentsLocked ? 'Unlock comments' : 'Lock comments',
        post.commentsLocked ? 'unlock' : 'lock']);
    }
    if (can.edit) items.push(['feed-edit', 'Edit', 'edit']);
    if (can.edit) items.push(['feed-duplicate', 'Duplicate', 'duplicate']);
    if (post.poll && (can.edit || can.pin) && !post.poll.isClosed) items.push(['feed-close-poll', 'Close poll', 'poll']);
    if (can.viewAcknowledgements && post.requiresAcknowledgement) {
      items.push(['feed-ack-stats', 'Acknowledgements', 'ack']);
    }
    if (can.delete) items.push(['feed-delete', 'Delete', 'delete', true]);

    return (
      '<div class="tma-dash__feed-post-menu-wrap">' +
      '<button type="button" class="tma-dash__tool-btn" data-feed-menu="' + esc(post.id) + '"' +
      ' aria-haspopup="menu" aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="Post actions">' +
      '<img src="' + ICON + 'DotsThree.svg" alt="" width="16" height="16"></button>' +
      (open
        ? '<div class="tma-dash__menu tma-dash__feed-post-menu" role="menu">' +
          items.map(function (item) {
            // A masked span rather than an <img>: the glyph follows the row's
            // colour, so Delete's icon is red with its label.
            return '<button type="button" class="tma-dash__menu-item' +
              (item[3] ? ' tma-dash__menu-item--danger' : '') + '" role="menuitem"' +
              ' data-' + item[0] + '="' + esc(post.id) + '">' +
              '<span class="tma-dash__feed-menu-icon tma-dash__feed-menu-icon--' + item[2] + '" aria-hidden="true"></span>' +
              '<span>' + esc(item[1]) + '</span></button>';
          }).join('') +
          '</div>'
        : '') +
      '</div>'
    );
  }

  /* Draft / scheduled / locked state, said plainly above the body. */
  function postStatusBarHtml(post) {
    if (post.status === 'draft') {
      return (
        '<div class="tma-dash__feed-post-status">' +
        '<img src="' + ICON + 'PencilSimple.svg" alt="" width="14" height="14">' +
        '<span>Draft, only you can see this.</span>' +
        '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--ghost"' +
        ' data-feed-edit="' + esc(post.id) + '">Continue</button>' +
        '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--primary"' +
        ' data-feed-publish-now="' + esc(post.id) + '">Publish now</button>' +
        '</div>'
      );
    }

    if (post.status === 'scheduled') {
      return (
        '<div class="tma-dash__feed-post-status">' +
        '<img src="' + ICON + 'ClockCountdown.svg" alt="" width="14" height="14">' +
        '<span>Publishes ' + esc(fullTime(post.scheduledFor)) +
        (post.timezone ? ' (' + esc(post.timezone) + ')' : '') + '</span>' +
        '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--ghost"' +
        ' data-feed-edit="' + esc(post.id) + '">Reschedule</button>' +
        '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--primary"' +
        ' data-feed-publish-now="' + esc(post.id) + '">Publish now</button>' +
        '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--ghost"' +
        ' data-feed-cancel-schedule="' + esc(post.id) + '">Cancel</button>' +
        '</div>'
      );
    }

    if (post.commentsLocked) {
      return (
        '<div class="tma-dash__feed-post-status tma-dash__feed-post-status--muted">' +
        '<img src="' + ICON + 'Lock.svg" alt="" width="14" height="14">' +
        '<span>Comments are locked.</span></div>'
      );
    }

    return '';
  }

  /*
   * The post body.
   *
   * `post.body` is server-sanitised HTML, it is inserted as markup on purpose,
   * because rich text is the point (§4). Nothing reaches this that has not
   * been through FeedContent::sanitise, and no client-side value is ever
   * concatenated into it.
   */
  function postBodyHtml(post) {
    return (
      '<div class="tma-dash__feed-post-body">' +
      (post.title ? '<h3 class="tma-dash__feed-post-title">' + esc(post.title) + '</h3>' : '') +
      '<div class="tma-dash__feed-rich">' + (post.body || '') + '</div>' +
      '</div>'
    );
  }

  /*
   * Images tile, video and audio play in place, and documents are cards with
   * a real preview: a PDF's first page is painted in the browser by
   * TMAFileThumbs (the server cannot rasterise one), anything else shows its
   * type mark. Every one of them opens the viewer (§18).
   */
  function attachmentGridHtml(post) {
    var images = post.attachments.filter(function (a) { return a.kind === 'image'; });
    var others = post.attachments.filter(function (a) { return a.kind !== 'image'; });

    var grid = images.length
      ? '<div class="tma-dash__feed-media tma-dash__feed-media--' +
        Math.min(images.length, 4) + '">' +
        images.slice(0, 4).map(function (file, i) {
          // The fourth tile stands in for the rest, the viewer steps through them.
          var more = i === 3 && images.length > 4 ? images.length - 4 : 0;
          return '<button type="button" class="tma-dash__feed-media-item"' +
            ' data-feed-lightbox="' + esc(file.id) + '" data-feed-post-ref="' + esc(post.id) + '"' +
            ' aria-label="Open ' + esc(file.name) + '">' +
            '<img src="' + esc(file.thumbUrl || file.url) + '" alt="' + esc(file.name) + '" loading="lazy"' +
            (file.width && file.height ? ' width="' + file.width + '" height="' + file.height + '"' : '') +
            '>' +
            (more ? '<span class="tma-dash__feed-media-more">+' + more + '</span>' : '') +
            '</button>';
        }).join('') +
        '</div>'
      : '';

    var list = others.length
      ? '<div class="tma-dash__feed-files">' +
        others.map(function (file) {
          if (file.kind === 'video') {
            return '<video class="tma-dash__feed-video" controls preload="metadata"' +
              (file.thumbUrl ? ' poster="' + esc(file.thumbUrl) + '"' : '') +
              ' src="' + esc(file.url) + '"></video>';
          }
          if (file.kind === 'audio') {
            return '<audio class="tma-dash__feed-audio" controls preload="metadata"' +
              ' src="' + esc(file.url) + '"></audio>';
          }
          return docCardHtml(post, file);
        }).join('') +
        '</div>'
      : '';

    return grid + list;
  }

  /*
   * A document card. The stage holds the preview, the strip beneath names
   * the file and keeps one-click download. A div rather than a button
   * because a button may not contain the download anchor.
   */
  function docCardHtml(post, file) {
    var icon = ICON + fileIcon(file) + '.svg';
    var preview = window.TMAFileThumbs
      ? window.TMAFileThumbs.imgHtml(
        {
          name: file.name, mime: file.mime, extension: file.extension, size: file.size,
          previewUrl: file.url, thumbUrl: file.thumbUrl || null,
        },
        { size: null, cls: 'tma-dash__feed-doc-preview', iconCls: 'tma-dash__feed-doc-glyph', icon: icon, alt: '' }
      )
      : '<img class="tma-dash__feed-doc-glyph" src="' + esc(icon) + '" alt="">';

    return '<div class="tma-dash__feed-doc" role="button" tabindex="0"' +
      ' data-feed-lightbox="' + esc(file.id) + '" data-feed-post-ref="' + esc(post.id) + '"' +
      ' aria-label="Preview ' + esc(file.name) + '">' +
      '<div class="tma-dash__feed-doc-stage">' + preview + '</div>' +
      '<div class="tma-dash__feed-file">' +
      '<span class="tma-dash__feed-file-icon">' +
      '<img src="' + esc(icon) + '" alt="" width="16" height="16"></span>' +
      '<span class="tma-dash__feed-file-meta">' +
      '<span class="tma-dash__feed-file-name">' + esc(file.name) + '</span>' +
      '<span class="tma-dash__feed-file-size">' + esc(bytes(file.size)) + '</span>' +
      '</span>' +
      '<a class="tma-dash__feed-file-download" data-feed-file-download href="' + esc(file.url) +
      '" download aria-label="Download ' + esc(file.name) + '">' +
      '<img src="' + ICON + 'DownloadSimple.svg" alt="" width="16" height="16"></a>' +
      '</div>' +
      '</div>';
  }

  /* A live poll (§13). */
  function pollHtml(post) {
    var poll = post.poll;
    var total = poll.totalVotes || 0;
    var canVote = !poll.isClosed && post.can && post.can.react;

    return (
      '<div class="tma-dash__feed-poll" data-feed-poll="' + esc(post.id) + '">' +
      '<div class="tma-dash__feed-poll-head">' +
      '<span class="tma-dash__feed-poll-question">' + esc(poll.question) + '</span>' +
      '<span class="tma-dash__feed-poll-meta">' +
      (poll.isClosed ? 'Closed' : (poll.closesAt ? 'Closes ' + shortTime(poll.closesAt) : 'Open')) +
      (poll.anonymous ? ' · Anonymous' : '') +
      (poll.multipleChoice ? ' · Choose several' : '') +
      '</span>' +
      '</div>' +

      '<div class="tma-dash__feed-poll-list">' +
      poll.options.map(function (option) {
        var votes = option.votes;
        var share = (poll.resultsVisible && total > 0 && votes !== null)
          ? Math.round((votes / total) * 100)
          : 0;

        return (
          '<button type="button" class="tma-dash__feed-poll-row' +
          (option.chosen ? ' tma-dash__feed-poll-row--chosen' : '') + '"' +
          ' data-feed-vote="' + esc(option.id) + '" data-feed-vote-post="' + esc(post.id) + '"' +
          (canVote ? '' : ' disabled') + '>' +
          (poll.resultsVisible
            ? '<span class="tma-dash__feed-poll-fill" style="width:' + share + '%" aria-hidden="true"></span>'
            : '') +
          '<span class="tma-dash__feed-poll-label">' +
          (poll.multipleChoice
            ? '<span class="tma-dash__feed-poll-box' + (option.chosen ? ' is-on' : '') + '"></span>'
            : '<span class="tma-dash__feed-poll-dot' + (option.chosen ? ' is-on' : '') + '"></span>') +
          esc(option.label) + '</span>' +
          (poll.resultsVisible
            ? '<span class="tma-dash__feed-poll-count">' + share + '%</span>'
            : '') +
          '</button>'
        );
      }).join('') +
      '</div>' +

      '<div class="tma-dash__feed-poll-foot">' +
      '<span>' + (poll.resultsVisible
        ? plural(total, 'vote')
        : 'Results are hidden until this closes') + '</span>' +
      (!poll.anonymous && poll.resultsVisible && total > 0
        ? '<button type="button" class="tma-dash__feed-link" data-feed-poll-voters="' + esc(post.id) + '">' +
          'Who voted</button>'
        : '') +
      '</div>' +
      '</div>'
    );
  }

  function hashtagRowHtml(post) {
    return (
      '<div class="tma-dash__feed-hashtags">' +
      post.hashtags.map(function (tag) {
        return '<button type="button" class="tma-dash__feed-hashtag" data-feed-hashtag="' + esc(tag) + '">#' +
          esc(tag) + '</button>';
      }).join('') +
      '</div>'
    );
  }

  /* An announcement that asks to be acknowledged (§12). */
  function acknowledgeBarHtml(post) {
    if (post.acknowledged) {
      return (
        '<div class="tma-dash__feed-ack tma-dash__feed-ack--done">' +
        '<img src="' + ICON + 'SealCheck.svg" alt="" width="16" height="16">' +
        '<span>You acknowledged this.</span></div>'
      );
    }

    return (
      '<div class="tma-dash__feed-ack">' +
      '<span>Please confirm you have read this.</span>' +
      '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--primary"' +
      ' data-feed-acknowledge="' + esc(post.id) + '">Acknowledge</button>' +
      '</div>'
    );
  }

  /* Reactions, comment count and view count (§4, §10). */
  function postFooterHtml(post) {
    return (
      '<footer class="tma-dash__feed-post-foot">' +
      postStatsHtml(post) +
      postActionsHtml(post, false) +
      '</footer>'
    );
  }

  function postStatsHtml(post) {
    var reactions = post.reactions || { total: 0, groups: [], mine: null };

    var summary = reactions.groups && reactions.groups.length
      ? '<button type="button" class="tma-dash__feed-react-summary" data-feed-reaction-people="' +
        esc(post.id) + '">' +
        reactions.groups.slice(0, 4).map(function (group) {
          return '<span class="tma-dash__feed-react-chip' +
            (group.mine ? ' tma-dash__feed-react-chip--mine' : '') + '">' +
            group.emoji + '<span>' + group.count + '</span></span>';
        }).join('') +
        '</button>'
      : '';

    var counts = [];
    if (post.counts.comments) counts.push(plural(post.counts.comments, 'comment'));
    if (post.counts.views) counts.push(plural(post.counts.views, 'view'));

    if (!summary && !counts.length) return '';

    return (
      '<div class="tma-dash__feed-post-stats">' +
      summary +
      (counts.length ? '<span class="tma-dash__feed-post-counts">' + esc(counts.join(' · ')) + '</span>' : '') +
      '</div>'
    );
  }

  /*
   * React, Comment, Save. The card and the photo viewer draw the same row;
   * in the viewer the emoji picker is keyed apart so the two never open
   * together, and Comment puts the caret in the viewer's own box instead of
   * toggling the thread under the card.
   *
   * The icons are masked spans, not <img>s: a masked glyph takes the
   * button's colour, so Saved tints with its label instead of needing a
   * filled variant the icon set here does not ship.
   */
  function postActionsHtml(post, inGallery) {
    var reactions = post.reactions || { total: 0, groups: [], mine: null };
    var can = post.can || {};
    var thread = state.comments[post.id] || {};
    var pickerKey = inGallery ? 'g:' + post.id : post.id;

    return (
      '<div class="tma-dash__feed-post-actions">' +
      (can.react
        ? '<div class="tma-dash__feed-react-wrap">' +
          '<button type="button" class="tma-dash__feed-action' +
          (reactions.mine ? ' tma-dash__feed-action--on' : '') + '"' +
          ' data-feed-react-open="' + esc(pickerKey) + '"' +
          ' aria-expanded="' + (state.reactionPicker === pickerKey ? 'true' : 'false') + '">' +
          (reactions.mine
            ? '<span class="tma-dash__feed-action-emoji">' + reactions.mine + '</span>'
            : '<span class="tma-dash__feed-action-icon tma-dash__feed-action-icon--react" aria-hidden="true"></span>') +
          '<span>React</span></button>' +
          (state.reactionPicker === pickerKey ? reactionPickerHtml(post) : '') +
          '</div>'
        : '') +

      (can.comment || post.counts.comments
        ? '<button type="button" class="tma-dash__feed-action' +
          (!inGallery && thread.open ? ' tma-dash__feed-action--on' : '') + '"' +
          (inGallery
            ? ' data-feed-gallery-comment="' + esc(post.id) + '"'
            : ' data-feed-comments="' + esc(post.id) + '"') + '>' +
          '<span class="tma-dash__feed-action-icon tma-dash__feed-action-icon--comment" aria-hidden="true"></span>' +
          '<span>Comment' + (post.counts.comments ? ' (' + post.counts.comments + ')' : '') + '</span></button>'
        : '') +

      '<button type="button" class="tma-dash__feed-action' +
      (post.bookmarked ? ' tma-dash__feed-action--on' : '') + '"' +
      ' data-feed-bookmark="' + esc(post.id) + '" aria-pressed="' + (post.bookmarked ? 'true' : 'false') + '">' +
      '<span class="tma-dash__feed-action-icon tma-dash__feed-action-icon--save" aria-hidden="true"></span>' +
      '<span>' + (post.bookmarked ? 'Saved' : 'Save') + '</span></button>' +
      '</div>'
    );
  }

  function reactionPickerHtml(post) {
    var mine = post.reactions && post.reactions.mine;

    return (
      '<div class="tma-dash__menu tma-dash__feed-react-picker" role="menu">' +
      QUICK_REACTIONS.map(function (emoji) {
        return '<button type="button" class="tma-dash__feed-react-option' +
          (mine === emoji ? ' tma-dash__feed-react-option--mine' : '') + '"' +
          ' data-feed-react="' + esc(emoji) + '" data-feed-react-post="' + esc(post.id) + '"' +
          ' role="menuitem" aria-label="React ' + esc(emoji) + '">' + emoji + '</button>';
      }).join('') +
      '</div>'
    );
  }

  /* ── comments (§9) ───────────────────────────────────────── */

  /*
   * The thread under a card. The same pieces are drawn again inside the
   * photo viewer's rail, with `scope` prefixed onto every key so morph does
   * not confuse the two copies of one comment.
   */
  function commentsHtml(post) {
    var thread = state.comments[post.id];
    if (!thread || !thread.open) return '';

    return (
      '<section class="tma-dash__feed-comments" data-key="comments-' + esc(post.id) + '">' +
      commentListHtml(post, thread, '') +
      (post.can && post.can.comment ? commentComposerHtml(post, thread, '') : '') +
      '</section>'
    );
  }

  function commentListHtml(post, thread, scope) {
    if (!thread || thread.loading) {
      return '<div class="tma-dash__feed-comment-skel" aria-hidden="true"></div>';
    }
    if (thread.error) {
      return '<p class="tma-dash__feed-error">' + esc(thread.error) + '</p>';
    }
    if (!thread.items || !thread.items.length) {
      return '<p class="tma-dash__feed-comments-empty">No comments yet.</p>';
    }
    return thread.items.map(function (comment) {
      return commentHtml(post, comment, false, scope);
    }).join('');
  }

  function commentHtml(post, comment, isReply, scope) {
    var can = comment.can || {};
    var author = comment.author || {};
    var reactions = comment.reactions || { total: 0, groups: [], mine: null };
    var pickerKey = 'c:' + comment.id;
    var keyPrefix = scope ? scope + '-' : '';

    return (
      '<div class="tma-dash__feed-comment' + (isReply ? ' tma-dash__feed-comment--reply' : '') + '"' +
      ' data-key="' + keyPrefix + 'comment-' + esc(comment.id) + '">' +

      // The face sits inside the bubble with the words, one shape per comment.
      '<div class="tma-dash__feed-comment-bubble">' +
      '<img class="tma-dash__feed-comment-avatar" src="' + esc(avatarFor(author)) + '" alt=""' +
      ' width="28" height="28" loading="lazy">' +
      '<div class="tma-dash__feed-comment-content">' +
      '<div class="tma-dash__feed-comment-head">' +
      '<span class="tma-dash__feed-comment-author">' + esc(author.name || 'Unknown') + '</span>' +
      '<span class="tma-dash__feed-comment-time" title="' + esc(fullTime(comment.createdAt)) + '">' +
      esc(shortTime(comment.createdAt)) + (comment.edited ? ' · Edited' : '') + '</span>' +
      '</div>' +
      '<div class="tma-dash__feed-rich tma-dash__feed-rich--sm">' + (comment.body || '') + '</div>' +
      (comment.attachments && comment.attachments.length
        ? '<div class="tma-dash__feed-files tma-dash__feed-files--sm">' +
          comment.attachments.map(function (file) {
            return '<button type="button" class="tma-dash__feed-file"' +
              ' data-feed-lightbox="' + esc(file.id) + '" data-feed-post-ref="' + esc(post.id) + '">' +
              '<span class="tma-dash__feed-file-icon"><img src="' + ICON + fileIcon(file) +
              '.svg" alt="" width="14" height="14"></span>' +
              '<span class="tma-dash__feed-file-name">' + esc(file.name) + '</span></button>';
          }).join('') +
          '</div>'
        : '') +
      '</div>' +
      (reactions.groups && reactions.groups.length
        ? '<span class="tma-dash__feed-comment-reacts" aria-label="' + esc(plural(reactions.total, 'reaction')) + '">' +
          reactions.groups.slice(0, 3).map(function (group) { return group.emoji; }).join('') +
          '<span>' + (reactions.total || 0) + '</span></span>'
        : '') +
      '</div>' +

      '<div class="tma-dash__feed-comment-actions">' +
      (can.react
        ? '<div class="tma-dash__feed-react-wrap">' +
          '<button type="button" class="tma-dash__feed-comment-action' +
          (reactions.mine ? ' tma-dash__feed-comment-action--on' : '') + '"' +
          ' data-feed-comment-react-open="' + esc(comment.id) + '" data-feed-comment-post="' + esc(post.id) + '"' +
          ' aria-expanded="' + (state.reactionPicker === pickerKey ? 'true' : 'false') + '">' +
          (reactions.mine || 'React') + '</button>' +
          (state.reactionPicker === pickerKey
            ? '<div class="tma-dash__menu tma-dash__feed-react-picker" role="menu">' +
              QUICK_REACTIONS.map(function (emoji) {
                return '<button type="button" class="tma-dash__feed-react-option' +
                  (reactions.mine === emoji ? ' tma-dash__feed-react-option--mine' : '') + '"' +
                  ' data-feed-comment-react="' + esc(emoji) + '" data-feed-comment-react-id="' + esc(comment.id) + '"' +
                  ' data-feed-comment-post="' + esc(post.id) + '"' +
                  ' role="menuitem" aria-label="React ' + esc(emoji) + '">' + emoji + '</button>';
              }).join('') +
              '</div>'
            : '') +
          '</div>'
        : '') +
      (can.reply && !isReply
        ? '<button type="button" class="tma-dash__feed-comment-action"' +
          ' data-feed-reply="' + esc(comment.id) + '" data-feed-reply-post="' + esc(post.id) + '">Reply</button>'
        : '') +
      (can.edit
        ? '<button type="button" class="tma-dash__feed-comment-action"' +
          ' data-feed-comment-edit="' + esc(comment.id) + '" data-feed-comment-post="' + esc(post.id) +
          '">Edit</button>'
        : '') +
      (can.delete
        ? '<button type="button" class="tma-dash__feed-comment-action tma-dash__feed-comment-action--danger"' +
          ' data-feed-comment-delete="' + esc(comment.id) + '" data-feed-comment-post="' + esc(post.id) +
          '">Delete</button>'
        : '') +
      '</div>' +

      (comment.replies && comment.replies.length
        ? '<div class="tma-dash__feed-replies">' +
          comment.replies.map(function (reply) { return commentHtml(post, reply, true, scope); }).join('') +
          '</div>'
        : '') +
      '</div>'
    );
  }

  function commentComposerHtml(post, thread, scope) {
    var keyPrefix = scope ? scope + '-' : '';
    var replyTo = thread.replyTo
      ? (thread.items || []).filter(function (c) { return c.id === thread.replyTo; })[0]
      : null;

    return (
      '<div class="tma-dash__feed-comment-composer" data-key="' + keyPrefix + 'comment-composer-' + esc(post.id) + '">' +
      (replyTo
        ? '<div class="tma-dash__feed-reply-to">' +
          '<span>Replying to ' + esc((replyTo.author && replyTo.author.name) || 'a comment') + '</span>' +
          '<button type="button" class="tma-dash__tool-btn" data-feed-reply-cancel="' + esc(post.id) + '"' +
          ' aria-label="Cancel reply"><img src="' + ICON + 'X.svg" alt="" width="12" height="12"></button>' +
          '</div>'
        : '') +
      '<div class="tma-dash__feed-comment-box">' +
      '<img class="tma-dash__feed-comment-avatar" src="' + esc(myAvatar()) + '" alt="" width="28" height="28">' +
      // Skipped by morph for the same reason as the post editor: what is typed
      // here has no counterpart in the rendered string.
      '<div class="tma-dash__feed-comment-input" contenteditable="true" role="textbox"' +
      ' data-feed-comment-input="' + esc(post.id) + '" data-key="' + keyPrefix + 'comment-input-' + esc(post.id) + '"' +
      ' data-morph-skip data-placeholder="Write a comment…" aria-label="Write a comment"></div>' +
      '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--primary"' +
      ' data-feed-comment-send="' + esc(post.id) + '"' + (thread.sending ? ' disabled' : '') + '>' +
      (thread.sending ? 'Sending…' : 'Send') + '</button>' +
      '</div>' +
      mentionMenuHtml('comment:' + post.id) +
      (thread.sendError ? '<p class="tma-dash__feed-error">' + esc(thread.sendError) + '</p>' : '') +
      '</div>'
    );
  }

  /* ── the photo viewer (§18) ──────────────────────────────── */

  /*
   * One attachment full-size on the left, the post it belongs to on the
   * right: who posted it, what they wrote, the reactions, and the whole
   * comment thread with its own box, so a picture can be talked about
   * without leaving it. Arrows and ←/→ step through the post's files.
   */
  function galleryHtml() {
    var open = state.gallery;
    if (!open) return '';

    var post = findPost(open.postId);
    var files = post ? (lightboxSetFor(post, open.attachmentId) || []) : [];
    if (!post || !files.length) {
      // The post went away underneath the viewer (deleted, or a view change
      // dropped it): there is nothing left to show.
      state.gallery = null;
      document.documentElement.classList.remove('tma-feed-gallery-open');
      return '';
    }

    var index = 0;
    files.forEach(function (file, i) { if (file.id === open.attachmentId) index = i; });
    var file = files[index];

    var author = post.author || {};
    var meta = [];
    if (author.role) meta.push(author.role);
    if (post.publishedAt) meta.push(shortTime(post.publishedAt));
    if (!state.channel && post.channel) meta.push(post.channel.name);

    var thread = state.comments[post.id];

    return (
      '<div class="tma-dash__feed-gallery" data-feed-gallery data-key="feed-gallery" role="dialog" aria-modal="true"' +
      ' aria-label="' + esc(file.name) + '">' +

      '<div class="tma-dash__feed-gallery-stage" data-feed-gallery-stage>' +
      '<button type="button" class="tma-dash__feed-gallery-btn tma-dash__feed-gallery-close" data-feed-gallery-close' +
      ' aria-label="Close"><img src="' + ICON + 'X.svg" alt="" width="18" height="18"></button>' +
      (files.length > 1
        ? '<button type="button" class="tma-dash__feed-gallery-btn tma-dash__feed-gallery-nav tma-dash__feed-gallery-nav--prev"' +
          ' data-feed-gallery-go="-1" aria-label="Previous">' +
          '<img src="' + ICON + 'CaretLeft.svg" alt="" width="20" height="20"></button>' +
          '<button type="button" class="tma-dash__feed-gallery-btn tma-dash__feed-gallery-nav tma-dash__feed-gallery-nav--next"' +
          ' data-feed-gallery-go="1" aria-label="Next">' +
          '<img src="' + ICON + 'CaretRight.svg" alt="" width="20" height="20"></button>'
        : '') +
      galleryStageHtml(file) +
      '<div class="tma-dash__feed-gallery-caption">' +
      '<span class="tma-dash__feed-gallery-caption-name">' + esc(file.name) + '</span>' +
      '<span>' + esc(bytes(file.size)) + (files.length > 1 ? ' · ' + (index + 1) + ' of ' + files.length : '') + '</span>' +
      '<a class="tma-dash__feed-gallery-download" href="' + esc(file.url) + '" download' +
      ' aria-label="Download ' + esc(file.name) + '">' +
      '<img src="' + ICON + 'DownloadSimple.svg" alt="" width="16" height="16"><span>Download</span></a>' +
      '</div>' +
      '</div>' +

      '<aside class="tma-dash__feed-gallery-rail" aria-label="Post">' +
      '<div class="tma-dash__feed-gallery-scroll">' +
      '<header class="tma-dash__feed-gallery-head">' +
      '<img class="tma-dash__feed-post-avatar" src="' + esc(avatarFor(author)) + '" alt="" width="40" height="40">' +
      '<div class="tma-dash__feed-post-meta">' +
      '<span class="tma-dash__feed-post-author">' + esc(author.name || 'Unknown') + '</span>' +
      '<span class="tma-dash__feed-post-sub" title="' + esc(fullTime(post.publishedAt || post.createdAt)) + '">' +
      esc(meta.join(' · ')) + '</span>' +
      '</div>' +
      '</header>' +
      (post.title || post.body || (post.hashtags && post.hashtags.length)
        ? '<div class="tma-dash__feed-gallery-body">' +
          (post.title ? '<h3 class="tma-dash__feed-post-title">' + esc(post.title) + '</h3>' : '') +
          '<div class="tma-dash__feed-rich">' + (post.body || '') + '</div>' +
          (post.hashtags && post.hashtags.length ? hashtagRowHtml(post) : '') +
          '</div>'
        : '') +
      '<div class="tma-dash__feed-gallery-foot">' +
      postStatsHtml(post) +
      postActionsHtml(post, true) +
      '</div>' +
      '<div class="tma-dash__feed-comments tma-dash__feed-comments--gallery" data-key="g-comments-' + esc(post.id) + '">' +
      commentListHtml(post, thread, 'g') +
      '</div>' +
      '</div>' +
      (post.can && post.can.comment
        ? '<div class="tma-dash__feed-gallery-compose">' + commentComposerHtml(post, thread || {}, 'g') + '</div>'
        : '') +
      '</aside>' +

      '</div>'
    );
  }

  /* What goes on the stage for one file. */
  function galleryStageHtml(file) {
    var key = ' data-key="gallery-file-' + esc(file.id) + '"';

    if (file.kind === 'image') {
      return '<img class="tma-dash__feed-gallery-img" src="' + esc(file.url) + '" alt="' + esc(file.name) + '"' + key + '>';
    }
    if (file.kind === 'video') {
      return '<video class="tma-dash__feed-gallery-video" controls autoplay playsinline src="' + esc(file.url) + '"' +
        (file.thumbUrl ? ' poster="' + esc(file.thumbUrl) + '"' : '') + key + '></video>';
    }
    if (file.kind === 'audio') {
      return '<div class="tma-dash__feed-gallery-nopreview"' + key + '>' +
        '<img src="' + ICON + fileIcon(file) + '.svg" alt="" width="48" height="48">' +
        '<audio class="tma-dash__feed-audio" controls src="' + esc(file.url) + '"></audio></div>';
    }

    var doc = galleryDocKind(file);
    if (doc && window.TMAPortalLightbox) {
      // Painted after the render by mountGalleryDoc; morph-skipped because
      // pdf.js owns what is inside, and keyed per file so stepping to the
      // next document gets a fresh host.
      return '<div class="tma-dash__feed-gallery-doc" data-feed-gallery-doc="' + doc + '"' +
        ' data-feed-gallery-doc-url="' + esc(file.url) + '" data-feed-gallery-doc-size="' + (file.size || 0) + '"' +
        ' data-morph-skip' + key + '></div>';
    }

    return '<div class="tma-dash__feed-gallery-nopreview"' + key + '>' +
      '<img src="' + ICON + fileIcon(file) + '.svg" alt="" width="48" height="48">' +
      '<p class="tma-dash__feed-gallery-nopreview-title">' + esc(file.name) + '</p>' +
      '<p class="tma-dash__feed-gallery-nopreview-text">No preview for this file type. Download it to open it.</p>' +
      '</div>';
  }

  /* 'pdf' or 'text' when the lightbox can draw it in place, else null. */
  function galleryDocKind(file) {
    var mime = String(file.mime || '').toLowerCase();
    var ext = String(file.extension || '').toLowerCase();

    if (mime.indexOf('application/pdf') === 0 || ext === 'pdf') return 'pdf';
    if (mime.indexOf('text/') === 0 || ['txt', 'md', 'csv', 'log', 'json'].indexOf(ext) !== -1) return 'text';
    return null;
  }

  function openGallery(postId, attachmentId) {
    var post = findPost(postId);
    if (!post) return;

    var files = lightboxSetFor(post, attachmentId);
    if (!files || !files.length) return;

    state.gallery = { postId: postId, attachmentId: attachmentId };
    state.menuFor = null;
    state.reactionPicker = null;
    document.documentElement.classList.add('tma-feed-gallery-open');

    // The rail shows the thread whether or not it is open under the card.
    var thread = state.comments[postId];
    if (!thread || !thread.items) loadComments(postId, true);
    else render();
  }

  function closeGallery() {
    if (!state.gallery) return;
    state.gallery = null;
    state.reactionPicker = null;
    if (state.mention && state.mention.host !== 'post') state.mention = null;
    document.documentElement.classList.remove('tma-feed-gallery-open');
    render();
  }

  function stepGallery(delta) {
    var open = state.gallery;
    if (!open) return;

    var post = findPost(open.postId);
    var files = post ? (lightboxSetFor(post, open.attachmentId) || []) : [];
    if (files.length < 2) return;

    var index = 0;
    files.forEach(function (file, i) { if (file.id === open.attachmentId) index = i; });
    open.attachmentId = files[(index + delta + files.length) % files.length].id;
    render();
  }

  /* Paint a PDF or text file into the stage host the render just drew. */
  function mountGalleryDoc(root) {
    var host = root.querySelector('[data-feed-gallery-doc]:not([data-feed-gallery-doc-mounted])');
    if (!host || !window.TMAPortalLightbox) return;

    host.setAttribute('data-feed-gallery-doc-mounted', '1');

    var url = host.getAttribute('data-feed-gallery-doc-url');
    if (host.getAttribute('data-feed-gallery-doc') === 'pdf') {
      window.TMAPortalLightbox.pdfInto(host, url);
    } else {
      window.TMAPortalLightbox.textInto(host, url, parseInt(host.getAttribute('data-feed-gallery-doc-size'), 10) || 0);
    }
  }

  function wireGallery(root, M) {
    each(root, M, '[data-feed-gallery-close]', 'click', function () { closeGallery(); });

    each(root, M, '[data-feed-gallery-go]', 'click', function (e) {
      stepGallery(parseInt(e.currentTarget.getAttribute('data-feed-gallery-go'), 10) || 1);
    });

    // A click on the dark stage itself, not on the picture, closes.
    each(root, M, '[data-feed-gallery-stage]', 'click', function (e) {
      if (e.target === e.currentTarget) closeGallery();
    });

    each(root, M, '[data-feed-gallery-comment]', 'click', function (e) {
      focusCommentInput(e.currentTarget.getAttribute('data-feed-gallery-comment'));
    });

    mountGalleryDoc(root);
  }

  /* ── analytics (§19) ─────────────────────────────────────── */

  function analyticsHtml() {
    if (!state.analytics) {
      return '<div class="tma-dash__feed-skel-card" aria-hidden="true"></div>';
    }

    if (state.analytics.error) {
      return (
        '<div class="tma-dash__feed-state">' +
        '<p class="tma-dash__feed-state-text">' + esc(state.analytics.error) + '</p>' +
        '</div>'
      );
    }

    var data = state.analytics;
    var totals = data.totals || {};

    var tiles = [
      ['Posts', totals.posts],
      ['Views', totals.views],
      // Reach and views are different numbers; the tile says which is which.
      ['Reach', totals.reach],
      ['Comments', totals.comments],
      ['Reactions', totals.reactions],
      ['Active members', totals.activeMembers],
    ];

    return (
      '<div class="tma-dash__feed-analytics">' +
      '<header class="tma-dash__feed-head">' +
      '<div class="tma-dash__feed-head-text">' +
      '<h2 class="tma-dash__feed-head-title">Analytics</h2>' +
      '<p class="tma-dash__feed-head-desc">' +
      'The last ' + esc(String((data.range && data.range.days) || 30)) + ' days.' +
      '</p>' +
      '</div>' +
      '<div class="tma-dash__feed-head-actions">' +
      '<select class="tma-dash__feed-select" data-feed-analytics-range>' +
      [7, 30, 90, 365].map(function (days) {
        return '<option value="' + days + '"' +
          ((data.range && data.range.days) === days ? ' selected' : '') + '>' +
          'Last ' + days + ' days</option>';
      }).join('') +
      '</select>' +
      '</div>' +
      '</header>' +

      '<div class="tma-dash__feed-stat-row">' +
      tiles.map(function (tile) {
        return '<div class="tma-dash__feed-stat">' +
          '<span class="tma-dash__feed-stat-value">' + esc(String(tile[1] || 0)) + '</span>' +
          '<span class="tma-dash__feed-stat-label">' + esc(tile[0]) + '</span>' +
          '</div>';
      }).join('') +
      '</div>' +

      analyticsListHtml('Top contributors', (data.topContributors || []).map(function (row) {
        return {
          name: (row.user && row.user.name) || 'Unknown',
          photo: row.user && row.user.photo,
          meta: plural(row.posts, 'post') + ' · ' + plural(row.comments, 'comment'),
          value: row.total,
        };
      })) +

      analyticsListHtml('Most viewed', (data.mostViewed || []).map(function (row) {
        return {
          name: row.title || 'Untitled',
          meta: ((row.channel && row.channel.name) || '') +
            ((row.author && row.author.name) ? ' · ' + row.author.name : ''),
          value: row.value,
          postId: row.id,
        };
      })) +

      analyticsListHtml('Most reacted', (data.mostReacted || []).map(function (row) {
        return {
          name: row.title || 'Untitled',
          meta: ((row.channel && row.channel.name) || '') +
            ((row.author && row.author.name) ? ' · ' + row.author.name : ''),
          value: row.value,
          postId: row.id,
        };
      })) +

      (data.channels && data.channels.length > 1 ? channelBreakdownHtml(data.channels) : '') +
      '</div>'
    );
  }

  function analyticsListHtml(title, rows) {
    if (!rows.length) {
      return (
        '<section class="tma-dash__feed-panel">' +
        '<h3 class="tma-dash__feed-panel-title">' + esc(title) + '</h3>' +
        '<p class="tma-dash__feed-comments-empty">Nothing yet in this period.</p>' +
        '</section>'
      );
    }

    return (
      '<section class="tma-dash__feed-panel">' +
      '<h3 class="tma-dash__feed-panel-title">' + esc(title) + '</h3>' +
      '<ol class="tma-dash__feed-rank">' +
      rows.map(function (row) {
        return (
          '<li class="tma-dash__feed-rank-row"' +
          (row.postId ? ' data-feed-open-post="' + esc(row.postId) + '"' : '') + '>' +
          (row.photo
            ? '<img class="tma-dash__feed-rank-avatar" src="' + esc(row.photo) + '" alt="" width="24" height="24">'
            : '') +
          '<span class="tma-dash__feed-rank-meta">' +
          '<span class="tma-dash__feed-rank-name">' + esc(row.name) + '</span>' +
          (row.meta ? '<span class="tma-dash__feed-rank-sub">' + esc(row.meta) + '</span>' : '') +
          '</span>' +
          '<span class="tma-dash__feed-rank-value">' + esc(String(row.value)) + '</span>' +
          '</li>'
        );
      }).join('') +
      '</ol>' +
      '</section>'
    );
  }

  function channelBreakdownHtml(channels) {
    return (
      '<section class="tma-dash__feed-panel">' +
      '<h3 class="tma-dash__feed-panel-title">By channel</h3>' +
      '<div class="tma-dash__feed-table-wrap">' +
      '<table class="tma-dash__feed-table">' +
      '<thead><tr><th>Channel</th><th>Members</th><th>Posts</th><th>Views</th>' +
      '<th>Reach</th><th>Comments</th><th>Reactions</th></tr></thead>' +
      '<tbody>' +
      channels.map(function (row) {
        return '<tr>' +
          '<td>' + esc((row.channel && row.channel.name) || '') + '</td>' +
          '<td>' + esc(String(row.members)) + '</td>' +
          '<td>' + esc(String(row.posts)) + '</td>' +
          '<td>' + esc(String(row.views)) + '</td>' +
          '<td>' + esc(String(row.reach)) + '</td>' +
          '<td>' + esc(String(row.comments)) + '</td>' +
          '<td>' + esc(String(row.reactions)) + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table></div></section>'
    );
  }

  /* ── search results (§14) ────────────────────────────────── */

  function searchResultsHtml() {
    var results = state.searchResults;

    var groups = [
      ['Posts', results.posts, function (row) {
        return {
          title: row.title || row.excerpt || 'Untitled',
          meta: ((row.channel && row.channel.name) || '') +
            ((row.author && row.author.name) ? ' · ' + row.author.name : '') +
            (row.publishedAt ? ' · ' + shortTime(row.publishedAt) : ''),
          postId: row.id,
        };
      }],
      ['Comments', results.comments, function (row) {
        return {
          title: row.excerpt,
          meta: ((row.author && row.author.name) || '') +
            ((row.channel && row.channel.name) ? ' · ' + row.channel.name : ''),
          postId: row.postId,
        };
      }],
      ['Channels', results.channels, function (row) {
        return { title: row.name, meta: row.description || '', channelId: row.id };
      }],
      ['People', results.people, function (row) {
        return { title: row.name, meta: row.role || '', authorId: row.id };
      }],
      ['Hashtags', results.hashtags, function (row) {
        return { title: '#' + row.tag, meta: plural(row.count, 'post'), hashtag: row.tag };
      }],
      ['Files', results.attachments, function (row) {
        return { title: row.name, meta: bytes(row.size), postId: row.postId };
      }],
    ];

    var any = groups.some(function (group) { return group[1] && group[1].length; });

    return (
      '<header class="tma-dash__feed-head">' +
      '<div class="tma-dash__feed-head-text">' +
      '<h2 class="tma-dash__feed-head-title">Results for “' + esc(state.search) + '”</h2>' +
      '</div>' +
      '<div class="tma-dash__feed-head-actions">' +
      '<button type="button" class="tma-dash__feed-btn" data-feed-clear-search>Clear search</button>' +
      '</div>' +
      '</header>' +
      toolbarHtml() +
      (any
        ? groups.map(function (group) {
          var rows = group[1] || [];
          if (!rows.length) return '';

          return (
            '<section class="tma-dash__feed-panel">' +
            '<h3 class="tma-dash__feed-panel-title">' + esc(group[0]) + '</h3>' +
            '<ul class="tma-dash__feed-results">' +
            rows.map(function (row) {
              var item = group[2](row);
              return '<li><button type="button" class="tma-dash__feed-result"' +
                (item.postId ? ' data-feed-open-post="' + esc(item.postId) + '"' : '') +
                (item.channelId ? ' data-feed-channel="' + esc(item.channelId) + '"' : '') +
                (item.hashtag ? ' data-feed-hashtag="' + esc(item.hashtag) + '"' : '') +
                (item.authorId ? ' data-feed-author="' + esc(String(item.authorId)) + '"' : '') +
                '>' +
                '<span class="tma-dash__feed-result-title">' + esc(item.title) + '</span>' +
                (item.meta ? '<span class="tma-dash__feed-result-meta">' + esc(item.meta) + '</span>' : '') +
                '</button></li>';
            }).join('') +
            '</ul></section>'
          );
        }).join('')
        : '<div class="tma-dash__feed-state">' +
          '<p class="tma-dash__feed-state-title">Nothing matches</p>' +
          '<p class="tma-dash__feed-state-text">Try a different search.</p></div>')
    );
  }

  /* ── modals ──────────────────────────────────────────────── */

  function modalHtml() {
    var modal = state.modal;

    var body = {
      channel: channelFormHtml,
      members: membersModalHtml,
      filters: filtersModalHtml,
      reactions: reactionPeopleHtml,
      voters: votersModalHtml,
      acks: acksModalHtml,
      confirm: confirmModalHtml,
    }[modal.kind];

    if (!body) return '';

    return (
      '<div class="tma-dash__feed-modal-scrim" data-feed-modal-scrim>' +
      '<div class="tma-dash__feed-modal" role="dialog" aria-modal="true"' +
      ' aria-label="' + esc(modal.title || 'Dialog') + '">' +
      '<header class="tma-dash__feed-modal-head">' +
      '<h2 class="tma-dash__feed-modal-title">' + esc(modal.title || '') + '</h2>' +
      '<button type="button" class="tma-dash__tool-btn" data-feed-modal-close aria-label="Close">' +
      '<img src="' + ICON + 'X.svg" alt="" width="16" height="16"></button>' +
      '</header>' +
      '<div class="tma-dash__feed-modal-body">' + body(modal) + '</div>' +
      '</div></div>'
    );
  }

  /* Create or edit a channel (§2). */
  function channelFormHtml(modal) {
    var form = modal.form;
    var editing = !!modal.channelId;
    var channel = editing ? findChannel(modal.channelId) : null;

    return (
      '<div class="tma-dash__feed-form">' +
      (modal.error ? '<p class="tma-dash__feed-error">' + esc(modal.error) + '</p>' : '') +

      (editing
        ? '<div class="tma-dash__feed-form-images">' +
          '<label class="tma-dash__feed-image-drop">' +
          '<span class="tma-dash__feed-field-label">Profile picture</span>' +
          (channel && channel.avatar
            ? '<img class="tma-dash__feed-image-preview" src="' + esc(channel.avatar) + '" alt="">'
            : '<span class="tma-dash__feed-image-empty">Choose an image</span>') +
          '<input type="file" accept="image/*" hidden data-feed-channel-avatar>' +
          '</label>' +
          '<label class="tma-dash__feed-image-drop tma-dash__feed-image-drop--wide">' +
          '<span class="tma-dash__feed-field-label">Cover image</span>' +
          (channel && channel.cover
            ? '<img class="tma-dash__feed-image-preview" src="' + esc(channel.cover) + '" alt="">'
            : '<span class="tma-dash__feed-image-empty">Choose an image</span>') +
          '<input type="file" accept="image/*" hidden data-feed-channel-cover>' +
          '</label>' +
          '</div>'
        : '') +

      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Name</span>' +
      '<input type="text" class="tma-dash__feed-input" data-feed-form="name"' +
      ' value="' + esc(form.name || '') + '" placeholder="e.g. Marketing"></label>' +

      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Description</span>' +
      '<textarea class="tma-dash__feed-input tma-dash__feed-textarea" data-feed-form="description"' +
      ' placeholder="What is this channel for?">' + esc(form.description || '') + '</textarea></label>' +

      '<div class="tma-dash__feed-form-row">' +
      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Type</span>' +
      '<select class="tma-dash__feed-select" data-feed-form="type"' + (editing ? ' disabled' : '') + '>' +
      CHANNEL_TYPES.map(function (type) {
        return '<option value="' + esc(type.id) + '"' +
          (form.type === type.id ? ' selected' : '') + '>' + esc(type.label) + '</option>';
      }).join('') +
      '</select></label>' +

      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Who can see it</span>' +
      '<select class="tma-dash__feed-select" data-feed-form="visibility">' +
      '<option value="org"' + (form.visibility === 'org' ? ' selected' : '') + '>Everyone at the firm</option>' +
      '<option value="private"' + (form.visibility === 'private' ? ' selected' : '') + '>Members only</option>' +
      '<option value="client"' + (form.visibility === 'client' ? ' selected' : '') + '>Client space</option>' +
      '</select></label>' +
      '</div>' +

      '<div class="tma-dash__feed-form-row">' +
      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Who can post</span>' +
      '<select class="tma-dash__feed-select" data-feed-form="postPolicy">' +
      '<option value="member"' + (form.postPolicy === 'member' ? ' selected' : '') + '>Any member</option>' +
      '<option value="moderator"' + (form.postPolicy === 'moderator' ? ' selected' : '') + '>Moderators and up</option>' +
      '<option value="admin"' + (form.postPolicy === 'admin' ? ' selected' : '') + '>Administrators only</option>' +
      '</select></label>' +

      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Who can comment</span>' +
      '<select class="tma-dash__feed-select" data-feed-form="commentPolicy">' +
      '<option value="member"' + (form.commentPolicy === 'member' ? ' selected' : '') + '>Any member</option>' +
      '<option value="moderator"' + (form.commentPolicy === 'moderator' ? ' selected' : '') + '>Moderators and up</option>' +
      '<option value="admin"' + (form.commentPolicy === 'admin' ? ' selected' : '') + '>Administrators only</option>' +
      '</select></label>' +
      '</div>' +

      '<div class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Colour</span>' +
      '<div class="tma-dash__feed-swatches">' +
      CHANNEL_COLOURS.map(function (colour) {
        return '<button type="button" class="tma-dash__feed-swatch tma-dash__feed-swatch--' + esc(colour) +
          (form.colour === colour ? ' tma-dash__feed-swatch--on' : '') + '"' +
          ' data-feed-form-colour="' + esc(colour) + '" aria-label="' + esc(colour) + '"></button>';
      }).join('') +
      '</div></div>' +

      '<div class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Icon</span>' +
      '<div class="tma-dash__feed-swatches">' +
      CHANNEL_ICONS.map(function (icon) {
        return '<button type="button" class="tma-dash__feed-icon-pick' +
          (form.icon === icon ? ' tma-dash__feed-icon-pick--on' : '') + '"' +
          ' data-feed-form-icon="' + esc(icon) + '" aria-label="' + esc(icon) + '">' +
          '<img src="' + ICON + icon + '.svg" alt="" width="16" height="16"></button>';
      }).join('') +
      '</div></div>' +

      '<div class="tma-dash__feed-modal-actions">' +
      (editing && channel && channel.can.delete
        ? '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--danger"' +
          ' data-feed-channel-delete>Delete channel</button>'
        : '') +
      (editing && channel
        ? '<button type="button" class="tma-dash__feed-btn" data-feed-channel-archive>' +
          (channel.isArchived ? 'Restore' : 'Archive') + '</button>' +
          '<button type="button" class="tma-dash__feed-btn" data-feed-channel-members>Members</button>'
        : '') +
      '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--primary" data-feed-channel-save' +
      (modal.busy ? ' disabled' : '') + '>' +
      (modal.busy ? 'Saving…' : (editing ? 'Save changes' : 'Create channel')) + '</button>' +
      '</div>' +
      '</div>'
    );
  }

  function membersModalHtml(modal) {
    if (modal.loading) return '<div class="tma-dash__feed-comment-skel" aria-hidden="true"></div>';
    if (modal.error) return '<p class="tma-dash__feed-error">' + esc(modal.error) + '</p>';

    var members = modal.members || [];
    var canManage = !!modal.can && modal.can.manage;

    return (
      '<div class="tma-dash__feed-members">' +
      (canManage
        ? '<div class="tma-dash__feed-member-add">' +
          '<label class="tma-dash__feed-search">' +
          '<img src="images/icons/tma/Search-16.svg" alt="" width="16" height="16">' +
          '<input type="search" placeholder="Add someone" data-feed-member-search' +
          ' aria-label="Search people to add">' +
          '</label>' +
          (modal.candidates && modal.candidates.length
            ? '<div class="tma-dash__menu tma-dash__feed-member-results">' +
              modal.candidates.map(function (person) {
                return '<button type="button" class="tma-dash__menu-item"' +
                  ' data-feed-member-add="' + esc(person.token) + '">' +
                  '<img class="tma-dash__feed-mention-avatar" src="' + esc(avatarFor(person)) + '" alt="">' +
                  '<span>' + esc(person.name) + '</span>' +
                  (person.isMember ? '<span class="tma-dash__feed-mention-meta">Already a member</span>' : '') +
                  '</button>';
              }).join('') +
              '</div>'
            : '') +
          '</div>'
        : '') +

      '<ul class="tma-dash__feed-member-list">' +
      members.map(function (member) {
        var person = member.user || {};
        return (
          '<li class="tma-dash__feed-member">' +
          '<img class="tma-dash__feed-member-avatar" src="' + esc(avatarFor(person)) + '" alt=""' +
          ' width="32" height="32">' +
          '<span class="tma-dash__feed-member-meta">' +
          '<span class="tma-dash__feed-member-name">' + esc(person.name || '') + '</span>' +
          (person.role ? '<span class="tma-dash__feed-member-sub">' + esc(person.role) + '</span>' : '') +
          '</span>' +
          (canManage && member.role !== 'owner'
            ? '<select class="tma-dash__feed-select tma-dash__feed-select--sm"' +
              ' data-feed-member-role="' + esc(String(person.id)) + '">' +
              ['member', 'moderator', 'admin'].map(function (role) {
                return '<option value="' + role + '"' + (member.role === role ? ' selected' : '') + '>' +
                  role.charAt(0).toUpperCase() + role.slice(1) + '</option>';
              }).join('') +
              '</select>' +
              '<button type="button" class="tma-dash__tool-btn"' +
              ' data-feed-member-remove="' + esc(String(person.id)) + '" aria-label="Remove">' +
              '<img src="' + ICON + 'X.svg" alt="" width="16" height="16"></button>'
            : '<span class="tma-dash__feed-chip">' + esc(member.role) + '</span>') +
          '</li>'
        );
      }).join('') +
      '</ul></div>'
    );
  }

  function filtersModalHtml(modal) {
    var filters = state.filters;

    return (
      '<div class="tma-dash__feed-form">' +
      '<div class="tma-dash__feed-form-row">' +
      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Post type</span>' +
      '<select class="tma-dash__feed-select" data-feed-filter="type">' +
      '<option value="">Any</option>' +
      POST_TYPES.map(function (type) {
        return '<option value="' + esc(type.id) + '"' +
          (filters.type === type.id ? ' selected' : '') + '>' + esc(type.label) + '</option>';
      }).join('') +
      '</select></label>' +

      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Hashtag</span>' +
      '<input type="text" class="tma-dash__feed-input" data-feed-filter="hashtag"' +
      ' value="' + esc(filters.hashtag) + '" placeholder="e.g. q3planning"></label>' +
      '</div>' +

      '<div class="tma-dash__feed-form-row">' +
      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">From</span>' +
      '<input type="date" class="tma-dash__feed-input" data-feed-filter="from"' +
      ' value="' + esc(filters.from) + '"></label>' +
      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">To</span>' +
      '<input type="date" class="tma-dash__feed-input" data-feed-filter="to"' +
      ' value="' + esc(filters.to) + '"></label>' +
      '</div>' +

      '<div class="tma-dash__feed-form-row">' +
      checkboxHtml('feed-filter-attachments', 'Has attachments', filters.hasAttachments) +
      checkboxHtml('feed-filter-poll', 'Has a poll', filters.hasPoll) +
      '</div>' +

      '<div class="tma-dash__feed-modal-actions">' +
      '<button type="button" class="tma-dash__feed-btn" data-feed-clear-filters>Clear all</button>' +
      '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--primary" data-feed-apply-filters>' +
      'Apply</button>' +
      '</div></div>'
    );
  }

  function reactionPeopleHtml(modal) {
    if (modal.loading) return '<div class="tma-dash__feed-comment-skel" aria-hidden="true"></div>';

    var groups = modal.groups || [];
    if (!groups.length) return '<p class="tma-dash__feed-comments-empty">No reactions yet.</p>';

    return groups.map(function (group) {
      return (
        '<section class="tma-dash__feed-panel">' +
        '<h3 class="tma-dash__feed-panel-title">' + group.emoji + ' ' + plural(group.count, 'person', 'people') +
        '</h3>' +
        '<ul class="tma-dash__feed-people">' +
        (group.people || []).map(function (person) {
          return '<li class="tma-dash__feed-person">' +
            '<img src="' + esc(avatarFor(person)) + '" alt="" width="28" height="28">' +
            '<span>' + esc(person.name) + '</span></li>';
        }).join('') +
        '</ul></section>'
      );
    }).join('');
  }

  function votersModalHtml(modal) {
    if (modal.loading) return '<div class="tma-dash__feed-comment-skel" aria-hidden="true"></div>';
    if (modal.error) return '<p class="tma-dash__feed-error">' + esc(modal.error) + '</p>';

    return (modal.options || []).map(function (option) {
      return (
        '<section class="tma-dash__feed-panel">' +
        '<h3 class="tma-dash__feed-panel-title">' + esc(option.label) +
        ' · ' + plural((option.people || []).length, 'vote') + '</h3>' +
        ((option.people || []).length
          ? '<ul class="tma-dash__feed-people">' +
            option.people.map(function (person) {
              return '<li class="tma-dash__feed-person">' +
                '<img src="' + esc(avatarFor(person)) + '" alt="" width="28" height="28">' +
                '<span>' + esc(person.name) + '</span></li>';
            }).join('') + '</ul>'
          : '<p class="tma-dash__feed-comments-empty">No votes for this option.</p>') +
        '</section>'
      );
    }).join('');
  }

  /* Acknowledgement statistics (§12), including who has *not* replied. */
  function acksModalHtml(modal) {
    if (modal.loading) return '<div class="tma-dash__feed-comment-skel" aria-hidden="true"></div>';
    if (modal.error) return '<p class="tma-dash__feed-error">' + esc(modal.error) + '</p>';

    var done = modal.acknowledged || [];
    var waiting = modal.outstanding || [];
    var total = done.length + waiting.length;
    var share = total ? Math.round((done.length / total) * 100) : 0;

    return (
      '<div class="tma-dash__feed-ack-stats">' +
      '<div class="tma-dash__feed-ack-meter">' +
      '<span class="tma-dash__feed-ack-fill" style="width:' + share + '%"></span>' +
      '</div>' +
      '<p class="tma-dash__feed-ack-summary">' +
      esc(done.length + ' of ' + total + ' acknowledged (' + share + '%)') + '</p>' +

      '<section class="tma-dash__feed-panel">' +
      '<h3 class="tma-dash__feed-panel-title">Acknowledged</h3>' +
      (done.length
        ? '<ul class="tma-dash__feed-people">' + done.map(function (row) {
          return '<li class="tma-dash__feed-person">' +
            '<img src="' + esc(avatarFor(row.user)) + '" alt="" width="28" height="28">' +
            '<span>' + esc((row.user && row.user.name) || '') + '</span>' +
            '<span class="tma-dash__feed-person-meta">' + esc(shortTime(row.at)) + '</span></li>';
        }).join('') + '</ul>'
        : '<p class="tma-dash__feed-comments-empty">Nobody yet.</p>') +
      '</section>' +

      '<section class="tma-dash__feed-panel">' +
      '<h3 class="tma-dash__feed-panel-title">Still waiting</h3>' +
      (waiting.length
        ? '<ul class="tma-dash__feed-people">' + waiting.map(function (person) {
          return '<li class="tma-dash__feed-person">' +
            '<img src="' + esc(avatarFor(person)) + '" alt="" width="28" height="28">' +
            '<span>' + esc(person.name) + '</span></li>';
        }).join('') + '</ul>'
        : '<p class="tma-dash__feed-comments-empty">Everyone has acknowledged.</p>') +
      '</section>' +
      '</div>'
    );
  }

  function confirmModalHtml(modal) {
    return (
      '<div class="tma-dash__feed-form">' +
      '<p class="tma-dash__feed-confirm-text">' + esc(modal.message) + '</p>' +
      '<div class="tma-dash__feed-modal-actions">' +
      '<button type="button" class="tma-dash__feed-btn" data-feed-modal-close>Cancel</button>' +
      '<button type="button" class="tma-dash__feed-btn tma-dash__feed-btn--danger" data-feed-confirm>' +
      esc(modal.confirmLabel || 'Confirm') + '</button>' +
      '</div></div>'
    );
  }

  /* ── wiring ──────────────────────────────────────────────── */

  /*
   * Handlers are attached through TMAMorph's `unwired`/`on`, which tag a node
   * once. Morph preserves nodes across a patch, so binding unconditionally
   * would stack a second listener on every render and fire each click twice.
   */
  function wire() {
    var root = state.el;
    if (!root) return;

    var M = morph();

    wireSidebar(root, M);
    wireToolbar(root, M);
    wireComposer(root, M);
    wirePosts(root, M);
    wireComments(root, M);
    wireModal(root, M);
    wireGallery(root, M);
  }

  function each(root, M, selector, type, handler) {
    M.unwired(root, selector, type || 'click').forEach(function (el) {
      M.on(el, type || 'click', handler, type || 'click');
    });
  }

  function wireSidebar(root, M) {
    each(root, M, '[data-feed-group-toggle]', 'click', function (e) {
      var key = e.currentTarget.getAttribute('data-feed-group-toggle');
      state.groups[key] = state.groups[key] === false;
      saveMemory();
      render();
    });

    each(root, M, '[data-feed-view]', 'click', function (e) {
      openView(e.currentTarget.getAttribute('data-feed-view'));
    });

    each(root, M, '[data-feed-channel]', 'click', function (e) {
      openChannel(e.currentTarget.getAttribute('data-feed-channel'));
    });

    each(root, M, '[data-feed-channel-search]', 'input', function (e) {
      state.channelSearch = e.currentTarget.value;
      saveMemory();
      render();
    });

    each(root, M, '[data-feed-sidebar]', 'scroll', function (e) {
      // Recorded but not saved on every pixel; saveMemory runs on navigation.
      state.sidebarScroll = e.currentTarget.scrollTop;
    });

    each(root, M, '[data-feed-new-channel]', 'click', function () {
      openChannelForm(null);
    });

    each(root, M, '[data-feed-analytics]', 'click', function () {
      openAnalytics(30);
    });

    each(root, M, '[data-feed-settings]', 'click', function () {
      var manageable = state.channels.filter(function (c) { return c.can && c.can.manage; });
      if (!manageable.length) return;
      openChannelForm(state.channel && state.channel.can.manage ? state.channel.id : manageable[0].id);
    });
  }

  function wireToolbar(root, M) {
    each(root, M, '[data-feed-search]', 'input', function (e) {
      state.search = e.currentTarget.value;
      debounceSearch();
    });

    each(root, M, '[data-feed-search]', 'keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
      if (e.key === 'Escape') { state.search = ''; state.searchResults = null; loadPosts(false); }
    });

    each(root, M, '[data-feed-clear-search]', 'click', function () {
      state.search = '';
      state.searchResults = null;
      loadPosts(false);
    });

    each(root, M, '[data-feed-filters]', 'click', function () {
      state.modal = { kind: 'filters', title: 'Filters' };
      render();
    });

    each(root, M, '[data-feed-clear-filters]', 'click', function () {
      Object.keys(state.filters).forEach(function (key) {
        state.filters[key] = typeof state.filters[key] === 'boolean' ? false : '';
      });
      state.modal = null;
      saveMemory();
      loadPosts(false);
    });

    each(root, M, '[data-feed-retry]', 'click', function () { loadPosts(false); });
    each(root, M, '[data-feed-more]', 'click', function () { loadPosts(true); });

    each(root, M, '[data-feed-join]', 'click', function () {
      if (!state.channelId) return;
      API.joinChannel(state.channelId)
        .then(function (data) { replaceChannel(data.channel); toast('Joined ' + data.channel.name, 'success'); })
        .catch(fail);
    });

    each(root, M, '[data-feed-leave]', 'click', function () {
      if (!state.channelId) return;
      API.leaveChannel(state.channelId)
        .then(function (data) { replaceChannel(data.channel); })
        .catch(fail);
    });

    each(root, M, '[data-feed-mute]', 'click', function () {
      var channel = state.channel;
      if (!channel || !channel.membership) return;

      var muted = !channel.membership.muted;
      API.updateMembership(channel.id, { muted: muted })
        .then(function () {
          channel.membership.muted = muted;
          render();
        })
        .catch(fail);
    });

    each(root, M, '[data-feed-channel-settings]', 'click', function () {
      if (state.channelId) openChannelForm(state.channelId);
    });

    each(root, M, '[data-feed-hashtag]', 'click', function (e) {
      state.filters.hashtag = e.currentTarget.getAttribute('data-feed-hashtag');
      state.searchResults = null;
      saveMemory();
      loadPosts(false);
    });

    each(root, M, '[data-feed-author]', 'click', function (e) {
      state.filters.author = e.currentTarget.getAttribute('data-feed-author');
      state.searchResults = null;
      loadPosts(false);
    });

    each(root, M, '[data-feed-analytics-range]', 'change', function (e) {
      openAnalytics(parseInt(e.currentTarget.value, 10) || 30);
    });

    each(root, M, '[data-feed-open-post]', 'click', function (e) {
      openPostById(e.currentTarget.getAttribute('data-feed-open-post'));
    });
  }

  var searchTimer = null;

  function debounceSearch() {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(runSearch, 350);
  }

  function runSearch() {
    var term = state.search.trim();

    // Below two characters the server refuses anyway; fall back to the stream
    // rather than showing an error for someone who is still typing.
    if (term.length < 2) {
      state.searchResults = null;
      loadPosts(false);
      return;
    }

    API.search(Object.assign({ q: term, channel: state.channelId || '' }, state.filters))
      .then(function (data) { state.searchResults = data; render(); })
      .catch(fail);
  }

  /* ── composer wiring ─────────────────────────────────────── */

  function wireComposer(root, M) {
    each(root, M, '[data-feed-compose-open]', 'click', function () { openComposer(); });

    each(root, M, '[data-feed-compose-close]', 'click', function () {
      state.composer = null;
      if (state.mention && state.mention.host === 'post') state.mention = null;
      render();
    });

    each(root, M, '[data-feed-type]', 'click', function (e) {
      var type = e.currentTarget.getAttribute('data-feed-type');
      if (!state.composer) openComposer();
      state.composer.type = type;

      // A poll post without a poll builder open is a dead end.
      if (type === 'poll' && !state.composer.poll) state.composer.poll = blankPoll();
      // An announcement usually wants a title and the options panel.
      if (type === 'announcement') {
        state.composer.showOptions = true;
        if (state.composer.title === undefined) state.composer.title = '';
      }
      render();
    });

    each(root, M, '[data-feed-channel-select]', 'change', function (e) {
      if (state.composer) state.composer.channelId = e.currentTarget.value;
    });

    each(root, M, '[data-feed-title]', 'input', function (e) {
      if (state.composer) { state.composer.title = e.currentTarget.value; queueAutosave(); }
    });

    // The editor is the one node whose content is *not* re-rendered from
    // state, the browser owns the caret. State reads from the DOM instead.
    var editor = M.unwiredOne(root, '[data-feed-editor]', 'wire');
    if (editor) {
      // Restore the draft body once, when the node first appears.
      if (state.composer && state.composer.body && !editor.innerHTML) {
        editor.innerHTML = state.composer.body;
      }

      M.on(editor, 'input', function () {
        if (!state.composer) return;
        state.composer.body = editor.innerHTML;
        state.composer.savedAt = null;
        detectMentionTrigger(editor, 'post', state.composer.channelId || state.channelId || '');
        queueAutosave();
      }, 'input');

      M.on(editor, 'keydown', function (e) { handleEditorKeys(e, editor); }, 'keydown');

      // Pasted rich text arrives with whatever styling its source had. Only
      // the text is kept; the server would strip the rest anyway, and this
      // way what is typed matches what is stored.
      M.on(editor, 'paste', function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
      }, 'paste');
    }

    each(root, M, '[data-feed-format]', 'click', function (e) {
      e.preventDefault();
      applyFormat(e.currentTarget.getAttribute('data-feed-format'));
    });

    // mousedown would move the caret out of the field before the click
    // lands, and the pick needs the caret where the @ was typed.
    each(root, M, '[data-feed-mention-pick]', 'mousedown', function (e) { e.preventDefault(); });

    each(root, M, '[data-feed-mention-pick]', 'click', function (e) {
      pickMention(parseInt(e.currentTarget.getAttribute('data-feed-mention-pick'), 10));
    });

    /* Attachments */
    each(root, M, '[data-feed-attach]', 'click', function () {
      var input = root.querySelector('[data-feed-file-input]');
      if (input) input.click();
    });

    each(root, M, '[data-feed-file-input]', 'change', function (e) {
      uploadFiles(Array.prototype.slice.call(e.currentTarget.files || []));
      e.currentTarget.value = '';
    });

    each(root, M, '[data-feed-attach-remove]', 'click', function (e) {
      removeAttachment(e.currentTarget.getAttribute('data-feed-attach-remove'));
    });

    /* Poll builder */
    each(root, M, '[data-feed-toggle-poll]', 'click', function () {
      if (!state.composer) return;
      state.composer.poll = state.composer.poll ? null : blankPoll();
      if (state.composer.poll) state.composer.type = 'poll';
      render();
    });

    each(root, M, '[data-feed-poll-question]', 'input', function (e) {
      if (state.composer && state.composer.poll) state.composer.poll.question = e.currentTarget.value;
    });

    each(root, M, '[data-feed-poll-option]', 'input', function (e) {
      var index = parseInt(e.currentTarget.getAttribute('data-feed-poll-option'), 10);
      if (state.composer && state.composer.poll) state.composer.poll.options[index] = e.currentTarget.value;
    });

    each(root, M, '[data-feed-poll-add]', 'click', function () {
      if (!state.composer || !state.composer.poll) return;
      state.composer.poll.options.push('');
      render();
    });

    each(root, M, '[data-feed-poll-remove]', 'click', function (e) {
      var index = parseInt(e.currentTarget.getAttribute('data-feed-poll-remove'), 10);
      if (!state.composer || !state.composer.poll) return;
      state.composer.poll.options.splice(index, 1);
      render();
    });

    each(root, M, '[data-feed-poll-multiple]', 'change', function (e) {
      if (state.composer && state.composer.poll) state.composer.poll.multipleChoice = e.currentTarget.checked;
    });
    each(root, M, '[data-feed-poll-anonymous]', 'change', function (e) {
      if (state.composer && state.composer.poll) state.composer.poll.anonymous = e.currentTarget.checked;
    });
    each(root, M, '[data-feed-poll-hide]', 'change', function (e) {
      if (state.composer && state.composer.poll) state.composer.poll.hideResults = e.currentTarget.checked;
    });
    each(root, M, '[data-feed-poll-closes]', 'change', function (e) {
      if (state.composer && state.composer.poll) state.composer.poll.closesAt = e.currentTarget.value;
    });

    /* Options panel */
    each(root, M, '[data-feed-toggle-options]', 'click', function () {
      if (!state.composer) return;
      state.composer.showOptions = !state.composer.showOptions;
      render();
    });

    each(root, M, '[data-feed-scheduled]', 'change', function (e) {
      if (state.composer) {
        state.composer.scheduledFor = e.currentTarget.value;
        // Switching the primary button between Post and Schedule.
        render();
      }
    });

    each(root, M, '[data-feed-expires]', 'change', function (e) {
      if (state.composer) state.composer.expiresAt = e.currentTarget.value;
    });

    each(root, M, '[data-feed-requires-ack]', 'change', function (e) {
      if (state.composer) state.composer.requiresAcknowledgement = e.currentTarget.checked;
    });

    each(root, M, '[data-feed-email-audience]', 'change', function (e) {
      if (state.composer) state.composer.emailAudience = e.currentTarget.value;
    });

    each(root, M, '[data-feed-notify-portal]', 'change', function (e) {
      if (state.composer) state.composer.notifyPortal = e.currentTarget.checked;
    });

    each(root, M, '[data-feed-emoji]', 'click', function () {
      insertAtCaret(pickQuickEmoji());
    });

    /* Submit */
    each(root, M, '[data-feed-save-draft]', 'click', function () { submitComposer('draft'); });
    each(root, M, '[data-feed-schedule]', 'click', function () { submitComposer('scheduled'); });
    each(root, M, '[data-feed-publish]', 'click', function () { submitComposer('published'); });
  }

  function blankPoll() {
    return {
      question: '', options: ['', ''],
      multipleChoice: false, anonymous: false, hideResults: false, closesAt: '',
    };
  }

  function openComposer(post) {
    state.composer = post
      ? {
        id: post.id,
        wasPublished: post.status === 'published',
        channelId: post.channel && post.channel.id,
        type: post.type,
        title: post.title || '',
        body: post.body || '',
        attachments: (post.attachments || []).slice(),
        poll: post.poll
          ? {
            question: post.poll.question,
            options: post.poll.options.map(function (o) { return o.label; }),
            multipleChoice: post.poll.multipleChoice,
            anonymous: post.poll.anonymous,
            hideResults: !post.poll.resultsVisible,
            closesAt: toLocalInput(post.poll.closesAt),
          }
          : null,
        scheduledFor: toLocalInput(post.scheduledFor),
        expiresAt: toLocalInput(post.expiresAt),
        requiresAcknowledgement: post.requiresAcknowledgement,
        emailAudience: (post.email && post.email.audience) || 'none',
        notifyPortal: true,
        timezone: post.timezone || localZone(),
        showOptions: !!(post.scheduledFor || post.requiresAcknowledgement),
        attachmentsIds: (post.attachments || []).map(function (a) { return a.id; }),
      }
      : {
        id: null,
        channelId: state.channelId || '',
        type: 'discussion',
        body: '',
        attachments: [],
        uploads: [],
        poll: null,
        emailAudience: 'none',
        notifyPortal: true,
        timezone: localZone(),
        showOptions: false,
      };

    if (!state.composer.uploads) state.composer.uploads = [];
    render();
  }

  /* A datetime-local input wants "YYYY-MM-DDTHH:MM" in local time. */
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* And the server wants an ISO instant back. */
  function fromLocalInput(value) {
    if (!value) return null;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function applyFormat(command) {
    var editor = state.el && state.el.querySelector('[data-feed-editor]');
    if (editor) editor.focus();

    if (command === 'createLink') {
      var url = window.prompt('Link address');
      if (!url) return;
      document.execCommand('createLink', false, url);
      return;
    }

    if (command.indexOf('formatBlock:') === 0) {
      document.execCommand('formatBlock', false, command.split(':')[1]);
      return;
    }

    document.execCommand(command, false, null);
    if (state.composer && editor) state.composer.body = editor.innerHTML;
  }

  function insertAtCaret(text) {
    if (!text) return;
    var editor = state.el && state.el.querySelector('[data-feed-editor]');
    if (!editor) return;
    editor.focus();
    document.execCommand('insertText', false, text);
    if (state.composer) state.composer.body = editor.innerHTML;
  }

  function pickQuickEmoji() {
    // The portal's emoji catalogue when it is loaded; otherwise a small set,
    // so the button always does something rather than silently failing.
    var data = window.TMAEmojiData;
    if (data && data.all && data.all.length) return data.all[0].char || '🙂';
    return '🙂';
  }

  function handleEditorKeys(e, editor) {
    if (handleMentionKeys(e, 'post')) return;

    // Ctrl/Cmd+Enter posts, which is what every other composer here does.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submitComposer(state.composer && state.composer.scheduledFor ? 'scheduled' : 'published');
    }
  }

  /* Arrow, Enter, Tab and Escape while the autocomplete for `host` is open. */
  function handleMentionKeys(e, host) {
    var mention = state.mention;
    if (!mention || mention.host !== host || !mention.results || !mention.results.length) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mention.index = ((mention.index || 0) + 1) % mention.results.length;
      render();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      mention.index = ((mention.index || 0) - 1 + mention.results.length) % mention.results.length;
      render();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pickMention(mention.index || 0);
      return true;
    }
    if (e.key === 'Escape') {
      state.mention = null;
      render();
      return true;
    }
    return false;
  }

  /*
   * Watch for an @ or # being typed and open the right autocomplete (§16, §17).
   *
   * The trigger is read from the text immediately before the caret rather than
   * from the whole body, so a '#' that was typed ten minutes ago does not
   * reopen the menu every time someone types elsewhere.
   */
  var mentionRequest = null;

  function detectMentionTrigger(editor, host, channelId) {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    var node = selection.anchorNode;
    if (!node || node.nodeType !== 3 || !editor.contains(node)) { closeMention(); return; }

    var before = node.textContent.slice(0, selection.anchorOffset);
    var match = before.match(/(^|\s)([@#])([\w\-]*)$/);

    if (!match) { closeMention(); return; }

    var kind = match[2] === '@' ? 'user' : 'hashtag';
    var term = match[3];

    // A hashtag indexes posts; a comment only ever names people.
    if (kind === 'hashtag' && host !== 'post') { closeMention(); return; }

    var current = state.mention && state.mention.host === host ? state.mention : {};
    state.mention = Object.assign(current, { host: host, el: editor, kind: kind, term: term, index: 0 });

    if (mentionRequest && mentionRequest.abort) mentionRequest.abort();
    var controller = window.AbortController ? new AbortController() : null;
    mentionRequest = controller;

    var request = kind === 'hashtag'
      ? API.hashtags(term, controller && controller.signal)
      : API.mentionable(term, channelId || '', controller && controller.signal);

    request
      .then(function (data) {
        if (!state.mention || state.mention.host !== host || state.mention.term !== term) return;
        state.mention.results = data.results || [];
        render();
      })
      .catch(function () { /* an aborted or failed lookup just shows nothing */ });
  }

  function closeMention() {
    if (state.mention) {
      state.mention = null;
      render();
    }
  }

  /*
   * Replace the typed trigger with a marker span.
   *
   * The marker is what the server reads on the way in, see
   * FeedContent::mentionTokens, so the identity stored is the one that was
   * picked, not a name that might match two people.
   */
  function pickMention(index) {
    var mention = state.mention;
    if (!mention || !mention.results) return;

    var item = mention.results[index];
    if (!item) return;

    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    var range = selection.getRangeAt(0);
    var node = range.startContainer;
    if (node.nodeType !== 3) return;

    var before = node.textContent.slice(0, range.startOffset);
    var match = before.match(/(^|\s)([@#])([\w\-]*)$/);
    if (!match) return;

    // Select the trigger text so it is replaced rather than appended to.
    // The caret is read first: once setStart has moved the range, its
    // startOffset *is* the new start, and ending there deletes nothing —
    // which is how "@Bea" used to stay behind the token it had just become.
    var caret = range.startOffset;
    var start = before.length - (match[2] + match[3]).length;
    range.setStart(node, start);
    range.setEnd(node, caret);
    range.deleteContents();

    var span = document.createElement('span');
    if (mention.kind === 'hashtag') {
      span.setAttribute('data-hashtag', item.tag);
      span.className = 'tma-feed-hashtag';
      span.textContent = '#' + item.tag;
    } else {
      span.setAttribute('data-mention', item.token);
      span.className = 'tma-feed-mention';
      span.textContent = '@' + item.name;
    }

    range.insertNode(span);

    // A trailing space, so the next word is not swallowed into the marker.
    var spacer = document.createTextNode(' ');
    span.parentNode.insertBefore(spacer, span.nextSibling);

    range.setStartAfter(spacer);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    if (mention.host === 'post' && state.composer) {
      var editor = state.el.querySelector('[data-feed-editor]');
      if (editor) state.composer.body = editor.innerHTML;
    }

    state.mention = null;
    render();
  }

  /* ── attachments ─────────────────────────────────────────── */

  function uploadFiles(files) {
    var composer = state.composer;
    if (!composer || !files.length) return;

    var channelId = composer.channelId || state.channelId;
    if (!channelId) {
      composer.error = 'Choose a channel before attaching files.';
      render();
      return;
    }

    files.forEach(function (file) {
      var upload = { name: file.name, percent: 0, preview: null };

      // A photo shows itself straight away, from the local bytes, rather
      // than as a name with a bar under it.
      if (/^image\//.test(file.type) && window.URL && window.URL.createObjectURL) {
        try { upload.preview = window.URL.createObjectURL(file); } catch (e) { upload.preview = null; }
      }

      composer.uploads.push(upload);
      render();

      var settle = function () {
        composer.uploads.splice(composer.uploads.indexOf(upload), 1);
        if (upload.preview) {
          try { window.URL.revokeObjectURL(upload.preview); } catch (e) { /* already gone */ }
        }
      };

      API.uploadAttachment(channelId, file, function (percent) {
        upload.percent = percent;
        render();
      })
        .then(function (data) {
          settle();

          // The composer this upload belonged to was closed meanwhile: the
          // staged file has no post to join, so it is let go.
          if (state.composer !== composer) {
            API.deleteAttachment(data.attachment.id).catch(function () {});
            return;
          }

          composer.attachments.push(data.attachment);
          render();
          flushPendingSubmit(composer);
        })
        .catch(function (err) {
          settle();
          if (state.composer !== composer) return;
          composer.error = err.message;
          composer.pendingSubmit = null;
          composer.busy = false;
          render();
        });
    });
  }

  /*
   * Post was pressed while a file was still uploading: the post waited for
   * it. Once the last upload lands, the submit that was queued goes ahead
   * with every attachment on it.
   */
  function flushPendingSubmit(composer) {
    if (!composer.pendingSubmit || composer.uploads.length) return;

    var status = composer.pendingSubmit;
    composer.pendingSubmit = null;
    composer.busy = false;
    submitComposer(status);
  }

  function removeAttachment(id) {
    var composer = state.composer;
    if (!composer) return;

    composer.attachments = composer.attachments.filter(function (file) { return file.id !== id; });
    render();

    // Best effort: the row is a staged file the prune would collect anyway.
    API.deleteAttachment(id).catch(function () {});
  }

  /* ── autosave (§5) ───────────────────────────────────────── */

  var autosaveTimer = null;

  function queueAutosave() {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(autosaveDraft, AUTOSAVE_MS);
  }

  /*
   * Autosave only touches a draft that already exists on the server.
   *
   * Creating one on the first keystroke would fill the Drafts view with
   * abandoned single-character posts, so the first save is the deliberate one
   *, "Save draft", and the timer keeps it current from then on.
   */
  function autosaveDraft() {
    var composer = state.composer;
    if (!composer || !composer.id || composer.wasPublished || composer.busy) return;

    composer.saving = true;
    render();

    API.autosave(composer.id, { body: composer.body || '', title: composer.title || null })
      .then(function (data) {
        composer.saving = false;
        composer.savedAt = data.savedAt;
        render();
      })
      .catch(function () {
        composer.saving = false;
        render();
      });
  }

  /* ── submitting a post ───────────────────────────────────── */

  function submitComposer(status) {
    var composer = state.composer;
    if (!composer || composer.busy) return;

    var editor = state.el && state.el.querySelector('[data-feed-editor]');
    if (editor) composer.body = editor.innerHTML;

    var channelId = composer.channelId || state.channelId;

    if (!channelId && !composer.id) {
      composer.error = 'Choose a channel first.';
      render();
      return;
    }

    if (composer.poll) {
      var filled = composer.poll.options.filter(function (option) { return option.trim(); });
      if (!composer.poll.question.trim() || filled.length < 2) {
        composer.error = 'A poll needs a question and at least two options.';
        render();
        return;
      }
    }

    // A file still on its way up would be left behind: this used to publish
    // the post at once and the photo, arriving a moment later, had nothing
    // to attach to. The submit now waits for the upload and then runs.
    if (composer.uploads && composer.uploads.length) {
      composer.pendingSubmit = status;
      composer.busy = true;
      composer.error = null;
      render();
      return;
    }

    var payload = {
      type: composer.type,
      title: composer.title || null,
      body: composer.body || '',
      status: status,
      scheduledFor: status === 'scheduled' ? fromLocalInput(composer.scheduledFor) : null,
      timezone: composer.timezone || localZone(),
      requiresAcknowledgement: !!composer.requiresAcknowledgement,
      expiresAt: fromLocalInput(composer.expiresAt),
      emailAudience: composer.emailAudience || 'none',
      notifyPortal: composer.notifyPortal !== false,
      attachments: (composer.attachments || []).map(function (file) { return file.id; }),
      poll: composer.poll
        ? {
          question: composer.poll.question,
          options: composer.poll.options.filter(function (o) { return o.trim(); }),
          multipleChoice: !!composer.poll.multipleChoice,
          anonymous: !!composer.poll.anonymous,
          hideResults: !!composer.poll.hideResults,
          closesAt: fromLocalInput(composer.poll.closesAt),
        }
        : null,
    };

    composer.busy = true;
    composer.error = null;
    render();

    // The channel is only sent on create, a post never changes channel, and
    // the server refuses the field on update for exactly that reason.
    var request = composer.id
      ? API.updatePost(composer.id, payload)
      : API.createPost(Object.assign({ channelId: channelId }, payload));

    request
      .then(function (data) {
        state.composer = null;
        upsertPost(data.post, true);

        toast(
          status === 'draft' ? 'Draft saved'
            : status === 'scheduled' ? 'Scheduled' : 'Posted',
          'success'
        );

        // A draft or scheduled post does not belong in the published stream,
        // and a published one does, so the list is only refetched when the
        // post would not otherwise be where the reader is looking.
        if (status !== 'published' || state.view !== 'all') loadPosts(false);
        else refreshChannelCounts();
      })
      .catch(function (err) {
        composer.busy = false;
        composer.error = err.message;
        render();
      });
  }

  /*
   * Put a post into the stream, or replace the copy already there.
   *
   * This is what keeps §22 true: a new or edited post patches into place, and
   * the rest of the feed is not touched.
   */
  function upsertPost(post, prepend) {
    if (!post) return;

    for (var i = 0; i < state.posts.length; i++) {
      if (state.posts[i].id === post.id) {
        state.posts[i] = post;
        render();
        return;
      }
    }

    for (var j = 0; j < state.pinned.length; j++) {
      if (state.pinned[j].id === post.id) {
        state.pinned[j] = post;
        render();
        return;
      }
    }

    if (prepend && post.status === 'published' && belongsInCurrentView(post)) {
      state.posts.unshift(post);
    }

    render();
  }

  /* Would this post be in the list the reader is currently looking at? */
  function belongsInCurrentView(post) {
    if (state.channelId) return post.channel && post.channel.id === state.channelId;
    return state.view === 'all' || state.view === 'mine';
  }

  function removePost(id) {
    if (state.gallery && state.gallery.postId === id) {
      state.gallery = null;
      document.documentElement.classList.remove('tma-feed-gallery-open');
    }
    state.posts = state.posts.filter(function (post) { return post.id !== id; });
    state.pinned = state.pinned.filter(function (post) { return post.id !== id; });
    delete state.comments[id];
    render();
  }

  function refreshChannelCounts() {
    API.channels({ includeArchived: true })
      .then(function (data) {
        state.channels = data.channels || [];
        state.can = data.can || {};
        if (state.channelId) state.channel = findChannel(state.channelId);
        render();
      })
      .catch(function () {});
  }

  function replaceChannel(channel) {
    if (!channel) return;

    var found = false;
    state.channels = state.channels.map(function (existing) {
      if (existing.id !== channel.id) return existing;
      found = true;
      return channel;
    });

    if (!found) state.channels.push(channel);
    if (state.channelId === channel.id) state.channel = channel;

    render();
  }

  function fail(err) {
    if (err && err.gone) {
      toast('That is no longer available.', 'neutral');
      loadChannels().then(function () { loadPosts(false); });
      return;
    }
    toast((err && err.message) || 'Something went wrong.', 'error');
    render();
  }

  /* ── post actions ────────────────────────────────────────── */

  function wirePosts(root, M) {
    each(root, M, '[data-feed-menu]', 'click', function (e) {
      e.stopPropagation();
      var id = e.currentTarget.getAttribute('data-feed-menu');
      state.menuFor = state.menuFor === id ? null : id;
      render();
    });

    each(root, M, '[data-feed-react-open]', 'click', function (e) {
      e.stopPropagation();
      var id = e.currentTarget.getAttribute('data-feed-react-open');
      state.reactionPicker = state.reactionPicker === id ? null : id;
      render();
    });

    each(root, M, '[data-feed-react]', 'click', function (e) {
      react(
        e.currentTarget.getAttribute('data-feed-react-post'),
        e.currentTarget.getAttribute('data-feed-react')
      );
    });

    each(root, M, '[data-feed-reaction-people]', 'click', function (e) {
      openReactionPeople(e.currentTarget.getAttribute('data-feed-reaction-people'));
    });

    each(root, M, '[data-feed-bookmark]', 'click', function (e) {
      toggleBookmark(e.currentTarget.getAttribute('data-feed-bookmark'));
    });

    each(root, M, '[data-feed-pin]', 'click', function (e) {
      var id = e.currentTarget.getAttribute('data-feed-pin');
      state.menuFor = null;
      API.togglePin(id)
        .then(function (data) {
          upsertPost(data.post);
          // Pinning changes the pinned band, which is a separate list.
          if (state.channelId) loadPosts(false);
        })
        .catch(fail);
    });

    each(root, M, '[data-feed-lock]', 'click', function (e) {
      var id = e.currentTarget.getAttribute('data-feed-lock');
      state.menuFor = null;
      API.toggleLock(id).then(function (data) { upsertPost(data.post); }).catch(fail);
    });

    each(root, M, '[data-feed-edit]', 'click', function (e) {
      var id = e.currentTarget.getAttribute('data-feed-edit');
      state.menuFor = null;
      var post = findPost(id);
      if (post) openComposer(post);
    });

    each(root, M, '[data-feed-duplicate]', 'click', function (e) {
      var id = e.currentTarget.getAttribute('data-feed-duplicate');
      state.menuFor = null;
      API.duplicatePost(id)
        .then(function () { toast('Duplicated as a draft', 'success'); })
        .catch(fail);
    });

    each(root, M, '[data-feed-delete]', 'click', function (e) {
      var id = e.currentTarget.getAttribute('data-feed-delete');
      state.menuFor = null;
      state.modal = {
        kind: 'confirm',
        title: 'Delete post',
        message: 'This removes the post and its comments. It cannot be undone from here.',
        confirmLabel: 'Delete',
        onConfirm: function () {
          API.deletePost(id)
            .then(function () {
              removePost(id);
              state.modal = null;
              toast('Post deleted', 'success');
              refreshChannelCounts();
            })
            .catch(fail);
        },
      };
      render();
    });

    each(root, M, '[data-feed-publish-now]', 'click', function (e) {
      var id = e.currentTarget.getAttribute('data-feed-publish-now');
      API.publishPost(id)
        .then(function (data) {
          toast('Published', 'success');
          // It has left drafts/scheduled, so those lists are refetched.
          if (state.view === 'drafts' || state.view === 'scheduled') loadPosts(false);
          else upsertPost(data.post);
          refreshChannelCounts();
        })
        .catch(fail);
    });

    each(root, M, '[data-feed-cancel-schedule]', 'click', function (e) {
      var id = e.currentTarget.getAttribute('data-feed-cancel-schedule');
      // Back to a draft rather than deleted: cancelling a schedule should
      // never lose what was written.
      API.updatePost(id, { status: 'draft' })
        .then(function () {
          toast('Moved back to drafts', 'success');
          loadPosts(false);
        })
        .catch(fail);
    });

    each(root, M, '[data-feed-acknowledge]', 'click', function (e) {
      var id = e.currentTarget.getAttribute('data-feed-acknowledge');
      var post = findPost(id);

      // Optimistic: the confirmation is the point, and a failure re-renders.
      if (post) { post.acknowledged = true; render(); }

      API.acknowledge(id)
        .then(function () { toast('Acknowledged', 'success'); })
        .catch(function (err) {
          if (post) post.acknowledged = false;
          fail(err);
        });
    });

    each(root, M, '[data-feed-ack-stats]', 'click', function (e) {
      var id = e.currentTarget.getAttribute('data-feed-ack-stats');
      state.menuFor = null;
      state.modal = { kind: 'acks', title: 'Acknowledgements', loading: true };
      render();

      API.acknowledgements(id)
        .then(function (data) {
          state.modal = Object.assign({ kind: 'acks', title: 'Acknowledgements' }, data);
          render();
        })
        .catch(function (err) {
          state.modal = { kind: 'acks', title: 'Acknowledgements', error: err.message };
          render();
        });
    });

    each(root, M, '[data-feed-copy-link]', 'click', function (e) {
      var id = e.currentTarget.getAttribute('data-feed-copy-link');
      state.menuFor = null;
      copyLink(id);
    });

    /* Polls */
    each(root, M, '[data-feed-vote]', 'click', function (e) {
      vote(
        e.currentTarget.getAttribute('data-feed-vote-post'),
        e.currentTarget.getAttribute('data-feed-vote')
      );
    });

    each(root, M, '[data-feed-close-poll]', 'click', function (e) {
      var id = e.currentTarget.getAttribute('data-feed-close-poll');
      state.menuFor = null;
      API.closePoll(id)
        .then(function (data) {
          var post = findPost(id);
          if (post) { post.poll = data.poll; render(); }
        })
        .catch(fail);
    });

    each(root, M, '[data-feed-poll-voters]', 'click', function (e) {
      var id = e.currentTarget.getAttribute('data-feed-poll-voters');
      state.modal = { kind: 'voters', title: 'Who voted', loading: true };
      render();

      API.pollVoters(id)
        .then(function (data) {
          state.modal = { kind: 'voters', title: 'Who voted', options: data.options };
          render();
        })
        .catch(function (err) {
          state.modal = { kind: 'voters', title: 'Who voted', error: err.message };
          render();
        });
    });

    each(root, M, '[data-feed-lightbox]', 'click', function (e) {
      // The chip's corner download arrow keeps its own meaning.
      if (e.target.closest('[data-feed-file-download]')) return;
      openLightbox(
        e.currentTarget.getAttribute('data-feed-post-ref'),
        e.currentTarget.getAttribute('data-feed-lightbox')
      );
    });

    // The document chips are divs (they hold a download anchor, which a
    // button may not), so Enter/Space has to be wired by hand.
    each(root, M, '[data-feed-lightbox][role="button"]', 'keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openLightbox(
        e.currentTarget.getAttribute('data-feed-post-ref'),
        e.currentTarget.getAttribute('data-feed-lightbox')
      );
    });
  }

  function findPost(id) {
    for (var i = 0; i < state.posts.length; i++) {
      if (state.posts[i].id === id) return state.posts[i];
    }
    for (var j = 0; j < state.pinned.length; j++) {
      if (state.pinned[j].id === id) return state.pinned[j];
    }
    return null;
  }

  /*
   * React, optimistically.
   *
   * The reaction row is redrawn from the server's answer, which is what makes
   * add/change/remove consistent even when two tabs race, but the immediate
   * flip is what makes it feel like a button rather than a request.
   */
  function react(postId, emoji) {
    var post = findPost(postId);
    state.reactionPicker = null;

    if (post && post.reactions) {
      var was = post.reactions.mine;
      post.reactions.mine = was === emoji ? null : emoji;
      post.reactions.total = Math.max(
        0,
        (post.reactions.total || 0) + (was === emoji ? -1 : (was ? 0 : 1))
      );
    }

    render();

    API.reactToPost(postId, emoji)
      .then(function (data) {
        var target = findPost(postId);
        if (target) { target.reactions = data.reactions; render(); }
      })
      .catch(fail);
  }

  function toggleBookmark(postId) {
    var post = findPost(postId);
    state.menuFor = null;

    if (post) { post.bookmarked = !post.bookmarked; render(); }

    API.toggleBookmark(postId)
      .then(function (data) {
        var target = findPost(postId);
        if (target) target.bookmarked = data.bookmarked;

        // In the bookmarks view, un-bookmarking removes the card.
        if (state.view === 'bookmarks' && !data.bookmarked) removePost(postId);
        else render();
      })
      .catch(function (err) {
        if (post) post.bookmarked = !post.bookmarked;
        fail(err);
      });
  }

  function vote(postId, optionId) {
    var post = findPost(postId);
    if (!post || !post.poll) return;

    var poll = post.poll;
    var chosen = poll.options
      .filter(function (option) { return option.chosen; })
      .map(function (option) { return option.id; });

    var next;
    if (poll.multipleChoice) {
      next = chosen.indexOf(optionId) !== -1
        ? chosen.filter(function (id) { return id !== optionId; })
        : chosen.concat([optionId]);
    } else {
      // Tapping the option already held withdraws the vote.
      next = chosen.length === 1 && chosen[0] === optionId ? [] : [optionId];
    }

    API.vote(postId, next)
      .then(function (data) {
        var target = findPost(postId);
        if (target) { target.poll = data.poll; render(); }
      })
      .catch(fail);
  }

  function openReactionPeople(postId) {
    state.modal = { kind: 'reactions', title: 'Reactions', loading: true };
    render();

    API.reactionPeople(postId)
      .then(function (data) {
        state.modal = { kind: 'reactions', title: 'Reactions', groups: data.groups };
        render();
      })
      .catch(function (err) {
        state.modal = { kind: 'reactions', title: 'Reactions', error: err.message };
        render();
      });
  }

  function copyLink(postId) {
    var url = window.location.origin + '/social/feed?post=' + encodeURIComponent(postId);

    // Taking the link is the share; the count is best-effort and never blocks
    // the copy, which is the thing the person actually asked for.
    API.share(postId)
      .then(function (data) {
        var post = findPost(postId);
        if (post) { post.counts.shares = data.shares; render(); }
      })
      .catch(function () {});

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(function () { toast('Link copied', 'success'); })
        .catch(function () { toast(url, 'neutral'); });
      return;
    }

    toast(url, 'neutral');
  }

  /* The set is whichever list the clicked file lives in, the post's
   * attachments, or one comment's, so prev/next stays within that context. */
  function lightboxSetFor(post, attachmentId) {
    var has = function (files) {
      return (files || []).some(function (f) { return f.id === attachmentId; });
    };

    if (has(post.attachments)) return post.attachments;

    var thread = state.comments[post.id];
    var items = (thread && thread.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (has(items[i].attachments)) return items[i].attachments;
      var replies = items[i].replies || [];
      for (var j = 0; j < replies.length; j++) {
        if (has(replies[j].attachments)) return replies[j].attachments;
      }
    }
    return null;
  }

  function openLightbox(postId, attachmentId) {
    openGallery(postId, attachmentId);
  }

  function openPostById(postId) {
    API.post(postId)
      .then(function (data) {
        var post = data.post;

        // Jump to the channel it lives in, then scroll the card into view.
        if (post.channel && post.channel.id !== state.channelId) {
          openChannel(post.channel.id);
        }

        state.searchResults = null;
        upsertPost(post, true);

        window.requestAnimationFrame(function () {
          var card = state.el && state.el.querySelector('[data-feed-post="' + post.id + '"]');
          if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      })
      .catch(fail);
  }

  /* ── comments wiring ─────────────────────────────────────── */

  function wireComments(root, M) {
    each(root, M, '[data-feed-comments]', 'click', function (e) {
      toggleComments(e.currentTarget.getAttribute('data-feed-comments'));
    });

    each(root, M, '[data-feed-comment-send]', 'click', function (e) {
      var box = e.currentTarget.closest('.tma-dash__feed-comment-composer');
      sendComment(
        e.currentTarget.getAttribute('data-feed-comment-send'),
        box && box.querySelector('[data-feed-comment-input]')
      );
    });

    each(root, M, '[data-feed-comment-input]', 'keydown', function (e) {
      var postId = e.currentTarget.getAttribute('data-feed-comment-input');
      if (handleMentionKeys(e, 'comment:' + postId)) return;

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendComment(postId, e.currentTarget);
      }
    });

    // @ in a comment offers the same people the post editor does.
    each(root, M, '[data-feed-comment-input]', 'input', function (e) {
      var postId = e.currentTarget.getAttribute('data-feed-comment-input');
      var post = findPost(postId);
      detectMentionTrigger(
        e.currentTarget,
        'comment:' + postId,
        (post && post.channel && post.channel.id) || state.channelId || ''
      );
    });

    each(root, M, '[data-feed-reply]', 'click', function (e) {
      var postId = e.currentTarget.getAttribute('data-feed-reply-post');
      var thread = state.comments[postId];
      if (!thread) return;
      thread.replyTo = e.currentTarget.getAttribute('data-feed-reply');
      render();
      focusCommentInput(postId);
    });

    each(root, M, '[data-feed-reply-cancel]', 'click', function (e) {
      var postId = e.currentTarget.getAttribute('data-feed-reply-cancel');
      if (state.comments[postId]) state.comments[postId].replyTo = null;
      render();
    });

    each(root, M, '[data-feed-comment-react-open]', 'click', function (e) {
      e.stopPropagation();
      var key = 'c:' + e.currentTarget.getAttribute('data-feed-comment-react-open');
      state.reactionPicker = state.reactionPicker === key ? null : key;
      render();
    });

    each(root, M, '[data-feed-comment-react]', 'click', function (e) {
      var commentId = e.currentTarget.getAttribute('data-feed-comment-react-id');
      var postId = e.currentTarget.getAttribute('data-feed-comment-post');
      var emoji = e.currentTarget.getAttribute('data-feed-comment-react');
      state.reactionPicker = null;
      render();

      API.reactToComment(commentId, emoji)
        .then(function (data) { replaceComment(postId, data.comment); })
        .catch(fail);
    });

    each(root, M, '[data-feed-comment-edit]', 'click', function (e) {
      var commentId = e.currentTarget.getAttribute('data-feed-comment-edit');
      var postId = e.currentTarget.getAttribute('data-feed-comment-post');
      var comment = findComment(postId, commentId);
      if (!comment) return;

      // A prompt rather than an inline editor: comments are short, and an
      // inline editor here would need its own mention handling to be honest.
      var next = window.prompt('Edit comment', stripHtml(comment.body));
      if (next === null) return;

      API.updateComment(commentId, '<p>' + escapeForHtml(next) + '</p>')
        .then(function (data) { replaceComment(postId, data.comment); })
        .catch(fail);
    });

    each(root, M, '[data-feed-comment-delete]', 'click', function (e) {
      var commentId = e.currentTarget.getAttribute('data-feed-comment-delete');
      var postId = e.currentTarget.getAttribute('data-feed-comment-post');

      state.modal = {
        kind: 'confirm',
        title: 'Delete comment',
        message: 'This removes the comment and any replies to it.',
        confirmLabel: 'Delete',
        onConfirm: function () {
          API.deleteComment(commentId)
            .then(function (data) {
              state.modal = null;
              var post = findPost(postId);
              if (post) post.counts.comments = data.commentsCount;
              loadComments(postId, true);
            })
            .catch(fail);
        },
      };
      render();
    });
  }

  function stripHtml(html) {
    var div = document.createElement('div');
    div.innerHTML = html || '';
    return div.textContent || '';
  }

  function escapeForHtml(text) {
    return esc(text).replace(/\n/g, '<br>');
  }

  function toggleComments(postId) {
    var thread = state.comments[postId];

    if (thread && thread.open) {
      thread.open = false;
      render();
      return;
    }

    state.comments[postId] = Object.assign(thread || {}, { open: true, loading: !thread || !thread.items });
    render();

    if (!thread || !thread.items) loadComments(postId, false);
  }

  function loadComments(postId, keepOpen) {
    var thread = state.comments[postId] || {};
    thread.open = keepOpen === false ? thread.open : true;
    thread.loading = true;
    state.comments[postId] = thread;
    render();

    API.comments(postId)
      .then(function (data) {
        thread.items = data.comments || [];
        thread.loading = false;
        thread.error = null;
        render();
      })
      .catch(function (err) {
        thread.loading = false;
        thread.error = err.message;
        render();
      });
  }

  /*
   * The box the caret should land in: the viewer's when it is open on this
   * post, the card's otherwise. Both carry the same data attribute, so a
   * bare query would always find the card's first.
   */
  function commentInputFor(postId) {
    var root = state.el;
    if (!root) return null;

    return (state.gallery && state.gallery.postId === postId
      ? root.querySelector('[data-feed-gallery] [data-feed-comment-input="' + postId + '"]')
      : null) || root.querySelector('[data-feed-comment-input="' + postId + '"]');
  }

  function focusCommentInput(postId) {
    window.requestAnimationFrame(function () {
      var input = commentInputFor(postId);
      if (input) input.focus();
    });
  }

  function sendComment(postId, input) {
    var thread = state.comments[postId];
    if (!thread || thread.sending) return;

    input = input || commentInputFor(postId);
    if (!input) return;

    var body = input.innerHTML.trim();
    if (!stripHtml(body).trim()) return;

    thread.sending = true;
    thread.sendError = null;
    render();

    API.comment(postId, { body: body, parentId: thread.replyTo || null })
      .then(function (data) {
        thread.sending = false;
        thread.replyTo = null;
        if (state.mention && state.mention.host === 'comment:' + postId) state.mention = null;
        // Cleared by hand: the input is a preserved node, so re-rendering
        // would not empty it.
        input.innerHTML = '';

        var post = findPost(postId);
        if (post) post.counts.comments = data.commentsCount;

        // Reload the thread rather than splicing: a reply has to land under
        // its parent, and the server is the one that knows where that is.
        loadComments(postId, true);
      })
      .catch(function (err) {
        thread.sending = false;
        thread.sendError = err.message;
        render();
      });
  }

  function findComment(postId, commentId) {
    var thread = state.comments[postId];
    if (!thread || !thread.items) return null;

    for (var i = 0; i < thread.items.length; i++) {
      if (thread.items[i].id === commentId) return thread.items[i];
      var replies = thread.items[i].replies || [];
      for (var j = 0; j < replies.length; j++) {
        if (replies[j].id === commentId) return replies[j];
      }
    }
    return null;
  }

  function replaceComment(postId, comment) {
    var thread = state.comments[postId];
    if (!thread || !thread.items || !comment) return;

    thread.items = thread.items.map(function (existing) {
      if (existing.id === comment.id) return Object.assign({}, comment, { replies: existing.replies });

      return Object.assign({}, existing, {
        replies: (existing.replies || []).map(function (reply) {
          return reply.id === comment.id ? comment : reply;
        }),
      });
    });

    render();
  }

  /* ── modal wiring ────────────────────────────────────────── */

  function wireModal(root, M) {
    each(root, M, '[data-feed-modal-close]', 'click', function () {
      state.modal = null;
      render();
    });

    each(root, M, '[data-feed-modal-scrim]', 'click', function (e) {
      // Only a click on the backdrop itself closes; one inside the dialog
      // bubbles up here too and must not.
      if (e.target === e.currentTarget) { state.modal = null; render(); }
    });

    each(root, M, '[data-feed-confirm]', 'click', function () {
      var action = state.modal && state.modal.onConfirm;
      if (action) action();
    });

    /* Filters */
    each(root, M, '[data-feed-filter]', 'change', function (e) {
      state.filters[e.currentTarget.getAttribute('data-feed-filter')] = e.currentTarget.value;
    });
    each(root, M, '[data-feed-filter-attachments]', 'change', function (e) {
      state.filters.hasAttachments = e.currentTarget.checked;
    });
    each(root, M, '[data-feed-filter-poll]', 'change', function (e) {
      state.filters.hasPoll = e.currentTarget.checked;
    });
    each(root, M, '[data-feed-apply-filters]', 'click', function () {
      state.modal = null;
      saveMemory();
      if (state.searchResults) runSearch();
      else loadPosts(false);
    });

    /* Channel form */
    each(root, M, '[data-feed-form]', 'input', function (e) {
      if (!state.modal || !state.modal.form) return;
      state.modal.form[e.currentTarget.getAttribute('data-feed-form')] = e.currentTarget.value;
    });
    each(root, M, '[data-feed-form]', 'change', function (e) {
      if (!state.modal || !state.modal.form) return;
      state.modal.form[e.currentTarget.getAttribute('data-feed-form')] = e.currentTarget.value;
    });

    each(root, M, '[data-feed-form-colour]', 'click', function (e) {
      if (!state.modal || !state.modal.form) return;
      state.modal.form.colour = e.currentTarget.getAttribute('data-feed-form-colour');
      render();
    });

    each(root, M, '[data-feed-form-icon]', 'click', function (e) {
      if (!state.modal || !state.modal.form) return;
      state.modal.form.icon = e.currentTarget.getAttribute('data-feed-form-icon');
      render();
    });

    each(root, M, '[data-feed-channel-save]', 'click', saveChannel);

    each(root, M, '[data-feed-channel-avatar]', 'change', function (e) {
      uploadChannelImage('avatar', e.currentTarget.files && e.currentTarget.files[0]);
    });
    each(root, M, '[data-feed-channel-cover]', 'change', function (e) {
      uploadChannelImage('cover', e.currentTarget.files && e.currentTarget.files[0]);
    });

    each(root, M, '[data-feed-channel-archive]', 'click', function () {
      var id = state.modal && state.modal.channelId;
      var channel = id && findChannel(id);
      if (!channel) return;

      var request = channel.isArchived ? API.restoreChannel(id) : API.archiveChannel(id);
      request
        .then(function (data) {
          replaceChannel(data.channel);
          state.modal = null;
          toast(data.channel.isArchived ? 'Channel archived' : 'Channel restored', 'success');
        })
        .catch(fail);
    });

    each(root, M, '[data-feed-channel-delete]', 'click', function () {
      var id = state.modal && state.modal.channelId;
      if (!id) return;

      state.modal = {
        kind: 'confirm',
        title: 'Delete channel',
        message: 'This removes the channel and hides its posts. Archiving keeps them readable instead.',
        confirmLabel: 'Delete channel',
        onConfirm: function () {
          API.deleteChannel(id)
            .then(function () {
              state.modal = null;
              state.channelId = null;
              state.channel = null;
              state.view = 'all';
              saveMemory();
              return loadChannels().then(function () { loadPosts(false); });
            })
            .catch(fail);
        },
      };
      render();
    });

    each(root, M, '[data-feed-channel-members]', 'click', function () {
      openMembers(state.modal && state.modal.channelId);
    });

    /* Members */
    each(root, M, '[data-feed-member-search]', 'input', function (e) {
      searchCandidates(e.currentTarget.value);
    });

    each(root, M, '[data-feed-member-add]', 'click', function (e) {
      var token = e.currentTarget.getAttribute('data-feed-member-add');
      if (token.indexOf('user:') !== 0) return;

      var userId = parseInt(token.slice(5), 10);
      var channelId = state.modal && state.modal.channelId;
      if (!channelId || !userId) return;

      API.addMembers(channelId, [userId])
        .then(function (data) {
          replaceChannel(data.channel);
          state.modal.candidates = [];
          openMembers(channelId);
        })
        .catch(fail);
    });

    each(root, M, '[data-feed-member-role]', 'change', function (e) {
      var userId = parseInt(e.currentTarget.getAttribute('data-feed-member-role'), 10);
      var channelId = state.modal && state.modal.channelId;
      if (!channelId) return;

      API.updateMember(channelId, userId, e.currentTarget.value)
        .then(function () { openMembers(channelId); })
        .catch(fail);
    });

    each(root, M, '[data-feed-member-remove]', 'click', function (e) {
      var userId = parseInt(e.currentTarget.getAttribute('data-feed-member-remove'), 10);
      var channelId = state.modal && state.modal.channelId;
      if (!channelId) return;

      API.removeMember(channelId, userId)
        .then(function () {
          openMembers(channelId);
          refreshChannelCounts();
        })
        .catch(fail);
    });
  }

  function openChannelForm(channelId) {
    var channel = channelId ? findChannel(channelId) : null;

    state.modal = {
      kind: 'channel',
      title: channel ? 'Channel settings' : 'New channel',
      channelId: channelId,
      form: channel
        ? {
          name: channel.name,
          description: channel.description || '',
          type: channel.type,
          visibility: channel.visibility,
          colour: channel.colour,
          icon: channel.icon,
          postPolicy: channel.policies.post,
          commentPolicy: channel.policies.comment,
          joinPolicy: channel.policies.join,
        }
        : {
          name: '', description: '', type: 'team', visibility: 'org',
          colour: 'blue', icon: 'Hash',
          postPolicy: 'member', commentPolicy: 'member', joinPolicy: 'anyone',
        },
    };

    render();
  }

  function saveChannel() {
    var modal = state.modal;
    if (!modal || modal.busy) return;

    if (!modal.form.name.trim()) {
      modal.error = 'Give the channel a name.';
      render();
      return;
    }

    modal.busy = true;
    modal.error = null;
    render();

    var payload = {
      name: modal.form.name,
      description: modal.form.description,
      visibility: modal.form.visibility,
      colour: modal.form.colour,
      icon: modal.form.icon,
      postPolicy: modal.form.postPolicy,
      commentPolicy: modal.form.commentPolicy,
      joinPolicy: modal.form.joinPolicy,
    };

    var request = modal.channelId
      ? API.updateChannel(modal.channelId, payload)
      // The type is only settable at creation: changing what a channel *is*
      // after it has posts in it would rewrite their context.
      : API.createChannel(Object.assign({ type: modal.form.type }, payload));

    request
      .then(function (data) {
        replaceChannel(data.channel);
        var isNew = !modal.channelId;
        state.modal = null;
        toast(isNew ? 'Channel created' : 'Channel updated', 'success');
        if (isNew) openChannel(data.channel.id);
        else render();
      })
      .catch(function (err) {
        modal.busy = false;
        modal.error = err.message;
        render();
      });
  }

  function uploadChannelImage(which, file) {
    var channelId = state.modal && state.modal.channelId;
    if (!channelId || !file) return;

    state.modal.busy = true;
    render();

    API.uploadChannelImage(channelId, which, file)
      .then(function (data) {
        state.modal.busy = false;
        replaceChannel(data.channel);
        toast(which === 'avatar' ? 'Picture updated' : 'Cover updated', 'success');
      })
      .catch(function (err) {
        state.modal.busy = false;
        state.modal.error = err.message;
        render();
      });
  }

  function openMembers(channelId) {
    if (!channelId) return;

    state.modal = { kind: 'members', title: 'Members', channelId: channelId, loading: true };
    render();

    API.members(channelId)
      .then(function (data) {
        state.modal = {
          kind: 'members', title: 'Members', channelId: channelId,
          members: data.members, can: data.can, candidates: [],
        };
        render();
      })
      .catch(function (err) {
        state.modal = { kind: 'members', title: 'Members', channelId: channelId, error: err.message };
        render();
      });
  }

  var candidateTimer = null;

  function searchCandidates(term) {
    window.clearTimeout(candidateTimer);

    candidateTimer = window.setTimeout(function () {
      var channelId = state.modal && state.modal.channelId;
      if (!channelId) return;

      if (!term.trim()) {
        state.modal.candidates = [];
        render();
        return;
      }

      API.mentionable(term, channelId)
        .then(function (data) {
          if (!state.modal || state.modal.kind !== 'members') return;
          // Groups cannot be channel members; only people can.
          state.modal.candidates = (data.results || []).filter(function (r) { return r.kind === 'user'; });
          render();
        })
        .catch(function () {});
    }, 250);
  }

  function openAnalytics(days) {
    state.view = 'analytics';
    state.searchResults = null;
    state.analytics = null;
    saveMemory();
    render();

    API.analytics({ channel: state.channelId || '', days: days })
      .then(function (data) { state.analytics = data; render(); })
      .catch(function (err) {
        state.analytics = { error: err.message };
        render();
      });
  }

  /* ── realtime (§22) ──────────────────────────────────────── */

  /*
   * Subscribe to the open channel's live updates.
   *
   * The event carries no content, only what changed and where, so each
   * arrival refetches exactly one post and patches it in. That is what lets a
   * comment or a reaction from someone else appear without the reader's own
   * scroll position, open composer or half-typed reply being disturbed.
   */
  var subscribedChannel = null;

  function subscribeRealtime() {
    var realtime = window.TMAMessagingRealtime;
    if (!realtime || !realtimeConfig) return;

    if (subscribedChannel && subscribedChannel !== state.channelId) {
      realtime.leave('private-feed.channel.' + subscribedChannel);
      subscribedChannel = null;
    }

    if (!state.channelId || subscribedChannel === state.channelId) return;
    if (!realtime.start(realtimeConfig)) return;

    subscribedChannel = state.channelId;

    realtime.listen('private-feed.channel.' + state.channelId, 'feed.post.changed', function (payload) {
      if (!payload || payload.channelId !== state.channelId) return;

      if (payload.action === 'deleted') {
        removePost(payload.postId);
        return;
      }

      // Only refetch what is on screen, or a genuinely new post.
      var known = findPost(payload.postId);
      if (!known && payload.action !== 'created') return;

      API.post(payload.postId)
        .then(function (data) {
          upsertPost(data.post, payload.action === 'created');

          // A comment arriving while its thread is open updates the thread too.
          var thread = state.comments[payload.postId];
          if (payload.action === 'commented' && thread && thread.open) {
            loadComments(payload.postId, true);
          }
        })
        .catch(function () {});
    });
  }

  var realtimeConfig = null;

  /*
   * One call for both the socket details and who is asking, because the
   * sidebar's memory cannot be read until the account is known.
   */
  function loadViewer() {
    return fetch((window.__TMA_SITE_ROOT || '') + '/me', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        if (data.id) viewerId = data.id;
        if (data.realtime && data.realtime.enabled) realtimeConfig = data.realtime;
      })
      .catch(function () {
        // No socket means the feed still works; it just updates on navigation.
      });
  }

  /* ── global listeners ────────────────────────────────────── */

  var globalsBound = false;

  function bindGlobals() {
    if (globalsBound) return;
    globalsBound = true;

    // A click anywhere else closes whichever popover is open. Bound once on
    // the document, because the popovers themselves are re-rendered.
    document.addEventListener('click', function (e) {
      if (!state.el) return;

      var inMenu = e.target.closest && e.target.closest('.tma-dash__feed-post-menu, .tma-dash__feed-react-picker');
      if (inMenu) return;

      if (state.menuFor || state.reactionPicker) {
        state.menuFor = null;
        state.reactionPicker = null;
        render();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (!state.el) return;

      // ←/→ step the viewer, unless the keys are being used to move a caret.
      if (state.gallery && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !state.modal) {
        var typing = e.target && e.target.closest &&
          e.target.closest('[contenteditable="true"], input, textarea, select');
        if (!typing) {
          e.preventDefault();
          stepGallery(e.key === 'ArrowLeft' ? -1 : 1);
        }
        return;
      }

      if (e.key !== 'Escape') return;

      if (state.modal) { state.modal = null; render(); return; }
      if (state.menuFor || state.reactionPicker || state.mention) {
        state.menuFor = null;
        state.reactionPicker = null;
        state.mention = null;
        render();
        return;
      }
      if (state.gallery) closeGallery();
    });

    // Leaving the page should not leave a socket subscribed to a channel
    // nobody is watching.
    window.addEventListener('beforeunload', function () {
      saveMemory();
      if (subscribedChannel && window.TMAMessagingRealtime) {
        window.TMAMessagingRealtime.leave('private-feed.channel.' + subscribedChannel);
      }
    });
  }

  /* ── mount ───────────────────────────────────────────────── */

  function mount(root) {
    if (!root) return;

    // Remounting happens on every view switch in the shell. The page is only
    // built once; after that a remount is just a re-render of live state.
    if (root._feedMounted) {
      state.el = root;
      render();
      return;
    }

    root._feedMounted = true;
    state.el = root;

    API = window.TMAFeedAPI;

    if (!API) {
      root.innerHTML =
        '<div class="tma-dash__feed-state">' +
        '<p class="tma-dash__feed-state-title">The Feed could not start</p>' +
        '<p class="tma-dash__feed-state-text">Reload the page to try again.</p></div>';
      return;
    }

    bindGlobals();

    var deepLink = readDeepLink();

    render();

    /*
     * ── Warm boot ──────────────────────────────────────────────────
     * The stream paints its kept first page while the loadViewer chain —
     * which was always going to run, fetches the truth. Gated on the
     * server not having answered yet (`state.real`), not on emptiness: a
     * dead network fills nothing but still finishes the chain. A deep link
     * skips it, someone following a notification means to land on that
     * post, and the kept page may not hold it. Mount runs well after DCL,
     * so the account scope is set and no readiness dance is needed.
     */
    if (window.TMAStore && !deepLink) {
      window.TMAStore.get('feed:warm').then(function (snap) {
        if (!snap || state.real || state.posts.length) return;
        state.channels = snap.channels || [];
        state.viewer = snap.viewer || state.viewer;
        state.channelId = snap.channelId || state.channelId;
        state.view = snap.view || state.view;
        state.channel = state.channelId ? findChannel(state.channelId) : null;
        state.posts = snap.posts || [];
        state.pinned = snap.pinned || [];
        state.loading = false;
        state.postsLoading = false;
        // The dead boot may have raced its error card in ahead of this
        // snapshot; the kept rows outrank it.
        state.error = null;
        render();
      });
    }

    // Who is asking, then what they left open, then the data. The order
    // matters: the memory is keyed by account.
    loadViewer()
      .then(function () {
        loadMemory();

        // A deep link outranks the remembered position, someone following a
        // notification means to land on that post, not where they were last.
        if (deepLink && deepLink.channel) {
          state.channelId = deepLink.channel;
          state.view = 'all';
        }

        return loadChannels();
      })
      .then(function () {
        state.loading = false;

        // A remembered channel that is still there is reopened; otherwise the
        // page falls back to the default channel or the all-channels stream.
        if (!state.channelId) {
          var preferred = state.channels.filter(function (c) { return c.isDefault && c.isMember; })[0];
          if (preferred && state.view === 'all') state.channelId = preferred.id;
        }

        state.channel = state.channelId ? findChannel(state.channelId) : null;
        subscribeRealtime();
        render();

        return loadPosts(false);
      })
      .then(function () {
        if (deepLink && deepLink.post) openPostById(deepLink.post);
      })
      .catch(function (err) {
        state.loading = false;
        // Warm rows already painted beat an error card, they are the last
        // known truth, and the failed boot that lands here offline was never
        // going to say anything truer.
        if (!state.posts.length) {
          state.error = (err && err.message) || 'The Feed could not be loaded.';
        }
        render();
      });
  }

  /*
   * The Feed's badge on the sidebar nav.
   *
   * Unread posts across every channel the reader belongs to. The shell asks
   * for this on its own schedule, so it reads what is already loaded rather
   * than fetching, a badge is not worth a request per poll.
   */
  function getUnreadCount() {
    return state.channels.reduce(function (total, channel) {
      return total + (channel.isMember ? (channel.unread || 0) : 0);
    }, 0);
  }

  /*
   * Reload the channel on screen, the shell's refresh gesture.
   *
   * mount() cannot do this: after the first visit it is only a re-render of
   * state already in memory, which is right for switching views and useless
   * for somebody asking for the latest.
   */
  function refresh() {
    if (!state.el || !API) return Promise.resolve();
    return loadChannels()
      .then(function () { return loadPosts(false); })
      .then(function () { render(); })
      .catch(function () {});
  }

  window.TMAFeed = { mount: mount, refresh: refresh, getUnreadCount: getUnreadCount };
})();
