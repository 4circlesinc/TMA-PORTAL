(function () {
  function setActivePage(nav, page) {
    const buttons = nav.querySelectorAll('.tma-pagination__button[data-page]');
    const totalPages = buttons.length;
    const prev = nav.querySelector('[data-direction="prev"]');
    const next = nav.querySelector('[data-direction="next"]');

    buttons.forEach((button) => {
      const isActive = Number(button.dataset.page) === page;
      button.classList.toggle('tma-pagination__button--active', isActive);
      button.toggleAttribute('aria-current', isActive);
    });

    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.tma-pagination__button');
    if (!button || button.disabled) return;

    const nav = button.closest('.tma-pagination');
    if (!nav) return;

    const active = nav.querySelector('.tma-pagination__button--active[data-page]');
    const current = active ? Number(active.dataset.page) : 1;
    const total = nav.querySelectorAll('.tma-pagination__button[data-page]').length;

    if (button.dataset.page) {
      setActivePage(nav, Number(button.dataset.page));
      return;
    }

    if (button.dataset.direction === 'prev') {
      setActivePage(nav, Math.max(1, current - 1));
      return;
    }

    if (button.dataset.direction === 'next') {
      setActivePage(nav, Math.min(total, current + 1));
    }
  });
})();
