/* TMA — Group documentation (Figma 33302:3387) */
(function () {
  'use strict';

  const NAV = [
    { key: 'home', label: 'Home', icon20: 'HouseDuotone20', icon24: 'HouseDuotone24', active: true },
    { key: 'history', label: 'History', icon20: 'ClockDuotone20', icon24: 'ClockDuotone24' },
    { key: 'user', label: 'User', icon20: 'UsersDuotone20', icon24: 'UsersDuotone24' },
    { key: 'folder', label: 'Folder', icon20: 'FolderDuotone20', icon24: 'FolderDuotone24' },
    { key: 'bookmark', label: 'Bookmark', icon20: 'BookmarkDuotone20', icon24: 'BookmarkDuotone24' },
  ];

  const MESSAGE = [
    { icon: 'UserCircle16', label: 'Developer' },
    { icon: 'MapPin16', label: 'SF, Bay Area' },
    { icon: 'EnvelopeSimple16', label: 'byewind@twitter.com' },
    { icon: 'Phone16', label: '+852 19850622' },
  ];

  function gi(key, cls, w, h) {
    const sources = [
      window.TMAButtonDocIcons,
      window.TMALineIcons,
      window.TMAPopoverIcons,
      window.TMATableSearchIcons,
      window.TMACardIcons,
      window.TMAGroupDocIcons,
    ];
    for (let i = 0; i < sources.length; i += 1) {
      if (sources[i] && sources[i].svg) {
        const result = sources[i].svg(key, cls, w, h);
        if (result) return result;
      }
    }
    return '';
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderDivider(nodeId) {
    return `<span class="tma-group-doc__divider" role="separator" aria-hidden="true"${nodeId ? ` data-node-id="${esc(nodeId)}"` : ''}></span>`;
  }

  function renderNavButton(item, opts) {
    const o = opts || {};
    const iconKey = o.iconSize === 24 ? item.icon24 : item.icon20;
    const px = o.iconSize === 24 ? 24 : 20;
    const active = item.active ? ' tma-group-doc__nav-btn--active' : '';
    const full = o.fullWidth ? ' tma-group-doc__nav-btn--full' : '';
    const icon = `<span class="tma-group-doc__nav-icon">${gi(iconKey, 'tma-group-doc__nav-icon-svg', px, px)}</span>`;
    const label = `<span class="tma-group-doc__nav-label">${esc(item.label)}</span>`;
    return `<button type="button" class="tma-group-doc__nav-btn${active}${full}" aria-pressed="${item.active ? 'true' : 'false'}">${icon}${label}</button>`;
  }

  function renderTopNavGroup() {
    const items = NAV.map((item) => renderNavButton(item, { iconSize: 20 })).join('');
    return `<div class="tma-group-doc__frame tma-group-doc__frame--top-nav" data-node-id="33302:3402" role="group">${items}</div>`;
  }

  function renderSideNavGroup() {
    const items = NAV.map((item) => renderNavButton(item, { iconSize: 24, fullWidth: true })).join('');
    return `<div class="tma-group-doc__frame tma-group-doc__frame--side-nav" data-node-id="33302:3405" role="group">${items}</div>`;
  }

  function renderIconTextItem(item) {
    return `<span class="tma-group-doc__icon-text">
      <span class="tma-group-doc__icon-text-icon">${gi(item.icon, 'tma-group-doc__icon-text-icon-svg', 16, 16)}</span>
      <span class="tma-group-doc__icon-text-label">${esc(item.label)}</span>
    </span>`;
  }

  function renderMessageGroup() {
    const items = MESSAGE.map((item) => renderIconTextItem(item)).join('');
    return `<div class="tma-group-doc__group tma-group-doc__group--message" data-node-id="33302:3408" role="group">${items}</div>`;
  }

  function renderToolbarIconBtn(icon, ariaLabel) {
    return `<button type="button" class="tma-group-doc__toolbar-icon-btn" aria-label="${esc(ariaLabel)}">${gi(icon, 'tma-group-doc__toolbar-icon-svg', 16, 16)}</button>`;
  }

  function renderToolbarDropdown(mainIcon, ariaLabel) {
    return `<button type="button" class="tma-group-doc__toolbar-dropdown-btn" aria-label="${esc(ariaLabel)}">
      <span class="tma-group-doc__toolbar-dropdown-icon">${gi(mainIcon, 'tma-group-doc__toolbar-icon-svg', 16, 16)}</span>
      <span class="tma-group-doc__toolbar-dropdown-chevron">${gi('ArrowLineDown16', 'tma-group-doc__toolbar-chevron-svg', 9, 5)}</span>
    </button>`;
  }

  function renderFeatureBars() {
    return `<div class="tma-group-doc__feature-bar" data-node-id="33302:3411">
      <div class="tma-group-doc__group tma-group-doc__group--toolbar" data-node-id="33302:3412" role="group">
        ${renderToolbarIconBtn('ArrowUUpLeft16', 'Undo')}
        ${renderToolbarIconBtn('ArrowUUpRight16', 'Redo')}
      </div>
      ${renderDivider('33302:3413')}
      <div class="tma-group-doc__group tma-group-doc__group--toolbar" data-node-id="33302:3414" role="group">
        ${renderToolbarDropdown('TextT16', 'Text style')}
        ${renderToolbarDropdown('TextA16', 'Font color')}
      </div>
      <div class="tma-group-doc__group tma-group-doc__group--toolbar" data-node-id="33302:3415" role="group">
        ${renderToolbarIconBtn('TextB16', 'Bold')}
        ${renderToolbarIconBtn('TextItalic16', 'Italic')}
        ${renderToolbarIconBtn('TextUnderline16', 'Underline')}
        ${renderToolbarIconBtn('TextStrikethrough16', 'Strikethrough')}
      </div>
      ${renderDivider('33302:3416')}
      <div class="tma-group-doc__group tma-group-doc__group--toolbar" data-node-id="33302:3417" role="group">
        ${renderToolbarIconBtn('ListBullets16', 'List')}
        ${renderToolbarIconBtn('Link16', 'Link')}
        ${renderToolbarIconBtn('ThreeDots16', 'More')}
      </div>
      <button type="button" class="tma-group-doc__feature-expand" data-node-id="33302:3418" aria-label="Expand">${gi('ArrowsOutSimple16', 'tma-group-doc__toolbar-icon-svg', 16, 16)}</button>
    </div>`;
  }

  function renderSegmentedControl() {
    return `<div class="tma-group-doc__seg-track" data-node-id="33302:3421" role="group">
      <button type="button" class="tma-group-doc__seg-btn tma-group-doc__seg-btn--active" aria-pressed="true">
        <span class="tma-group-doc__seg-icon">${gi('SquaresFour24', 'tma-group-doc__seg-icon-svg', 24, 24)}</span>
        <span class="tma-group-doc__seg-label">Card</span>
      </button>
      <button type="button" class="tma-group-doc__seg-btn" aria-pressed="false">
        <span class="tma-group-doc__seg-icon">${gi('ListBullets24', 'tma-group-doc__seg-icon-svg', 24, 24)}</span>
        <span class="tma-group-doc__seg-label">list</span>
      </button>
    </div>`;
  }

  function renderPaginationGroup() {
    const pages = ['1', '2', '3', '4', '5'];
    const pageBtns = pages.map((page, i) => {
      const active = i === 0 ? ' tma-group-doc__page-btn--active' : '';
      const pad = i === 0 ? '' : ' tma-group-doc__page-btn--wide';
      return `<button type="button" class="tma-group-doc__page-btn${active}${pad}" data-page="${page}" aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(page)}</button>`;
    }).join('');
    return `<div class="tma-group-doc__group tma-group-doc__group--pagination" data-node-id="33302:3424" role="group" aria-label="Pagination">
      ${pageBtns}
      <button type="button" class="tma-group-doc__page-btn tma-group-doc__page-btn--icon tma-group-doc__page-btn--wide" data-action="prev" aria-label="Previous page">${gi('ArrowLineLeft16', 'tma-group-doc__page-icon', 16, 16)}</button>
      <button type="button" class="tma-group-doc__page-btn tma-group-doc__page-btn--icon" data-action="next" aria-label="Next page">${gi('ArrowLineRight16', 'tma-group-doc__page-icon', 16, 16)}</button>
    </div>`;
  }

  function renderMixedInstances() {
    return `<div class="tma-group-doc__group tma-group-doc__group--mixed" data-node-id="33302:3427" role="group">
      <span class="tma-group-doc__tab tma-group-doc__tab--active">Total Users</span>
      <span class="tma-group-doc__tab tma-group-doc__tab--muted">Total Projects</span>
      <span class="tma-group-doc__tab tma-group-doc__tab--muted">Operating Status</span>
      <span class="tma-group-doc__pipe" aria-hidden="true">|</span>
      <span class="tma-group-doc__legend">
        <span class="tma-group-doc__legend-dot">${gi('Dot12', 'tma-group-doc__legend-dot-svg', 4.5, 4.5)}</span>
        <span class="tma-group-doc__legend-label">This year</span>
      </span>
      <span class="tma-group-doc__legend">
        <span class="tma-group-doc__legend-dot">${gi('Dot12', 'tma-group-doc__legend-dot-svg', 4.5, 4.5)}</span>
        <span class="tma-group-doc__legend-label">Last year</span>
      </span>
    </div>`;
  }

  function renderExamples() {
    return `<div class="tma-group-doc__examples-stack" data-node-id="33302:3399">
      <div class="tma-group-doc__example-block" data-node-id="33302:3400">
        <p class="tma-group-doc__example-caption" data-node-id="33302:3401">Use button groups for top navigation.</p>
        ${renderTopNavGroup()}
      </div>
      <div class="tma-group-doc__example-block" data-node-id="33302:3403">
        <p class="tma-group-doc__example-caption" data-node-id="33302:3404">Use button groups for side navigation.</p>
        ${renderSideNavGroup()}
      </div>
      <div class="tma-group-doc__example-block" data-node-id="33302:3406">
        <p class="tma-group-doc__example-caption" data-node-id="33302:3407">Use IconText for the message group.</p>
        ${renderMessageGroup()}
      </div>
      <div class="tma-group-doc__example-block" data-node-id="33302:3409">
        <p class="tma-group-doc__example-caption" data-node-id="33302:3410">Use multiple groups for feature bars.</p>
        ${renderFeatureBars()}
      </div>
      <div class="tma-group-doc__example-block" data-node-id="33302:3419">
        <p class="tma-group-doc__example-caption" data-node-id="33302:3420">Make the group a segmented control.</p>
        ${renderSegmentedControl()}
      </div>
      <div class="tma-group-doc__example-block" data-node-id="33302:3422">
        <p class="tma-group-doc__example-caption" data-node-id="33302:3423">Use group for pagination.</p>
        ${renderPaginationGroup()}
      </div>
      <div class="tma-group-doc__example-block" data-node-id="33302:3425">
        <p class="tma-group-doc__example-caption" data-node-id="33302:3426">Instances in a Group can be a combination of multiple instances.</p>
        ${renderMixedInstances()}
      </div>
    </div>`;
  }

  function renderDocumentationFooter(socialSvg) {
    const ts = socialSvg || (() => '');
    return `<footer class="tma-group-doc__footer" data-node-id="33302:3428">
      <div class="tma-group-doc__footer-brand">
        <div class="tma-group-doc__logo" aria-hidden="true">
          ${ts('TMALogoMark', 'tma-group-doc__logo-icon', 28, 28)}
          <span class="tma-group-doc__wordmark">
            ${ts('TMALogoWordmark', 'tma-group-doc__wordmark-left', 53, 12)}
            ${ts('TMALogoSuffix', 'tma-group-doc__wordmark-right', 15, 12)}
          </span>
        </div>
        <p class="tma-group-doc__copyright">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="tma-group-doc__socials">
        <a class="tma-group-doc__social-link" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="Twitter">${ts('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-group-doc__social-link" href="https://www.instagram.com/farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${ts('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-group-doc__social-link" href="https://www.threads.net/@farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Threads">${ts('ThreadsLogo', '', 28, 28)}</a>
        <a class="tma-group-doc__social-link" href="https://dribbble.com/byewind" target="_blank" rel="noopener noreferrer" aria-label="Dribbble">${ts('DribbbleSocial', '', 28, 28)}</a>
        <a class="tma-group-doc__social-link" href="https://www.behance.net/ByeWind" target="_blank" rel="noopener noreferrer" aria-label="Behance">${ts('BehanceSocial', '', 28, 28)}</a>
        <a class="tma-group-doc__social-link" href="https://www.figma.com/@byewind" target="_blank" rel="noopener noreferrer" aria-label="Figma">${ts('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-group-doc__social-link" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${ts('TMALogoMark', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function wireNavGroups(root) {
    root.querySelectorAll('.tma-group-doc__frame').forEach((group) => {
      group.addEventListener('click', (event) => {
        const btn = event.target.closest('.tma-group-doc__nav-btn');
        if (!btn || !group.contains(btn)) return;
        group.querySelectorAll('.tma-group-doc__nav-btn').forEach((item) => {
          item.classList.remove('tma-group-doc__nav-btn--active');
          item.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('tma-group-doc__nav-btn--active');
        btn.setAttribute('aria-pressed', 'true');
      });
    });
  }

  function wirePagination(root) {
    const group = root.querySelector('.tma-group-doc__group--pagination');
    if (!group) return;

    const pageButtons = () => Array.from(group.querySelectorAll('[data-page]'));

    function setActive(btn) {
      pageButtons().forEach((item) => {
        item.classList.remove('tma-group-doc__page-btn--active');
        item.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('tma-group-doc__page-btn--active');
      btn.setAttribute('aria-pressed', 'true');
    }

    group.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target || !group.contains(target)) return;

      if (target.dataset.page) {
        setActive(target);
        return;
      }

      const buttons = pageButtons();
      const currentIndex = buttons.findIndex((btn) => btn.classList.contains('tma-group-doc__page-btn--active'));
      if (target.dataset.action === 'prev' && currentIndex > 0) {
        setActive(buttons[currentIndex - 1]);
      }
      if (target.dataset.action === 'next' && currentIndex < buttons.length - 1) {
        setActive(buttons[currentIndex + 1]);
      }
    });
  }

  function wireSegmented(root) {
    const track = root.querySelector('.tma-group-doc__seg-track');
    if (!track) return;
    track.addEventListener('click', (event) => {
      const btn = event.target.closest('.tma-group-doc__seg-btn');
      if (!btn || !track.contains(btn)) return;
      track.querySelectorAll('.tma-group-doc__seg-btn').forEach((item) => {
        item.classList.remove('tma-group-doc__seg-btn--active');
        item.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('tma-group-doc__seg-btn--active');
      btn.setAttribute('aria-pressed', 'true');
    });
  }

  function wireDocumentationInteractivity(root) {
    if (!root) return;
    wireNavGroups(root);
    wirePagination(root);
    wireSegmented(root);
  }

  function mountDocumentation(opts) {
    const o = opts || {};
    if (o.examplesEl) {
      o.examplesEl.innerHTML = renderExamples();
      wireDocumentationInteractivity(o.examplesEl);
    }
    if (o.footerEl && o.socialSvg) o.footerEl.innerHTML = renderDocumentationFooter(o.socialSvg);
  }

  window.TMAGroupDoc = {
    NAV,
    MESSAGE,
    renderExamples,
    renderDocumentationFooter,
    wireDocumentationInteractivity,
    mountDocumentation,
  };
})();
