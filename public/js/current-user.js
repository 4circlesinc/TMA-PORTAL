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
    if (avatar && /^(https?:|\/storage\/|data:)/.test(avatar)) return avatar;
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
      el.textContent = me.name;
    });
    document.querySelectorAll('.tma-dash__profile-email').forEach(function (el) {
      el.textContent = me.email;
    });
    document.querySelectorAll('.tma-dash__profile-avatar, .tma-dash__account-avatar').forEach(function (el) {
      el.src = avatarSrc(me.avatar, me.name);
      el.alt = me.name;
    });

    /* dashboard greeting */
    document.querySelectorAll('.tma-portal-hello__title').forEach(function (el) {
      el.textContent = 'Hello ' + me.firstName;
    });
    document.querySelectorAll('.tma-portal-hello__avatar').forEach(function (el) {
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
    // Re-apply the signed-in user to all shell chrome after a view re-renders.
    repaint: paint,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }

  /* portal views repaint their own markup; keep the chrome in sync */
  document.addEventListener('tma:view-rendered', paint);
})();
