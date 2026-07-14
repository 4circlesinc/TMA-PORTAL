/* TMA - Layout interactive guidance panel (Figma 30484:299256) */
(function () {
  'use strict';

  const DOC = window.TMAInteractiveGuidanceDoc;

  function renderThreeColumnsShowcase() {
    const GS = window.TMAGlobalSearch;
    const overview = GS
      ? GS.renderOverview({ interactive: false, theme: 'dark', variant: 'layout' })
      : '<p class="ig-layout__fallback">Overview preview unavailable.</p>';

    return `<div class="ig-layout__showcase" data-node-id="387056:523350">
      <div class="ig-layout__scene ig-layout__scene--three" data-node-id="387056:523351" data-name="Overview">
        ${overview}
      </div>
    </div>`;
  }

  function renderTwoColumnsShowcase() {
    const GS = window.TMAGlobalSearch;
    const overview = GS
      ? GS.renderOverview({ interactive: false, theme: 'dark', variant: 'layout' })
      : '<p class="ig-layout__fallback">Overview preview unavailable.</p>';

    return `<div class="ig-layout__showcase ig-layout__showcase--two" data-node-id="387056:523354">
      <div class="ig-layout__scene ig-layout__scene--two" data-node-id="387056:523355" data-name="Overview (2 columns)">
        ${overview}
      </div>
    </div>`;
  }

  function renderOneColumnShowcase() {
    const GS = window.TMAGlobalSearch;
    const overview = GS
      ? GS.renderOverview({ interactive: false, theme: 'dark', variant: 'layout' })
      : '<p class="ig-layout__fallback">Overview preview unavailable.</p>';

    return `<div class="ig-layout__showcase ig-layout__showcase--one" data-node-id="387056:523425">
      <div class="ig-layout__scene ig-layout__scene--one" data-node-id="387056:523425" data-name="Overview (1 column)">
        ${overview}
      </div>
    </div>`;
  }

  function renderLayout() {
    const intro = `<div class="ig-layout__intro-copy">
      <p>All pages of tma-portal support responsive layout and can adapt to all mainstream resolutions from mobile to desktop.</p>
      <p>However, due to the rules of Figma, it is difficult to achieve a perfect responsive layout in some cases. Therefore, it would be a better choice to manually respond to different resolutions.</p>
    </div>`;

    return `<article class="ig-doc ig-layout" data-node-id="30484:299256">
      ${DOC.renderDocHero('Layout')}
      <section class="ig-doc__section ig-layout__intro" data-node-id="387056:523345">
        <h3 class="ig-doc__heading">Responsive Layouts</h3>
        <div class="ig-doc__body">${intro}</div>
      </section>
      <section class="ig-doc__section ig-layout__three-columns" data-node-id="387056:523348">
        <h3 class="ig-doc__heading">Three Columns</h3>
        ${renderThreeColumnsShowcase()}
      </section>
      <section class="ig-doc__section ig-layout__two-columns" data-node-id="387056:523352">
        <h3 class="ig-doc__heading">Two Columns</h3>
        ${renderTwoColumnsShowcase()}
      </section>
      <section class="ig-doc__section ig-layout__one-column" data-node-id="387056:523423">
        <h3 class="ig-doc__heading">One Column</h3>
        ${renderOneColumnShowcase()}
      </section>
      ${DOC.renderDocFooter()}
    </article>`;
  }

  window.TMAInteractiveGuidanceLayout = { renderLayout };
})();
