(function () {
  'use strict';

  function syncToolbarSearch(scope, state) {
    var wrap = scope && scope.querySelector('.tma-dash__toolbar-search');
    if (!wrap) return;
    wrap.classList.toggle('tma-dash__toolbar-search--focused', !!(state.searchFocused || state.search));
    wrap.classList.toggle('tma-dash__toolbar-search--has-value', !!state.search);
    wrap.classList.toggle('tma-dash__toolbar-search--loading', !!state.searchLoading);
  }

  window.TMADashSearchChrome = {
    syncToolbar: syncToolbarSearch,
  };
})();
