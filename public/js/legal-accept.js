/**
 * Legal consent sheet: opening a document flips its switch on; Agree unlocks
 * once both are on. Not now dismisses and leaves the form's ticks unset.
 * No document content is embedded — links go to the real pages.
 */
(function () {
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
        // Reparenting severs the sheet from .tma-auth--split, so carry the
        // layout over as a class the CSS can still see.
        if (root.closest('.tma-auth--split')) {
          sheet.classList.add('tma-legal-consent__sheet--split');
        }
        document.body.appendChild(sheet);
      }
      if (sheet.open) return;
      if (typeof sheet.show === 'function') sheet.show();
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

      var hint = sheet.querySelector('[data-legal-hint="' + key + '"]');
      if (hint) hint.textContent = 'Opened';

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

    function syncVisibility() {
      if (root.dataset.agreed === '1' || dismissed) {
        closeSheet();
        return;
      }
      if (always || formVisible()) openSheet();
      else closeSheet();
    }

    // Returning with old() ticks: treat as already agreed.
    if (root.dataset.agreed === '1' || (box('terms') && box('terms').checked && box('privacy') && box('privacy').checked)) {
      visited.terms = true;
      visited.privacy = true;
      root.classList.add('is-agreed');
      root.dataset.agreed = '1';
      closeSheet();
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
