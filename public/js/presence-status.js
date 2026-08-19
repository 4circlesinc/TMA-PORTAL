/*
 * TMA — Advanced user presence & availability status.
 * Global: window.TMAPresence
 *
 * Owns the signed-in user's status (manual, scheduled, location, call),
 * paints the sidebar profile indicator, and listens for realtime updates.
 */
(function () {
  'use strict';

  var ROOT = window.__TMA_SITE_ROOT || '';
  var state = null;
  var listeners = [];
  var locationTimer = null;
  var expiryTimer = null;
  var wired = false;
  var popoverOpen = false;

  var STATUS = {
    online: { label: 'Online', icon: 'green', dot: '#22c55e' },
    offline: { label: 'Offline', icon: 'gray', dot: '#94a3b8' },
    on_call: { label: 'On a Call', icon: 'red', dot: '#ef4444' },
    at_meeting: { label: 'At a Meeting', icon: 'calendar', dot: '#6366f1' },
    do_not_disturb: { label: 'Do Not Disturb', icon: 'dnd', dot: '#ef4444' },
    in_office: { label: 'In Office', icon: 'office', dot: '#22c55e' },
    working_remote: { label: 'Working Remote', icon: 'home', dot: '#0ea5e9' },
    away: { label: 'Away', icon: 'away', dot: '#f59e0b' },
    available: { label: 'Available', icon: 'green', dot: '#22c55e' },
  };

  var MANUAL_PICKS = ['available', 'on_call', 'at_meeting', 'do_not_disturb', 'in_office', 'working_remote', 'away'];

  var DND_SUPPORTED = !!(navigator.permissions && typeof Notification !== 'undefined');

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function api(method, path, body) {
    var headers = {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': csrf(),
    };
    if (body) headers['Content-Type'] = 'application/json';
    var rt = window.TMAMessagingRealtime;
    if (rt && rt.socketId) headers['X-Socket-ID'] = rt.socketId;
    return fetch(ROOT + path, {
      method: method,
      credentials: 'same-origin',
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (!r.ok) throw new Error('Request failed');
      return r.json();
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function meta(slug) {
    return STATUS[slug] || { label: slug, icon: 'gray', dot: '#94a3b8' };
  }

  function primary() {
    return (state && state.primary) || { status: 'online', label: 'Online', source: 'automatic', icon: 'green' };
  }

  function sourceLabel(src) {
    if (src === 'manual') return 'Manual';
    if (src === 'scheduled') return 'Scheduled';
    if (src === 'location') return 'Automatic · Location';
    if (src === 'call') return 'Automatic · Call';
    if (src === 'system') return 'Automatic';
    return 'Automatic';
  }

  function iconHtml(icon, size) {
    size = size || 8;
    var m = meta(icon === 'green' || icon === 'red' || icon === 'gray' ? 'online' : '');
    var color = m.dot;
    if (icon === 'red') color = '#ef4444';
    if (icon === 'green') color = '#22c55e';
    if (icon === 'gray') color = '#94a3b8';
    if (icon === 'calendar') {
      return '<img class="tma-presence__icon-img" src="images/icons/phosphor/CalendarBlank.svg" alt="" width="14" height="14">';
    }
    if (icon === 'dnd') {
      return '<img class="tma-presence__icon-img" src="images/icons/phosphor/BellSlash.svg" alt="" width="14" height="14">';
    }
    if (icon === 'office') {
      return '<img class="tma-presence__icon-img" src="images/icons/phosphor/Buildings.svg" alt="" width="14" height="14">';
    }
    if (icon === 'home') {
      return '<img class="tma-presence__icon-img" src="images/icons/phosphor/House.svg" alt="" width="14" height="14">';
    }
    if (icon === 'away') {
      return '<img class="tma-presence__icon-img" src="images/icons/phosphor/Clock.svg" alt="" width="14" height="14">';
    }
    return '<span class="tma-presence__dot" style="background:' + color + ';width:' + size + 'px;height:' + size + 'px"></span>';
  }

  /** Public label for any presence payload (self or remote). */
  function labelFor(p) {
    if (!p) return 'Offline · Last seen recently';
    if (p.statusLabel) {
      if (p.status === 'offline') {
        var ls = window.TMALastSeen ? window.TMALastSeen.forPresence(p) : (p.lastSeen || 'Last seen recently');
        if (/^online$/i.test(ls)) ls = 'Last seen recently';
        return 'Offline · ' + ls.replace(/^Last seen /i, '');
      }
      if (p.statusMessage) return p.statusLabel + ' — ' + p.statusMessage;
      return p.statusLabel;
    }
    if (window.TMALastSeen) return window.TMALastSeen.forPresence(p);
    return p.online ? 'Online' : (p.lastSeen || 'Last seen recently');
  }

  function paintProfile() {
    var p = primary();
    var text = p.label || meta(p.status).label;
    if (p.message) text = text + ' — ' + p.message;

    document.querySelectorAll('[data-presence-indicator]').forEach(function (el) {
      el.innerHTML =
        iconHtml(p.icon || meta(p.status).icon, 8) +
        '<span class="tma-presence__label">' + esc(text) + '</span>';
      el.setAttribute('data-presence-status', p.status || '');
      el.title = text;
    });
  }

  function ensureProfileSlot() {
    document.querySelectorAll('.tma-dash__profile-meta').forEach(function (metaEl) {
      if (metaEl.querySelector('[data-presence-indicator]')) return;
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'tma-presence tma-presence--profile';
      row.setAttribute('data-presence-indicator', '');
      row.setAttribute('aria-haspopup', 'dialog');
      row.setAttribute('aria-expanded', 'false');
      metaEl.appendChild(row);
    });
  }

  function injectCss() {
    if (document.getElementById('tma-presence-css')) return;
    var s = document.createElement('style');
    s.id = 'tma-presence-css';
    s.textContent =
      '.tma-presence--profile{display:flex;align-items:center;gap:6px;margin-top:2px;padding:2px 0;border:0;background:transparent;cursor:pointer;font:inherit;color:var(--color-text-secondary,#64748b);max-width:100%;text-align:left}' +
      '.tma-presence--profile:hover{background:var(--color-hover,rgba(0,0,0,.04));border-radius:6px}' +
      '.tma-presence__label{font-size:11px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px}' +
      '.tma-presence__dot{display:inline-block;border-radius:50%;flex:0 0 auto}' +
      '.tma-presence__icon-img{flex:0 0 auto;opacity:.85}' +
      '.tma-presence-popover{min-width:280px;max-width:340px}' +
      '.tma-presence-popover__section{padding:8px 0;border-top:1px solid var(--color-border,#e2e8f0)}' +
      '.tma-presence-popover__section:first-child{border-top:0}' +
      '.tma-presence-popover__head{font-size:11px;font-weight:600;color:var(--color-text-secondary);padding:4px 12px;text-transform:uppercase;letter-spacing:.04em}' +
      '.tma-presence-popover__current{padding:8px 12px;display:flex;gap:10px;align-items:flex-start}' +
      '.tma-presence-popover__current-meta{flex:1;min-width:0}' +
      '.tma-presence-popover__current-title{font-weight:600;font-size:14px}' +
      '.tma-presence-popover__current-sub{font-size:12px;color:var(--color-text-secondary);margin-top:2px}' +
      '.tma-presence-popover__item{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:0;background:transparent;text-align:left;cursor:pointer;font:inherit}' +
      '.tma-presence-popover__item:hover{background:var(--color-hover,rgba(0,0,0,.04))}' +
      '.tma-presence-popover__item.is-active{font-weight:600}' +
      '.tma-presence-settings{padding:12px}' +
      '.tma-presence-settings label{display:block;font-size:12px;margin:8px 0 4px;color:var(--color-text-secondary)}' +
      '.tma-presence-settings input,.tma-presence-settings select{width:100%;padding:8px;border:1px solid var(--color-border,#e2e8f0);border-radius:8px;font:inherit}' +
      '.tma-presence-settings__row{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
      '@media(max-width:767px){.tma-presence__label{max-width:120px}}';
    document.head.appendChild(s);
  }

  function closePopover() {
    popoverOpen = false;
    var host = document.querySelector('[data-presence-popover-host]');
    if (host) host.remove();
    document.querySelectorAll('[data-presence-indicator]').forEach(function (el) {
      el.setAttribute('aria-expanded', 'false');
    });
  }

  function openPopover(anchor) {
    injectCss();
    closePopover();
    popoverOpen = true;
    anchor.setAttribute('aria-expanded', 'true');
    var p = primary();
    var host = document.createElement('div');
    host.setAttribute('data-presence-popover-host', '');
    host.className = 'tma-popover tma-presence-popover';
    host.style.position = 'fixed';
    host.style.zIndex = '10050';

    var items = MANUAL_PICKS.map(function (slug) {
      var m = meta(slug);
      var active = p.status === slug ? ' is-active' : '';
      return '<button type="button" class="tma-presence-popover__item' + active + '" data-presence-set="' + esc(slug) + '">' +
        iconHtml(m.icon, 10) + '<span>' + esc(m.label) + '</span></button>';
    }).join('');

    host.innerHTML =
      '<div class="tma-presence-popover__section">' +
      '<div class="tma-presence-popover__head">Current status</div>' +
      '<div class="tma-presence-popover__current">' +
      iconHtml(p.icon, 12) +
      '<div class="tma-presence-popover__current-meta">' +
      '<div class="tma-presence-popover__current-title">' + esc(p.label || meta(p.status).label) + '</div>' +
      '<div class="tma-presence-popover__current-sub">' + esc(sourceLabel(p.source)) +
      (p.expiresAt ? ' · until ' + esc(new Date(p.expiresAt).toLocaleString()) : '') +
      '</div></div></div></div>' +
      '<div class="tma-presence-popover__section"><div class="tma-presence-popover__head">Set status</div>' + items + '</div>' +
      '<div class="tma-presence-popover__section">' +
      '<button type="button" class="tma-presence-popover__item" data-presence-settings><img src="images/icons/phosphor/Gear.svg" alt="" width="14" height="14"><span>Status settings…</span></button>' +
      '</div>';

    document.body.appendChild(host);
    var rect = anchor.getBoundingClientRect();
    host.style.top = Math.min(rect.bottom + 6, window.innerHeight - host.offsetHeight - 8) + 'px';
    host.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - host.offsetWidth - 8)) + 'px';

    host.addEventListener('click', function (e) {
      var set = e.target.closest('[data-presence-set]');
      if (set) {
        var slug = set.getAttribute('data-presence-set');
        setStatus(slug).then(function () { closePopover(); }).catch(function () {});
        return;
      }
      if (e.target.closest('[data-presence-settings]')) {
        closePopover();
        openSettingsModal();
      }
    });
  }

  function openSettingsModal() {
    injectCss();
    var locs = (state && state.locations) || [];
    var office = locs.find(function (l) { return l.type === 'office'; }) || {};
    var remote = locs.find(function (l) { return l.type === 'remote'; }) || {};

    var wrap = document.createElement('div');
    wrap.className = 'tma-modal-overlay';
    wrap.setAttribute('data-presence-settings-modal', '');
    wrap.innerHTML =
      '<div class="tma-modal" role="dialog" aria-label="Status settings" style="max-width:480px;width:calc(100% - 32px)">' +
      '<div class="tma-modal__head"><h2 class="tma-modal__title">Work locations</h2>' +
      '<button type="button" class="tma-modal__close" data-presence-close aria-label="Close">&times;</button></div>' +
      '<div class="tma-presence-settings">' +
      '<p style="font-size:13px;color:var(--color-text-secondary);margin:0 0 12px">Allow location access to automatically detect whether you\'re working from the office or remotely. Your exact location is never shown to others.</p>' +
      '<h3 style="font-size:14px;margin:16px 0 8px">Office location</h3>' +
      '<label>Label</label><input data-loc-office-label value="' + esc(office.label || 'Office') + '">' +
      '<label>Address</label><input data-loc-office-address value="' + esc(office.address || '') + '" placeholder="123 Example Street">' +
      '<div class="tma-presence-settings__row">' +
      '<div><label>Latitude</label><input data-loc-office-lat type="number" step="any" value="' + esc(office.latitude || '') + '"></div>' +
      '<div><label>Longitude</label><input data-loc-office-lng type="number" step="any" value="' + esc(office.longitude || '') + '"></div></div>' +
      '<label>Radius (metres)</label><input data-loc-office-radius type="number" min="25" max="5000" value="' + esc(office.radiusM || 100) + '">' +
      '<label><input type="checkbox" data-loc-office-enabled ' + (office.enabled !== false ? 'checked' : '') + '> Enable automatic detection</label>' +
      '<button type="button" class="tma-btn tma-btn--secondary" data-loc-office-current style="margin-top:8px">Use current location</button>' +
      '<h3 style="font-size:14px;margin:20px 0 8px">Remote location</h3>' +
      '<label>Label</label><input data-loc-remote-label value="' + esc(remote.label || 'Home') + '">' +
      '<label>Address</label><input data-loc-remote-address value="' + esc(remote.address || '') + '">' +
      '<div class="tma-presence-settings__row">' +
      '<div><label>Latitude</label><input data-loc-remote-lat type="number" step="any" value="' + esc(remote.latitude || '') + '"></div>' +
      '<div><label>Longitude</label><input data-loc-remote-lng type="number" step="any" value="' + esc(remote.longitude || '') + '"></div></div>' +
      '<label>Radius (metres)</label><input data-loc-remote-radius type="number" min="25" max="5000" value="' + esc(remote.radiusM || 100) + '">' +
      '<label><input type="checkbox" data-loc-remote-enabled ' + (remote.enabled !== false ? 'checked' : '') + '> Enable automatic detection</label>' +
      '<button type="button" class="tma-btn tma-btn--secondary" data-loc-remote-current style="margin-top:8px">Use current location</button>' +
      '<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">' +
      '<button type="button" class="tma-btn tma-btn--secondary" data-presence-close>Cancel</button>' +
      '<button type="button" class="tma-btn tma-btn--primary" data-presence-save-locations>Save</button></div></div></div>';

    document.body.appendChild(wrap);

    function useCurrent(prefix) {
      if (!navigator.geolocation) {
        toast('Location is not supported in this browser.', false);
        return;
      }
      navigator.geolocation.getCurrentPosition(function (pos) {
        wrap.querySelector('[data-loc-' + prefix + '-lat]').value = pos.coords.latitude;
        wrap.querySelector('[data-loc-' + prefix + '-lng]').value = pos.coords.longitude;
      }, function () {
        toast('Location permission denied.', false);
      }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
    }

    wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-presence-close]')) { wrap.remove(); return; }
      if (e.target.closest('[data-loc-office-current]')) { useCurrent('office'); return; }
      if (e.target.closest('[data-loc-remote-current]')) { useCurrent('remote'); return; }
      if (e.target.closest('[data-presence-save-locations]')) {
        saveLocation('office', wrap).then(function () { return saveLocation('remote', wrap); })
          .then(function () { wrap.remove(); startLocationChecks(); toast('Locations saved.', true); })
          .catch(function () { toast('Could not save locations.', false); });
      }
    });
  }

  function saveLocation(type, wrap) {
    var prefix = type === 'office' ? 'office' : 'remote';
    var lat = parseFloat(wrap.querySelector('[data-loc-' + prefix + '-lat]').value);
    var lng = parseFloat(wrap.querySelector('[data-loc-' + prefix + '-lng]').value);
    if (isNaN(lat) || isNaN(lng)) return Promise.resolve();
    return api('PUT', '/me/availability/locations', {
      type: type,
      label: wrap.querySelector('[data-loc-' + prefix + '-label]').value,
      address: wrap.querySelector('[data-loc-' + prefix + '-address]').value,
      latitude: lat,
      longitude: lng,
      radiusM: parseInt(wrap.querySelector('[data-loc-' + prefix + '-radius]').value, 10) || 100,
      enabled: !!wrap.querySelector('[data-loc-' + prefix + '-enabled]').checked,
    }).then(applyPayload);
  }

  function toast(msg, ok) {
    if (window.TMAToast && window.TMAToast.show) window.TMAToast.show(msg, ok !== false);
    else if (window.TMAPortalUI && window.TMAPortalUI.toast) window.TMAPortalUI.toast(msg);
  }

  function applyPayload(j) {
    state = j;
    paintProfile();
    listeners.forEach(function (fn) { fn(state); });
    scheduleExpiry();
    return state;
  }

  function load(fromMe) {
    if (fromMe && fromMe.availability) {
      return applyPayload(fromMe.availability);
    }
    return api('GET', '/me/availability').then(applyPayload).catch(function () {});
  }

  function setStatus(slug, opts) {
    opts = opts || {};
    return api('PUT', '/me/availability/status', {
      status: slug,
      message: opts.message || null,
      startsAt: opts.startsAt || null,
      expiresAt: opts.expiresAt || null,
    }).then(applyPayload);
  }

  function reportCall(active) {
    return api('POST', '/me/availability/call', { active: !!active }).catch(function () {});
  }

  function scheduleExpiry() {
    if (expiryTimer) clearTimeout(expiryTimer);
    var p = primary();
    if (!p.expiresAt) return;
    var ms = new Date(p.expiresAt).getTime() - Date.now();
    if (ms <= 0) { load(); return; }
    expiryTimer = setTimeout(function () { load(); }, Math.min(ms + 500, 86400000));
  }

  function startLocationChecks() {
    if (locationTimer) clearInterval(locationTimer);
    var locs = (state && state.locations) || [];
    var any = locs.some(function (l) { return l.enabled && l.latitude != null; });
    if (!any || !navigator.geolocation) return;

    function tick() {
      if (document.visibilityState === 'hidden') return;
      navigator.geolocation.getCurrentPosition(function (pos) {
        api('POST', '/me/availability/location', {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }).then(applyPayload).catch(function () {});
      }, function () { /* denied — stop prompting */ }, {
        enableHighAccuracy: false,
        timeout: 12000,
        maximumAge: 300000,
      });
    }

    tick();
    locationTimer = setInterval(tick, 300000);
  }

  function bindCallIntegration() {
    var obs = new MutationObserver(function () {
      var phase = document.documentElement.getAttribute('data-tma-call');
      var active = phase === 'active' || phase === 'ringing';
      if (window._tmaPresenceOnCall !== active) {
        window._tmaPresenceOnCall = active;
        reportCall(active);
      }
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tma-call'] });
  }

  function bindRealtime(userId) {
    var rt = window.TMAMessagingRealtime;
    if (!rt || !userId) return;
    rt.listen('private-portal.staff', 'presence.status', onRemoteStatus);
    rt.listen('private-App.Models.User.' + userId, 'presence.status', onRemoteStatus);
  }

  function onRemoteStatus(payload) {
    if (!payload || payload.userId == null) return;
    var me = window.TMACurrentUser && window.TMACurrentUser.get();
    if (me && payload.userId === me.id) {
      load();
      return;
    }
    document.dispatchEvent(new CustomEvent('tma:presence-status', { detail: payload }));
  }

  function wire() {
    if (wired) return;
    wired = true;
    injectCss();
    ensureProfileSlot();
    paintProfile();

    document.addEventListener('click', function (e) {
      var ind = e.target.closest('[data-presence-indicator]');
      if (ind) {
        e.preventDefault();
        e.stopPropagation();
        if (popoverOpen) closePopover();
        else openPopover(ind);
        return;
      }
      if (popoverOpen && !e.target.closest('[data-presence-popover-host]')) closePopover();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePopover();
    });
  }

  window.TMAPresence = {
    load: load,
    get: function () { return state; },
    primary: primary,
    labelFor: labelFor,
    setStatus: setStatus,
    reportCall: reportCall,
    onChange: function (fn) { listeners.push(fn); if (state) fn(state); },
    paint: paintProfile,
    iconHtml: iconHtml,
    meta: meta,
    wire: wire,
    startLocationChecks: startLocationChecks,
    bindRealtime: bindRealtime,
    bindCallIntegration: bindCallIntegration,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
