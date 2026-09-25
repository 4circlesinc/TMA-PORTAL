/**
 * Legal consent: opening a document flips its switch on; Agree unlocks once
 * both are on. No document content is embedded — links go to the real pages.
 *
 * The answer lives in localStorage, so it is per browser and per device: a new
 * browser, a new machine or cleared site data all ask again. Not now only
 * dismisses for this page view; it is never remembered, so every later visit
 * asks again until they agree.
 *
 * In the desktop and Android shells the same markup renders as a full white
 * page rather than a docked banner.
 */
(function () {
  var STORE_KEY = 'tma.legalAccepted';

  // Both shells expose this; the desktop one cannot be sniffed from the user
  // agent because it presents as plain Chrome for OAuth.
  function inApp() {
    return !!(window.TMADesktop && window.TMADesktop.isDesktop);
  }

  function storedAgreement() {
    try {
      return window.localStorage.getItem(STORE_KEY) === '1';
    } catch (e) {
      // Private mode, blocked site data: fall back to asking every time.
      return false;
    }
  }

  function rememberAgreement() {
    try {
      window.localStorage.setItem(STORE_KEY, '1');
    } catch (e) {
      /* Nothing to do: they simply get asked again next visit. */
    }
  }

  function setup(root) {
    if (!root || root.dataset.legalBound) return;
    root.dataset.legalBound = '1';

    var sheet = root.querySelector('[data-legal-sheet]');
    var agree = root.querySelector('[data-legal-agree]');
    var decline = root.querySelector('[data-legal-decline]');
    var reopen = root.querySelector('[data-legal-reopen]');
    var status = root.querySelector('[data-legal-status]');
    if (!sheet || !agree) return;

    var form = root.closest('form');
    var visited = { terms: false, privacy: false };
    var dismissed = false;

    function box(key) {
      return root.querySelector('[data-legal-check="' + key + '"]');
    }

    function openSheet() {
      if (sheet.parentElement !== document.body) {
        if (fullPage) sheet.classList.add('tma-legal-consent__sheet--full');
        document.body.appendChild(sheet);
      }
      if (sheet.open) return;
      // Centred over the page, so it is a real modal: showModal() gives the
      // backdrop and keeps focus inside until they answer.
      if (typeof sheet.showModal === 'function') sheet.showModal();
      else if (typeof sheet.show === 'function') sheet.show();
      else sheet.setAttribute('open', '');
    }

    function closeSheet() {
      if (!sheet.open && !sheet.hasAttribute('open')) return;
      if (typeof sheet.close === 'function') sheet.close();
      else sheet.removeAttribute('open');
    }

    function refreshAgree() {
      agree.disabled = !(visited.terms && visited.privacy);
    }

    function noteVisit(key) {
      if (visited[key]) return;
      visited[key] = true;

      // Query the sheet, not the root: openSheet() reparents the dialog to
      // document.body, so these nodes are no longer inside root.
      var toggle = sheet.querySelector('[data-legal-switch="' + key + '"]');
      if (toggle) toggle.checked = true;

      var row = sheet.querySelector('[data-legal-row="' + key + '"]');
      if (row) row.classList.add('is-read');

      refreshAgree();
    }

    function applyAgreed() {
      ['terms', 'privacy'].forEach(function (key) {
        var el = box(key);
        if (!el) return;
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      root.classList.add('is-agreed');
      root.dataset.agreed = '1';
      rememberAgreement();
      if (status) {
        status.textContent = 'You have agreed to the Terms of Service and Privacy Policy.';
      }
      closeSheet();
    }

    function formVisible() {
      if (!form) return true;
      if (form.hidden || form.hasAttribute('hidden')) return false;
      var style = window.getComputedStyle(form);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }

    // data-legal-always: the sheet gates the whole page, not one form branch
    // (sign-up consent applies to the provider buttons as much as the email
    // form, and the partial itself sits inside the hidden email form).
    var always = root.hasAttribute('data-legal-always');

    // The shells show it as a full white page instead of a docked banner.
    var fullPage = inApp();

    function syncVisibility() {
      if (root.dataset.agreed === '1' || dismissed) {
        closeSheet();
        return;
      }
      if (always || formVisible()) openSheet();
      else closeSheet();
    }

    // Already agreed on this device, or returning with old() ticks. The ticks
    // must be set here too: the form still validates them server-side, and
    // skipping the sheet would otherwise submit an unticked form that fails.
    if (root.dataset.agreed === '1' || storedAgreement() || (box('terms') && box('terms').checked && box('privacy') && box('privacy').checked)) {
      visited.terms = true;
      visited.privacy = true;
      applyAgreed();
      return;
    }

    sheet.querySelectorAll('[data-legal-visit]').forEach(function (link) {
      link.addEventListener('click', function () {
        noteVisit(link.getAttribute('data-legal-visit'));
      });
    });

    agree.addEventListener('click', function () {
      if (agree.disabled) return;
      applyAgreed();
    });

    if (decline) {
      decline.addEventListener('click', function () {
        dismissed = true;
        closeSheet();
      });
    }

    if (reopen) {
      reopen.addEventListener('click', function () {
        dismissed = false;
        openSheet();
      });
    }

    sheet.addEventListener('cancel', function (e) {
      e.preventDefault();
      dismissed = true;
      closeSheet();
    });

    if (form) {
      var observer = new MutationObserver(syncVisibility);
      observer.observe(form, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
    }
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-show-email], [data-show-providers]')) {
        window.setTimeout(syncVisibility, 0);
      }
    });

    refreshAgree();
    syncVisibility();
  }

  function boot() {
    document.querySelectorAll('[data-legal-consent]').forEach(setup);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
