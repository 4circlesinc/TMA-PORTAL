(function () {
  'use strict';

  var root = document.querySelector('[data-account-setup]');
  if (!root) return;

  var step = root.getAttribute('data-step');
  var csrf = document.querySelector('input[name="_token"]');
  var csrfToken = csrf ? csrf.value : '';

  function applyTheme(mode) {
    try {
      if (mode === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else if (mode === 'light') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (dark) document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');
      }
      localStorage.setItem('tma.themeMode', mode);
    } catch (e) { /* ignore */ }
  }

  function applyFontScale(scale) {
    var n = parseInt(scale, 10);
    if (!(n >= 1 && n <= 5)) return;
    document.documentElement.style.setProperty('--tma-font-scale-step', String(n));
    try { localStorage.setItem('tma.fontScale', String(n)); } catch (e) { /* ignore */ }
  }

  if (step === 'preferences') {
    root.querySelectorAll('[data-pref]').forEach(function (input) {
      input.addEventListener('change', function () {
        var name = input.getAttribute('data-pref');
        if (name === 'themeMode') applyTheme(input.value);
        if (name === 'fontScale') applyFontScale(input.value);
      });
    });

    var checkedTheme = root.querySelector('input[name="themeMode"]:checked');
    if (checkedTheme) applyTheme(checkedTheme.value);
    var checkedFont = root.querySelector('input[name="fontScale"]:checked');
    if (checkedFont) applyFontScale(checkedFont.value);
  }

  if (step === 'two-factor') {
    var form = root.querySelector('[data-setup-form="two-factor"]');
    if (!form) return;

    var panels = form.querySelectorAll('[data-tfa-panel]');
    var qrWrap = form.querySelector('[data-tfa-qr]');
    var secretEl = form.querySelector('[data-tfa-secret]');
    var qrUrl = form.getAttribute('data-qr-url');
    var qrLoaded = false;

    function showPanel(name) {
      panels.forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-tfa-panel') !== name;
      });
    }

    function loadQr() {
      if (qrLoaded || !qrUrl) return;
      qrWrap.textContent = 'Loading…';
      fetch(qrUrl, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          qrLoaded = true;
          qrWrap.innerHTML = data.svg || '';
          if (secretEl && data.secretKey) {
            secretEl.hidden = false;
            secretEl.textContent = 'Manual key: ' + data.secretKey;
          }
        })
        .catch(function () {
          qrWrap.textContent = 'Could not load the QR code. Refresh and try again.';
        });
    }

    form.querySelectorAll('[data-tfa-next]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = btn.getAttribute('data-tfa-next');
        if (next === 'scan') loadQr();
        showPanel(next);
      });
    });

    form.querySelectorAll('[data-tfa-back]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showPanel(btn.getAttribute('data-tfa-back'));
      });
    });

    var codeInput = form.querySelector('input[name="code"]');
    if (codeInput) {
      codeInput.addEventListener('input', function () {
        codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
      });
    }
  }
})();
