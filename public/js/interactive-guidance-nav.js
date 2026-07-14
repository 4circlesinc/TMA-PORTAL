/* TMA - Interactive guidance navigation rails (Figma 30992:280837–839) */
(function () {
  'use strict';

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderNavigationCard(label, nodeId) {
    return `<aside class="ig-nav" data-node-id="${esc(nodeId)}" aria-label="${esc(label)} navigation">
      <p class="ig-nav__label">${esc(label)}</p>
    </aside>`;
  }

  window.TMAInteractiveGuidanceNav = {
    renderNavigationCard,
  };
})();
