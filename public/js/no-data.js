/**
 * TMA — No data empty state (Figma 32546:96126)
 * https://www.figma.com/design/58ZXC7sZYQsbenzf0foWCH/Portal-Design?node-id=32546-96126
 */
(function () {
  'use strict';

  var DEFAULT_ILLUSTRATION = 'images/illustrations/Illustration07.svg';
  var ADD_ICON = 'images/icons/tma/Add.svg';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function addButtonLabel(o) {
    if (o.buttonLabel != null) return o.buttonLabel;
    if (o.itemLabel) return 'Add ' + o.itemLabel;
    return 'Add data';
  }

  function illustrationSrc(o) {
    if (o.illustration) return o.illustration;
    if (o.illustrationName) {
      return 'images/illustrations/' + o.illustrationName + '.svg';
    }
    return DEFAULT_ILLUSTRATION;
  }

  function render(opts) {
    var o = opts || {};
    var title = o.title != null ? o.title : 'No data';
    var subtitle = o.subtitle != null ? o.subtitle : 'You may need';
    var buttonLabel = addButtonLabel(o);
    var showButton = o.showButton !== false;
    var illustration = illustrationSrc(o);

    return (
      '<section class="tma-no-data" data-no-data aria-labelledby="tma-no-data-title">' +
        '<div class="tma-no-data__group">' +
          '<div class="tma-no-data__heading">' +
            '<h2 class="tma-no-data__title" id="tma-no-data-title">' + escapeHtml(title) + '</h2>' +
          '</div>' +
          '<img class="tma-no-data__illustration" src="' + illustration + '" alt="" width="100" height="100" decoding="async">' +
        '</div>' +
        '<div class="tma-no-data__divider" aria-hidden="true"></div>' +
        '<div class="tma-no-data__cta-group">' +
          '<p class="tma-no-data__subtitle">' + escapeHtml(subtitle) + '</p>' +
          (showButton
            ? '<button type="button" class="tma-no-data__btn" data-no-data-action="add">' +
                '<img class="tma-no-data__btn-icon" src="' + ADD_ICON + '" alt="" width="20" height="20">' +
                '<span>' + escapeHtml(buttonLabel) + '</span>' +
              '</button>'
            : '') +
        '</div>' +
      '</section>'
    );
  }

  function mount(container, opts) {
    if (!container) return;

    var o = opts || {};
    container.innerHTML = render(o);

    var btn = container.querySelector('[data-no-data-action]');
    if (!btn) return;

    btn.addEventListener('click', function () {
      if (typeof o.onAction === 'function') {
        o.onAction('add');
        return;
      }
      if (window.TMATableAddData && window.TMATableAddData.openAddData) {
        window.TMATableAddData.openAddData();
      }
    });
  }

  window.TMANoData = { render: render, mount: mount };
})();
