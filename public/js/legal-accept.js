/**
 * Legal acceptance: open Terms / Privacy in a popup, then enable that tick.
 */
(function () {
  function setup(root) {
    if (!root || root.dataset.legalBound) return;
    root.dataset.legalBound = '1';

    var dialog = root.querySelector('[data-legal-dialog]');
    var frame = root.querySelector('[data-legal-frame]');
    var title = root.querySelector('[data-legal-title]');
    var confirm = root.querySelector('[data-legal-confirm]');
    var closeBtn = root.querySelector('[data-legal-close]');
    if (!dialog || !frame || !confirm) return;

    var current = null;
    var titles = {
      terms: 'Terms of Service',
      privacy: 'Privacy Policy',
    };

    function check(key) {
      return root.querySelector('[data-legal-check="' + key + '"]');
    }

    function open(key, href) {
      current = key;
      if (title) title.textContent = titles[key] || 'Legal';
      confirm.disabled = true;
      confirm.textContent = 'Scroll to the end to continue';
      frame.onload = function () {
        watchScroll();
      };
      frame.src = href;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }

    function close() {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      frame.src = 'about:blank';
      current = null;
    }

    function watchScroll() {
      try {
        var doc = frame.contentDocument || frame.contentWindow.document;
        var scroller = doc.scrollingElement || doc.documentElement;
        function update() {
          var bottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 24;
          // Short documents: treat as readable without a scroll.
          if (scroller.scrollHeight <= scroller.clientHeight + 24) bottom = true;
          confirm.disabled = !bottom;
          confirm.textContent = bottom ? 'I have read this' : 'Scroll to the end to continue';
        }
        update();
        doc.addEventListener('scroll', update, { passive: true });
        frame.contentWindow.addEventListener('scroll', update, { passive: true });
      } catch (e) {
        // Cross-origin or empty: let them confirm after a short wait.
        window.setTimeout(function () {
          confirm.disabled = false;
          confirm.textContent = 'I have read this';
        }, 800);
      }
    }

    root.querySelectorAll('[data-legal-open]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        open(link.getAttribute('data-legal-open'), link.getAttribute('href'));
      });
    });

    confirm.addEventListener('click', function () {
      if (!current || confirm.disabled) return;
      var box = check(current);
      if (box) {
        box.disabled = false;
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      }
      close();
    });

    if (closeBtn) closeBtn.addEventListener('click', close);
    dialog.addEventListener('cancel', function (e) {
      e.preventDefault();
      close();
    });

    // Returning with old() ticks: allow those boxes so a failed submit is not a trap.
    ['terms', 'privacy'].forEach(function (key) {
      var box = check(key);
      if (box && box.checked) box.disabled = false;
    });
  }

  function boot() {
    document.querySelectorAll('[data-legal-accept]').forEach(setup);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
