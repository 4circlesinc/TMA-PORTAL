(function () {
  const ICONS = { unchecked: null, checked: null };
  const PAGE_SIZES = [20, 50, 100];
  const ROW_VARIANTS = [
    'default',
    'section-end',
    'selected-only',
    'selected-start',
    'selected-mid',
    'selected-end',
  ];

  let lastClickedIndex = null;
  let deletedRows = null;
  let toastTimer = null;
  let openPopover = null;

  function resolveIconPaths(table) {
    if (ICONS.unchecked) return;
    const sample = table.querySelector('[data-checkbox-glyph]');
    if (!sample) return;
    const src = sample.getAttribute('src') || '';
    ICONS.unchecked = src.includes('CheckboxChecked')
      ? src.replace('CheckboxChecked-16.svg', 'Checkbox-16.svg')
      : src;
    ICONS.checked = ICONS.unchecked.replace('Checkbox-16.svg', 'CheckboxChecked-16.svg');
  }

  function isChecked(button) {
    return button?.hasAttribute('data-checked') ?? false;
  }

  function setCheckboxState(button, checked) {
    const glyph = button.querySelector('[data-checkbox-glyph]');
    const table = button.closest('[data-table-c]');
    if (table) resolveIconPaths(table);

    button.setAttribute('aria-pressed', checked ? 'true' : 'false');
    if (checked) {
      button.setAttribute('data-checked', '');
    } else {
      button.removeAttribute('data-checked');
    }

    if (glyph && ICONS.unchecked && ICONS.checked) {
      glyph.src = checked ? ICONS.checked : ICONS.unchecked;
    }
  }

  function setSelectAllState(button, state) {
    const glyph = button.querySelector('[data-checkbox-glyph]');
    const table = button.closest('[data-table-c]');
    if (table) resolveIconPaths(table);

    button.removeAttribute('data-checked');
    button.removeAttribute('data-indeterminate');

    if (state === 'all') {
      button.setAttribute('data-checked', '');
      button.setAttribute('aria-pressed', 'true');
      if (glyph && ICONS.checked) glyph.src = ICONS.checked;
      return;
    }

    if (state === 'some') {
      button.setAttribute('data-indeterminate', '');
      button.setAttribute('aria-pressed', 'mixed');
      if (glyph && ICONS.unchecked) glyph.src = ICONS.unchecked;
      return;
    }

    button.setAttribute('aria-pressed', 'false');
    if (glyph && ICONS.unchecked) glyph.src = ICONS.unchecked;
  }

  function applyRowVariant(row, variant) {
    ROW_VARIANTS.forEach((name) => row.classList.remove('tma-table-a__row--' + name));
    row.classList.add('tma-table-a__row--' + variant);
  }

  function dataRows(table) {
    return [...table.querySelectorAll('.tma-table-a__row[role="row"][data-row-index]')];
  }

  function restingVariant(row) {
    return row.dataset.borderVariant === 'section-end' ? 'section-end' : 'default';
  }

  function checkedRows(table) {
    return dataRows(table).filter((row) => isChecked(row.querySelector('[data-row-checkbox]')));
  }

  function checkedCount(table) {
    return checkedRows(table).length;
  }

  function syncRowVariants(table) {
    const rows = dataRows(table);

    rows.forEach((row) => {
      const checkbox = row.querySelector('[data-row-checkbox]');
      if (!isChecked(checkbox)) {
        applyRowVariant(row, restingVariant(row));
      }
    });

    let index = 0;
    while (index < rows.length) {
      while (index < rows.length && !isChecked(rows[index].querySelector('[data-row-checkbox]'))) {
        index += 1;
      }
      if (index >= rows.length) break;

      const start = index;
      while (index < rows.length && isChecked(rows[index].querySelector('[data-row-checkbox]'))) {
        index += 1;
      }
      const end = index - 1;

      if (start === end) {
        applyRowVariant(rows[start], 'selected-only');
        continue;
      }

      applyRowVariant(rows[start], 'selected-start');
      for (let mid = start + 1; mid < end; mid += 1) {
        applyRowVariant(rows[mid], 'selected-mid');
      }
      applyRowVariant(rows[end], 'selected-end');
    }
  }

  function syncSelectAll(table) {
    const boxes = table.querySelectorAll('[data-row-checkbox]');
    const selectAll = table.querySelector('[data-select-all]');
    if (!selectAll || !boxes.length) return;

    const count = [...boxes].filter((box) => isChecked(box)).length;
    if (count === 0) {
      setSelectAllState(selectAll, 'none');
    } else if (count === boxes.length) {
      setSelectAllState(selectAll, 'all');
    } else {
      setSelectAllState(selectAll, 'some');
    }
  }

  function updateSelectionBar(table) {
    const count = checkedCount(table);
    const label = table.querySelector('[data-selection-bar] .tma-function-bar__selection-label');
    if (label) {
      label.textContent = count + ' Selected';
    }
  }

  function syncTable(table) {
    const anyChecked = checkedCount(table) > 0;
    table.toggleAttribute('data-has-selection', anyChecked);
    syncRowVariants(table);
    syncSelectAll(table);
    updateSelectionBar(table);
  }

  function setRowChecked(row, checked) {
    const checkbox = row.querySelector('[data-row-checkbox]');
    if (!checkbox) return;
    setCheckboxState(checkbox, checked);
  }

  function selectRange(table, fromIndex, toIndex, checked) {
    const rows = dataRows(table);
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    for (let i = start; i <= end; i += 1) {
      setRowChecked(rows[i], checked);
    }
  }

  function clearSelection(table) {
    table.querySelectorAll('[data-row-checkbox]').forEach((box) => setCheckboxState(box, false));
    syncTable(table);
    lastClickedIndex = null;
  }

  function clearHovering(table) {
    dataRows(table).forEach((row) => row.classList.remove('tma-table-a__row--hovering'));
  }

  function reindexRows(table) {
    dataRows(table).forEach((row, index) => {
      row.dataset.rowIndex = String(index);
    });
  }

  function parseRowData(row) {
    try {
      return JSON.parse(row.dataset.rowData || '{}');
    } catch {
      return {};
    }
  }

  function closePopover() {
    if (!openPopover) return;
    openPopover.removeAttribute('data-open');
    openPopover.setAttribute('aria-hidden', 'true');
    openPopover = null;
  }

  function openRowPopover(button) {
    const table = button.closest('[data-table-c]');
    const popover = table?.querySelector('[data-table-popover]');
    if (!popover) return;

    closePopover();
    const rect = button.getBoundingClientRect();
    popover.style.left = Math.round(rect.right - 160) + 'px';
    popover.style.top = Math.round(rect.bottom + 4) + 'px';
    popover.setAttribute('data-open', '');
    popover.setAttribute('aria-hidden', 'false');
    openPopover = popover;
  }

  function hideToast(table) {
    const toast = table.querySelector('[data-table-toast]');
    if (!toast) return;
    toast.removeAttribute('data-visible');
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  function showToast(table) {
    const toast = table.querySelector('[data-table-toast]');
    if (!toast) return;
    toast.setAttribute('data-visible', '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hideToast(table), 5000);
  }

  function deleteSelected(table) {
    const selected = checkedRows(table);
    if (!selected.length) return;

    deletedRows = selected.map((row) => ({
      element: row,
      nextSibling: row.nextElementSibling,
      parent: row.parentElement,
      data: parseRowData(row),
    }));

    selected.forEach((row) => row.remove());
    reindexRows(table);
    syncTable(table);
    showToast(table);
  }

  function undoDelete(table) {
    if (!deletedRows?.length) return;

    const body = table.querySelector('[data-table-body]');
    if (!body) return;

    deletedRows.forEach((item) => {
      if (item.nextSibling && item.nextSibling.parentElement === body) {
        body.insertBefore(item.element, item.nextSibling);
      } else {
        body.appendChild(item.element);
      }
      setRowChecked(item.element, true);
    });

    deletedRows = null;
    reindexRows(table);
    syncTable(table);
    hideToast(table);
  }

  function duplicateSelected(table) {
    const selected = checkedRows(table);
    if (!selected.length) return;

    const rows = dataRows(table);
    const indices = selected.map((row) => Number(row.dataset.rowIndex));
    const insertAfter = Math.max(...indices);
    const body = table.querySelector('[data-table-body]');
    if (!body) return;

    const clones = [];
    selected.forEach((row) => {
      const clone = row.cloneNode(true);
      clone.removeAttribute('data-checked');
      const checkbox = clone.querySelector('[data-row-checkbox]');
      if (checkbox) {
        checkbox.removeAttribute('data-checked');
        checkbox.setAttribute('aria-pressed', 'false');
        const glyph = checkbox.querySelector('[data-checkbox-glyph]');
        if (glyph && ICONS.unchecked) glyph.src = ICONS.unchecked;
      }
      clone.classList.remove(
        'tma-table-a__row--selected-only',
        'tma-table-a__row--selected-start',
        'tma-table-a__row--selected-mid',
        'tma-table-a__row--selected-end',
        'tma-table-a__row--hovering'
      );
      clone.classList.add('tma-table-a__row--' + (clone.dataset.borderVariant === 'section-end' ? 'section-end' : 'default'));
      clones.push(clone);
    });

    const anchor = rows[insertAfter];
    let ref = anchor?.nextElementSibling ?? null;
    clones.reverse().forEach((clone) => {
      body.insertBefore(clone, ref);
      ref = clone;
    });

    clearSelection(table);
    reindexRows(table);
    clones.reverse().forEach((clone) => setRowChecked(clone, true));
    syncTable(table);
  }

  function cyclePageSize(table) {
    const button = table.querySelector('[data-table-pagination] .tma-pagination-bar__page-size');
    const label = button?.querySelector('.tma-pagination__label');
    if (!label) return;

    const current = Number(label.textContent) || 20;
    const index = PAGE_SIZES.indexOf(current);
    const next = PAGE_SIZES[(index + 1) % PAGE_SIZES.length];
    label.textContent = String(next);
  }

  function toggleLoading(table) {
    const loading = table.querySelector('[data-table-loading]');
    if (!loading) return;
    const visible = loading.hasAttribute('data-visible');
    if (visible) {
      loading.removeAttribute('data-visible');
      loading.setAttribute('aria-hidden', 'true');
    } else {
      loading.setAttribute('data-visible', '');
      loading.setAttribute('aria-hidden', 'false');
    }
  }

  function handleRowBodyClick(table, row, event) {
    if (event.target.closest('button, a, input, [data-row-action], [data-copy-address]')) return;

    const rowIndex = Number(row.dataset.rowIndex);
    const checkbox = row.querySelector('[data-row-checkbox]');
    const checked = isChecked(checkbox);
    const modifier = event.metaKey || event.ctrlKey;

    if (event.shiftKey && lastClickedIndex !== null) {
      selectRange(table, lastClickedIndex, rowIndex, true);
    } else if (modifier) {
      setCheckboxState(checkbox, !checked);
    } else {
      const count = checkedCount(table);
      if (!checked) {
        if (count > 0 && !modifier) {
          table.querySelectorAll('[data-row-checkbox]').forEach((box) => {
            if (box !== checkbox) setCheckboxState(box, false);
          });
        }
        setCheckboxState(checkbox, true);
      } else if (count === 1) {
        setCheckboxState(checkbox, false);
      } else {
        table.querySelectorAll('[data-row-checkbox]').forEach((box) => setCheckboxState(box, false));
        setCheckboxState(checkbox, true);
      }
    }

    lastClickedIndex = rowIndex;
    syncTable(table);
  }

  function bindRowHover(table, row) {
    row.addEventListener('mouseenter', () => {
      clearHovering(table);
      row.classList.add('tma-table-a__row--hovering');
    });
    row.addEventListener('mouseleave', () => {
      row.classList.remove('tma-table-a__row--hovering');
    });
  }

  function bindTable(table) {
    resolveIconPaths(table);

    const sheet = table.querySelector('[data-table-sheet]');
    if (sheet) {
      sheet.addEventListener('mouseenter', () => table.setAttribute('data-sheet-hover', ''));
      sheet.addEventListener('mouseleave', () => table.removeAttribute('data-sheet-hover'));
    }

    dataRows(table).forEach((row) => {
      bindRowHover(table, row);
      row.addEventListener('click', (event) => handleRowBodyClick(table, row, event));
    });

    syncTable(table);
  }

  document.querySelectorAll('[data-table-c]').forEach(bindTable);

  document.addEventListener('click', (event) => {
    const table = event.target.closest('[data-table-c]');

    if (!table && !event.target.closest('[data-table-popover]')) {
      document.querySelectorAll('[data-table-c]').forEach(clearSelection);
      closePopover();
      return;
    }

    if (event.target.closest('[data-table-popover]')) return;

    const actionBtn = event.target.closest('[data-row-action]');
    if (actionBtn && table) {
      event.preventDefault();
      event.stopPropagation();
      openRowPopover(actionBtn);
      return;
    }

    if (event.target.closest('[data-copy-address]')) {
      const cell = event.target.closest('.tma-table-a__cell--address');
      const text = cell?.querySelector('.tma-table-a__label')?.textContent?.trim();
      if (text && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text);
      }
      return;
    }

    const trashBtn = event.target.closest('[data-table-c] [aria-label="Trash"]');
    if (trashBtn) {
      event.preventDefault();
      deleteSelected(trashBtn.closest('[data-table-c]'));
      return;
    }

    const copyBtn = event.target.closest('[data-table-c] [aria-label="Copy"]');
    if (copyBtn) {
      event.preventDefault();
      duplicateSelected(copyBtn.closest('[data-table-c]'));
      return;
    }

    const loadingBtn = event.target.closest('[data-table-c] [aria-label="Loading"]');
    if (loadingBtn) {
      event.preventDefault();
      toggleLoading(loadingBtn.closest('[data-table-c]'));
      return;
    }

    const pageSizeBtn = event.target.closest('[data-table-pagination] .tma-pagination-bar__page-size');
    if (pageSizeBtn && table) {
      event.preventDefault();
      cyclePageSize(table);
      return;
    }

    const undoBtn = event.target.closest('[data-toast-undo]');
    if (undoBtn) {
      event.preventDefault();
      const toastTable = undoBtn.closest('[data-table-c]');
      if (toastTable) undoDelete(toastTable);
      return;
    }

    const button = event.target.closest('.tma-table-a__checkbox-btn');
    if (!button || !table) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopPropagation();

    if (button.matches('[data-select-all]')) {
      const boxes = table.querySelectorAll('[data-row-checkbox]');
      const count = [...boxes].filter((box) => isChecked(box)).length;
      const shouldCheck = count !== boxes.length;
      boxes.forEach((box) => setCheckboxState(box, shouldCheck));
      syncTable(table);
      lastClickedIndex = null;
      return;
    }

    if (button.matches('[data-row-checkbox]')) {
      const row = button.closest('.tma-table-a__row');
      const rowIndex = row ? Number(row.dataset.rowIndex) : null;
      const checked = !isChecked(button);

      if (event.shiftKey && lastClickedIndex !== null && rowIndex !== null) {
        selectRange(table, lastClickedIndex, rowIndex, true);
      } else if (event.metaKey || event.ctrlKey) {
        setCheckboxState(button, checked);
      } else {
        setCheckboxState(button, checked);
      }

      if (rowIndex !== null) lastClickedIndex = rowIndex;
      syncTable(table);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePopover();
  });
})();
