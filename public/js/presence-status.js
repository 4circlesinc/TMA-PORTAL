/*
 * TMA — Advanced user presence & availability status.
 * Global: window.TMAPresence
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
  var realtimeBound = false;
  var pendingStatus = null;

  var STATUS = {
    online: { label: 'Online', icon: 'green' },
    offline: { label: 'Offline', icon: 'gray' },
    on_call: { label: 'On a Call', icon: 'red' },
    at_meeting: { label: 'At a Meeting', icon: 'calendar' },
    do_not_disturb: { label: 'Do Not Disturb', icon: 'dnd' },
    in_office: { label: 'In Office', icon: 'office' },
    working_remote: { label: 'Working Remote', icon: 'home' },
    away: { label: 'Away', icon: 'away' },
    available: { label: 'Available', icon: 'green' },
  };

  var MANUAL_PICKS = ['available', 'on_call', 'at_meeting', 'do_not_disturb', 'in_office', 'working_remote', 'away'];
  var TIMED = { at_meeting: true, do_not_disturb: true, away: true };

  var DURATIONS = [
    { key: 'indefinite', label: 'Indefinitely' },
    { key: '30m', label: '30 minutes' },
    { key: '1h', label: '1 hour' },
    { key: '2h', label: '2 hours' },
    { key: 'today', label: 'Today' },
    { key: 'custom', label: 'Custom…' },
  ];

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
    return STATUS[slug] || { label: slug.replace(/_/g, ' '), icon: 'gray' };
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
    var color = icon === 'red' ? '#ef4444' : icon === 'green' ? '#22c55e' : '#94a3b8';
    return '<span class="tma-presence__dot" style="background:' + color + ';width:' + size + 'px;height:' + size + 'px"></span>';
  }

  function labelFor(p) {
    if (!p) return 'Offline · Last seen recently';
    if (p.statusLabel || p.status) {
      if (p.status === 'offline') {
        var ls = window.TMALastSeen ? window.TMALastSeen.forPresence(p) : (p.lastSeen || 'Last seen recently');
        if (/^online$/i.test(ls)) ls = 'Last seen recently';
        return 'Offline · ' + ls.replace(/^Last seen /i, '');
      }
      var base = p.statusLabel || meta(p.status).label;
      if (p.statusMessage) return base + ' — ' + p.statusMessage;
      return base;
    }
    if (window.TMALastSeen) return window.TMALastSeen.forPresence(p);
    return p.online ? 'Online' : (p.lastSeen || 'Last seen recently');
  }

  function loadCss() {
    if (document.getElementById('tma-presence-css-link')) return;
    var link = document.createElement('link');
    link.id = 'tma-presence-css-link';
    link.rel = 'stylesheet';
    link.href = (ROOT || '') + 'css/presence.css?v=1';
    document.head.appendChild(link);
  }

  function paintProfile() {
    var p = primary();
    var text = p.label || meta(p.status).label;
    if (p.message) text = text + ' — ' + p.message;
    document.querySelectorAll('[data-presence-indicator]').forEach(function (el) {
      el.innerHTML = iconHtml(p.icon || meta(p.status).icon, 8) +
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

  function closePopover() {
    popoverOpen = false;
    pendingStatus = null;
    var host = document.querySelector('[data-presence-popover-host]');
    if (host) host.remove();
    document.querySelectorAll('[data-presence-indicator]').forEach(function (el) {
      el.setAttribute('aria-expanded', 'false');
    });
  }

  function expiresFromKey(key) {
    if (!key || key === 'indefinite') return null;
    var now = new Date();
    if (key === '30m') return new Date(now.getTime() + 30 * 60000).toISOString();
    if (key === '1h') return new Date(now.getTime() + 60 * 60000).toISOString();
    if (key === '2h') return new Date(now.getTime() + 120 * 60000).toISOString();
    if (key === 'today') {
      var end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return end.toISOString();
    }
    return null;
  }

  function durationSectionHtml(slug) {
    if (!TIMED[slug]) return '';
    var pills = DURATIONS.map(function (d) {
      return '<button type="button" class="tma-presence-popover__pill" data-presence-duration="' + d.key + '">' + esc(d.label) + '</button>';
    }).join('');
    return '<div class="tma-presence-popover__duration" data-presence-duration-panel hidden>' +
      '<div class="tma-presence-popover__head">Duration</div>' +
      '<div class="tma-presence-popover__duration-row">' + pills + '</div>' +
      '<div style="padding:8px 0 0;display:none" data-presence-custom-range>' +
      '<input type="datetime-local" data-presence-starts style="margin-bottom:6px">' +
      '<input type="datetime-local" data-presence-ends>' +
      '</div></div>';
  }

  function openPopover(anchor) {
    loadCss();
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
      '<div class="tma-presence-popover__current">' + iconHtml(p.icon, 12) +
      '<div class="tma-presence-popover__current-meta">' +
      '<div class="tma-presence-popover__current-title">' + esc(p.label || meta(p.status).label) + '</div>' +
      '<div class="tma-presence-popover__current-sub">' + esc(sourceLabel(p.source)) +
      (p.expiresAt ? ' · until ' + esc(new Date(p.expiresAt).toLocaleString()) : '') +
      '</div></div></div></div>' +
      '<div class="tma-presence-popover__section">' +
      '<div class="tma-presence-popover__head">Status message <span style="font-weight:400;text-transform:none">(optional)</span></div>' +
      '<div class="tma-presence-popover__message"><input type="text" maxlength="140" placeholder="Focused on client work…" data-presence-message value="' + esc(p.message || '') + '"></div>' +
      '</div>' +
      '<div class="tma-presence-popover__section"><div class="tma-presence-popover__head">Set status</div>' + items +
      durationSectionHtml('at_meeting') + '</div>' +
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
        if (TIMED[slug]) {
          pendingStatus = slug;
          var panel = host.querySelector('[data-presence-duration-panel]');
          if (panel) panel.hidden = false;
          return;
        }
        commitStatus(slug, host);
        return;
      }
      var dur = e.target.closest('[data-presence-duration]');
      if (dur && pendingStatus) {
        var key = dur.getAttribute('data-presence-duration');
        if (key === 'custom') {
          host.querySelector('[data-presence-custom-range]').style.display = 'block';
          return;
        }
        commitStatus(pendingStatus, host, { expiresAt: expiresFromKey(key) });
        return;
      }
      if (e.target.closest('[data-presence-settings]')) {
        closePopover();
        openSettingsModal();
      }
    });

    host.addEventListener('change', function (e) {
      if (!pendingStatus) return;
      if (e.target.matches('[data-presence-ends]') && e.target.value) {
        var starts = host.querySelector('[data-presence-starts]');
        commitStatus(pendingStatus, host, {
          startsAt: starts && starts.value ? new Date(starts.value).toISOString() : null,
          expiresAt: new Date(e.target.value).toISOString(),
        });
      }
    });
  }

  function commitStatus(slug, host, opts) {
    opts = opts || {};
    var msgEl = host && host.querySelector('[data-presence-message]');
    var message = msgEl ? msgEl.value.trim() : '';
    setStatus(slug, {
      message: message || null,
      startsAt: opts.startsAt || null,
      expiresAt: opts.expiresAt || null,
    }).then(function () { closePopover(); }).catch(function () { toast('Could not update status.', false); });
  }

  function openSettingsModal() {
    loadCss();
    var locs = (state && state.locations) || [];
    var schedules = (state && state.schedules) || [];
    var office = locs.find(function (l) { return l.type === 'office'; }) || {};
    var remote = locs.find(function (l) { return l.type === 'remote'; }) || {};

    var scheduleRows = schedules.length
      ? schedules.map(function (s) {
          return '<div class="tma-presence-settings__schedule-row">' +
            '<span>' + esc(meta(s.status).label) + '<br><small>' + esc(new Date(s.startsAt).toLocaleString()) + ' – ' + esc(new Date(s.endsAt).toLocaleString()) + '</small></span>' +
            '<button type="button" class="tma-btn tma-btn--secondary" data-schedule-del="' + s.id + '">Remove</button></div>';
        }).join('')
      : '<p style="font-size:13px;color:var(--color-text-secondary)">No scheduled statuses yet.</p>';

    var wrap = document.createElement('div');
    wrap.className = 'tma-modal-overlay';
    wrap.setAttribute('data-presence-settings-modal', '');
    wrap.innerHTML =
      '<div class="tma-modal" role="dialog" aria-label="Status settings" style="max-width:520px;width:calc(100% - 32px)">' +
      '<div class="tma-modal__head"><h2 class="tma-modal__title">Presence settings</h2>' +
      '<button type="button" class="tma-modal__close" data-presence-close aria-label="Close">&times;</button></div>' +
      '<div class="tma-presence-settings__tabs">' +
      '<button type="button" class="tma-presence-settings__tab is-active" data-tab="locations">Work locations</button>' +
      '<button type="button" class="tma-presence-settings__tab" data-tab="schedules">Scheduled statuses</button></div>' +
      '<div class="tma-presence-settings">' +
      '<div class="tma-presence-settings__panel" data-panel="locations">' +
      '<p style="font-size:13px;color:var(--color-text-secondary);margin:0 0 12px">Allow location access to automatically detect whether you\'re working from the office or remotely. Your exact location is never shown to others.</p>' +
      '<h3 style="font-size:14px;margin:16px 0 8px">Office location</h3>' +
      '<label>Label</label><input data-loc-office-label value="' + esc(office.label || 'Office') + '">' +
      '<label>Address</label><input data-loc-office-address value="' + esc(office.address || '') + '" placeholder="123 Example Street">' +
      '<div class="tma-presence-settings__row"><div><label>Latitude</label><input data-loc-office-lat type="number" step="any" value="' + esc(office.latitude || '') + '"></div>' +
      '<div><label>Longitude</label><input data-loc-office-lng type="number" step="any" value="' + esc(office.longitude || '') + '"></div></div>' +
      '<label>Radius (metres)</label><input data-loc-office-radius type="number" min="25" max="5000" value="' + esc(office.radiusM || 100) + '">' +
      '<label><input type="checkbox" data-loc-office-enabled ' + (office.enabled !== false ? 'checked' : '') + '> Enable automatic detection</label>' +
      '<button type="button" class="tma-btn tma-btn--secondary" data-loc-office-current style="margin-top:8px">Use current location</button>' +
      '<h3 style="font-size:14px;margin:20px 0 8px">Remote location</h3>' +
      '<label>Label</label><input data-loc-remote-label value="' + esc(remote.label || 'Home') + '">' +
      '<label>Address</label><input data-loc-remote-address value="' + esc(remote.address || '') + '">' +
      '<div class="tma-presence-settings__row"><div><label>Latitude</label><input data-loc-remote-lat type="number" step="any" value="' + esc(remote.latitude || '') + '"></div>' +
      '<div><label>Longitude</label><input data-loc-remote-lng type="number" step="any" value="' + esc(remote.longitude || '') + '"></div></div>' +
      '<label>Radius (metres)</label><input data-loc-remote-radius type="number" min="25" max="5000" value="' + esc(remote.radiusM || 100) + '">' +
      '<label><input type="checkbox" data-loc-remote-enabled ' + (remote.enabled !== false ? 'checked' : '') + '> Enable automatic detection</label>' +
      '<button type="button" class="tma-btn tma-btn--secondary" data-loc-remote-current style="margin-top:8px">Use current location</button>' +
      '</div>' +
      '<div class="tma-presence-settings__panel" data-panel="schedules" hidden>' +
      '<p style="font-size:13px;color:var(--color-text-secondary);margin:0 0 12px">Schedule Away, meetings, or focus time with start and end dates.</p>' +
      scheduleRows +
      '<h3 style="font-size:14px;margin:16px 0 8px">Add schedule</h3>' +
      '<label>Status</label><select data-schedule-status><option value="away">Away</option><option value="at_meeting">At a Meeting</option><option value="do_not_disturb">Do Not Disturb</option><option value="focus_time">Focus Time</option></select>' +
      '<div class="tma-presence-settings__row"><div><label>Starts</label><input type="datetime-local" data-schedule-starts></div>' +
      '<div><label>Ends</label><input type="datetime-local" data-schedule-ends></div></div>' +
      '<label>Message (optional)</label><input data-schedule-message maxlength="140">' +
      '<button type="button" class="tma-btn tma-btn--secondary" data-schedule-add style="margin-top:10px">Add schedule</button></div>' +
      '<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">' +
      '<button type="button" class="tma-btn tma-btn--secondary" data-presence-close>Close</button>' +
      '<button type="button" class="tma-btn tma-btn--primary" data-presence-save-locations>Save locations</button></div></div></div>';

    document.body.appendChild(wrap);

    wrap.querySelectorAll('[data-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        wrap.querySelectorAll('[data-tab]').forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        var id = tab.getAttribute('data-tab');
        wrap.querySelectorAll('[data-panel]').forEach(function (p) {
          p.hidden = p.getAttribute('data-panel') !== id;
        });
      });
    });

    function useCurrent(prefix) {
      if (!navigator.geolocation) { toast('Location is not supported in this browser.', false); return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        wrap.querySelector('[data-loc-' + prefix + '-lat]').value = pos.coords.latitude;
        wrap.querySelector('[data-loc-' + prefix + '-lng]').value = pos.coords.longitude;
      }, function () { toast('Location permission denied.', false); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
    }

    wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-presence-close]')) { wrap.remove(); return; }
      if (e.target.closest('[data-loc-office-current]')) { useCurrent('office'); return; }
      if (e.target.closest('[data-loc-remote-current]')) { useCurrent('remote'); return; }
      var del = e.target.closest('[data-schedule-del]');
      if (del) {
        api('DELETE', '/me/availability/schedules/' + del.getAttribute('data-schedule-del'))
          .then(applyPayload).then(function () { wrap.remove(); openSettingsModal(); })
          .catch(function () { toast('Could not remove schedule.', false); });
        return;
      }
      if (e.target.closest('[data-schedule-add]')) {
        var starts = wrap.querySelector('[data-schedule-starts]').value;
        var ends = wrap.querySelector('[data-schedule-ends]').value;
        if (!starts || !ends) { toast('Choose start and end times.', false); return; }
        api('POST', '/me/availability/schedules', {
          status: wrap.querySelector('[data-schedule-status]').value,
          message: wrap.querySelector('[data-schedule-message]').value || null,
          startsAt: new Date(starts).toISOString(),
          endsAt: new Date(ends).toISOString(),
        }).then(applyPayload).then(function () { wrap.remove(); openSettingsModal(); toast('Schedule added.', true); })
          .catch(function () { toast('Could not add schedule.', false); });
        return;
      }
      if (e.target.closest('[data-presence-save-locations]')) {
        saveLocation('office', wrap).then(function () { return saveLocation('remote', wrap); })
          .then(function () { requestLocationIfEnabled(); startLocationChecks(); toast('Locations saved.', true); })
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

  function requestLocationIfEnabled() {
    var locs = (state && state.locations) || [];
    if (!locs.some(function (l) { return l.enabled; }) || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function () { startLocationChecks(); }, function () { /* denied */ },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
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
    if (fromMe && fromMe.availability) return applyPayload(fromMe.availability);
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
    if (!locs.some(function (l) { return l.enabled && l.latitude != null; }) || !navigator.geolocation) return;

    function tick() {
      if (document.visibilityState === 'hidden') return;
      navigator.geolocation.getCurrentPosition(function (pos) {
        api('POST', '/me/availability/location', { lat: pos.coords.latitude, lng: pos.coords.longitude })
          .then(applyPayload).catch(function () {});
      }, function () {}, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
    }
    tick();
    locationTimer = setInterval(tick, 300000);
  }

  function bindCallIntegration() {
    if (window._tmaPresenceCallBound) return;
    window._tmaPresenceCallBound = true;
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
    if (realtimeBound || !userId) return;
    var rt = window.TMAMessagingRealtime;
    if (!rt) return;
    realtimeBound = true;
    rt.listen('private-portal.staff', 'presence.status', onRemoteStatus);
    rt.listen('private-App.Models.User.' + userId, 'presence.status', onRemoteStatus);
  }

  function onRemoteStatus(payload) {
    if (!payload || payload.userId == null) return;
    var me = window.TMACurrentUser && window.TMACurrentUser.get();
    if (me && payload.userId === me.id) { load(); return; }
    document.dispatchEvent(new CustomEvent('tma:presence-status', { detail: payload }));
  }

  function applyRemoteToPerson(person, payload) {
    if (!person || person.id !== payload.userId) return person;
    person.status = payload.status;
    person.statusLabel = payload.label;
    person.statusSource = payload.source;
    person.statusMessage = payload.message;
    person.statusIcon = payload.icon;
    person.online = payload.status !== 'offline';
    return person;
  }

  function wire() {
    if (wired) return;
    wired = true;
    loadCss();
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
    applyRemoteToPerson: applyRemoteToPerson,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
