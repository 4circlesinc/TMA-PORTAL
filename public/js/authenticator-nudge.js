/*
 * Weekly authenticator-app reminder. Email codes already cover unusual
 * sign-ins; this asks people without an app to add one. Shown at most five
 * times, once per week, from /me.
 *
 * Global: window.TMAAuthenticatorNudge
 */
(function () {
  'use strict';

  var shown = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api(method, url) {
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
    });
  }

  function setupUrl() {
    return (window.__TMA_SITE_ROOT || '') + '/account-settings?settings-page=account-security';
  }

  function maybeShow(me) {
    if (shown) return;
    if (!me || !me.authenticatorNudge || !me.authenticatorNudge.show) return;
    if (/account-settings/.test(location.pathname || '')) return;
    var ui = window.TMAPortalUI;
    if (!ui || !ui.openModal) return;

    shown = true;
    api('POST', (window.__TMA_SITE_ROOT || '') + '/me/authenticator-nudge').catch(function () {});

    ui.openModal({
      title: 'Protect your account',
      cls: 'tma-nudge',
      body:
        '<p class="tma-nudge__lead">Email codes already confirm unusual sign-ins. An authenticator app is quicker and works even if you can\'t open your inbox.</p>' +
        '<div class="tma-nudge__apps">' +
          '<div class="tma-nudge__app">' +
            '<img src="images/icons/brands/MicrosoftAuthenticator.webp" alt="">' +
            '<span class="tma-nudge__app-copy">' +
              '<span class="tma-nudge__app-name">Microsoft Authenticator</span>' +
              '<span class="tma-nudge__app-desc">Free on iOS and Android</span>' +
            '</span>' +
          '</div>' +
          '<div class="tma-nudge__app">' +
            '<img src="images/icons/brands/GoogleAuthenticator.svg" alt="">' +
            '<span class="tma-nudge__app-copy">' +
              '<span class="tma-nudge__app-name">Google Authenticator</span>' +
              '<span class="tma-nudge__app-desc">Free on iOS and Android</span>' +
            '</span>' +
          '</div>' +
        '</div>' +
        '<div class="tma-nudge__actions tma-portal-form-actions">' +
          ui.btn({ label: 'Set up authenticator', attrs: ' data-nudge-setup' }) +
          ui.btn({ label: 'Not now', variant: 'ghost', attrs: ' data-nudge-later' }) +
        '</div>',
      onMount: function (host) {
        var setup = host.querySelector('[data-nudge-setup]');
        var later = host.querySelector('[data-nudge-later]');
        if (setup) setup.addEventListener('click', function () {
          ui.closeModal();
          window.location.href = setupUrl();
        });
        if (later) later.addEventListener('click', function () { ui.closeModal(); });
      },
    });
  }

  window.TMAAuthenticatorNudge = { maybeShow: maybeShow };
})();
