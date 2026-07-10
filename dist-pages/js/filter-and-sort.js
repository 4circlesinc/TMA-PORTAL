(function () {
  function syncEmptyState(bar) {
    const visibleTags = bar.querySelectorAll('.tma-filter-and-sort__tag:not(.tma-filter-and-sort__tag--removed)');
    bar.classList.toggle('tma-filter-and-sort--empty', visibleTags.length === 0);
  }

  document.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove-tag]');
    if (removeButton) {
      if (removeButton.closest('[data-table-filter-sort]')) return;
      const tag = removeButton.closest('.tma-filter-and-sort__tag');
      const bar = removeButton.closest('.tma-filter-and-sort');
      if (tag) tag.classList.add('tma-filter-and-sort__tag--removed');
      if (bar) syncEmptyState(bar);
      return;
    }

    const resetButton = event.target.closest('[data-reset-filters]');
    if (resetButton) {
      if (resetButton.closest('[data-table-filter-sort]')) return;
      const bar = resetButton.closest('.tma-filter-and-sort');
      if (!bar) return;

      bar.querySelectorAll('.tma-filter-and-sort__tag').forEach((tag) => {
        tag.classList.add('tma-filter-and-sort__tag--removed');
      });
      syncEmptyState(bar);
    }
  });
})();
