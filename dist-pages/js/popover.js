/* TMA - Popover / Select dropdown */
(function () {
  'use strict';

  const svg = (key, cls, w, h) => (window.TMAPopoverIcons && window.TMAPopoverIcons.svg(key, cls, w, h)) || '';

  const SIMPLE_NODE_IDS = {
    1: '33303:7655',
    2: '33303:7656',
    3: '33303:7657',
    4: '33303:7658',
    5: '33303:7659',
    6: '33303:7660',
    7: '33303:7661',
    8: '33303:7662',
  };

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function avatarBase() {
    if (typeof location === 'undefined') return '../images/avatars/';
    const segments = (location.pathname || '').split('/').filter(Boolean);
    if (segments.length && /\.[a-z0-9]+$/i.test(segments[segments.length - 1])) segments.pop();
    if (segments.length === 0) return '/TMA-PORTAL/images/avatars/';
    return `${'../'.repeat(segments.length)}images/avatars/`;
  }

  function avatarSrc(name) {
    return `${avatarBase()}${name}.png`;
  }

  function renderSwitch(on, large, opts) {
    const o = opts || {};
    const cls = on ? ' tma-popover__switch-track--on' : '';
    const wrapCls = large ? ' tma-popover__switch--large' : '';
    const track = `<span class="tma-popover__switch-track${cls}"><span class="tma-popover__switch-thumb"></span></span>`;

    if (!o.interactive) {
      return `<span class="tma-popover__switch${wrapCls}" aria-hidden="true">${track}</span>`;
    }

    const disabled = o.locked ? ' disabled' : '';
    return `<button type="button" class="tma-popover__switch${wrapCls}" data-popover-switch aria-pressed="${on ? 'true' : 'false'}" aria-label="Toggle"${disabled}>${track}</button>`;
  }

  function renderValueInput(opts) {
    const o = typeof opts === 'string' ? { placeholder: opts } : (opts || {});
    const text = o.value != null ? o.value : (o.placeholder || 'Type a value...');
    const cls = [
      o.value == null ? 'tma-popover__value-input--placeholder' : '',
      o.wide ? 'tma-popover__value-input--wide' : '',
      o.padded ? 'tma-popover__value-input--padded' : '',
    ].filter(Boolean).join(' ');
    const inner = `<div class="tma-popover__value-input${cls ? ` ${cls}` : ''}"><span class="tma-popover__value-input-text">${esc(text)}</span></div>`;
    return o.wrap ? `<div class="tma-popover__value-input-wrap">${inner}</div>` : inner;
  }

  function renderTag(label) {
    return `<span class="tma-popover__tag"><span class="tma-popover__tag-label">${esc(label)}</span><span class="tma-popover__tag-close">${svg('Close12', 'tma-popover__tag-close-icon', 12, 12)}</span></span>`;
  }

  function renderItem(item) {
    const parts = [];
    const state = [];
    if (item.hover) state.push('data-hover');
    if (item.selected) state.push('data-selected');
    if (item.destructive) state.push('data-destructive');
    const switchInteractive = !!(item.switch && item.switchInteractive);
    if (item.static && !switchInteractive) state.push('data-static');
    if (switchInteractive && !item.switchLocked) state.push('data-switch-row');
    if (item.check) state.push('data-checked');

    const tag = (item.button === false && (!switchInteractive || item.switchLocked)) ? 'div' : 'button';
    const type = tag === 'button' ? ' type="button"' : '';
    const role = item.role ? ` role="${item.role}"` : '';

    parts.push(`<${tag} class="tma-popover__item${item.static ? ' tma-popover__item--static' : ''}"${type}${role}${state.length ? ' ' + state.join(' ') : ''}>`);

    if (item.avatar) {
      if (item.avatarInitial) {
        parts.push(`<span class="tma-popover__avatar tma-popover__avatar--initial" style="background:${esc(item.avatarColor || 'rgba(0,0,0,0.04)')}">${esc(item.avatarInitial)}</span>`);
      } else {
        parts.push(`<img src="${esc(avatarSrc(item.avatar))}" alt="" class="tma-popover__avatar" width="24" height="24" />`);
      }
    } else if (item.icon) {
      parts.push(`<span class="tma-popover__item-icon">${svg(item.icon, 'tma-popover__item-icon-svg', 16, 16)}</span>`);
    }

    if (item.description) {
      parts.push(`<span class="tma-popover__item-copy"><span class="tma-popover__item-label">${esc(item.label)}</span><span class="tma-popover__item-description">${esc(item.description)}</span></span>`);
    } else {
      parts.push(`<span class="tma-popover__item-label">${esc(item.label)}</span>`);
    }

    if (item.meta) {
      parts.push(`<span class="tma-popover__item-meta">${esc(item.meta)}</span>`);
    }
    if (item.shortcut) {
      parts.push(`<span class="tma-popover__item-shortcut">${esc(item.shortcut)}</span>`);
    }
    if (item.check) {
      parts.push(`<span class="tma-popover__item-check">${svg('Check16', 'tma-popover__item-check-svg', 16, 16)}</span>`);
    }
    if (item.chevron) {
      parts.push(`<span class="tma-popover__item-chevron">${svg('ArrowLineRight16', 'tma-popover__item-chevron-svg', 16, 16)}</span>`);
    }
    if (item.switch) {
      parts.push(renderSwitch(!!item.switchOn, !!item.switchLarge, {
        interactive: switchInteractive,
        locked: !!item.switchLocked,
      }));
    }

    parts.push(`</${tag}>`);
    return parts.join('');
  }

  function renderTextRow(label, opts) {
    const o = opts || {};
    const cls = o.muted ? ' tma-popover__text-row--muted' : '';
    return `<div class="tma-popover__text-row${cls}">${esc(label)}</div>`;
  }

  function renderSearch(opts) {
    const o = opts || {};
    const value = o.value != null ? esc(o.value) : '';
    const placeholder = esc(o.placeholder || 'Search');
    const readonly = o.readonly ? ' readonly' : '';
    const variant = o.variant === 'focused' ? ' tma-popover__search--focused' : '';
    const input = o.interactive
      ? `<input class="tma-popover__search-input" type="text" placeholder="${placeholder}" value="${value}"${readonly} data-popover-search />`
      : `<span class="tma-popover__search-placeholder">${value || placeholder}</span>`;

    const inner = `<div class="tma-popover__search${o.focus ? ' tma-popover__search--focus' : ''}${variant}">
      <span class="tma-popover__search-icon">${svg('Search16', 'tma-popover__search-icon-svg', 16, 16)}</span>
      ${input}
      ${o.kbd !== false ? '<span class="tma-popover__search-kbd">/</span>' : ''}
    </div>`;

    return o.wrap ? `<div class="tma-popover__search-wrap">${inner}</div>` : inner;
  }

  function renderGroupHeader(label, opts) {
    const o = opts || {};
    let html = `<div class="tma-popover__group-header${o.clickable ? ' tma-popover__group-header--clickable' : ''}${o.surface ? ' tma-popover__group-header--surface' : ''}">`;
    if (o.chevron) {
      html += `<span class="tma-popover__group-chevron">${svg(o.chevron === 'down' ? 'ArrowLineDown16' : 'ArrowLineRight16', 'tma-popover__group-chevron-svg', 16, 16)}</span>`;
    }
    html += `<span class="tma-popover__group-label">${esc(label)}</span>`;
    if (o.partial) {
      const partialKey = o.partial === 'minus' ? 'Minus16' : 'Check16';
      html += `<span class="tma-popover__group-partial">${svg(partialKey, 'tma-popover__group-partial-svg', 16, 16)}</span>`;
    }
    html += '</div>';
    return html;
  }

  function renderTagInput(tags, placeholder) {
    const tagHtml = (tags || []).map(renderTag).join('');
    return `<div class="tma-popover__tag-input">
      <div class="tma-popover__tag-input-inner">
        ${tagHtml}
        <span class="tma-popover__tag-input-text">${esc(placeholder || '')}</span>
      </div>
      <span class="tma-popover__tag-input-chevron">${svg('ArrowLineDown16', 'tma-popover__tag-input-chevron-svg', 20, 20)}</span>
    </div>`;
  }

  function renderGroups(groups) {
    return (groups || []).map((group, index) => {
      const border = group.border !== false && index < groups.length - 1;
      let html = `<div class="tma-popover__group${border ? ' tma-popover__group--bordered' : ''}">`;
      if (group.search) html += renderSearch(group.search);
      if (group.valueInput) html += renderValueInput(group.valueInput);
      if (group.tagInput) html += renderTagInput(group.tagInput.tags, group.tagInput.placeholder);
      if (group.header) html += renderGroupHeader(group.header, group.headerOpts);
      if (group.textRows) {
        group.textRows.forEach((row) => { html += renderTextRow(row.label, row); });
      }
      if (group.empty) {
        html += `<p class="tma-popover__empty">${esc(group.empty)}</p>`;
      }
      (group.items || []).forEach((item) => { html += renderItem(item); });
      html += '</div>';
      return html;
    }).join('');
  }

  function renderSimple(count, nodeId) {
    const n = Math.max(1, Math.min(8, count || 1));
    const id = nodeId || SIMPLE_NODE_IDS[n];
    const items = Array.from({ length: n }, (_, i) => ({ label: `Option ${i + 1}`, button: false }));
    return renderPopover({ items, nodeId: id, width: 'auto' });
  }

  function renderPopover(opts) {
    const o = opts || {};
    const resolvedWidth = typeof o.width === 'number' ? o.width : (o.wide ? 360 : (o.width === 'auto' ? null : 240));
    const widthAttr = resolvedWidth == null
      ? ''
      : ` style="width:${resolvedWidth}px"`;
    const cls = [
      'tma-popover',
      o.wide ? 'tma-popover--wide' : '',
      o.width === 'auto' ? 'tma-popover--auto' : '',
      o.fixed ? 'tma-popover--fixed' : '',
      o.className || '',
    ].filter(Boolean).join(' ');

    let body = '';
    if (o.search && !o.groups) body += renderSearch(o.search);
    if (o.tagInput) body += renderTagInput(o.tagInput.tags, o.tagInput.placeholder);
    if (o.groups) body += renderGroups(o.groups);
    if (o.items) {
      body += `<div class="tma-popover__group">${o.items.map(renderItem).join('')}</div>`;
    }
    if (o.empty) body += `<p class="tma-popover__empty">${esc(o.empty)}</p>`;

    const nodeAttr = o.nodeId ? ` data-node-id="${o.nodeId}"` : '';
    const openAttr = o.open ? ' data-open aria-hidden="false"' : ' aria-hidden="true"';

    return `<div class="${cls}"${nodeAttr}${widthAttr}${o.fixed ? openAttr : ''} role="menu">${body}</div>`;
  }

  function basicInteractionMenuGroups(overrides) {
    const o = overrides || {};
    return [
      {
        search: { placeholder: 'Search', kbd: true, ...(o.search || {}) },
        items: [
          { label: 'Ask AI', icon: 'AI16', chevron: true, hover: o.hoverAsk },
          { label: 'Tags', icon: 'Tag16', meta: 'Multi-Select', chevron: true },
          { label: 'Edit Property', icon: 'SlidersHorizontal16', hover: !!o.hoverEdit },
        ],
        border: true,
      },
      {
        items: [
          { label: 'Sort ascending', icon: 'ArrowsUp16', shortcut: '⌘C' },
          { label: 'Sort descending', icon: 'ArrowsDown16', shortcut: '⌘D' },
          { label: 'Filter', icon: 'FunnelSimple' },
        ],
        border: true,
      },
      {
        items: [
          { label: 'Hide in view', icon: 'EyeSlash16' },
          { label: 'Align', icon: 'TextAlignLeft16' },
        ],
        border: true,
      },
      {
        items: [
          { label: 'Toggle', switch: true, switchOn: o.switchOn, static: true },
        ],
        border: false,
      },
    ];
  }

  function propertyMenuGroups(overrides) {
    const groups = basicInteractionMenuGroups(overrides);
    groups.push({
      items: [{ label: 'Delete Property', icon: 'Trash16', destructive: true }],
      border: false,
    });
    return groups;
  }

  function renderPropertyMenu(opts) {
    return renderPopover({
      groups: propertyMenuGroups(opts),
      nodeId: opts && opts.nodeId,
      hoverItem: opts && opts.hoverItem,
    });
  }

  function renderSearchStates() {
    const allItems = [
      { label: 'Ask AI', icon: 'AI16', chevron: true },
      { label: 'Tags', icon: 'Tag16', meta: 'Multi-Select', chevron: true },
      { label: 'Edit Property', icon: 'SlidersHorizontal16' },
      { label: 'Sort ascending', icon: 'ArrowsUp16', shortcut: '⌘C' },
      { label: 'Sort descending', icon: 'ArrowsDown16', shortcut: '⌘D' },
      { label: 'Filter', icon: 'FunnelSimple' },
    ];

    return {
      noInput: renderPopover({
        groups: [{ search: { placeholder: 'Search' }, items: allItems.slice(0, 4), border: true }, { items: allItems.slice(3) }],
      }),
      noResults: renderPopover({
        search: { value: 'xyz', focus: true, interactive: true },
        empty: 'No results',
        groups: [{ items: [], border: false }],
      }),
      haveResults: renderPopover({
        search: { value: 'tag', focus: true, interactive: true },
        groups: [{ items: [{ label: 'Tags', icon: 'Tag16', meta: 'Multi-Select', chevron: true, hover: true }] }],
      }),
    };
  }

  function renderNestedMenus() {
    const parent = renderPopover({
      groups: [
        {
          search: { placeholder: 'Search' },
          items: [
            { label: 'Ask AI', icon: 'AI16', chevron: true },
            { label: 'Tags', icon: 'Tag16', meta: 'Multi-Select', chevron: true, hover: true, 'data-submenu': 'tags' },
            { label: 'Edit Property', icon: 'SlidersHorizontal16' },
          ],
        },
      ],
    });

    const child = renderPopover({
      groups: [
        {
          tagInput: { tags: [], placeholder: 'Search tags' },
          items: [
            { label: 'Design', check: true },
            { label: 'Engineering', hover: true },
            { label: 'Marketing', chevron: true },
            { label: 'Sales' },
            { label: 'Support' },
            { label: 'Operations' },
          ],
        },
      ],
    });

    return { parent, child };
  }

  function renderGroupingMenu() {
    return renderPopover({
      wide: true,
      groups: [
        {
          tagInput: {
            tags: ['Group 1', 'ByeWind', 'Drew Cano', 'Natali Craig'],
            placeholder: 'BW',
          },
          border: true,
        },
        {
          header: 'Group 1',
          headerOpts: { chevron: 'down', clickable: true, partial: true },
          items: [
            { label: 'ByeWind', avatar: 'AvatarByewind', check: true },
            { label: 'Bruce Wayne', avatarInitial: 'B', avatarColor: '#7dbbff' },
            { label: 'Drew Cano', avatar: 'AvatarMale04' },
            { label: 'Koray Okumus', avatar: 'AvatarMale04' },
            { label: 'Melody Macy', avatar: 'AvatarFemale05' },
            { label: 'Michael Brown', avatarInitial: 'M', avatarColor: '#71dd8c' },
            { label: 'Natali Craig', avatar: 'AvatarFemale06', chevron: true },
            { label: 'Orlando Diggs', avatar: 'AvatarMale03', chevron: true },
          ],
        },
      ],
    });
  }

  function renderSelectFieldMarkup(opts) {
    const o = opts || {};
    const label = o.label ? `<label class="tma-select-field__label">${esc(o.label)}</label>` : '';
    const placeholder = esc(o.placeholder || 'Select an option');
    const value = o.value ? esc(o.value) : '';
    const empty = value ? '' : ' data-empty';
    const text = value || placeholder;

    return `${label}
      <button type="button" class="tma-select-field__trigger" aria-haspopup="listbox" aria-expanded="false"${empty}>
        <span class="tma-select-field__value">${text}</span>
        <span class="tma-select-field__chevron">${svg('ArrowLineDown16', 'tma-select-field__chevron-svg', 16, 16)}</span>
      </button>
      ${o.name ? `<input type="hidden" name="${esc(o.name)}" value="${value}">` : ''}`;
  }

  function closeAllPopovers(except) {
    document.querySelectorAll('.tma-popover--fixed[data-open], .tma-select-field[data-open]').forEach((el) => {
      if (el !== except && !except?.contains?.(el)) {
        el.removeAttribute('data-open');
        if (el.classList.contains('tma-popover--fixed')) {
          el.setAttribute('aria-hidden', 'true');
        }
        const trigger = el.querySelector?.('.tma-select-field__trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function positionPopover(popover, anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth || 240;
    let left = Math.min(rect.left, window.innerWidth - width - 8);
    let top = rect.bottom + 4;
    if (top + popover.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - popover.offsetHeight - 4);
    }
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function bindPopoverSearch(popover) {
    const input = popover.querySelector('[data-popover-search]');
    if (!input) return;
    const items = [...popover.querySelectorAll('.tma-popover__item')];
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      let visible = 0;
      items.forEach((item) => {
        const label = item.querySelector('.tma-popover__item-label')?.textContent?.toLowerCase() || '';
        const show = !q || label.includes(q);
        item.style.display = show ? '' : 'none';
        if (show) visible += 1;
      });
      let emptyEl = popover.querySelector('.tma-popover__empty--live');
      if (!emptyEl) {
        emptyEl = document.createElement('p');
        emptyEl.className = 'tma-popover__empty tma-popover__empty--live';
        emptyEl.textContent = 'No results';
        popover.appendChild(emptyEl);
      }
      emptyEl.hidden = visible > 0 || !q;
    });
  }

  function attachSelectField(container, options) {
    if (!container) return null;
    const o = options || {};
    const count = o.optionCount || 8;
    const optionsList = o.options || Array.from({ length: count }, (_, i) => `Option ${i + 1}`);

    container.classList.add('tma-select-field');
    container.innerHTML = renderSelectFieldMarkup(o);

    const trigger = container.querySelector('.tma-select-field__trigger');
    const hidden = container.querySelector('input[type="hidden"]');
    const valueEl = container.querySelector('.tma-select-field__value');

    const popover = document.createElement('div');
    popover.innerHTML = renderPopover({
      fixed: true,
      items: optionsList.map((label) => ({ label, role: 'menuitem' })),
    });
    const popoverEl = popover.firstElementChild;
    document.body.appendChild(popoverEl);
    popoverEl._anchor = trigger;

    function open() {
      closeAllPopovers(container);
      container.setAttribute('data-open', 'true');
      trigger.setAttribute('aria-expanded', 'true');
      popoverEl.setAttribute('data-open', 'true');
      popoverEl.setAttribute('aria-hidden', 'false');
      positionPopover(popoverEl, trigger);
    }

    function close() {
      container.removeAttribute('data-open');
      trigger.setAttribute('aria-expanded', 'false');
      popoverEl.removeAttribute('data-open');
      popoverEl.setAttribute('aria-hidden', 'true');
    }

    function select(label) {
      if (!label) {
        valueEl.textContent = o.placeholder || 'Select an option';
        trigger.setAttribute('data-empty', '');
        if (hidden) hidden.value = '';
      } else {
        valueEl.textContent = label;
        trigger.removeAttribute('data-empty');
        if (hidden) hidden.value = label;
      }
      if (typeof o.onChange === 'function') o.onChange(label);
      close();
    }

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (container.hasAttribute('data-open')) close();
      else open();
    });

    popoverEl.addEventListener('click', (e) => {
      const item = e.target.closest('.tma-popover__item');
      if (!item || !popoverEl.contains(item)) return;
      e.preventDefault();
      const label = item.querySelector('.tma-popover__item-label')?.textContent?.trim();
      if (label) select(label);
    });

    window.addEventListener('resize', () => {
      if (container.hasAttribute('data-open')) positionPopover(popoverEl, trigger);
    });

    document.addEventListener('click', (e) => {
      if (!container.hasAttribute('data-open')) return;
      if (!container.contains(e.target) && !popoverEl.contains(e.target)) close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && container.hasAttribute('data-open')) close();
    });

    return { open, close, select, trigger, popover: popoverEl };
  }

  function toggleSwitch(btn) {
    const track = btn.querySelector('.tma-popover__switch-track');
    if (!track) return;
    const on = !track.classList.contains('tma-popover__switch-track--on');
    track.classList.toggle('tma-popover__switch-track--on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function bindPopoverSwitches(root) {
    const scope = root || document;

    scope.querySelectorAll('[data-popover-switch]:not([disabled])').forEach((btn) => {
      if (btn.dataset.switchBound) return;
      btn.dataset.switchBound = '1';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSwitch(btn);
      });
    });

    scope.querySelectorAll('.tma-popover__item[data-switch-row]').forEach((row) => {
      if (row.dataset.switchRowBound) return;
      row.dataset.switchRowBound = '1';
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-popover-switch]')) return;
        const btn = row.querySelector('[data-popover-switch]:not([disabled])');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        toggleSwitch(btn);
      });
    });
  }

  function mountInteractive(root, options) {
    if (!root) return;
    const o = options || {};
    root.querySelectorAll('[data-popover-live]').forEach((wrap) => {
      const trigger = wrap.querySelector('[data-popover-trigger]');
      const menu = wrap.querySelector('.tma-popover');
      if (!trigger || !menu) return;

      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const open = wrap.hasAttribute('data-open');
        closeAllPopovers(wrap);
        if (!open) {
          wrap.setAttribute('data-open', 'true');
          trigger.setAttribute('aria-expanded', 'true');
        }
      });

      bindPopoverSearch(menu);

      menu.querySelectorAll('.tma-popover__item').forEach((item) => {
        item.addEventListener('click', () => {
          menu.querySelectorAll('.tma-popover__item[data-selected]').forEach((el) => el.removeAttribute('data-selected'));
          item.setAttribute('data-selected', 'true');
        });
      });
    });

    if (o.selectField) {
      attachSelectField(root.querySelector('[data-select-field]'), o.selectField);
    }

    bindPopoverSwitches(root);

    document.addEventListener('click', (e) => {
      root.querySelectorAll('[data-popover-live][data-open]').forEach((wrap) => {
        if (!wrap.contains(e.target)) {
          wrap.removeAttribute('data-open');
          const trigger = wrap.querySelector('[data-popover-trigger]');
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  window.TMAPopover = {
    SIMPLE_NODE_IDS,
    renderPopover,
    renderSimple,
    renderPropertyMenu,
    renderSearchStates,
    renderNestedMenus,
    renderGroupingMenu,
    renderSelectFieldMarkup,
    renderValueInput,
    attachSelectField,
    bindPopoverSwitches,
    mountInteractive,
    closeAllPopovers,
    propertyMenuGroups,
    basicInteractionMenuGroups,
  };
})();
