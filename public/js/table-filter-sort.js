/**
 * TMA Table Filter and sort - Plan A interactive filtering + sorting.
 */
(function () {
  'use strict';

  var DATE_WEIGHT = {
    'just now': 0,
    '1 minute ago': 1,
    '1 hour ago': 2,
    'yesterday': 3,
    'feb 2, 2026': 4,
  };

  function normalize(value) {
    return String(value || '').toLowerCase().trim();
  }

  function dateWeight(label) {
    return DATE_WEIGHT[normalize(label)] ?? 99;
  }

  function closeAllPopovers(except) {
    document.querySelectorAll('.tma-filter-popover--fixed[data-open]').forEach(function (el) {
      if (el !== except) {
        el.removeAttribute('data-open');
        el.setAttribute('aria-hidden', 'true');
      }
    });
    document.querySelectorAll('[data-filter-trigger]').forEach(function (btn) {
      if (!except || btn !== except._trigger) {
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    document.querySelectorAll('[data-column-menu-trigger]').forEach(function (btn) {
      if (!except || btn !== except._trigger) {
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function positionPopover(popover, anchor) {
    var rect = anchor.getBoundingClientRect();
    var width = popover.offsetWidth || 240;
    var left = Math.min(rect.left, window.innerWidth - width - 8);
    var top = rect.bottom + 4;
    if (top + popover.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - popover.offsetHeight - 4);
    }
    popover.style.left = Math.round(left) + 'px';
    popover.style.top = Math.round(top) + 'px';
  }

  function openPopover(popover, anchor) {
    closeAllPopovers(popover);
    popover.setAttribute('data-open', 'true');
    popover.setAttribute('aria-hidden', 'false');
    popover._trigger = anchor;
    positionPopover(popover, anchor);
    if (anchor) {
      anchor.setAttribute('aria-expanded', 'true');
      if (anchor.hasAttribute('data-filter-trigger')) {
        anchor.setAttribute('aria-pressed', 'true');
      }
    }
  }

  function tagIcon(kind) {
    if (kind === 'sort') return 'ArrowsDown';
    if (kind === 'status') return 'Dot';
    return 'FunnelSimple';
  }

  function renderTags(bar, tags) {
    if (!bar) return;
    var tagsWrap = bar.querySelector('.tma-filter-and-sort__tags');
    if (!tagsWrap) return;

    var html = tags.map(function (tag) {
      var icon = tag.icon || tagIcon(tag.kind);
      var iconSize = icon === 'Dot' ? 12 : 16;
      var iconClass = iconSize === 12
        ? 'tma-filter-and-sort__icon tma-filter-and-sort__icon--12'
        : 'tma-filter-and-sort__icon tma-filter-and-sort__icon--16';
      return '<div class="tma-filter-and-sort__tag" role="listitem" data-tag-id="' + tag.id + '">' +
        '<img src="' + (window.TMATableFilterSortIcons && window.TMATableFilterSortIcons[icon] || '') + '" class="' + iconClass + '" width="' + iconSize + '" height="' + iconSize + '" alt="" aria-hidden="true" />' +
        '<span class="tma-filter-and-sort__label">' + tag.label + '</span>' +
        '<button type="button" class="tma-filter-and-sort__remove" aria-label="Remove ' + tag.label + '" data-remove-tag="' + tag.id + '">' +
        '<img src="' + (window.TMATableFilterSortIcons && window.TMATableFilterSortIcons.Close || '') + '" class="tma-filter-and-sort__icon tma-filter-and-sort__icon--close" width="6" height="6" alt="" />' +
        '</button></div>';
    }).join('');

    tagsWrap.innerHTML = html;
    bar.classList.toggle('tma-filter-and-sort--empty', tags.length === 0);
  }

  function applyTable(root, allRows, state) {
    var body = root.querySelector('[data-table-body]');
    var renderRow = window.TMATableFilterSortRenderRow;
    var resultsEl = root.querySelector('[data-filter-results-count]');
    if (!body || !renderRow) return;

    var rows = allRows.slice();

    if (state.filters.status) {
      rows = rows.filter(function (row) {
        return normalize(row.statusLabel) === normalize(state.filters.status);
      });
    }

    if (state.filters.user) {
      rows = rows.filter(function (row) {
        return normalize(row.user) === normalize(state.filters.user);
      });
    }

    if (state.filters.project) {
      var q = normalize(state.filters.project);
      rows = rows.filter(function (row) {
        return normalize(row.project).includes(q);
      });
    }

    if (state.filters.text) {
      var needle = normalize(state.filters.text.value);
      var field = state.filters.text.field;
      rows = rows.filter(function (row) {
        var hay = normalize(row[field] || row.project || '');
        if (state.filters.text.op === 'starts with') return hay.startsWith(needle);
        if (state.filters.text.op === 'ends with') return hay.endsWith(needle);
        if (state.filters.text.op === 'is not') return hay !== needle;
        if (state.filters.text.op === 'does not contain') return !hay.includes(needle);
        if (state.filters.text.op === 'is') return hay === needle;
        return hay.includes(needle);
      });
    }

    if (state.sort.column === 'date') {
      rows.sort(function (a, b) {
        var diff = dateWeight(a.date) - dateWeight(b.date);
        return state.sort.direction === 'asc' ? diff : -diff;
      });
    }

    if (state.sort.column === 'status') {
      rows.sort(function (a, b) {
        var diff = normalize(a.statusLabel).localeCompare(normalize(b.statusLabel));
        return state.sort.direction === 'asc' ? diff : -diff;
      });
    }

    body.innerHTML = rows.map(function (row, i) { return renderRow(row, i); }).join('');

    if (resultsEl) {
      var count = rows.length;
      resultsEl.textContent = count === 1 ? '1 result' : count + ' results';
    }

    updateHeaderState(root, state);
  }

  function updateHeaderState(root, state) {
    root.querySelectorAll('[data-column-menu-trigger]').forEach(function (btn) {
      var col = btn.getAttribute('data-column-menu-trigger');
      var headCell = btn.closest('.tma-table-a__cell');
      var label = headCell && headCell.querySelector('.tma-table-a__label');
      var icons = headCell && headCell.querySelector('.tma-table-a__head-icons');
      if (!headCell || !label) return;

      var hasFilter = (col === 'date' && state.filters.dateRange) || (col === 'status' && state.filters.status);
      var hasSort = state.sort.column === col;

      headCell.classList.toggle('tma-table-a__head-cell--active', !!(hasFilter || hasSort));
      if (icons) icons.style.display = (hasFilter || hasSort) ? 'inline-flex' : 'none';
    });
  }

  function buildTags(state) {
    var tags = [];
    if (state.filters.dateRange) {
      tags.push({ id: 'date-range', kind: 'filter', label: 'Date: ' + state.filters.dateRange, icon: 'FunnelSimple' });
    }
    if (state.filters.status) {
      tags.push({ id: 'status', kind: 'filter', label: 'Status', icon: 'Dot' });
    }
    if (state.filters.user) {
      tags.push({ id: 'user', kind: 'filter', label: 'User: ' + state.filters.user, icon: 'FunnelSimple' });
    }
    if (state.filters.text) {
      tags.push({ id: 'text', kind: 'filter', label: state.filters.text.fieldLabel + ': ' + state.filters.text.value, icon: 'FunnelSimple' });
    }
    if (state.sort.column === 'date') {
      tags.push({ id: 'sort-date', kind: 'sort', label: 'Date', icon: 'ArrowsDown' });
    }
    return tags;
  }

  function initLive(root) {
    if (root.hasAttribute('data-table-filter-sort-initialized')) return;
    root.setAttribute('data-table-filter-sort-initialized', '');

    var allRows = [];
    try {
      allRows = JSON.parse(root.getAttribute('data-all-rows') || '[]');
    } catch (_) {}

    var state = {
      filters: { dateRange: '10/02/2026 - 25/02/2026' },
      sort: { column: 'date', direction: 'desc' },
    };

    var filterBar = root.querySelector('.tma-filter-and-sort');
    var filterBtn = root.querySelector('[data-filter-trigger]');
    var fieldsPopover = root.querySelector('[data-filter-popover="fields"]');
    var operatorsPopover = root.querySelector('[data-filter-popover="operators"]');
    var statusPopover = root.querySelector('[data-filter-popover="status"]');
    var usersPopover = root.querySelector('[data-filter-popover="users"]');
    var columnPopover = root.querySelector('[data-filter-popover="column"]');

    renderTags(filterBar, buildTags(state));
    applyTable(root, allRows, state);

    var activeField = null;

    function refresh() {
      renderTags(filterBar, buildTags(state));
      applyTable(root, allRows, state);
    }

    if (filterBtn && fieldsPopover) {
      filterBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (fieldsPopover.hasAttribute('data-open')) {
          closeAllPopovers();
        } else {
          openPopover(fieldsPopover, filterBtn);
        }
      });
    }

    root.addEventListener('click', function (e) {
      var fieldItem = e.target.closest('[data-filter-field]');
      if (fieldItem && fieldsPopover && fieldsPopover.contains(fieldItem)) {
        e.preventDefault();
        activeField = {
          id: fieldItem.getAttribute('data-filter-field'),
          label: fieldItem.getAttribute('data-filter-field-label') || fieldItem.textContent.trim(),
        };

        if (activeField.id === 'status' && statusPopover) {
          closeAllPopovers(statusPopover);
          openPopover(statusPopover, fieldItem);
          return;
        }

        if (activeField.id === 'user' && usersPopover) {
          closeAllPopovers(usersPopover);
          openPopover(usersPopover, fieldItem);
          return;
        }

        if (activeField.id === 'date') {
          state.filters.dateRange = '10/02/2026 - 25/02/2026';
          closeAllPopovers();
          refresh();
          return;
        }

        if (operatorsPopover) {
          var input = operatorsPopover.querySelector('[data-operator-value]');
          if (input) {
            input.value = '';
            input.placeholder = 'Type a value...';
          }
          closeAllPopovers(operatorsPopover);
          openPopover(operatorsPopover, fieldItem);
        }
        return;
      }

      var operatorItem = e.target.closest('[data-filter-operator]');
      if (operatorItem && operatorsPopover && operatorsPopover.contains(operatorItem)) {
        e.preventDefault();
        var op = operatorItem.getAttribute('data-filter-operator');
        var valueInput = operatorsPopover.querySelector('[data-operator-value]');
        var value = valueInput ? valueInput.value.trim() : '';
        if (!value || !activeField) return;

        var fieldKey = activeField.id === 'orderId' ? 'orderId' : (activeField.id === 'address' ? 'address' : 'project');
        state.filters.text = {
          field: fieldKey,
          fieldLabel: activeField.label,
          op: op,
          value: value,
        };
        closeAllPopovers();
        refresh();
        return;
      }

      var statusItem = e.target.closest('[data-filter-status]');
      if (statusItem && statusPopover && statusPopover.contains(statusItem)) {
        e.preventDefault();
        state.filters.status = statusItem.getAttribute('data-filter-status');
        closeAllPopovers();
        refresh();
        return;
      }

      var userItem = e.target.closest('[data-filter-user]');
      if (userItem && usersPopover && usersPopover.contains(userItem)) {
        e.preventDefault();
        state.filters.user = userItem.getAttribute('data-filter-user');
        closeAllPopovers();
        refresh();
        return;
      }

      var columnItem = e.target.closest('[data-column-action]');
      if (columnItem && columnPopover && columnPopover.contains(columnItem)) {
        e.preventDefault();
        var action = columnItem.getAttribute('data-column-action');
        if (action === 'noop') return;
        var col = columnPopover.getAttribute('data-active-column');
        if (action === 'sort-asc' && col) {
          state.sort = { column: col, direction: 'asc' };
        } else if (action === 'sort-desc' && col) {
          state.sort = { column: col, direction: 'desc' };
        } else if (action === 'clear-filter' && col === 'status') {
          delete state.filters.status;
        } else if (action === 'clear-filter' && col === 'date') {
          delete state.filters.dateRange;
        } else if (action === 'clear-sort') {
          state.sort = { column: null, direction: null };
        }
        closeAllPopovers();
        refresh();
        return;
      }

      var colTrigger = e.target.closest('[data-column-menu-trigger]');
      if (colTrigger && columnPopover) {
        e.preventDefault();
        e.stopPropagation();
        var column = colTrigger.getAttribute('data-column-menu-trigger');
        columnPopover.setAttribute('data-active-column', column);
        if (columnPopover.hasAttribute('data-open') && columnPopover._trigger === colTrigger) {
          closeAllPopovers();
        } else {
          openPopover(columnPopover, colTrigger);
        }
        return;
      }

      var removeBtn = e.target.closest('[data-remove-tag]');
      if (removeBtn && root.contains(removeBtn)) {
        e.preventDefault();
        var tagId = removeBtn.getAttribute('data-remove-tag');
        if (tagId === 'date-range') delete state.filters.dateRange;
        if (tagId === 'status') delete state.filters.status;
        if (tagId === 'user') delete state.filters.user;
        if (tagId === 'text') delete state.filters.text;
        if (tagId === 'sort-date') state.sort = { column: null, direction: null };
        refresh();
        return;
      }

      var resetBtn = e.target.closest('[data-reset-filters]');
      if (resetBtn && root.contains(resetBtn)) {
        e.preventDefault();
        state = { filters: {}, sort: { column: null, direction: null } };
        refresh();
        return;
      }
    });

    document.addEventListener('click', function (e) {
      if (e.target.closest('.tma-filter-popover--fixed') || e.target.closest('[data-filter-trigger]') || e.target.closest('[data-column-menu-trigger]')) {
        return;
      }
      closeAllPopovers();
    });

    window.addEventListener('resize', function () {
      document.querySelectorAll('.tma-filter-popover--fixed[data-open]').forEach(function (popover) {
        if (popover._trigger) positionPopover(popover, popover._trigger);
      });
    });
  }

  function initPlanB(root) {
    if (!root || root.hasAttribute('data-plan-b-initialized')) return;
    root.setAttribute('data-plan-b-initialized', '');

    var allRows = [];
    try {
      allRows = JSON.parse(root.getAttribute('data-all-rows') || '[]');
    } catch (_) {}

    var projectInput = root.querySelector('[data-plan-b-project]');
    var searchBtn = root.querySelector('[data-plan-b-search]');
    var resetBtn = root.querySelector('[data-plan-b-reset]');
    var body = root.querySelector('[data-table-body]');
    var renderRow = window.TMATableFilterSortRenderRow;

    function applyPlanB() {
      if (!body || !renderRow) return;
      var q = projectInput ? normalize(projectInput.value) : '';
      var rows = q
        ? allRows.filter(function (row) { return normalize(row.project).includes(q); })
        : allRows.slice();
      body.innerHTML = rows.map(function (row, i) { return renderRow(row, i); }).join('');
    }

    if (searchBtn) searchBtn.addEventListener('click', function (e) { e.preventDefault(); applyPlanB(); });
    if (resetBtn) resetBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (projectInput) projectInput.value = '';
      applyPlanB();
    });
    if (projectInput) {
      projectInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') applyPlanB();
      });
    }
  }

  function init() {
    document.querySelectorAll('[data-table-filter-sort]').forEach(initLive);
    document.querySelectorAll('[data-table-filter-sort-plan-b]').forEach(initPlanB);
  }

  window.TMATableFilterSort = { init: init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
