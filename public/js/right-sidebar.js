/*
 * TMA - Right sidebar sections (section 1, section 5).
 *
 * Fills the existing right sidebar's three sections. Notifications, Activities,
 * Applications, with real data from the shared stores (notifications, activity)
 * and the CIP preview API. The layout, spacing, and card styles are untouched;
 * only the content is now live.
 *
 * The third section is the reader's own caseload, not the firm's directory. An
 * administrator sees the whole book capped at fifteen rows; everybody else sees
 * the applications assigned to them. The server decides that, see
 * CipApplicationController::preview - the sidebar only asks.
 *
 * Re-renders are per-section and scroll-preserving: a new notification updates
 * just that list, never the whole panel, and never resets the scroll position
 * (section 25). Items are clickable and open their record in place via the shell's
 * SPA navigator (section 5).
 *
 * Global: window.TMARightSidebar
 */
(function () {
  'use strict';

  var R = function () { return window.TMANotifyRender; };
  var ROOT = window.__TMA_SITE_ROOT || '';
  var APPS_MIN = 6;
  // The server caps at fifteen too; asking for more would be trimmed anyway.
  var APPS_MAX = 15;

  function mount(root) {
    var rightbar = root.querySelector('.tma-dash__rightbar');
    if (!rightbar || rightbar._rbMounted) return;
    rightbar._rbMounted = true;

    // Prefer the shell's hosts: their skeleton rows are already on screen and
    // stay there until real rows morph over them, so nothing is emptied and
    // refilled. Fall back to building them when an older page still has
    // prototype filler.
    var host = rightbar.querySelector('[data-rb-sections]');
    if (host) {
      ['notifications', 'activities'].forEach(function (kind) {
        var sec = host.querySelector('[data-rb-section="' + kind + '"]');
        if (sec && !sec.querySelector('[data-rb-footer="' + kind + '"]')) {
          var foot = document.createElement('div');
          foot.className = 'tma-dash__rb-footer';
          foot.setAttribute('data-rb-footer', kind);
          foot.hidden = true;
          sec.appendChild(foot);
        }
      });
    } else {
      Array.prototype.slice.call(rightbar.querySelectorAll('.tma-dash__rb-section')).forEach(function (n) { n.remove(); });
      host = document.createElement('div');
      host.className = 'tma-dash__rb-sections';
      host.setAttribute('data-rb-sections', '');
      host.innerHTML =
        section('notifications', 'Notifications') +
        section('activities', 'Activities') +
        section('applications', 'Applications');
      rightbar.appendChild(host);
    }

    var apps = { items: [], loaded: false, loading: false, error: false, forbidden: false };
    // Kept for load-more while a section is temporarily expanded; "See all"
    // navigates to the full Overview tabs instead of expanding in place.
    var expanded = { notifications: false, activities: false };

    /* Preview counts per section: more on a tall window, fewer on a short
       one so Applications still starts above the fold. The stylesheet is the
       authority (--rb-cap-* on .tma-dash__rightbar, dashboard.css): it
       reserves each section's height for exactly this many rows before the
       data is in, and reading the caps back from it is what keeps the two
       from disagreeing. The arithmetic below is the same ladder for a page
       whose stylesheet predates the tokens. */
    function previewLimits() {
      var style = window.getComputedStyle(rightbar);
      var fromCss = function (kind) {
        var n = parseInt(style.getPropertyValue('--rb-cap-' + kind), 10);
        return n > 0 ? n : 0;
      };
      var caps = {
        applications: fromCss('applications'),
        notifications: fromCss('notifications'),
        activities: fromCss('activities'),
      };
      if (caps.applications && caps.notifications && caps.activities) return caps;

      var h = rightbar.clientHeight || window.innerHeight || 800;
      var appsLimit = APPS_MIN;
      if (h >= 900) appsLimit = APPS_MAX;
      else if (h >= 780) appsLimit = 10;

      var notifLimit = 6;
      var actLimit = 6;
      if (h < 720) { notifLimit = 4; actLimit = 3; }
      else if (h < 820) { notifLimit = 5; actLimit = 4; }
      if (h < 640) { notifLimit = 3; actLimit = 2; }

      return {
        applications: caps.applications || appsLimit,
        notifications: caps.notifications || notifLimit,
        activities: caps.activities || actLimit,
      };
    }

    /* ── renderers ─────────────────────────────────────────────── */
    function bodyEl(kind) { return host.querySelector('[data-rb-body="' + kind + '"]'); }
    function footerEl(kind) { return host.querySelector('[data-rb-footer="' + kind + '"]'); }

    function withScroll(fn) {
      var top = rightbar.scrollTop;
      fn();
      rightbar.scrollTop = top;
    }

    /* Reconcile rather than rewrite: a re-render keeps the rows that did not
       change, so a person's photo is not re-fetched and the section is never
       empty between one paint and the next. The shell's skeleton rows are
       morphed over the same way. */
    function patch(el, html) {
      if (window.TMAMorph && window.TMAMorph.patch) window.TMAMorph.patch(el, html);
      else el.innerHTML = html;
    }

    function moreControl(kind, hasMore) {
      if (!expanded[kind] || !hasMore) return '';
      return '<button type="button" class="tma-dash__rb-more" data-rb-more="' + kind + '">Load more</button>';
    }

    function seeAllControl(kind) {
      var label = kind === 'notifications' ? 'See all notifications' : 'See all activities';
      return '<button type="button" class="tma-dash__rb-see-all" data-rb-see-all="' + kind + '">' + label + '</button>';
    }

    function syncFooter(kind, total, previewCount, hasMore) {
      var foot = footerEl(kind);
      if (!foot) return;
      // Always offer See all so users can open the full page even with few items.
      var html = seeAllControl(kind) + moreControl(kind, hasMore);
      patch(foot, html);
      foot.hidden = !html;
    }

    function renderNotifications() {
      var el = bodyEl('notifications');
      if (!el) return;
      var s = window.TMANotifications.state;
      var limits = previewLimits();
      withScroll(function () {
        // Not yet asked as well as still loading: the skeleton stays until
        // there is an answer, rather than "all caught up" for a frame.
        if (!s.loaded && !s.error) { patch(el, R().skeleton(3)); syncFooter('notifications', 0, limits.notifications, false); return; }
        if (s.error && !s.items.length) { patch(el, R().errorState('Could not load notifications.')); syncFooter('notifications', 0, limits.notifications, false); return; }
        if (!s.items.length) { patch(el, R().emptyState('You are all caught up.', 'Bell')); syncFooter('notifications', 0, limits.notifications, false); return; }
        var preview = limits.notifications;
        var rows = expanded.notifications ? s.items : s.items.slice(0, preview);
        patch(el, rows.map(function (it) { return R().notificationItem(it, 'sidebar'); }).join(''));
        syncFooter('notifications', s.items.length, preview, !!s.hasMore);
      });
    }

    function renderActivities() {
      var el = bodyEl('activities');
      if (!el) return;
      var s = window.TMAActivities.state;
      var limits = previewLimits();
      withScroll(function () {
        if (!s.loaded && !s.error) { patch(el, R().skeleton(3)); syncFooter('activities', 0, limits.activities, false); return; }
        if (s.error && !s.items.length) { patch(el, R().errorState('Could not load activity.')); syncFooter('activities', 0, limits.activities, false); return; }
        if (!s.items.length) { patch(el, R().emptyState('No recent activity.', 'ClockCounterClockwise')); syncFooter('activities', 0, limits.activities, false); return; }
        var preview = limits.activities;
        var rows = expanded.activities ? s.items : s.items.slice(0, preview);
        patch(el, rows.map(function (it) {
          return R().activityItem(it, 'sidebar');
        }).join(''));
        syncFooter('activities', s.items.length, preview, !!s.hasMore);
      });
    }

    function renderApplications() {
      var el = bodyEl('applications');
      if (!el) return;
      var limits = previewLimits();
      withScroll(function () {
        if (!apps.loaded && !apps.error) { patch(el, R().skeleton(3)); return; }
        if (apps.forbidden) {
          // No reach into the module (the feature is off, or this account is
          // not part of it). Hide the section rather than explain it.
          var sec = host.querySelector('[data-rb-section="applications"]');
          if (sec) sec.hidden = true;
          return;
        }
        if (apps.error && !apps.items.length) { patch(el, R().errorState('Could not load applications.')); return; }
        if (!apps.items.length) { patch(el, R().emptyState('No applications yet.', 'IdentificationCard')); return; }
        patch(el, apps.items.slice(0, limits.applications).map(applicationItem).join(''));
      });
    }

    function applicationItem(a) {
      var name = a.applicantName && a.applicantName !== '-' ? a.applicantName : 'Application';
      // The file number under the name, and the status when there is no number,
      // so a row is never just a face and a name.
      var sub = a.number || a.statusLabel || '';
      // The applicant's real portrait when one is filed; the initials tile
      // only stands in when there isn't (section 5).
      var initials = R().initialsUri(name);
      var photo = a.photo;
      var src = (photo && /^(https?:|\/(storage|media|portal)\/|data:)/.test(photo)) ? photo : initials;
      return '<div class="tma-dash__contact" role="button" tabindex="0" data-cip-app-uid="' + R().esc(a.clientUid || '') + '">' +
        '<img class="tma-dash__rb-avatar" src="' + R().esc(src) + '" alt="" ' +
          "onerror=\"this.onerror=null;this.src='" + initials + "'\">" +
        '<span class="tma-dash__contact-name">' + R().esc(name) +
        (sub ? '<span class="tma-dash__contact-company">' + R().esc(sub) + '</span>' : '') +
        '</span></div>';
    }

    /* ── applications data ───────────────────────── */
    function loadApplications() {
      if (apps.loaded || apps.loading) return;
      apps.loading = true;
      renderApplications();
      /*
       * Preview only: the sidebar paints at most fifteen rows, and the
       * endpoint refuses to return more. The full table lives at
       * /citizenship-applications and is a much heavier read.
       *
       * There is no client-side capability for the module, so reach is the
       * server's answer: a 404 (module off, or this account is not part of
       * it) hides the section the same way a 403 does.
       */
      var limit = Math.max(APPS_MAX, previewLimits().applications);
      window.TMANotifyAPI.api(ROOT + '/portal/cip/applications/preview?limit=' + encodeURIComponent(limit)).then(function (data) {
        apps.items = (data && data.applications) || [];
        apps.loaded = true;
        apps.loading = false;
        renderApplications();
      }).catch(function (err) {
        apps.loading = false;
        apps.error = true;
        if (err && (err.status === 404 || err.status === 403 || err.status === 401)) apps.forbidden = true;
        renderApplications();
      });
    }

    /* ── data wiring ───────────────────────────────────────────── */
    window.TMANotifications.subscribe(renderNotifications);
    window.TMAActivities.subscribe(renderActivities);

    function loadAll() {
      window.TMANotifications.ensureLoaded({ limit: 20 });
      window.TMAActivities.ensureLoaded({ limit: 20 });
      loadApplications();
    }

    // Paint whatever is already known, then ensure fresh data. A section with
    // nothing known yet keeps the shell's skeleton rows.
    renderNotifications();
    renderActivities();
    renderApplications();
    loadAll();

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!expanded.notifications) renderNotifications();
        if (!expanded.activities) renderActivities();
        renderApplications();
      }, 120);
    });

    /* ── clicks: open the record in place ──────────────────────── */
    host.addEventListener('click', function (e) {
      var retry = e.target.closest('[data-rb-retry]');
      if (retry) {
        e.preventDefault();
        var sec = retry.closest('[data-rb-section]');
        var kind = sec && sec.getAttribute('data-rb-section');
        if (kind === 'notifications') window.TMANotifications.load({ limit: 20 });
        else if (kind === 'activities') window.TMAActivities.load({ limit: 20 });
        else if (kind === 'applications') { apps.loaded = false; apps.error = false; loadApplications(); }
        return;
      }

      var seeAll = e.target.closest('[data-rb-see-all]');
      if (seeAll) {
        e.preventDefault();
        var seeKind = seeAll.getAttribute('data-rb-see-all');
        if (seeKind === 'notifications') navigate('/overview?tab=notifications');
        else if (seeKind === 'activities') navigate('/overview?tab=activity');
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

      /*
       * Open the file the way the table opens it: by the hub client's uid,
       * which is what /citizenship-applications/{uid} resolves. The row also
       * carries the application uuid, but that path does not take one.
       */
      var app = e.target.closest('[data-cip-app-uid]');
      if (app) {
        var uid = app.getAttribute('data-cip-app-uid');
        if (uid) navigate('/citizenship-applications/' + encodeURIComponent(uid));
        return;
      }
    });

    // Keyboard access for the role="button" rows.
    host.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var row = e.target.closest('[data-notification-id],[data-activity-id],[data-cip-app-uid]');
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
      var limits = previewLimits();
      var preview = kind === 'notifications' ? limits.notifications : limits.activities;
      // Pull a fuller page if we only have the compact set so far.
      if (store.state.items.length <= preview && store.state.hasMore) store.loadMore();
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
      ((kind === 'notifications' || kind === 'activities')
        ? '<div class="tma-dash__rb-footer" data-rb-footer="' + kind + '" hidden></div>'
        : '') +
    '</section>';
  }

  window.TMARightSidebar = { mount: mount, expand: expand };
})();
