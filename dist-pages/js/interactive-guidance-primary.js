/* TMA - Primary Interactive Guide (Figma 30484:299252) */
(function () {
  'use strict';

  const tsSvg = window.TMATableSearchIcons && window.TMATableSearchIcons.svg;

  const SECTIONS = [
    {
      title: 'Faster',
      body: 'Efficiency is the first core of TMA user experience. Therefore, speed is the first premise from UI to interaction.',
    },
    {
      title: 'Greater Freedom',
      body: 'Allow users to enjoy greater customization on the premise of satisfying the speed, so that users are not bound by the UI. Let users feel more freedom.',
    },
    {
      title: 'Preloading',
      paragraphs: [
        'In order to make the page open faster, the best way is to use the preloading of the page.',
        'Please formulate a preloading strategy for each page\\data to load pages and data as quickly as possible.',
      ],
    },
    {
      title: 'Remember everything',
      paragraphs: [
        'When the user logs in again, the page will appear as it was when the user closed it last time.',
        'Including the status of the sidebar, the status of the currently opened page, half of the input content, and the selected data.',
      ],
    },
    {
      title: 'Animation',
      paragraphs: [
        'All animations follow the rules of how they appear and how they disappear.',
        'If the form of appearance is transparency 0%-100%, then it will disappear with transparency 100%-0% when it disappears.',
      ],
    },
    {
      title: 'Support dynamic scaling of the system',
      paragraphs: [
        'The text size and all elements on the interface need to support the dynamic scaling of the system.',
        'So text size, line height, spacing, rounded corners, shadow size, etc. should all be defined in percentages.',
        'The text and rounded corners in the current design draft cannot support dynamic scaling, because Figma does not support it yet.',
        'To view the zoom effect, please use the Scale function, the shortcut key is K.',
      ],
    },
    {
      title: 'Scrollbar',
      paragraphs: [
        'The Scrollbar is hidden by default, and it appears when the cursor slides to the area that needs a Scrollbar and scrolls the content of the area.',
        'It can be overlaid on other objects.',
        '4px from the edge.',
      ],
    },
  ];

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderBody(section) {
    if (section.body) {
      return `<p class="ig-primary__text">${esc(section.body)}</p>`;
    }
    return section.paragraphs.map((p) => `<p class="ig-primary__text">${esc(p)}</p>`).join('');
  }

  function renderFooter() {
    const logo = window.TMALogo
      ? window.TMALogo.renderTMALogo({ link: false, iconSize: 28 })
      : '';
    if (!tsSvg) {
      return `<footer class="ig-primary__footer"><p class="ig-primary__copy">© 2026 TM ANTOINE Advisory. All rights reserved.</p></footer>`;
    }
    return `<footer class="ig-primary__footer">
      <div class="ig-primary__footer-brand">
        ${logo}
        <p class="ig-primary__copy">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="ig-primary__footer-social">
        <a class="ig-primary__social" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="X">${tsSvg('TwitterSocial', '', 28, 28)}</a>
        <a class="ig-primary__social" href="https://www.instagram.com/farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${tsSvg('InstagramSocial', '', 28, 28)}</a>
        <a class="ig-primary__social" href="https://www.threads.net/@farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Threads">${tsSvg('ThreadsLogo', '', 28, 28)}</a>
        <a class="ig-primary__social" href="https://dribbble.com/byewind" target="_blank" rel="noopener noreferrer" aria-label="Dribbble">${tsSvg('DribbbleSocial', '', 28, 28)}</a>
        <a class="ig-primary__social" href="https://www.behance.net/ByeWind" target="_blank" rel="noopener noreferrer" aria-label="Behance">${tsSvg('BehanceSocial', '', 28, 28)}</a>
        <a class="ig-primary__social" href="https://www.figma.com/@byewind" target="_blank" rel="noopener noreferrer" aria-label="Figma">${tsSvg('FigmaSocial', '', 28, 28)}</a>
        <a class="ig-primary__social" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${tsSvg('TMALogoMark', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function renderPrimaryGuide() {
    const sections = SECTIONS.map((section) => (
      `<section class="ig-primary__section">
        <h3 class="ig-primary__heading">${esc(section.title)}</h3>
        <div class="ig-primary__body">${renderBody(section)}</div>
      </section>`
    )).join('');

    return `<article class="ig-primary" data-node-id="33305:195924">
      <header class="ig-primary__hero">
        <h2 class="ig-primary__title">Primary Interactive Guide</h2>
      </header>
      ${sections}
      ${renderFooter()}
    </article>`;
  }

  window.TMAInteractiveGuidancePrimary = {
    renderPrimaryGuide,
  };
})();
