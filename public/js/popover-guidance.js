/* TMA — Popover interactive guidance (Figma 33303:7653) */
(function () {
  'use strict';

  const PO = window.TMAPopover;
  const poSvg = window.TMAPopoverIcons && window.TMAPopoverIcons.svg;
  const tsSvg = window.TMATableSearchIcons && window.TMATableSearchIcons.svg;

  function section(title, body) {
    return `<section class="tma-popover-guidance-page__section"><h2 class="tma-popover-guidance-page__section-title">${title}</h2>${body}</section>`;
  }

  function board(w, h, html) {
    return `<div class="tma-popover-guidance-page__board-wrap"><div class="tma-popover-guidance-page__board" style="width:${w}px;height:${h}px">${html}</div></div>`;
  }

  function pop(left, top, html) {
    return `<div class="tma-popover-guidance-page__popover" style="left:${left}px;top:${top}px">${html}</div>`;
  }

  function note(text, left, top, width) {
    const style = width ? `left:${left}px;top:${top}px;width:${width}px` : `left:${left}px;top:${top}px`;
    if (String(text).includes('<')) {
      return `<div class="tma-popover-guidance-page__note" style="${style}">${text}</div>`;
    }
    return `<p class="tma-popover-guidance-page__note" style="${style}">${text}</p>`;
  }

  function lineH(left, top, width) {
    return `<span class="tma-popover-guidance-page__callout-line tma-popover-guidance-page__callout-line--h" style="left:${left}px;top:${top}px;width:${width}px"></span>`;
  }

  function renderSimpleVariants() {
    const variants = Array.from({ length: 8 }, (_, i) => {
      const count = i + 1;
      const nodeId = PO.SIMPLE_NODE_IDS[count];
      return `<div class="tma-popover-guidance-page__variant">
        <p class="tma-popover-guidance-page__variant-label">${count} option${count > 1 ? 's' : ''}</p>
        ${PO.renderSimple(count, nodeId)}
      </div>`;
    }).join('');

    return section('Select dropdown', `<div class="tma-popover-guidance-page__variants-row">${variants}</div>`);
  }

  function renderBasicInteraction() {
    const defaultMenu = PO.renderPopover({
      groups: PO.basicInteractionMenuGroups({ switchOn: true }),
    });
    const hoverMenu = PO.renderPopover({
      groups: PO.basicInteractionMenuGroups({ switchOn: true, hoverEdit: true }),
    });

    return section('Basic interaction', `<div class="tma-popover-guidance-page__interaction-row">
      <div class="tma-popover-guidance-page__interaction-col">
        ${defaultMenu}
        <p class="tma-popover-guidance-page__interaction-label">Default</p>
      </div>
      <div class="tma-popover-guidance-page__interaction-col">
        ${hoverMenu}
        <p class="tma-popover-guidance-page__interaction-label">Hover on item</p>
      </div>
    </div>`);
  }

  function renderSearchSection() {
    const states = PO.renderSearchStates();
    return section('Search', `<div class="tma-popover-guidance-page__search-row">
      <div class="tma-popover-guidance-page__search-col">
        <p class="tma-popover-guidance-page__design-label">No input</p>
        ${states.noInput}
      </div>
      <div class="tma-popover-guidance-page__search-col">
        <p class="tma-popover-guidance-page__design-label">No results</p>
        ${states.noResults}
      </div>
      <div class="tma-popover-guidance-page__search-col">
        <p class="tma-popover-guidance-page__design-label">Have results</p>
        ${states.haveResults}
      </div>
    </div>`);
  }

  function renderSecondLevel() {
    const menus = PO.renderNestedMenus();
    return section('Second level menu', board(808, 404, [
      pop(0, 128, menus.parent),
      pop(568, 50, menus.child),
      note('Click', 263, 235),
      lineH(260, 263, 40),
    ].join('')));
  }

  function renderGrouping() {
    const menu = PO.renderGroupingMenu();
    const quick = PO.renderPopover({
      wide: true,
      className: 'tma-popover-guidance-page__quick-action',
      groups: [
        {
          tagInput: {
            tags: ['Group 1', 'ByeWind', 'Drew Cano', 'Natali Craig'],
            placeholder: 'BW',
          },
          border: true,
        },
        {
          items: [
            { label: 'ByeWind', avatar: 'AvatarByewind' },
            { label: 'Bruce Wayne', avatarInitial: 'B', avatarColor: '#7dbbff' },
          ],
        },
      ],
    });

    return section('With grouping', board(1272, 648, [
      pop(170, 0, menu),
      pop(912, 42, quick),
      note('Click the arrow buttons to expand and collapse groups.', 0, 124, 114),
      note('Clicking on a group title selects all content within the group. (The entire bar is clickable.)', 605, 124, 216),
      note('<p>The selected results can be displayed or entered.</p><p>As you type, the list below will display matching results based on your input.</p>', 605, 17, 216),
      note('<p>Partially selected</p><p>Click to select all, click again to deselect all.</p>', 605, 362, 216),
      lineH(119, 134, 64),
      lineH(512, 31, 82),
      lineH(518, 133, 76),
      lineH(518, 370, 76),
      lineH(821, 66, 82),
    ].join('')));
  }

  function renderSelectDropdownLive() {
    return section('Working select dropdown', `<p class="tma-popover-guidance-page__design-label" style="margin-bottom:20px">Live example — click the field to open the popover menu</p>
      <div data-select-field></div>`);
  }

  function renderFooter() {
    if (!tsSvg) {
      return `<footer class="tma-popover-guidance-page__footer"><p class="tma-popover-guidance-page__footer-copy">© 2026 TM ANTOINE Advisory. All rights reserved.</p></footer>`;
    }
    return `<footer class="tma-popover-guidance-page__footer">
      <div class="tma-popover-guidance-page__footer-brand">
        <div class="tma-popover-guidance-page__footer-wordmark">
          ${tsSvg('TMALogoMark', '', 28, 28)}
          ${tsSvg('TMALogoWordmark', '', 53, 12)}
          ${tsSvg('TMALogoSuffix', '', 15, 12)}
        </div>
        <p class="tma-popover-guidance-page__footer-copy">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="tma-popover-guidance-page__footer-social">
        <a class="tma-popover-guidance-page__footer-link" href="https://www.figma.com/@tma" target="_blank" rel="noopener noreferrer" aria-label="Figma">${tsSvg('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-popover-guidance-page__footer-link" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${tsSvg('TMALogoMark', '', 28, 28)}</a>
        <a class="tma-popover-guidance-page__footer-link" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="X">${tsSvg('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-popover-guidance-page__footer-link" href="https://www.instagram.com/tma.design/" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${tsSvg('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-popover-guidance-page__footer-link" href="https://www.threads.net/@tma.design" target="_blank" rel="noopener noreferrer" aria-label="Threads">${tsSvg('ThreadsLogo', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function mountGuidance(container) {
    if (!container || !PO) return;
    container.innerHTML = [
      renderSimpleVariants(),
      renderBasicInteraction(),
      renderSearchSection(),
      renderSecondLevel(),
      renderGrouping(),
      renderSelectDropdownLive(),
      renderFooter(),
    ].join('');

    PO.mountInteractive(container, {
      selectField: {
        label: 'Project',
        placeholder: 'Select a project',
        name: 'project',
        options: ['Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5', 'Option 6', 'Option 7', 'Option 8'],
      },
    });
  }

  window.TMAPopoverGuidance = { mountGuidance };
})();
