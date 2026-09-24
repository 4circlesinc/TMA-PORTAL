/**
 * Cookie-style legal consent: open each legal page (new tab), then Agree.
 * No document content is embedded — links go to the real pages.
 */
(function () {
  function setup(root) {
    if (!root || root.dataset.legalBound) return;
    root.dataset.legalBound = '1';

    var sheet = root.querySelector('[data-legal-sheet]');
    var agree = root.querySelector('[data-legal-agree]');
    var status = root.querySelector('[data-legal-status]');
    if (!sheet || !agree) return;

    var form = root.closest('form');
    var visited = { terms: false, privacy: false };

    function box(key) {
      return root.querySelector('[data-legal-check="' + key + '"]');
    }

    function mark(key) {
      return root.querySelector('[data-legal-mark="' + key + '"]');
    }

    function formVisible() {
      if (!form) return true;
      if (form.hidden || form.hasAttribute('hidden')) return false;
      var style = window.getComputedStyle(form);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function openSheet() {
      if (sheet.parentElement !== document.body) {
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
      var ready = visited.terms && visited.privacy;
      agree.disabled = !ready;
      agree.textContent = ready ? 'Agree' : 'Open both documents to Agree';
    }

    function noteVisit(key) {
      visited[key] = true;
      var m = mark(key);
      if (m) m.hidden = false;
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

    function syncVisibility() {
      if (root.dataset.agreed === '1') {
        closeSheet();
        return;
      }
      if (formVisible()) openSheet();
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

    root.querySelectorAll('[data-legal-visit]').forEach(function (link) {
      link.addEventListener('click', function () {
        noteVisit(link.getAttribute('data-legal-visit'));
      });
    });

    agree.addEventListener('click', function () {
      if (agree.disabled) return;
      applyAgreed();
    });

    sheet.addEventListener('cancel', function (e) {
      e.preventDefault();
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
