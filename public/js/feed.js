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

  var CHANNEL_COLOURS = ['blue', 'green', 'orange', 'red', 'teal', 'pink', 'yellow', 'grey'];

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
    modal: null,          // { kind, ... } — channel form, members, analytics, ...
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

  function myAvatar() {
    var u = me();
    if (u && u.avatar) return u.avatar;
    if (window.TMACurrentUser && window.TMACurrentUser.initialsUri && u && u.name) {
      return window.TMACurrentUser.initialsUri(u.name);
    }
    return TRANSPARENT;
  }

  var TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  function avatarFor(person) {
    if (!person) return TRANSPARENT;
    if (person.photo) return person.photo;
    if (window.TMACurrentUser && window.TMACurrentUser.initialsUri && person.name) {
      return window.TMACurrentUser.initialsUri(person.name);
    }
    return TRANSPARENT;
  }

  /* A short, human time — "3m", "2h", "Mon", "4 Mar". */
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
   */
  function memoryKey() {
    var u = me();
    return 'tma.feed.' + ((u && u.id) || 'anon');
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
    // is open — otherwise the sidebar would show two things selected at once.
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
   * The cover is only drawn when the channel actually has one — an empty band
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
      mentionMenuHtml(draft) +
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
          (draft.busy ? ' disabled' : '') + '>' + (draft.id && draft.wasPublished ? 'Save changes' : 'Post') + '</button>') +
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
   * Inside a channel this is fixed and shown as a label — a picker there
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
   * deliberately keyed so morph preserves the node across renders — replacing
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
      '<div class="tma-dash__feed-editor" contenteditable="true" role="textbox" aria-multiline="true"' +
      ' data-feed-editor data-key="feed-editor" aria-label="Write your post"' +
      ' data-placeholder="Write something worth reading…"></div>' +
      '</div>'
    );
  }

  /* The @ and # autocomplete list, anchored under the caret (§16, §17). */
  function mentionMenuHtml(draft) {
    if (!draft.mention || !draft.mention.results || !draft.mention.results.length) return '';

    return (
      '<div class="tma-dash__menu tma-dash__feed-mention-menu" data-feed-mention-menu role="listbox">' +
      draft.mention.results.map(function (item, i) {
        var selected = i === (draft.mention.index || 0);

        if (draft.mention.kind === 'hashtag') {
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

  /* Staged files, with their upload progress (§18). */
  function attachmentsTrayHtml(draft) {
    var files = draft.attachments || [];
    var uploads = draft.uploads || [];

    if (!files.length && !uploads.length) return '';

    return (
      '<div class="tma-dash__feed-attach-tray">' +
      files.map(function (file) {
        return (
          '<div class="tma-dash__feed-attach" data-key="att-' + esc(file.id) + '">' +
          (file.kind === 'image' && file.thumbUrl
            ? '<img class="tma-dash__feed-attach-thumb" src="' + esc(file.thumbUrl) + '" alt="">'
            : '<span class="tma-dash__feed-attach-icon">' +
              '<img src="' + ICON + fileIcon(file) + '.svg" alt="" width="16" height="16"></span>') +
          '<span class="tma-dash__feed-attach-meta">' +
          '<span class="tma-dash__feed-attach-name">' + esc(file.name) + '</span>' +
          '<span class="tma-dash__feed-attach-size">' + esc(bytes(file.size)) + '</span>' +
          '</span>' +
          '<button type="button" class="tma-dash__feed-attach-remove" data-feed-attach-remove="' +
          esc(file.id) + '" aria-label="Remove ' + esc(file.name) + '">' +
          '<img src="' + ICON + 'X.svg" alt="" width="12" height="12"></button>' +
          '</div>'
        );
      }).join('') +
      uploads.map(function (upload) {
        return (
          '<div class="tma-dash__feed-attach tma-dash__feed-attach--uploading">' +
          '<span class="tma-dash__feed-attach-meta">' +
          '<span class="tma-dash__feed-attach-name">' + esc(upload.name) + '</span>' +
          '<span class="tma-dash__feed-attach-progress">' +
          '<span style="width:' + (upload.percent || 0) + '%"></span></span>' +
          '</span>' +
          '</div>'
        );
      }).join('') +
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
      checkboxHtml('feed-poll-multiple', 'Allow several answers', poll.multipleChoice) +
      checkboxHtml('feed-poll-anonymous', 'Hide who voted', poll.anonymous) +
      checkboxHtml('feed-poll-hide', 'Hide results until it closes', poll.hideResults) +
      '<label class="tma-dash__feed-field">' +
      '<span class="tma-dash__feed-field-label">Closes</span>' +
      '<input type="datetime-local" class="tma-dash__feed-input" data-feed-poll-closes' +
      ' value="' + esc(poll.closesAt || '') + '">' +
      '</label>' +
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
          checkboxHtml('feed-requires-ack', 'Ask people to acknowledge', draft.requiresAcknowledgement) +
          '<label class="tma-dash__feed-field">' +
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
