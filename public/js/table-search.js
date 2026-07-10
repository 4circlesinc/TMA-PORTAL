(function () {
  function normalize(value) {
    return (value || '').toLowerCase().trim();
  }

  function rowMatches(row, query) {
    if (!query) return true;
    const haystack = [
      row.orderId,
      row.user,
      row.project,
      row.address,
      row.date,
      row.statusLabel,
    ].join(' ').toLowerCase();

    return haystack.includes(query);
  }

  function updateSearchChrome(bar, value) {
    const hasValue = value.length > 0;
    bar.classList.toggle('tma-function-bar__search--has-value', hasValue);
    bar.classList.toggle('tma-function-bar__search--focused', document.activeElement === bar.querySelector('.tma-function-bar__search-input'));
  }

  function renderEmptyState() {
    return '<div class="tma-table-search__empty" role="row">No results</div>';
  }

  function initSearchTable(root) {
    if (root.hasAttribute('data-table-search-initialized')) return;
    root.setAttribute('data-table-search-initialized', '');

    const allRows = [];
    try {
      const raw = root.getAttribute('data-all-rows');
      if (raw) allRows.push(...JSON.parse(raw));
    } catch (_) {
      root.querySelectorAll('[data-row-data]').forEach((rowEl) => {
        try {
          allRows.push(JSON.parse(rowEl.getAttribute('data-row-data')));
        } catch (_) {}
      });
    }

    const body = root.querySelector('[data-table-body]');
    const renderRow = window.TMATableSearchRenderRow;
    const searchWrap = root.querySelector('.tma-function-bar__search');
    const input = searchWrap?.querySelector('.tma-function-bar__search-input');
    const clearBtn = searchWrap?.querySelector('[data-search-clear]');
    const resultsEl = root.querySelector('[data-search-results-count]');
    if (!body || !input || !renderRow) return;

    let timer = null;

    function applyFilter() {
      const query = normalize(input.value);
      updateSearchChrome(searchWrap, input.value);

      const matches = allRows.filter((row) => rowMatches(row, query));

      if (!query) {
        body.innerHTML = allRows.map((row, index) => renderRow(row, index)).join('');
        if (resultsEl) resultsEl.textContent = '105 results';
        return;
      }

      if (matches.length === 0) {
        body.innerHTML = renderEmptyState();
        if (resultsEl) resultsEl.textContent = '0 results';
        return;
      }

      body.innerHTML = matches.map((row, index) => renderRow(row, index)).join('');
      if (resultsEl) {
        const label = matches.length === 1 ? '1 result' : matches.length + ' results';
        resultsEl.textContent = label;
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      searchWrap.classList.add('tma-function-bar__search--loading');
      timer = setTimeout(() => {
        searchWrap.classList.remove('tma-function-bar__search--loading');
        applyFilter();
      }, 180);
    });

    input.addEventListener('focus', () => {
      searchWrap.classList.add('tma-function-bar__search--focused');
    });

    input.addEventListener('blur', () => {
      searchWrap.classList.remove('tma-function-bar__search--focused');
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', (event) => {
        event.preventDefault();
        clearTimeout(timer);
        searchWrap.classList.remove('tma-function-bar__search--loading');
        input.value = '';
        input.focus();
        applyFilter();
      });
    }

    applyFilter();
  }

  function init() {
    document.querySelectorAll('[data-table-search]').forEach(initSearchTable);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.TMATableSearch = { init };
})();
