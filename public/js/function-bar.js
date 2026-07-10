(function () {
  function isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    return target.matches('input, textarea, select, [contenteditable="true"]');
  }

  function searchInput(bar) {
    return bar.querySelector('.tma-function-bar__search-input');
  }

  function focusSearch(bar) {
    const input = searchInput(bar);
    if (!input) return;
    input.focus();
    input.select();
  }

  function syncFunctionBarSearchChrome(searchWrap, value) {
    if (!searchWrap) return;
    const hasValue = (value || '').length > 0;
    searchWrap.classList.toggle('tma-function-bar__search--has-value', hasValue);
    searchWrap.classList.toggle('tma-function-bar__search--focused', document.activeElement === searchWrap.querySelector('.tma-function-bar__search-input'));
    const kbd = searchWrap.querySelector('.tma-function-bar__kbd');
    if (kbd) kbd.hidden = hasValue;
  }

  function ensureSearchChrome(searchWrap) {
    if (!searchWrap || searchWrap.dataset.searchChromeWired === '1') return;
    if (searchWrap.closest('[data-table-search]')) return;
    searchWrap.dataset.searchChromeWired = '1';

    if (!searchWrap.querySelector('[data-search-clear]')) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'tma-function-bar__search-clear';
      clearBtn.setAttribute('data-search-clear', '');
      clearBtn.setAttribute('aria-label', 'Clear search');
      clearBtn.innerHTML = '<img src="images/icons/tma/Xcircle.svg" class="tma-function-bar__search-clear-icon" width="16" height="16" alt="">';
      searchWrap.appendChild(clearBtn);
    }

    if (!searchWrap.querySelector('.tma-function-bar__search-spinner')) {
      const spinner = document.createElement('span');
      spinner.className = 'tma-function-bar__search-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      spinner.innerHTML = '<img src="images/icons/tma/Loading-16.svg" width="20" height="20" alt="">';
      searchWrap.appendChild(spinner);
    }

    const input = searchWrap.querySelector('.tma-function-bar__search-input');
    if (!input) return;

    let timer = null;

    input.addEventListener('input', () => {
      syncFunctionBarSearchChrome(searchWrap, input.value);
      clearTimeout(timer);
      searchWrap.classList.add('tma-function-bar__search--loading');
      timer = setTimeout(() => {
        searchWrap.classList.remove('tma-function-bar__search--loading');
        syncFunctionBarSearchChrome(searchWrap, input.value);
      }, 180);
    });

    input.addEventListener('focus', () => {
      searchWrap.classList.add('tma-function-bar__search--focused');
    });

    input.addEventListener('blur', () => {
      searchWrap.classList.remove('tma-function-bar__search--focused');
    });

    searchWrap.querySelector('[data-search-clear]')?.addEventListener('click', (event) => {
      event.preventDefault();
      clearTimeout(timer);
      input.value = '';
      searchWrap.classList.remove('tma-function-bar__search--loading');
      syncFunctionBarSearchChrome(searchWrap, '');
      input.focus();
    });

    syncFunctionBarSearchChrome(searchWrap, input.value);
  }

  function initSearchBars(root) {
    (root || document).querySelectorAll('.tma-function-bar__search').forEach(ensureSearchChrome);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;

    event.preventDefault();

    const active = document.activeElement;
    const bar = active?.closest?.('.tma-function-bar')
      || document.querySelector('.tma-function-bar');

    focusSearch(bar);
  });

  document.addEventListener('click', (event) => {
    const kbd = event.target.closest('.tma-function-bar__kbd');
    if (!kbd) return;

    const bar = kbd.closest('.tma-function-bar');
    if (!bar) return;

    event.preventDefault();
    focusSearch(bar);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initSearchBars());
  } else {
    initSearchBars();
  }

  window.TMAFunctionBar = {
    initSearchBars: initSearchBars,
  };
})();
