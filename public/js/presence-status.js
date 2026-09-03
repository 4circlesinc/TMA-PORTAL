/*
 * TMA. Advanced user presence & availability status.
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
  var locationMaps = {};
  var leafletPromise = null;
  var DEFAULT_MAP = { lat: 45.5017, lng: -73.5673, zoom: 12 };

  var STATUS = {
    online: { label: 'Online', icon: 'green' },
    offline: { label: 'Offline', icon: 'gray' },
    on_call: { label: 'On a Call', icon: 'red' },
    at_meeting: { label: 'At a Meeting', icon: 'calendar' },
    do_not_disturb: { label: 'Do Not Disturb', icon: 'dnd' },
    in_office: { label: 'In Office', icon: 'office' },
    working_remote: { label: 'Working Remote', icon: 'home' },
    away: { label: 'Out of Office', icon: 'away' },
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
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var msg = (data && data.message) || 'Request failed';
          if (data && data.errors) {
            var key = Object.keys(data.errors)[0];
            if (key && data.errors[key] && data.errors[key][0]) msg = data.errors[key][0];
          }
          throw new Error(msg);
        }
        return data;
      });
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
      if (p.statusMessage) return base + ': ' + p.statusMessage;
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
    link.href = (ROOT || '') + 'css/presence.css?v=13';
    document.head.appendChild(link);
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      if (!document.getElementById('tma-leaflet-css')) {
        var css = document.createElement('link');
        css.id = 'tma-leaflet-css';
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);
      }
      var script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = function () { resolve(window.L); };
      script.onerror = function () { reject(new Error('Map library failed to load')); };
      document.head.appendChild(script);
    });
    return leafletPromise;
  }

  function destroyLocationMaps() {
    Object.keys(locationMaps).forEach(function (key) {
      if (locationMaps[key] && locationMaps[key].map) locationMaps[key].map.remove();
      delete locationMaps[key];
    });
  }

  function writeLocCoords(root, prefix, lat, lng, updateMap) {
    var latEl = root.querySelector('[data-loc-' + prefix + '-lat]');
    var lngEl = root.querySelector('[data-loc-' + prefix + '-lng]');
    var coordsEl = root.querySelector('[data-loc-' + prefix + '-coords]');
    if (latEl) latEl.value = lat;
    if (lngEl) lngEl.value = lng;
    if (coordsEl) {
      coordsEl.textContent = Number(lat).toFixed(6) + ', ' + Number(lng).toFixed(6);
      coordsEl.hidden = false;
    }
    if (updateMap) {
      var entry = locationMaps[prefix];
      if (entry && entry.setPosition) entry.setPosition(lat, lng, locRadius(root, prefix));
    }
  }

  function syncCoordsFromMap(root, prefix) {
    var entry = locationMaps[prefix];
    if (!entry || !entry.marker) return;
    var p = entry.marker.getLatLng();
    writeLocCoords(root, prefix, p.lat, p.lng, false);
  }

  function syncAllCoordsFromMaps(root) {
    ['office', 'remote'].forEach(function (prefix) {
      syncCoordsFromMap(root, prefix);
    });
  }

  function locCoords(root, prefix) {
    syncCoordsFromMap(root, prefix);
    var latEl = root.querySelector('[data-loc-' + prefix + '-lat]');
    var lngEl = root.querySelector('[data-loc-' + prefix + '-lng]');
    if (!latEl || !lngEl) return null;
    var lat = parseFloat(latEl.value);
    var lng = parseFloat(lngEl.value);
    if (!isNaN(lat) && !isNaN(lng)) return { lat: lat, lng: lng };

    /* Visible coords can be set while hidden inputs are still catching up. */
    var coordsEl = root.querySelector('[data-loc-' + prefix + '-coords]');
    if (coordsEl && !coordsEl.hidden && coordsEl.textContent.trim()) {
      var parts = coordsEl.textContent.trim().split(',');
      if (parts.length >= 2) {
        lat = parseFloat(parts[0]);
        lng = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lng)) {
          writeLocCoords(root, prefix, lat, lng, false);
          return { lat: lat, lng: lng };
        }
      }
    }
    return null;
  }

  function locRadius(root, prefix) {
    return parseInt(root.querySelector('[data-loc-' + prefix + '-radius]').value, 10) || 100;
  }

  function setLocCoords(root, prefix, lat, lng) {
    writeLocCoords(root, prefix, lat, lng, true);
  }

  function applyLocationOnMap(root, prefix, lat, lng, addressLabel) {
    writeLocCoords(root, prefix, lat, lng, true);
    var entry = locationMaps[prefix];
    if (entry && entry.map) {
      entry.map.setView([lat, lng], 16, { animate: true });
      setTimeout(function () { entry.map.invalidateSize(); }, 80);
    }
    var addressEl = root.querySelector('[data-loc-' + prefix + '-address]');
    if (addressEl && addressLabel) addressEl.value = addressLabel;
  }

  function fillAddressLabel(root, prefix, lat, lng, fallback) {
    reverseGeocodeAddress(lat, lng)
      .then(function (res) {
        var addressEl = root.querySelector('[data-loc-' + prefix + '-address]');
        if (addressEl) addressEl.value = (res && res.label) ? res.label : fallback;
      })
      .catch(function () {
        var addressEl = root.querySelector('[data-loc-' + prefix + '-address]');
        if (addressEl && fallback) addressEl.value = fallback;
      });
  }

  function useCurrentLocation(root, prefix, mapsReady) {
    if (!navigator.geolocation) {
      toast('Location is not supported in this browser.', false);
      return;
    }
    var btn = root.querySelector('[data-loc-' + prefix + '-current]');
    var btnLabel = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Getting location…';
    }

    function done() {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btnLabel || 'Use current location';
      }
    }

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        var fallbackAddress = Number(lat).toFixed(6) + ', ' + Number(lng).toFixed(6);

        function placeOnMap() {
          applyLocationOnMap(root, prefix, lat, lng, fallbackAddress);
          fillAddressLabel(root, prefix, lat, lng, fallbackAddress);
          toast('Location set on map.', true);
          done();
        }

        writeLocCoords(root, prefix, lat, lng, false);
        fillAddressLabel(root, prefix, lat, lng, fallbackAddress);
        if (mapsReady && typeof mapsReady.then === 'function') mapsReady.then(placeOnMap).catch(placeOnMap);
        else placeOnMap();
      },
      function (err) {
        var msg = 'Location permission denied.';
        if (err && err.code === 2) msg = 'Location unavailable. Check your device settings.';
        if (err && err.code === 3) msg = 'Location request timed out. Try again.';
        toast(msg, false);
        done();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  function geocodeAddress(q) {
    return api('GET', '/me/availability/geocode?q=' + encodeURIComponent(q));
  }

  function reverseGeocodeAddress(lat, lng) {
    return api('GET', '/me/availability/reverse-geocode?lat=' + encodeURIComponent(lat) + '&lng=' + encodeURIComponent(lng));
  }

  function initLocationMap(root, prefix, loc) {
    var mapEl = root.querySelector('[data-loc-' + prefix + '-map]');
    if (!mapEl || locationMaps[prefix]) return Promise.resolve();

    return loadLeaflet().then(function (L) {
      if (locationMaps[prefix]) return;

      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      var savedCoords = loc && loc.latitude != null && loc.longitude != null
        ? { lat: loc.latitude, lng: loc.longitude }
        : locCoords(root, prefix);
      var center = savedCoords || DEFAULT_MAP;
      var zoom = savedCoords ? 15 : DEFAULT_MAP.zoom;
      var hasPin = !!savedCoords;

      var map = L.map(mapEl, { scrollWheelZoom: true }).setView([center.lat, center.lng], zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      var marker = null;
      var circle = null;

      function ensurePin(lat, lng, radius) {
        if (!marker) {
          marker = L.marker([lat, lng], { draggable: true }).addTo(map);
          circle = L.circle([lat, lng], {
            radius: radius || locRadius(root, prefix),
            color: '#03a5e9',
            fillColor: '#03a5e9',
            fillOpacity: 0.12,
            weight: 2,
          }).addTo(map);
          marker.on('dragend', function () {
            var p = marker.getLatLng();
            applyLocationOnMap(root, prefix, p.lat, p.lng, null);
            fillAddressLabel(root, prefix, p.lat, p.lng, null);
          });
        }
        return marker;
      }

      function setPosition(lat, lng, radius) {
        ensurePin(lat, lng, radius);
        marker.setLatLng([lat, lng]);
        circle.setLatLng([lat, lng]);
        circle.setRadius(radius || locRadius(root, prefix));
        map.panTo([lat, lng], { animate: true });
        writeLocCoords(root, prefix, lat, lng, false);
      }

      if (hasPin) {
        setPosition(center.lat, center.lng, loc && loc.radiusM ? loc.radiusM : locRadius(root, prefix));
      }

      map.on('click', function (e) {
        applyLocationOnMap(root, prefix, e.latlng.lat, e.latlng.lng, null);
        fillAddressLabel(root, prefix, e.latlng.lat, e.latlng.lng, null);
      });

      var radiusEl = root.querySelector('[data-loc-' + prefix + '-radius]');
      if (radiusEl) {
        radiusEl.addEventListener('input', function () {
          if (circle) circle.setRadius(locRadius(root, prefix));
        });
      }

      locationMaps[prefix] = {
        map: map,
        get marker() { return marker; },
        get circle() { return circle; },
        setPosition: setPosition,
      };
      setTimeout(function () { map.invalidateSize(); }, 80);
    }).catch(function () {
      if (mapEl) mapEl.innerHTML = '<p class="tma-presence-loc__map-fallback">Map unavailable. Use address search or current location.</p>';
    });
  }

  function refreshLocationMaps(root) {
    ['office', 'remote'].forEach(function (prefix) {
      if (locationMaps[prefix] && locationMaps[prefix].map) {
        locationMaps[prefix].map.invalidateSize();
      }
    });
  }

  function initAllLocationMaps(root, office, remote) {
    destroyLocationMaps();
    return Promise.all([
      initLocationMap(root, 'office', office),
      initLocationMap(root, 'remote', remote),
    ]).then(function () { refreshLocationMaps(root); });
  }

  function searchLocationAddress(root, prefix) {
    var q = root.querySelector('[data-loc-' + prefix + '-address]').value.trim();
    if (!q) { toast('Enter an address to search.', false); return Promise.resolve(); }
    return geocodeAddress(q).then(function (res) {
      applyLocationOnMap(root, prefix, res.lat, res.lng, res.label || q);
    }).catch(function (err) {
      toast(err.message || 'Could not find that address.', false);
    });
  }

  function paintHeader() {
    ensureSlots();
    var p = primary();
    var slug = p.status || 'online';
    var label = p.label || meta(slug).label;
    var icon = p.icon || meta(slug).icon;
    var title = p.message ? label + ': ' + p.message : label;

    /*
     * Rewriting the pill costs a fresh <img> for the status icon, and the
     * icon flashes while it is fetched. Plenty of things repaint the header
     * that have nothing to say about presence, a view render, a /me answer,
     * so paint only what changed and leave an unchanged pill alone.
     */
    var key = slug + '\u0000' + icon + '\u0000' + label + '\u0000' + title;
    var pillHtml = null;

    document.querySelectorAll('[data-presence-indicator]').forEach(function (el) {
      if (el.getAttribute('data-presence-painted') === key && el.firstChild) return;
      if (pillHtml === null) {
        pillHtml = iconHtml(icon, 8) +
          '<span class="tma-presence-pill__label">' + esc(label) + '</span>';
      }
      el.className = 'tma-presence-pill tma-presence-pill--' + slug;
      el.innerHTML = pillHtml;
      el.setAttribute('data-presence-status', slug);
      el.title = title;
      el.setAttribute('aria-label', 'Status: ' + label + '. Click to change.');
      el.setAttribute('data-presence-painted', key);
    });

    document.querySelectorAll('[data-presence-titlebar]').forEach(function (wrap) {
      wrap.hidden = true;
    });
  }

  /** @deprecated alias */
  function paintProfile() { paintHeader(); }

  function makePresenceButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tma-presence-pill';
    btn.setAttribute('data-presence-indicator', '');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    return btn;
  }

  function ensureSlots() {
    /* Browser / desktop shell: first slot inside the header icon cluster, so
     * on tablet/phone the status shares the same bubble as dark mode etc. */
    document.querySelectorAll('.tma-dash__header-right').forEach(function (right) {
      var icons = right.querySelector('.tma-dash__header-icons');
      if (!icons) return;
      var wrap = right.querySelector('[data-presence-header]');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'tma-dash__header-presence';
        wrap.setAttribute('data-presence-header', '');
        wrap.appendChild(makePresenceButton());
        icons.insertAdjacentElement('afterbegin', wrap);
      } else {
        if (!wrap.querySelector('[data-presence-indicator]')) {
          wrap.appendChild(makePresenceButton());
        }
        if (wrap.parentElement !== icons || icons.firstElementChild !== wrap) {
          icons.insertAdjacentElement('afterbegin', wrap);
        }
      }
      wrap.querySelectorAll('[data-presence-user-name]').forEach(function (el) { el.remove(); });
    });

    /* Legacy placements, title area, sidebar, duplicate slots. */
    document.querySelectorAll(
      '.tma-dash__header-left [data-presence-header], .tma-dash__profile-meta [data-presence-indicator], [data-presence-titlebar] [data-presence-indicator]'
    ).forEach(function (el) {
      var block = el.closest('[data-presence-header]') || el.closest('[data-presence-titlebar]') || el;
      if (block.matches('[data-presence-titlebar]')) {
        el.remove();
      } else {
        block.remove();
      }
    });
  }

  /** @deprecated */
  function ensureHeaderSlot() { ensureSlots(); }

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
      '<div class="tma-presence-popover__section tma-presence-popover__section--now">' +
      '<div class="tma-presence-popover__current"><span class="tma-presence-popover__current-icon">' + iconHtml(p.icon, 12) + '</span>' +
      '<div class="tma-presence-popover__current-meta">' +
      '<div class="tma-presence-popover__current-title">' + esc(p.label || meta(p.status).label) + '</div>' +
      '<div class="tma-presence-popover__current-sub">' + esc(sourceLabel(p.source)) +
      (p.expiresAt ? ' · until ' + esc(new Date(p.expiresAt).toLocaleString()) : '') +
      '</div></div></div>' +
      '<div class="tma-presence-popover__message"><input type="text" maxlength="140" placeholder="Add a status message…" data-presence-message aria-label="Status message" value="' + esc(p.message || '') + '"></div>' +
      '</div>' +
      '<div class="tma-presence-popover__section tma-presence-popover__section--pick">' + items +
      durationSectionHtml('at_meeting') + '</div>' +
      '<div class="tma-presence-popover__section tma-presence-popover__section--foot">' +
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
        e.preventDefault();
        e.stopPropagation();
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

  function closeSettingsModal() {
    destroyLocationMaps();
    if (window.TMAPortalUI && window.TMAPortalUI.closeModal) {
      window.TMAPortalUI.closeModal();
      return;
    }
    var el = document.querySelector('[data-presence-settings-modal]');
    if (el) el.remove();
  }

  function settingsModalRoot(host) {
    return (host && host.querySelector('.tma-portal-modal__body')) || host || document;
  }

  function locationBlockHtml(prefix, title, loc) {
    loc = loc || {};
    var ghostBtn = 'tma-no-data__btn tma-portal-btn--ghost';
    var lat = loc.latitude != null && loc.latitude !== '' ? loc.latitude : '';
    var lng = loc.longitude != null && loc.longitude !== '' ? loc.longitude : '';
    return (
      '<section class="tma-presence-loc" data-loc-block="' + prefix + '">' +
      '<h3 class="tma-presence-loc__title">' + esc(title) + '</h3>' +
      '<label>Label</label><input data-loc-' + prefix + '-label value="' + esc(loc.label || title) + '">' +
      '<label>Address</label>' +
      '<div class="tma-presence-loc__search">' +
      '<input type="text" data-loc-' + prefix + '-address value="' + esc(loc.address || '') + '" placeholder="Search for an address…">' +
      '<button type="button" class="' + ghostBtn + '" data-loc-' + prefix + '-search>Find on map</button></div>' +
      '<div class="tma-presence-loc__map" data-loc-' + prefix + '-map role="application" aria-label="' + esc(title) + ' map"></div>' +
      '<p class="tma-presence-loc__hint">Click the map, search an address, or use current location to set a pin. The circle shows the detection radius.</p>' +
      '<input type="hidden" data-loc-' + prefix + '-lat value="' + esc(lat) + '">' +
      '<input type="hidden" data-loc-' + prefix + '-lng value="' + esc(lng) + '">' +
      '<p class="tma-presence-loc__coords" data-loc-' + prefix + '-coords' + (lat && lng ? '' : ' hidden') + '>' +
      (lat && lng ? esc(Number(lat).toFixed(6) + ', ' + Number(lng).toFixed(6)) : '') + '</p>' +
      '<label>Detection radius (metres)</label>' +
      '<input data-loc-' + prefix + '-radius type="number" min="25" max="5000" step="25" value="' + esc(loc.radiusM || 100) + '">' +
      '<label class="tma-presence-settings__check"><input type="checkbox" data-loc-' + prefix + '-enabled ' +
      (lat && lng && loc.enabled !== false ? 'checked' : '') + '><span>Enable automatic detection</span></label>' +
      '<div class="tma-presence-loc__actions">' +
      '<button type="button" class="' + ghostBtn + '" data-loc-' + prefix + '-current>Use current location</button>' +
      '<button type="button" class="' + ghostBtn + '" data-loc-' + prefix + '-reset>Reset</button></div>' +
      '</section>'
    );
  }

  function clearLocationBlock(root, prefix) {
    var title = prefix === 'office' ? 'Office location' : 'Remote location';
    var labelEl = root.querySelector('[data-loc-' + prefix + '-label]');
    var addressEl = root.querySelector('[data-loc-' + prefix + '-address]');
    var latEl = root.querySelector('[data-loc-' + prefix + '-lat]');
    var lngEl = root.querySelector('[data-loc-' + prefix + '-lng]');
    var radiusEl = root.querySelector('[data-loc-' + prefix + '-radius]');
    var enabledEl = root.querySelector('[data-loc-' + prefix + '-enabled]');
    var coordsEl = root.querySelector('[data-loc-' + prefix + '-coords]');
    if (labelEl) labelEl.value = title;
    if (addressEl) addressEl.value = '';
    if (latEl) latEl.value = '';
    if (lngEl) lngEl.value = '';
    if (radiusEl) radiusEl.value = '100';
    if (enabledEl) enabledEl.checked = false;
    if (coordsEl) { coordsEl.textContent = ''; coordsEl.hidden = true; }
    if (locationMaps[prefix] && locationMaps[prefix].setPosition) {
      locationMaps[prefix].setPosition(DEFAULT_MAP.lat, DEFAULT_MAP.lng, 100);
      locationMaps[prefix].map.setView([DEFAULT_MAP.lat, DEFAULT_MAP.lng], DEFAULT_MAP.zoom);
    }
  }

  function resetLocation(type, root) {
    var prefix = type === 'office' ? 'office' : 'remote';
    var title = type === 'office' ? 'Office' : 'Remote';
    return api('DELETE', '/me/availability/locations/' + type)
      .then(applyPayload)
      .then(function () {
        clearLocationBlock(root, prefix);
        toast(title + ' location reset.', true);
      })
      .catch(function (err) {
        toast(err.message || 'Could not reset location.', false);
      });
  }

  function settingsModalBodyHtml(office, remote, scheduleRows) {
    var ghostBtn = 'tma-no-data__btn tma-portal-btn--ghost';
    var primaryBtn = 'tma-no-data__btn';
    return (
      '<div class="tma-presence-settings__tabs">' +
      '<button type="button" class="tma-presence-settings__tab is-active" data-tab="locations">Work locations</button>' +
      '<button type="button" class="tma-presence-settings__tab" data-tab="schedules">Scheduled statuses</button></div>' +
      '<div class="tma-presence-settings">' +
      '<div class="tma-presence-settings__panel" data-panel="locations">' +
      '<p class="tma-presence-loc__intro">Allow location access to automatically detect whether you\'re working from the office or remotely. Your exact location is never shown to others.</p>' +
      locationBlockHtml('office', 'Office location', office) +
      locationBlockHtml('remote', 'Remote location', remote) +
      '</div>' +
      '<div class="tma-presence-settings__panel" data-panel="schedules" hidden>' +
      '<p style="font-size:13px;color:var(--color-text-secondary);margin:0 0 12px">Schedule Away, meetings, or focus time with start and end dates.</p>' +
      scheduleRows +
      '<h3 style="font-size:14px;margin:16px 0 8px">Add schedule</h3>' +
      '<label>Status</label><select data-schedule-status><option value="away">Out of Office</option><option value="at_meeting">At a Meeting</option><option value="do_not_disturb">Do Not Disturb</option><option value="focus_time">Focus Time</option></select>' +
      '<div class="tma-presence-settings__row"><div><label>Starts</label><input type="datetime-local" data-schedule-starts></div>' +
      '<div><label>Ends</label><input type="datetime-local" data-schedule-ends></div></div>' +
      '<label>Message (optional)</label><input data-schedule-message maxlength="140">' +
      '<button type="button" class="' + ghostBtn + '" data-schedule-add style="margin-top:10px">Add schedule</button></div>' +
      '<div class="tma-portal-modal__foot">' +
      '<button type="button" class="' + ghostBtn + '" data-presence-close>Close</button>' +
      '<button type="button" class="' + primaryBtn + '" data-presence-save-locations>Save locations</button></div></div>'
    );
  }

  function wireSettingsModal(host, office, remote) {
    var root = settingsModalRoot(host);
    office = office || {};
    remote = remote || {};

    root.querySelectorAll('[data-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        root.querySelectorAll('[data-tab]').forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        var id = tab.getAttribute('data-tab');
        root.querySelectorAll('[data-panel]').forEach(function (p) {
          p.hidden = p.getAttribute('data-panel') !== id;
        });
        if (id === 'locations') setTimeout(function () { refreshLocationMaps(root); }, 60);
      });
    });

    var mapsReady = initAllLocationMaps(root, office, remote);

    root.querySelectorAll('[data-loc-office-address], [data-loc-remote-address]').forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var prefix = input.hasAttribute('data-loc-office-address') ? 'office' : 'remote';
        searchLocationAddress(root, prefix);
      });
    });

    host.addEventListener('click', function (e) {
      if (e.target.closest('[data-presence-close]')) { closeSettingsModal(); return; }
      if (e.target.closest('[data-loc-office-search]')) { searchLocationAddress(root, 'office'); return; }
      if (e.target.closest('[data-loc-remote-search]')) { searchLocationAddress(root, 'remote'); return; }
      if (e.target.closest('[data-loc-office-current]')) { useCurrentLocation(root, 'office', mapsReady); return; }
      if (e.target.closest('[data-loc-remote-current]')) { useCurrentLocation(root, 'remote', mapsReady); return; }
      if (e.target.closest('[data-loc-office-reset]')) { resetLocation('office', root); return; }
      if (e.target.closest('[data-loc-remote-reset]')) { resetLocation('remote', root); return; }
      var del = e.target.closest('[data-schedule-del]');
      if (del) {
        api('DELETE', '/me/availability/schedules/' + del.getAttribute('data-schedule-del'))
          .then(applyPayload).then(function () { closeSettingsModal(); openSettingsModal(); })
          .catch(function () { toast('Could not remove schedule.', false); });
        return;
      }
      if (e.target.closest('[data-schedule-add]')) {
        var starts = root.querySelector('[data-schedule-starts]').value;
        var ends = root.querySelector('[data-schedule-ends]').value;
        if (!starts || !ends) { toast('Choose start and end times.', false); return; }
        api('POST', '/me/availability/schedules', {
          status: root.querySelector('[data-schedule-status]').value,
          message: root.querySelector('[data-schedule-message]').value || null,
          startsAt: new Date(starts).toISOString(),
          endsAt: new Date(ends).toISOString(),
        }).then(applyPayload).then(function () { closeSettingsModal(); openSettingsModal(); toast('Schedule added.', true); })
          .catch(function () { toast('Could not add schedule.', false); });
        return;
      }
      if (e.target.closest('[data-presence-save-locations]')) {
        e.preventDefault();
        e.stopPropagation();
        var saveBtn = e.target.closest('[data-presence-save-locations]');
        if (saveBtn && saveBtn.disabled) return;
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
        saveAllLocations(root)
          .then(function () {
            requestLocationIfEnabled();
            startLocationChecks();
            toast('Locations saved.', true);
          })
          .catch(function (err) { toast(err.message || 'Could not save locations.', false); })
          .finally(function () {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save locations'; }
          });
        return;
      }
    });
  }

  function renderSettingsModal() {
    loadCss();
    var locs = (state && state.locations) || [];
    var schedules = (state && state.schedules) || [];
    var office = locs.find(function (l) { return l.type === 'office'; }) || {};
    var remote = locs.find(function (l) { return l.type === 'remote'; }) || {};

    var scheduleRows = schedules.length
      ? schedules.map(function (s) {
          return '<div class="tma-presence-settings__schedule-row">' +
            '<span>' + esc(meta(s.status).label) + '<br><small>' + esc(new Date(s.startsAt).toLocaleString()) + ' – ' + esc(new Date(s.endsAt).toLocaleString()) + '</small></span>' +
            '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-schedule-del="' + s.id + '">Remove</button></div>';
        }).join('')
      : '<p style="font-size:13px;color:var(--color-text-secondary)">No scheduled statuses yet.</p>';

    var body = settingsModalBodyHtml(office, remote, scheduleRows);
    var ui = window.TMAPortalUI;

    closeSettingsModal();

    if (ui && ui.openModal) {
      var host = ui.openModal({
        title: 'Presence settings',
        body: body,
        onMount: function (modalHost) { wireSettingsModal(modalHost, office, remote); },
      });
      if (host) host.setAttribute('data-presence-settings-modal', '');
      return;
    }

    /* Fallback when portal-views.js is not on the page. */
    var wrap = document.createElement('div');
    wrap.className = 'tma-presence-settings-modal';
    wrap.setAttribute('data-presence-settings-modal', '');
    wrap.innerHTML =
      '<div class="tma-dash__settings-change-card tma-presence-settings-modal__card" role="dialog" aria-label="Status settings">' +
      '<div class="tma-presence-settings-modal__head"><h2>Presence settings</h2>' +
      '<button type="button" class="tma-dash__settings-change-close" data-presence-close aria-label="Close">&times;</button></div>' +
      body +
      '</div>';
    document.body.appendChild(wrap);
    wireSettingsModal(wrap, office, remote);
  }

  function openSettingsModal() {
    if (state) {
      renderSettingsModal();
      return;
    }
    load().then(renderSettingsModal).catch(function () {
      toast('Could not load status settings.', false);
    });
  }

  function hasLocationData(root, prefix) {
    if (locCoords(root, prefix)) return true;
    var addressEl = root.querySelector('[data-loc-' + prefix + '-address]');
    return !!(addressEl && addressEl.value.trim());
  }

  function saveLocation(type, wrap) {
    var prefix = type === 'office' ? 'office' : 'remote';
    var title = type === 'office' ? 'Office' : 'Remote';
    syncCoordsFromMap(wrap, prefix);
    var enabledEl = wrap.querySelector('[data-loc-' + prefix + '-enabled]');
    var enabled = !!(enabledEl && enabledEl.checked);
    var coords = locCoords(wrap, prefix);
    var addressEl = wrap.querySelector('[data-loc-' + prefix + '-address]');
    var address = addressEl ? addressEl.value.trim() : '';
    var hasCoords = !!coords;

    function persist(latitude, longitude) {
      return api('PUT', '/me/availability/locations', {
        type: type,
        label: wrap.querySelector('[data-loc-' + prefix + '-label]').value,
        address: wrap.querySelector('[data-loc-' + prefix + '-address]').value,
        latitude: latitude,
        longitude: longitude,
        radiusM: parseInt(wrap.querySelector('[data-loc-' + prefix + '-radius]').value, 10) || 100,
        enabled: enabled,
      }).then(function (data) {
        applyPayload(data);
        return true;
      });
    }

    /* Nothing entered, skip unless we need to turn off a previously saved location. */
    if (!enabled && !hasCoords && !address) {
      var existing = (state && state.locations || []).find(function (l) { return l.type === type; });
      if (existing) return persist(existing.latitude, existing.longitude).then(function () { return true; });
      return Promise.resolve(false);
    }

    if (hasCoords) {
      return persist(coords.lat, coords.lng);
    }

    if (!address) {
      if (enabled) {
        return Promise.reject(new Error(title + ': set a location on the map, search an address, or use current location.'));
      }
      return Promise.resolve(false);
    }

    return geocodeAddress(address).then(function (res) {
      applyLocationOnMap(wrap, prefix, res.lat, res.lng, res.label || address);
      return persist(res.lat, res.lng);
    });
  }

  function saveAllLocations(wrap) {
    syncAllCoordsFromMaps(wrap);
    var errors = [];
    var hasAny = false;
    ['office', 'remote'].forEach(function (type) {
      var prefix = type;
      var title = type === 'office' ? 'Office' : 'Remote';
      var enabledEl = wrap.querySelector('[data-loc-' + prefix + '-enabled]');
      var enabled = !!(enabledEl && enabledEl.checked);
      var hasData = hasLocationData(wrap, prefix);
      if (hasData) hasAny = true;
      if (!enabled) return;
      if (!hasData) {
        errors.push(title + ': set a location on the map, search an address, or use current location.');
      }
    });
    if (errors.length) return Promise.reject(new Error(errors[0]));
    if (!hasAny) {
      return Promise.reject(new Error('Set a location on the map or enter an address before saving.'));
    }

    return saveLocation('office', wrap).then(function () {
      return saveLocation('remote', wrap);
    });
  }

  function requestLocationIfEnabled() {
    var locs = (state && state.locations) || [];
    if (!locs.some(function (l) { return l.enabled && l.latitude != null; }) || !navigator.geolocation) return;
    reportCurrentPosition();
  }

  function toast(msg, ok) {
    if (window.TMAToast && window.TMAToast.showFloatingToast) {
      window.TMAToast.showFloatingToast(msg, { state: ok !== false ? 'successful' : 'failure' });
      return;
    }
    if (window.TMAPortalUI) {
      if (ok === false && window.TMAPortalUI.toastError) window.TMAPortalUI.toastError(msg);
      else if (window.TMAPortalUI.toast) window.TMAPortalUI.toast(msg);
    }
  }

  function applyPayload(j) {
    state = j;
    paintHeader();
    listeners.forEach(function (fn) { fn(state); });
    scheduleExpiry();
    if ((state.locations || []).some(function (l) { return l.enabled && l.latitude != null; })) {
      startLocationChecks();
    }
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

  var locationVisibilityBound = false;
  var locationChecksArmed = false;

  function reportCurrentPosition() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        api('POST', '/me/availability/location', {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        }).then(applyPayload).catch(function () {});
      },
      function () {},
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
  }

  function locationTick() {
    if (document.visibilityState === 'hidden') return;
    reportCurrentPosition();
  }

  /*
   * Arm the geofence poll, once.
   *
   * Reporting a position answers with the whole availability payload, and
   * every payload lands in applyPayload, which arms the poll. So an
   * immediate check on each call is a loop that feeds itself: report,
   * payload, arm, report. It spun as fast as the round trip, repainting the
   * header pill on every turn (the blink) and posting a position to the
   * server without pause for anyone with a geofence saved.
   *
   * A payload is not a reason to go and look where the device is. Being
   * switched on is. So the first call starts the poll and the rest are
   * no-ops until the locations themselves change.
   */
  function startLocationChecks() {
    var locs = (state && state.locations) || [];
    var wanted = !!navigator.geolocation && locs.some(function (l) {
      return l.enabled && l.latitude != null;
    });

    if (!wanted) {
      if (locationTimer) clearInterval(locationTimer);
      locationTimer = null;
      locationChecksArmed = false;
      return;
    }
    if (locationChecksArmed) return;
    locationChecksArmed = true;

    locationTick();
    locationTimer = setInterval(locationTick, 300000);

    if (!locationVisibilityBound) {
      locationVisibilityBound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && locationChecksArmed) locationTick();
      });
    }
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
    var me = window.TMACurrentUser && window.TMACurrentUser.get && window.TMACurrentUser.get();
    if (me && me.isStaff) rt.listen('private-portal.staff', 'presence.status', onRemoteStatus);
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

  /*
   * The order a team list is read in: who is here, then who was here most
   * recently.
   *
   * Mirrors the sort in StaffPresenceController, and exists separately from it
   * on purpose — presence moves under a list that is already on screen, so
   * somebody coming online has to rise to the top on the event rather than on
   * the next poll thirty seconds later. Both surfaces that draw the team
   * (the home board's Employees tile and Overview's) sort through here, so
   * they cannot disagree about it.
   */
  function lastSeenMs(person) {
    var at = person && person.lastSeenAt ? Date.parse(person.lastSeenAt) : 0;

    return isFinite(at) ? at : 0;
  }

  function compare(a, b) {
    // Ascending on 0/1 rather than a separate descending pass, so the whole
    // order is one comparison.
    var here = (a.online ? 0 : 1) - (b.online ? 0 : 1);
    if (here) return here;

    // Most recently seen first. Never seen is 0, which lands after every real
    // timestamp rather than in front of it — the trap a plain descending sort
    // on a nullable field falls into.
    var seen = lastSeenMs(b) - lastSeenMs(a);
    if (seen) return seen;

    // Everyone online was seen "now", so that group needs a real tiebreak.
    return String(a.name || '').localeCompare(String(b.name || ''));
  }

  function wire() {
    if (wired) return;
    wired = true;
    loadCss();
    ensureSlots();
    paintHeader();

    /* Portal morph may rebuild the header, re-mount the pill beside icons. */
    if (!document.documentElement.dataset.tmaPresenceHeaderWatch) {
      document.documentElement.dataset.tmaPresenceHeaderWatch = '1';
      new MutationObserver(function () {
        var right = document.querySelector('.tma-dash__header-right');
        if (!right || !right.querySelector('.tma-dash__header-icons')) return;
        var pill = right.querySelector('[data-presence-header] [data-presence-indicator]');
        /*
         * Missing, or rebuilt empty: a morph that reconciles the header
         * against the shell's markup leaves the button there and its
         * contents gone, which looks the same to a reader as no pill at all.
         */
        if (pill && pill.firstChild) return;
        ensureSlots();
        paintHeader();
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
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
    paint: paintHeader,
    iconHtml: iconHtml,
    meta: meta,
    wire: wire,
    startLocationChecks: startLocationChecks,
    bindRealtime: bindRealtime,
    bindCallIntegration: bindCallIntegration,
    applyRemoteToPerson: applyRemoteToPerson,
    compare: compare,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
