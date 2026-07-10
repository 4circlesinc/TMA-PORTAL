(function () {
  let openPopover = null;
  let toastTimer = null;

  function showToast(message) {
    let toast = document.querySelector('[data-table-b-toast]');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'tma-table-b__toast';
      toast.setAttribute('data-table-b-toast', '');
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.setAttribute('data-visible', '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.removeAttribute('data-visible'), 2400);
  }

  function closePopover() {
    if (!openPopover) return;
    openPopover.removeAttribute('data-open');
    openPopover.setAttribute('aria-hidden', 'true');
    const trigger = openPopover._trigger;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    openPopover = null;
  }

  function positionPopover(popover, button) {
    const rect = button.getBoundingClientRect();
    const width = popover.offsetWidth || 160;
    popover.style.left = Math.round(rect.right - width) + 'px';
    popover.style.top = Math.round(rect.bottom + 4) + 'px';
  }

  function openPopoverMenu(popover, button) {
    if (openPopover === popover) {
      closePopover();
      return;
    }

    closePopover();
    popover.removeAttribute('hidden');
    positionPopover(popover, button);
    popover.setAttribute('data-open', '');
    popover.setAttribute('aria-hidden', 'false');
    popover._trigger = button;
    button.setAttribute('aria-expanded', 'true');
    openPopover = popover;
  }

  function initTasksTable(table) {
    if (table.hasAttribute('data-table-b-initialized')) return;
    table.setAttribute('data-table-b-initialized', '');

    const dataPageUrl = table.getAttribute('data-data-page-url') || '#';

    table.addEventListener('click', (event) => {
      const titleBtn = event.target.closest('[data-table-b-title], [data-task-title]');
      if (titleBtn) {
        event.preventDefault();
        if (dataPageUrl && dataPageUrl !== '#') {
          window.open(dataPageUrl, '_blank', 'noopener,noreferrer');
        } else {
          showToast('Opening data page…');
        }
        return;
      }

      const avatarBtn = event.target.closest('[data-user-avatar]');
      if (avatarBtn) {
        event.preventDefault();
        const userId = avatarBtn.getAttribute('data-user-id') || 'user';
        showToast('Go to user page: ' + userId);
      }
    });
  }

  function initSessionsTable(block) {
    if (block.hasAttribute('data-table-b-initialized')) return;
    block.setAttribute('data-table-b-initialized', '');

    const fullPageUrl = block.getAttribute('data-full-page-url') || '#';
    const variant = block.getAttribute('data-variant');

    const expandBtn = block.querySelector('[data-sessions-expand]');
    if (expandBtn) {
      expandBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (fullPageUrl && fullPageUrl !== '#') {
          window.open(fullPageUrl, '_blank', 'noopener,noreferrer');
        } else {
          showToast('Opening table in a new tab…');
        }
      });
    }

    const filterBtn = block.querySelector('[data-sessions-filter]');
    const filterPopover = block.querySelector('[data-table-b-popover="filter"]');
    if (filterBtn && filterPopover) {
      filterBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPopoverMenu(filterPopover, filterBtn);
      });

      filterPopover.addEventListener('click', (event) => {
        const item = event.target.closest('[data-popover-value]');
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();

        const label = item.textContent.trim();
        const labelEl = filterBtn.querySelector('[data-sessions-filter-label]');
        if (labelEl) labelEl.textContent = label;

        filterPopover.querySelectorAll('[data-popover-value]').forEach((el) => {
          el.removeAttribute('data-selected');
        });
        item.setAttribute('data-selected', '');
        closePopover();
        showToast('Filter: ' + label);
      });
    }

    const actionsBtn = block.querySelector('[data-sessions-actions]');
    const actionsPopover = block.querySelector('[data-table-b-popover="actions"]');
    if (actionsBtn && actionsPopover) {
      actionsBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPopoverMenu(actionsPopover, actionsBtn);
      });

      actionsPopover.addEventListener('click', (event) => {
        const item = event.target.closest('[data-popover-value]');
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();
        closePopover();
        showToast(item.textContent.trim());
      });
    }

    if (variant === 'expand' || variant === 'actions') {
      block.addEventListener('mouseleave', () => {
        if (openPopover && block.contains(openPopover._trigger)) {
          closePopover();
        }
      });
    }
  }

  function onDocumentClick(event) {
    if (!openPopover) return;
    if (event.target.closest('[data-table-b-popover]')) return;
    if (event.target.closest('[data-sessions-filter], [data-sessions-actions]')) return;
    closePopover();
  }

  let documentListenersBound = false;

  function init() {
    document.querySelectorAll('[data-table-b]').forEach(initTasksTable);
    document.querySelectorAll('[data-table-b-sessions]').forEach(initSessionsTable);

    if (!documentListenersBound) {
      document.addEventListener('click', onDocumentClick);
      window.addEventListener('resize', closePopover);
      window.addEventListener('scroll', closePopover, true);
      documentListenersBound = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.TMATableB = { init };
})();
