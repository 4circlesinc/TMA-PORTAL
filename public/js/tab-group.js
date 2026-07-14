/**
 * TabGroup - keyboard and click selection for TMA tabs.
 */
(function () {
  const GROUP_SELECTOR = '.tma-tab-group';

  function activateTab(group, tab) {
    const tabs = group.querySelectorAll('.tma-tab');
    tabs.forEach((item) => {
      const isActive = item === tab;
      item.classList.toggle('is-active', isActive);
      item.setAttribute('aria-selected', isActive ? 'true' : 'false');
      item.tabIndex = isActive ? 0 : -1;
    });

    group.dispatchEvent(new CustomEvent('tma-tab-change', {
      bubbles: true,
      detail: {
        index: Number(tab.dataset.tabIndex),
        key: tab.dataset.tabKey || null,
        label: tab.querySelector('.tma-tab__label')?.textContent?.trim()
          || tab.getAttribute('aria-label')
          || '',
      },
    }));
  }

  function initGroup(group) {
    if (group.dataset.tabGroupInit === 'true') return;
    group.dataset.tabGroupInit = 'true';

    const tabs = Array.from(group.querySelectorAll('.tma-tab'));
    if (!tabs.length) return;

    tabs.forEach((tab) => {
      tab.addEventListener('click', (event) => {
        if (tab.tagName === 'A' && tab.getAttribute('href')?.startsWith('#')) {
          event.preventDefault();
        }
        activateTab(group, tab);
      });

      tab.addEventListener('keydown', (event) => {
        const currentIndex = tabs.indexOf(tab);
        let nextIndex = currentIndex;

        if (event.key === 'ArrowRight') {
          nextIndex = (currentIndex + 1) % tabs.length;
        } else if (event.key === 'ArrowLeft') {
          nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        } else if (event.key === 'Home') {
          nextIndex = 0;
        } else if (event.key === 'End') {
          nextIndex = tabs.length - 1;
        } else {
          return;
        }

        event.preventDefault();
        activateTab(group, tabs[nextIndex]);
        tabs[nextIndex].focus();
      });
    });
  }

  function initAll(scope) {
    const root = scope || document;
    root.querySelectorAll(GROUP_SELECTOR).forEach(initGroup);
  }

  window.PortalTabGroup = { init: initAll, activate: activateTab };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initAll());
  } else {
    initAll();
  }
})();
