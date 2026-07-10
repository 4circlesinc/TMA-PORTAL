(function () {
  const ICONS = { unchecked: null, checked: null };
  let lastClickedIndex = null;

  const ROW_VARIANTS = [
    'default',
    'section-end',
    'selected-only',
    'selected-start',
    'selected-mid',
    'selected-end',
  ];

  function resolveIconPaths(table) {
    if (ICONS.unchecked) return;
    const sample = table.querySelector('[data-checkbox-glyph]');
    if (!sample) return;
    const src = sample.getAttribute('src') || '';
    ICONS.unchecked = src.includes('CheckboxChecked') ? src.replace('CheckboxChecked-16.svg', 'Checkbox-16.svg') : src;
    ICONS.checked = ICONS.unchecked.replace('Checkbox-16.svg', 'CheckboxChecked-16.svg');
  }

  function isChecked(button) {
    return button?.hasAttribute('data-checked') ?? false;
  }

  function setCheckboxState(button, checked) {
    const glyph = button.querySelector('[data-checkbox-glyph]');
    const table = button.closest('.tma-table-a');
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
    const table = button.closest('.tma-table-a');
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

    const checkedCount = [...boxes].filter((box) => isChecked(box)).length;
    if (checkedCount === 0) {
      setSelectAllState(selectAll, 'none');
    } else if (checkedCount === boxes.length) {
      setSelectAllState(selectAll, 'all');
    } else {
      setSelectAllState(selectAll, 'some');
    }
  }

  function syncTable(table) {
    const anyChecked = [...table.querySelectorAll('[data-row-checkbox]')].some((box) => isChecked(box));
    table.toggleAttribute('data-has-selection', anyChecked);
    syncRowVariants(table);
    syncSelectAll(table);
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

  function clearHovering(table) {
    dataRows(table).forEach((row) => row.classList.remove('tma-table-a__row--hovering'));
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
    dataRows(table).forEach((row) => bindRowHover(table, row));
    syncTable(table);
  }

  document.querySelectorAll('.tma-table-a').forEach(bindTable);

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.tma-table-a__checkbox-btn');
    if (!button) return;

    const table = button.closest('.tma-table-a');
    if (!table) return;

    event.preventDefault();

    if (button.matches('[data-select-all]')) {
      const boxes = table.querySelectorAll('[data-row-checkbox]');
      const checkedCount = [...boxes].filter((box) => isChecked(box)).length;
      const shouldCheck = checkedCount !== boxes.length;

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
      } else {
        setCheckboxState(button, checked);
      }

      if (rowIndex !== null) lastClickedIndex = rowIndex;
      syncTable(table);
    }
  });
})();
