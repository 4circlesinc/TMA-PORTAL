/* TMA - Dashboard guidance panels (Header, Sidebar, Rightbar, Layout) */
(function () {
  'use strict';

  const DOC = window.TMAInteractiveGuidanceDoc;
  const tsSvg = window.TMATableSearchIcons && window.TMATableSearchIcons.svg;

  function iconImg(path, cls) {
    return `<img src="../images/icons/${path}" alt="" class="${cls || 'ig-header__icon'}" width="16" height="16" />`;
  }

  function svg(name, cls, w, h) {
    return tsSvg ? tsSvg(name, cls || '', w || 16, h || 16) : '';
  }

  function renderHeader() {
    const demo = `<div class="ig-header__demo">
      <div class="ig-header__bar">
        <div class="ig-header__left">
          <div class="ig-header__icon-group" aria-hidden="true">
            <span class="ig-header__icon-btn">${iconImg('tma/Sidebar.svg')}</span>
            <span class="ig-header__icon-btn">${iconImg('phosphor/Star.svg')}</span>
          </div>
          <nav class="ig-header__breadcrumb" aria-label="Breadcrumb">
            <button type="button" class="ig-header__crumb ig-header__crumb--muted">Dashboards</button>
            <span class="ig-header__sep">/</span>
            <button type="button" class="ig-header__crumb">Overview</button>
          </nav>
        </div>
        <div class="ig-header__right">
          <div class="ig-header__search">
            ${svg('Search16', 'ig-header__search-icon', 16, 16)}
            <span class="ig-header__search-placeholder">Search</span>
            <kbd class="ig-header__kbd">/</kbd>
          </div>
          <div class="ig-header__icon-group" aria-hidden="true">
            <span class="ig-header__icon-btn">${iconImg('phosphor/Sun.svg')}</span>
            <span class="ig-header__icon-btn">${iconImg('phosphor/ClockCounterClockwise.svg')}</span>
            <span class="ig-header__icon-btn">${iconImg('phosphor/Bell.svg')}</span>
            <span class="ig-header__icon-btn">${iconImg('tma/Rightbar.svg')}</span>
          </div>
        </div>
      </div>
      <ul class="ig-header__callouts">
        <li><strong>Favorites</strong><span>The Favorites page will appear in the Sidebar in Favorites.</span></li>
        <li><strong>Sidebar</strong><span>Click to collapse the sidebar</span></li>
        <li><strong>Rightbar</strong><span>Click to collapse the Rightbar</span></li>
        <li><strong>Activities</strong><span>Open in the Rightbar</span></li>
        <li><strong>Notifications</strong><span>Open in the Rightbar</span></li>
        <li><strong>Light/Dark mode switch</strong></li>
        <li><strong>Search</strong></li>
      </ul>
    </div>`;

    return `<article class="ig-doc ig-header" data-node-id="33319:128011">
      ${DOC.renderDocHero('Header', 'Interactive guidance')}
      ${DOC.renderDocSection('', '<p class="ig-doc__lead">Header is always fixed at the top of the page.</p>')}
      <section class="ig-doc__section ig-doc__section--flush">${demo}</section>
      ${DOC.renderDocFooter()}
    </article>`;
  }

  function renderSidebar() {
    if (window.TMAInteractiveGuidanceSidebar) {
      return window.TMAInteractiveGuidanceSidebar.renderSidebar();
    }
    return `<article class="ig-doc" data-node-id="30484:299255">
      ${DOC.renderDocHero('Sidebar', 'Interactive guidance')}
      ${DOC.renderDocSection('', '<p class="ig-doc__lead">Sidebar guidance loading…</p>')}
      ${DOC.renderDocFooter()}
    </article>`;
  }

  function renderRightbar() {
    if (window.TMAInteractiveGuidanceRightbar) {
      return window.TMAInteractiveGuidanceRightbar.renderRightbar();
    }
    return `<article class="ig-doc" data-node-id="30484:299250">
      ${DOC.renderDocHero('Rightbar', 'Interactive guidance')}
      ${DOC.renderDocSection('', '<p class="ig-doc__lead">Rightbar guidance loading…</p>')}
      ${DOC.renderDocFooter()}
    </article>`;
  }

  function renderLayout() {
    if (window.TMAInteractiveGuidanceLayout) {
      return window.TMAInteractiveGuidanceLayout.renderLayout();
    }
    return `<article class="ig-doc" data-node-id="30484:299256">
      ${DOC.renderDocHero('Layout', 'Interactive guidance')}
      ${DOC.renderDocSection('', '<p class="ig-doc__lead">Layout guidance loading…</p>')}
      ${DOC.renderDocFooter()}
    </article>`;
  }

  window.TMAInteractiveGuidanceDashboard = {
    renderHeader,
    renderSidebar,
    renderRightbar,
    renderLayout,
  };
})();
