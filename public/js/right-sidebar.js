/*
 * TMA - Right sidebar sections (§1, §5).
 *
 * Fills the existing right sidebar's three sections — Notifications, Activities,
 * Clients — with real data from the shared stores (notifications, activity) and
 * the clients API. The layout, spacing, and card styles are untouched; only the
 * content is now live.
 *
 * Re-renders are per-section and scroll-preserving: a new notification updates
 * just that list, never the whole panel, and never resets the scroll position
 * (§25). Items are clickable and open their record in place via the shell's
 * SPA navigator (§5).
 *
 * Global: window.TMARightSidebar
 */
(function () {
  'use strict';

  var R = function () { return window.TMANotifyRender; };
  var ROOT = window.__TMA_SITE_ROOT || '';
  var SIDEBAR_LIMIT = 6;
  var CLIENTS_LIMIT = 8;

  function mount(root) {
    var rightbar = root.querySelector('.tma-dash__rightbar');
    if (!rightbar || rightbar._rbMounted) return;
    rightbar._rbMounted = true;

    // Replace the static prototype sections with live ones, leaving any resize
    // handle dashboard.js inserts as the first child in place.
    Array.prototype.slice.call(rightbar.querySelectorAll('.tma-dash__rb-section')).forEach(function (n) { n.remove(); });

    var host = document.createElement('div');
    host.className = 'tma-dash__rb-sections';
    host.setAttribute('data-rb-sections', '');
    host.innerHTML =
      section('notifications', 'Notifications') +
      section('activities', 'Activities') +
      section('clients', 'Clients');
    rightbar.appendChild(host);

    var clients = { items: [], loaded: false, loading: false, error: false, forbidden: false };
    // "See all notifications" expands the section from the compact 6 to the full
    // paginated list, in place (§6) — no separate page needed.
    var expanded = { notifications: false, activities: false };

    /* ── renderers ─────────────────────────────────────────────── */
    function bodyEl(kind) { return host.querySelector('[data-rb-body="' + kind + '"]'); }

    function withScroll(fn) {
      var top = rightbar.scrollTop;
      fn();
      rightbar.scrollTop = top;
    }

    function moreControl(kind, hasMore) {
      if (!expanded[kind] || !hasMore) return '';
      return '<button type="button" class="tma-dash__rb-more" data-rb-more="' + kind + '">Load more</button>';
    }

    function renderNotifications() {
      var el = bodyEl('notifications');
      if (!el) return;
      var s = window.TMANotifications.state;
      withScroll(function () {
        if (!s.loaded && s.loading) { el.innerHTML = R().skeleton(3); return; }
        if (s.error && !s.items.length) { el.innerHTML = R().errorState('Could not load notifications.'); return; }
        if (!s.items.length) { el.innerHTML = R().emptyState('You are all caught up.', 'Bell'); return; }
        var rows = expanded.notifications ? s.items : s.items.slice(0, SIDEBAR_LIMIT);
        el.innerHTML = rows.map(function (it) { return R().notificationItem(it, 'sidebar'); }).join('') +
          moreControl('notifications', s.hasMore);
      });
    }

    function renderActivities() {
      var el = bodyEl('activities');
      if (!el) return;
      var s = window.TMAActivities.state;
      withScroll(function () {
        if (!s.loaded && s.loading) { el.innerHTML = R().skeleton(3); return; }
        if (s.error && !s.items.length) { el.innerHTML = R().errorState('Could not load activity.'); return; }
        if (!s.items.length) { el.innerHTML = R().emptyState('No recent activity.', 'ClockCounterClockwise'); return; }
        el.innerHTML = s.items.slice(0, SIDEBAR_LIMIT).map(function (it) {
          return R().activityItem(it, 'sidebar');
        }).join('');
      });
    }

    function renderClients() {
      var el = bodyEl('clients');
      if (!el) return;
      withScroll(function () {
        if (clients.loading && !clients.loaded) { el.innerHTML = R().skeleton(3); return; }
        if (clients.forbidden) {
          // A client-role user has no directory to show; hide the section.
          var sec = host.querySelector('[data-rb-section="clients"]');
          if (sec) sec.hidden = true;
          return;
        }
        if (clients.error && !clients.items.length) { el.innerHTML = R().errorState('Could not load clients.'); return; }
        if (!clients.items.length) { el.innerHTML = R().emptyState('No clients yet.', 'AddressBook'); return; }
        el.innerHTML = clients.items.slice(0, CLIENTS_LIMIT).map(clientItem).join('');
      });
    }

    function clientItem(c) {
      var name = c.name || 'Client';
      var company = (c.profile && c.profile.work && c.profile.work.company) || c.company || '';
      // Real client photo (an upload or provider URL) if there is one; the
      // initials tile only stands in when there isn't (§5).
      var initials = R().initialsUri(name);
      var photo = c.profile && c.profile.photo;
      var src = (photo && /^(https?:|\/(storage|media)\/|data:)/.test(photo)) ? photo : initials;
      return '<div class="tma-dash__contact" role="button" tabindex="0" data-client-id="' + R().esc(c.id) + '">' +
        '<img class="tma-dash__rb-avatar" src="' + R().esc(src) + '" alt="" ' +
          "onerror=\"this.onerror=null;this.src='" + initials + "'\">" +
        '<span class="tma-dash__contact-name">' + R().esc(name) +
        (company ? '<span class="tma-dash__contact-company">' + R().esc(company) + '</span>' : '') +
        '</span></div>';
    }

    /* ── clients data ──────────────────────────────────────────── */
    function loadClients() {
      if (clients.loaded || clients.loading) return;
      clients.loading = true;
      renderClients();
      window.TMANotifyAPI.api(ROOT + '/portal/clients').then(function (data) {
        clients.items = (data && data.clients) || [];
        clients.loaded = true;
        clients.loading = false;
        renderClients();
      }).catch(function (err) {
        clients.loading = false;
        clients.error = true;
        if (err && (err.status === 403 || err.status === 401)) clients.forbidden = true;
        renderClients();
      });
    }

    /* ── data wiring ───────────────────────────────────────────── */
    window.TMANotifications.subscribe(renderNotifications);
    window.TMAActivities.subscribe(renderActivities);

    function loadAll() {
      window.TMANotifications.ensureLoaded({ limit: 20 });
      window.TMAActivities.ensureLoaded({ limit: 20 });
      loadClients();
    }

    // Paint whatever is already known, then ensure fresh data.
    renderNotifications();
    renderActivities();
    renderClients();
    loadAll();

    /* ── clicks: open the record in place ──────────────────────── */
    host.addEventListener('click', function (e) {
      var retry = e.target.closest('[data-rb-retry]');
      if (retry) {
        e.preventDefault();
        var sec = retry.closest('[data-rb-section]');
        var kind = sec && sec.getAttribute('data-rb-section');
        if (kind === 'notifications') window.TMANotifications.load({ limit: 20 });
        else if (kind === 'activities') window.TMAActivities.load({ limit: 20 });
        else if (kind === 'clients') { clients.loaded = false; clients.error = false; loadClients(); }
        return;
      }

      var more = e.target.closest('[data-rb-more]');
      if (more) {
        e.preventDefault();
        var mkind = more.getAttribute('data-rb-more');
        if (mkind === 'notifications') window.TMANotifications.loadMore();
        else if (mkind === 'activities') window.TMAActivities.loadMore();
        return;
      }

      var dismiss = e.target.closest('[data-notification-dismiss]');
      if (dismiss) { e.preventDefault(); e.stopPropagation(); window.TMANotifications.remove(dismiss.getAttribute('data-notification-dismiss')); return; }

      var notif = e.target.closest('[data-notification-id]');
      if (notif) { openNotification(notif.getAttribute('data-notification-id'), notif.getAttribute('data-action-url')); return; }

      var act = e.target.closest('[data-activity-id]');
      if (act) { navigate(act.getAttribute('data-action-url')); return; }

      var client = e.target.closest('[data-client-id]');
      if (client) { navigate('/clients?client=' + encodeURIComponent(client.getAttribute('data-client-id'))); return; }
    });

    // Keyboard access for the role="button" rows.
    host.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var row = e.target.closest('[data-notification-id],[data-activity-id],[data-client-id]');
      if (!row) return;
      e.preventDefault();
      row.click();
    });

    function openNotification(uid, url) {
      window.TMANotifications.markRead(uid);
      navigate(url);
    }

    function navigate(url) {
      if (!url) return;
      // Close the mobile rightbar drawer as we leave.
      if (window.innerWidth <= 1024) root.classList.remove('is-rb-open');
      if (root._portalNavigate) root._portalNavigate(url);
      else window.location.assign((window.__TMA_SITE_ROOT || '') + url);
    }

    function expand(kind) {
      if (kind !== 'notifications' && kind !== 'activities') return;
      expanded[kind] = true;
      var store = kind === 'notifications' ? window.TMANotifications : window.TMAActivities;
      // Pull a fuller page if we only have the compact set so far.
      if (store.state.items.length <= SIDEBAR_LIMIT && store.state.hasMore) store.loadMore();
      if (kind === 'notifications') renderNotifications(); else renderActivities();
      var sec = host.querySelector('[data-rb-section="' + kind + '"]');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    rightbar._rbControl = {
      loadAll: loadAll,
      renderNotifications: renderNotifications,
      renderActivities: renderActivities,
      expand: expand,
    };
  }

  /* Expand a sidebar section in place, from the header popup's "See all". */
  function expand(root, kind) {
    var rightbar = root.querySelector('.tma-dash__rightbar');
    if (rightbar && rightbar._rbControl && rightbar._rbControl.expand) rightbar._rbControl.expand(kind);
  }

  function section(kind, title) {
    // Preserve the original activities modifier (draws the connector line).
    var cls = 'tma-dash__rb-section' + (kind === 'activities' ? ' tma-dash__rb-section--activities' : '');
    return '<section class="' + cls + '" data-rb-section="' + kind + '">' +
      '<div class="tma-dash__rb-title">' + title + '</div>' +
      '<div class="tma-dash__rb-body" data-rb-body="' + kind + '"></div>' +
    '</section>';
  }

  window.TMARightSidebar = { mount: mount, expand: expand };
})();
