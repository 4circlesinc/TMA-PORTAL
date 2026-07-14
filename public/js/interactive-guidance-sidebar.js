/* TMA - Sidebar interactive guidance panel (Figma 30484:299255) */
(function () {
  'use strict';

  const DOC = window.TMAInteractiveGuidanceDoc;
  const PH = '../images/icons/phosphor/';
  const TMA = '../images/icons/tma/';

  function icon(file, size) {
    const s = size || 20;
    return `<img src="${PH}${file}.svg" alt="" class="ig-sidebar__icon" width="${s}" height="${s}" />`;
  }

  function dot() {
    return `<img src="${TMA}Dot.svg" alt="" class="ig-sidebar__dot" width="16" height="16" />`;
  }

  function caret(open) {
    return `<span class="ig-sidebar__caret${open ? ' ig-sidebar__caret--open' : ''}" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  }

  function tooltip(label, shortcut) {
    const key = shortcut ? `<span class="ig-sidebar__tooltip-key">${shortcut}</span>` : '';
    return `<div class="ig-sidebar__tooltip"><span>${label}</span>${key}</div>`;
  }

  function callout(title, body, cls) {
    return `<div class="ig-sidebar__callout ${cls || ''}">${title ? `<strong>${title}</strong>` : ''}${body}</div>`;
  }

  function navRow(opts) {
    const cls = ['ig-sidebar__row'];
    if (opts.active) cls.push('ig-sidebar__row--active');
    if (opts.nested) cls.push('ig-sidebar__row--nested');
    if (opts.directory) cls.push('ig-sidebar__row--directory');
    return `<div class="${cls.join(' ')}">${opts.caret || ''}${opts.leading || ''}<span class="ig-sidebar__label">${opts.label}</span>${opts.trailing || ''}</div>`;
  }

  function renderComplexSidebarPanel() {
    const logo = window.TMALogo
      ? window.TMALogo.renderTMALogo({ link: false, variant: 'compact', iconSize: 20, className: 'ig-sidebar__brand' })
      : '<span class="ig-sidebar__brand-text">TMA</span>';

    return `<aside class="ig-sidebar__panel" data-node-id="33319:205849" aria-label="Sidebar example">
      <div class="ig-sidebar__section">
        <div class="ig-sidebar__profile">
          <img src="../images/avatars/AvatarByewind.png" alt="" class="ig-sidebar__avatar" width="24" height="24" />
          <span class="ig-sidebar__profile-name">ByeWind</span>
        </div>
        <div class="ig-sidebar__tabs">
          <span class="ig-sidebar__tab ig-sidebar__tab--active">Favorites</span>
          <span class="ig-sidebar__tab">Recently</span>
        </div>
        ${navRow({ leading: dot(), label: 'Overview' })}
        ${navRow({ leading: dot(), label: 'Projects' })}
      </div>
      <div class="ig-sidebar__section">
        <div class="ig-sidebar__group-label">Dashboards</div>
        ${navRow({ active: true, leading: icon('ChartPieSlice', 20), label: 'Overview' })}
        ${navRow({ directory: true, caret: caret(true), leading: icon('Storefront', 20), label: 'eCommerce' })}
        ${navRow({ directory: true, caret: caret(false), leading: icon('FolderNotch', 20), label: 'Projects' })}
      </div>
      <div class="ig-sidebar__section">
        <div class="ig-sidebar__group-label">Pages</div>
        ${navRow({ directory: true, caret: caret(true), leading: icon('IdentificationBadge', 20), label: 'User Profile' })}
        ${navRow({ nested: true, label: 'Overview' })}
        ${navRow({ nested: true, label: 'Projects' })}
        ${navRow({ nested: true, label: 'Campaigns' })}
        ${navRow({ nested: true, label: 'Documents' })}
        ${navRow({ nested: true, label: 'Followers' })}
        ${navRow({ directory: true, caret: caret(false), leading: icon('IdentificationCard', 20), label: 'Account' })}
        ${navRow({ directory: true, caret: caret(false), leading: icon('UsersThree', 20), label: 'Corporate' })}
        ${navRow({ directory: true, caret: caret(false), leading: icon('Notebook', 20), label: 'Blog' })}
        ${navRow({ directory: true, caret: caret(false), leading: icon('ChatsTeardrop', 20), label: 'Social' })}
      </div>
      <div class="ig-sidebar__panel-logo">${logo}</div>
    </aside>`;
  }

  function renderComplexStage() {
    return `<div class="ig-sidebar__stage ig-sidebar__stage--complex" data-node-id="33319:205848">
      ${callout(
        'Favorites',
        '<p>The user clicks <img src="' + PH + 'Star.svg" alt="" class="ig-sidebar__inline-icon" width="16" height="16" /> button to add the page here,</p><p>Click again to remove the page.</p><p>When selected, click again to collapse.</p>',
        'ig-sidebar__callout--favorites'
      )}
      ${tooltip('Tooltip', '⌘')}
      ${callout(
        'Recently',
        '<p>Recently visited pages are displayed here.</p><p>Display up to 10 items.</p>',
        'ig-sidebar__callout--recently'
      )}
      ${tooltip('Tooltip', '⌘')}
      ${callout('Single page', '', 'ig-sidebar__callout--single')}
      ${callout(
        'Directory',
        '<ul><li>Directory has no selected state.</li><li>Multiple directories can be expanded(open) at the same time.</li><li>Directories need to be collapsed (closed) manually by the user.</li></ul>',
        'ig-sidebar__callout--directory'
      )}
      ${callout(
        'Adjustable width',
        '<p>Minimum: 212</p><p>Maximum: no more than 40% of the page width.</p>',
        'ig-sidebar__callout--width'
      )}
      <span class="ig-sidebar__resize-cursor" aria-hidden="true"></span>
      ${renderComplexSidebarPanel()}
    </div>`;
  }

  function renderNestingDiagram() {
    const levels = ['First level', 'Second level', 'Third level', 'Fourth level', 'Last level'];
    const rows = levels.map(function (label, index) {
      const indent = index > 0 ? ` style="padding-left:${index * 12}px"` : '';
      const caretHtml = index === 0 ? caret(true) : '';
      const iconHtml = index === 0 ? icon('FolderNotch', 16) : '<span class="ig-sidebar__dash-icon"></span>';
      return `<div class="ig-sidebar__nest-row"${indent}>${caretHtml}${iconHtml}<span>${label}</span></div>`;
    }).join('');

    return `<div class="ig-sidebar__nesting" data-node-id="33319:205867">
      <p class="ig-sidebar__nesting-lead">Support unlimited levels.</p>
      <div class="ig-sidebar__nesting-list">${rows}</div>
    </div>`;
  }

  function renderExpandedStatePanel() {
    const logo = window.TMALogo
      ? window.TMALogo.renderTMALogo({ link: false, variant: 'compact', iconSize: 28, className: 'ig-sidebar__brand' })
      : '';

    const items = [
      { icon: 'ChartPieSlice', label: 'Overview', active: true },
      { icon: 'Storefront', label: 'eCommerce', caret: true },
      { icon: 'FolderNotch', label: 'Projects' },
      { icon: 'IdentificationBadge', label: 'User Profile' },
      { icon: 'IdentificationCard', label: 'Account' },
      { icon: 'UsersThree', label: 'Corporate' },
      { icon: 'Notebook', label: 'Blog' },
      { icon: 'ChatsTeardrop', label: 'Social' },
    ];

    const rows = items.map(function (item) {
      return navRow({
        active: item.active,
        leading: icon(item.icon, 24),
        label: item.label,
        trailing: item.caret ? caret(false) : '',
      });
    }).join('');

    return `<aside class="ig-sidebar__panel ig-sidebar__panel--expanded" data-node-id="33319:205879">
      <div class="ig-sidebar__panel-logo ig-sidebar__panel-logo--top">${logo}</div>
      <div class="ig-sidebar__section">${rows}</div>
      <div class="ig-sidebar__profile ig-sidebar__profile--bottom">
        <img src="../images/avatars/AvatarByewind.png" alt="" class="ig-sidebar__avatar" width="24" height="24" />
        <span class="ig-sidebar__profile-name">ByeWind</span>
      </div>
    </aside>`;
  }

  function renderFoldedStatePanel() {
    const logo = window.TMALogo
      ? window.TMALogo.renderTMALogo({ link: false, variant: 'mark', iconSize: 28, className: 'ig-sidebar__brand' })
      : '<img src="../images/brand/tma/tma-logo-mark.png" alt="" width="28" height="28" />';

    const icons = ['ChartPieSlice', 'Storefront', 'FolderNotch', 'IdentificationBadge', 'IdentificationCard', 'UsersThree', 'Notebook', 'ChatsTeardrop'];

    return `<aside class="ig-sidebar__panel ig-sidebar__panel--folded" data-node-id="33319:205880">
      <div class="ig-sidebar__panel-logo ig-sidebar__panel-logo--top">${logo}</div>
      <div class="ig-sidebar__fold-icons">
        ${icons.map(function (name, i) {
          return `<div class="ig-sidebar__fold-icon${i === 0 ? ' ig-sidebar__fold-icon--active' : ''}">${icon(name, 24)}</div>`;
        }).join('')}
      </div>
      <div class="ig-sidebar__profile ig-sidebar__profile--bottom ig-sidebar__profile--icon-only">
        <img src="../images/avatars/AvatarByewind.png" alt="" class="ig-sidebar__avatar" width="24" height="24" />
      </div>
      ${tooltip('Tooltip', '⌘')}
    </aside>`;
  }

  function renderMoreStatesStage() {
    return `<div class="ig-sidebar__stage ig-sidebar__stage--states" data-node-id="33319:205878">
      <p class="ig-sidebar__state-label ig-sidebar__state-label--expanded">Expanded state</p>
      <p class="ig-sidebar__state-label ig-sidebar__state-label--folded">Folded state</p>
      <p class="ig-sidebar__state-note">Only one level of directory can be selected after folding.</p>
      ${callout(
        'Directory',
        '<ul><li>Directory has no selected state.</li><li>Cannot expand(open) more than one directory at a time.</li><li>Directory is closed automatically when select another menu.</li></ul>',
        'ig-sidebar__callout--states-directory'
      )}
      ${renderExpandedStatePanel()}
      ${renderFoldedStatePanel()}
    </div>`;
  }

  function renderSidebar() {
    return `<article class="ig-doc ig-sidebar" data-node-id="30484:299255">
      ${DOC.renderDocHero('Sidebar', 'Interactive guidance')}
      <section class="ig-doc__section" data-node-id="33319:205845">
        <h3 class="ig-doc__heading">Complex type</h3>
        <div class="ig-doc__body">
          <p class="ig-sidebar__intro">Sidebar item can be dragged to sort. but cannot jump out of the category.</p>
          ${renderComplexStage()}
          ${renderNestingDiagram()}
        </div>
      </section>
      <section class="ig-doc__section" data-node-id="33319:205876">
        <h3 class="ig-doc__heading">More states</h3>
        <div class="ig-doc__body">${renderMoreStatesStage()}</div>
      </section>
      ${DOC.renderDocFooter()}
    </article>`;
  }

  window.TMAInteractiveGuidanceSidebar = { renderSidebar };
})();
