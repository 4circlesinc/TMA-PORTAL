/**
 * TMA - Section error state for failed API loads.
 * Global: window.TMASectionError
 *
 * Use when a section fails — never fall back to sample records.
 * Keeps failures scoped to the section (not the whole page).
 */
(function () {
  'use strict';

  var WARN_ICON = 'images/icons/phosphor/WarningCircle.svg';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render(opts) {
    var o = opts || {};
    var title = o.title != null ? o.title : 'Unable to load this section';
    var message = o.message != null
      ? o.message
      : (o.permissionDenied
        ? 'You do not have permission to view this information.'
        : 'There was a problem loading this section.');
    var ref = o.reference || o.errorRef || '';
    var showRetry;
    if (o.permissionDenied) {
      showRetry = false;
    } else if (typeof o.showRetry === 'boolean') {
      showRetry = o.showRetry;
    } else {
      showRetry = typeof o.onRetry === 'function';
    }
    var retryLabel = o.retryLabel || 'Retry';
    var retryAttr = o.retryAttr || 'data-section-error-retry';

    return (
      '<div class="tma-section-error" data-section-error role="alert">' +
        '<span class="tma-section-error__icon" aria-hidden="true">' +
          '<img src="' + escapeHtml(o.icon || WARN_ICON) + '" alt="" width="20" height="20">' +
        '</span>' +
        '<div class="tma-section-error__copy">' +
          '<p class="tma-section-error__title">' + escapeHtml(title) + '</p>' +
          '<p class="tma-section-error__message">' + escapeHtml(message) + '</p>' +
          (ref
            ? '<p class="tma-section-error__ref">Reference: ' + escapeHtml(ref) + '</p>'
            : '') +
        '</div>' +
        (showRetry
          ? '<button type="button" class="tma-section-error__retry" ' + retryAttr + '>' +
              escapeHtml(retryLabel) + '</button>'
          : '') +
      '</div>'
    );
  }

  function mount(container, opts) {
    if (!container) return null;
    var o = opts || {};
    container.innerHTML = render(o);
    var btn = container.querySelector('[data-section-error-retry]');
    if (btn && typeof o.onRetry === 'function') {
      btn.addEventListener('click', function () { o.onRetry(); });
    }
    return container;
  }

  window.TMASectionError = { render: render, mount: mount };
})();
