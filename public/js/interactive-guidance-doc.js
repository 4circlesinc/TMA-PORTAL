/* TMA - shared documentation footer for interactive guidance panels */
(function () {
  'use strict';

  const tsSvg = window.TMATableSearchIcons && window.TMATableSearchIcons.svg;

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderDocFooter() {
    const logo = window.TMALogo
      ? window.TMALogo.renderTMALogo({ link: false, iconSize: 28 })
      : '';
    if (!tsSvg) {
      return `<footer class="ig-doc__footer"><p class="ig-doc__copy">© 2026 TM ANTOINE Advisory. All rights reserved.</p></footer>`;
    }
    return `<footer class="ig-doc__footer">
      <div class="ig-doc__footer-brand">
        ${logo}
        <p class="ig-doc__copy">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="ig-doc__footer-social">
        <a class="ig-doc__social" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="X">${tsSvg('TwitterSocial', '', 28, 28)}</a>
        <a class="ig-doc__social" href="https://www.instagram.com/farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${tsSvg('InstagramSocial', '', 28, 28)}</a>
        <a class="ig-doc__social" href="https://www.threads.net/@farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Threads">${tsSvg('ThreadsLogo', '', 28, 28)}</a>
        <a class="ig-doc__social" href="https://dribbble.com/byewind" target="_blank" rel="noopener noreferrer" aria-label="Dribbble">${tsSvg('DribbbleSocial', '', 28, 28)}</a>
        <a class="ig-doc__social" href="https://www.behance.net/ByeWind" target="_blank" rel="noopener noreferrer" aria-label="Behance">${tsSvg('BehanceSocial', '', 28, 28)}</a>
        <a class="ig-doc__social" href="https://www.figma.com/@byewind" target="_blank" rel="noopener noreferrer" aria-label="Figma">${tsSvg('FigmaSocial', '', 28, 28)}</a>
        <a class="ig-doc__social" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${tsSvg('TMALogoMark', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function renderDocHero(title, subtitle) {
    const sub = subtitle
      ? `<p class="ig-doc__subtitle">${esc(subtitle)}</p>`
      : '';
    return `<header class="ig-doc__hero">
      <h2 class="ig-doc__title">${esc(title)}</h2>
      ${sub}
    </header>`;
  }

  function renderDocSection(title, bodyHtml) {
    return `<section class="ig-doc__section">
      ${title ? `<h3 class="ig-doc__heading">${esc(title)}</h3>` : ''}
      <div class="ig-doc__body">${bodyHtml}</div>
    </section>`;
  }

  function renderOrderedList(items) {
    return `<ol class="ig-doc__ol">${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ol>`;
  }

  function renderUnorderedList(items) {
    return `<ul class="ig-doc__ul">${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
  }

  function renderListPair(ordered, unordered) {
    return `<div class="ig-doc__list-pair">${renderOrderedList(ordered)}${renderUnorderedList(unordered)}</div>`;
  }

  window.TMAInteractiveGuidanceDoc = {
    esc,
    renderDocFooter,
    renderDocHero,
    renderDocSection,
    renderOrderedList,
    renderUnorderedList,
    renderListPair,
  };
})();
