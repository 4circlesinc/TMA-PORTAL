/*
 * Fills the portal shell with the signed-in user: sidebar profile, greeting,
 * and the avatar. The shells are static HTML, so the real values arrive from
 * /me and are painted in. Also owns the profile-picture picker.
 *
 * Global: window.TMACurrentUser  ({ get, load, openAvatarPicker, onChange })
 */
(function () {
  'use strict';

  var me = null;
  var listeners = [];

  // 1x1 transparent GIF — lets an <img> show its skeleton background with no
  // broken-image icon and, crucially, no dummy photo.
  var TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var SKELETON_TEXT = '.tma-dash__profile-name, .tma-dash__profile-email, .tma-portal-hello__title';
  var SKELETON_AVATAR = '.tma-dash__profile-avatar, .tma-dash__account-avatar, .tma-portal-hello__avatar, .tma-dash__tab-btn--profile .tma-dash__tab-btn-icon img';

  // A shimmering placeholder shown WHILE the signed-in user loads, so the
  // shells never flash their hardcoded dummy name/photo. Injected once.
  function injectSkeletonCss() {
    if (document.getElementById('tma-skeleton-css')) return;
    var style = document.createElement('style');
    style.id = 'tma-skeleton-css';
    style.textContent =
      '.tma-skeleton{background:linear-gradient(90deg,#e6eaf0 25%,#f2f5f8 37%,#e6eaf0 63%)!important;' +
      'background-size:400% 100%!important;animation:tma-shimmer 1.4s ease infinite!important;' +
      'color:transparent!important;border-radius:6px}' +
      '.tma-skeleton--text{display:inline-block;height:.72em;vertical-align:middle;min-width:80px}' +
      '.tma-skeleton--avatar{border-radius:50%!important}' +
      '.tma-skeleton--block{display:block;border-radius:8px;height:16px;min-width:24px}' +
      '.tma-skeleton--line{display:block;height:.7em;border-radius:6px;margin:.4em 0}' +
      '.tma-skeleton--circle{border-radius:50%!important;flex:0 0 auto}' +
      '.tma-skeleton-stack{display:flex;flex-direction:column;gap:6px;padding:4px 0}' +
      '.tma-skeleton-row{display:flex;align-items:center;gap:12px;padding:10px 4px}' +
      '.tma-skeleton-row__grow{flex:1;min-width:0}' +
      '.tma-dash__profile-name.tma-skeleton{min-width:92px}' +
      '.tma-dash__profile-email.tma-skeleton{min-width:124px;height:.62em}' +
      '.tma-portal-hello__title.tma-skeleton{min-width:150px;height:1.05em}' +
      '@keyframes tma-shimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}' +
      '@media (prefers-color-scheme:dark){.tma-skeleton{background:linear-gradient(90deg,#2a2f37 25%,#353b45 37%,#2a2f37 63%)!important}}';
    (document.head || document.documentElement).appendChild(style);
  }

  function setLoading() {
    injectSkeletonCss();
    document.querySelectorAll(SKELETON_TEXT).forEach(function (el) {
      el.classList.add('tma-skeleton', 'tma-skeleton--text');
      el.textContent = '';
    });
    document.querySelectorAll(SKELETON_AVATAR).forEach(function (el) {
      el.classList.add('tma-skeleton', 'tma-skeleton--avatar');
      el.src = TRANSPARENT;
      el.alt = '';
    });
  }

  function clearLoading(el) {
    el.classList.remove('tma-skeleton', 'tma-skeleton--text', 'tma-skeleton--avatar');
  }

  /* ── Global skeleton API ──────────────────────────
     Any view that loads data can show a shimmering placeholder instead of a
     spinner or (worse) dummy data. Usage:
       window.TMASkeleton.rows(6)                 // list/table loading
       window.TMASkeleton.cards(8)                // grid loading
       window.TMASkeleton.apply(el, 'text')       // turn an element into a bar
       window.TMASkeleton.clear(el)               // restore it
       window.TMASkeleton.line('60%')             // a single placeholder line   */
  var Skeleton = {
    css: injectSkeletonCss,
    apply: function (el, variant) {
      if (!el) return;
      injectSkeletonCss();
      el.classList.add('tma-skeleton', 'tma-skeleton--' + (variant || 'text'));
      if (el.tagName === 'IMG') { el.src = TRANSPARENT; el.alt = ''; } else { el.textContent = ''; }
    },
    clear: function (el) {
      if (!el) return;
      el.classList.remove('tma-skeleton', 'tma-skeleton--text', 'tma-skeleton--avatar',
        'tma-skeleton--block', 'tma-skeleton--line', 'tma-skeleton--circle');
    },
    line: function (width) {
      injectSkeletonCss();
      return '<span class="tma-skeleton tma-skeleton--line"' + (width ? ' style="width:' + width + '"' : '') + '></span>';
    },
    block: function (opts) {
      injectSkeletonCss();
      opts = opts || {};
      var s = (opts.width ? 'width:' + opts.width + ';' : '') +
        (opts.height ? 'height:' + opts.height + ';' : '') +
        (opts.radius ? 'border-radius:' + opts.radius + ';' : '');
      return '<span class="tma-skeleton tma-skeleton--block"' + (s ? ' style="' + s + '"' : '') + '></span>';
    },
    circle: function (size) {
      injectSkeletonCss();
      size = size || '32px';
      return '<span class="tma-skeleton tma-skeleton--circle" style="display:inline-block;width:' + size + ';height:' + size + '"></span>';
    },
    /* A vertical stack of loading list items (leading circle + 1–2 lines). */
    rows: function (n, opts) {
      injectSkeletonCss();
      opts = opts || {};
      n = n || 6;
      var out = '<div class="tma-skeleton-stack" role="status" aria-live="polite" aria-label="Loading">';
      for (var i = 0; i < n; i++) {
        out += '<div class="tma-skeleton-row">' +
          (opts.leading === false ? '' : this.circle(opts.leadingSize || '28px')) +
          '<div class="tma-skeleton-row__grow">' +
          this.line(opts.width1 || '55%') +
          (opts.lines === 1 ? '' : this.line(opts.width2 || '32%')) +
          '</div>' +
          (opts.trailing ? this.block({ width: '52px', height: '12px' }) : '') +
          '</div>';
      }
      return out + '</div>';
    },
    /* A responsive grid of loading cards (thumbnail + two lines). */
    cards: function (n, opts) {
      injectSkeletonCss();
      opts = opts || {};
      n = n || 8;
      var out = '<div class="tma-skeleton-cards" role="status" aria-live="polite" aria-label="Loading" ' +
        'style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px">';
      for (var i = 0; i < n; i++) {
        out += '<div>' + this.block({ height: opts.thumbHeight || '92px', radius: '10px' }) +
          '<div style="padding:10px 2px">' + this.line('70%') + this.line('40%') + '</div></div>';
      }
      return out + '</div>';
    },
  };
  window.TMASkeleton = Skeleton;

  function api(method, url, body) {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  function initialsAvatar(displayName, seed) {
    var initials = String(displayName || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?';
    var colors = ['#136da0', '#03a5e9', '#0f9d8c', '#3f9142', '#c77d18', '#b5497e', '#3b6fb8'];
    var n = 0, s = String(seed || displayName || '');
    for (var i = 0; i < s.length; i++) n = (n + s.charCodeAt(i)) % 997;
    var bg = colors[n % colors.length];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
      '<rect width="40" height="40" rx="20" fill="' + bg + '"/>' +
      '<text x="20" y="21" font-family="Inter, system-ui, sans-serif" font-size="15" font-weight="600" ' +
      'fill="#ffffff" text-anchor="middle" dominant-baseline="central">' + initials + '</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  // A real photo (uploaded /storage/… or a provider https URL) if there is one;
  // otherwise the person's initials. System avatars are no longer used.
  function avatarSrc(avatar, displayName) {
    if (avatar && /^(https?:|\/(storage|media)\/|data:)/.test(avatar)) return avatar;
    return initialsAvatar(displayName || (me && me.name), me && me.email);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* paint the shell chrome that exists on every portal page */
  function paint() {
    if (!me) return;

    document.querySelectorAll('.tma-dash__profile-name').forEach(function (el) {
      clearLoading(el);
      el.textContent = me.name;
    });
    document.querySelectorAll('.tma-dash__profile-email').forEach(function (el) {
      clearLoading(el);
      el.textContent = me.email;
    });
    document.querySelectorAll('.tma-dash__profile-avatar, .tma-dash__account-avatar, .tma-dash__tab-btn--profile .tma-dash__tab-btn-icon img').forEach(function (el) {
      clearLoading(el);
      el.src = avatarSrc(me.avatar, me.name);
      el.alt = me.name;
    });

    /* dashboard greeting */
    document.querySelectorAll('.tma-portal-hello__title').forEach(function (el) {
      clearLoading(el);
      el.textContent = 'Hello ' + me.firstName;
    });
    document.querySelectorAll('.tma-portal-hello__avatar').forEach(function (el) {
      clearLoading(el);
      el.src = avatarSrc(me.avatar, me.name);
      el.alt = me.name;
    });
    document.querySelectorAll('[data-home-add-picture]').forEach(function (el) {
      el.textContent = me.hasAvatar ? 'Change profile picture' : 'Add profile picture';
    });

    markProfileClickable();
    listeners.forEach(function (fn) { fn(me); });
  }

  function load() {
    return api('GET', '/me').then(function (res) {
      if (!res.ok) return null;
      return res.json().then(function (j) {
        me = j;
        if (j && j.toasts && window.TMAToast && window.TMAToast.applyToastPrefs) {
          window.TMAToast.applyToastPrefs(j.toasts);
          try { localStorage.setItem('tma.toasts', JSON.stringify(j.toasts)); } catch (e) {}
        }
        paint();
        return j;
      });
    }).catch(function () { return null; });
  }

  /* ── profile picture picker ── */
  function openAvatarPicker() {
    if (!me) return;
    var existing = document.querySelector('[data-avatar-picker]');
    if (existing) existing.remove();

    var wrap = document.createElement('div');
    wrap.className = 'tma-dash__settings-popup';
    wrap.setAttribute('data-avatar-picker', '');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Profile picture');

    var file = null;              // a File the user picked
    var source = 'upload';        // 'upload' | 'provider'
    var hasProvider = !!me.providerPhoto;

    wrap.innerHTML =
      '<div class="tma-dash__settings-popup-backdrop" aria-hidden="true"></div>' +
      '<div class="tma-dash__settings-change-card">' +
      '<button type="button" class="tma-dash__settings-change-close tma-dash__settings-change-close--desktop" data-ap-close aria-label="Close">' +
      '<img src="images/icons/phosphor/X.svg" alt="" width="16" height="16"></button>' +
      '<h3 class="tma-dash__settings-change-title">Profile picture</h3>' +
      '<img class="tma-ap__preview" data-ap-preview src="' + esc(avatarSrc(me.avatar, me.name)) + '" alt="" width="72" height="72">' +
      (hasProvider
        ? '<div class="tma-ap__sources">' +
            '<label class="tma-ap__source"><input type="radio" name="ap-source" value="provider" checked><span>Use my account photo</span></label>' +
            '<label class="tma-ap__source"><input type="radio" name="ap-source" value="upload"><span>Upload a photo</span></label>' +
          '</div>'
        : '') +
      '<label class="tma-dash__settings-submit tma-ap__upload"' + (hasProvider ? ' hidden' : '') + ' data-ap-uploadbtn>' +
      '<span data-ap-uploadlabel>Choose a photo</span>' +
      '<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-ap-file></label>' +
      '<button type="submit" class="tma-dash__settings-submit" data-ap-save' + (hasProvider ? '' : ' disabled') + '>Save</button>' +
      '</div>';

    document.body.appendChild(wrap);

    function close() { wrap.remove(); }
    var previewEl = wrap.querySelector('[data-ap-preview]');
    var uploadBtn = wrap.querySelector('[data-ap-uploadbtn]');
    var uploadLabel = wrap.querySelector('[data-ap-uploadlabel]');
    var fileInput = wrap.querySelector('[data-ap-file]');
    var saveBtn = wrap.querySelector('[data-ap-save]');

    wrap.querySelector('[data-ap-close]').addEventListener('click', close);
    wrap.querySelector('.tma-dash__settings-popup-backdrop').addEventListener('click', close);

    fileInput.addEventListener('change', function () {
      var picked = fileInput.files && fileInput.files[0];
      if (!picked) return;
      var useIt = function (blob, dataUrl) {
        file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
        previewEl.src = dataUrl || URL.createObjectURL(blob);
        uploadLabel.textContent = 'Change photo';
        saveBtn.disabled = false;
      };
      if (window.TMAAvatarCropper) {
        window.TMAAvatarCropper.open(picked, useIt);
      } else {
        // graceful fallback: upload as-is, server centre-crops
        file = picked;
        previewEl.src = URL.createObjectURL(picked);
        uploadLabel.textContent = 'Change photo';
        saveBtn.disabled = false;
      }
      fileInput.value = '';
    });

    wrap.querySelectorAll('input[name="ap-source"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        source = radio.value;
        if (source === 'upload') {
          uploadBtn.hidden = false;
          fileInput.click();
          saveBtn.disabled = !file;
        } else {
          uploadBtn.hidden = true;
          file = null;
          fileInput.value = '';
          previewEl.src = avatarSrc(me.providerPhoto, me.name);
          saveBtn.disabled = false;
        }
      });
    });

    saveBtn.addEventListener('click', function () {
      var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
      var fd = new FormData();
      fd.append('source', source);
      if (source === 'upload') {
        if (!file) return;
        fd.append('avatar_photo', file);
      }
      saveBtn.disabled = true;
      fetch('/me/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
          'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: fd,
      }).then(function (res) {
        if (!res.ok) {
          saveBtn.disabled = false;
          if (window.TMAToast) window.TMAToast.showFloatingToast('Could not save your picture', { state: 'negative' });
          return;
        }
        return res.json().then(function (j) {
          me.avatar = j.avatar;
          me.hasAvatar = true;
          paint();
          close();
          if (window.TMAToast) window.TMAToast.showFloatingToast('Profile picture updated', { state: 'positive' });
        });
      });
    });
  }

  /* the greeting link lives inside a re-rendered view, so delegate */
  document.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-home-add-picture]')) {
      ev.preventDefault();
      openAvatarPicker();
    }
  });

  /* The sidebar profile block opens the user's own profile. Handled by
     delegation rather than wrapping it in a link: dashboard.js rearranges
     that block's children and needs the avatar to stay a direct child. */
  document.addEventListener('click', function (ev) {
    var profile = ev.target.closest('.tma-dash__profile');
    if (!profile) return;
    // let the block's own buttons (sign out, settings) do their job
    if (ev.target.closest('button, a')) return;
    window.location.href = '/profile';
  });

  function markProfileClickable() {
    document.querySelectorAll('.tma-dash__profile-avatar, .tma-dash__profile-meta').forEach(function (el) {
      el.style.cursor = 'pointer';
      el.title = 'My profile';
    });
  }

  window.TMACurrentUser = {
    get: function () { return me; },
    load: load,
    openAvatarPicker: openAvatarPicker,
    onChange: function (fn) { listeners.push(fn); if (me) fn(me); },
    // Shared resolver so re-rendered views (e.g. the dashboard greeting) draw
    // the same photo/initials this file does — never a broken images/avatars/…
    avatarSrc: avatarSrc,
    // Initials for someone who is *not* the signed-in user (an email sender,
    // say): same palette and shape, seeded per person so a given address keeps
    // its colour everywhere it appears.
    initialsFor: function (displayName, seed) { return initialsAvatar(displayName, seed || displayName); },
    // Re-apply the signed-in user to all shell chrome after a view re-renders.
    repaint: paint,
  };

  function boot() {
    // Show the loading skeleton first, so the shells' hardcoded dummy
    // name/photo is never what the user sees.
    if (me) { paint(); } else { setLoading(); }
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* portal views repaint their own markup; keep the chrome in sync. If the
     user hasn't loaded yet, the freshly rendered markup gets the skeleton too. */
  document.addEventListener('tma:view-rendered', function () {
    if (me) { paint(); } else { setLoading(); }
  });
})();
