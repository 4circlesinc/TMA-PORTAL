/* TMA — Unified forms demo */
(function () {
  'use strict';

  const IN = window.TMAInput;
  const FG = window.TMAFormsGuidance;
  const FI = window.TMAFormInstances;

  function mountDemo(opts) {
    const o = opts || {};
    const tsSvg = o.socialSvg || (window.TMATableSearchIcons && window.TMATableSearchIcons.svg);

    if (o.variantsGridEl && IN) {
      o.variantsGridEl.innerHTML = IN.renderExamplesGrid();
    }
    if (o.commandEl && IN) {
      o.commandEl.innerHTML = IN.renderCommandInput({ nodeId: '32728:395062' });
    }
    if (o.tagsEl && IN) {
      o.tagsEl.innerHTML = IN.renderTagInput({ nodeId: '32728:395063' });
    }
    if (o.buttonsEl && FG) {
      o.buttonsEl.innerHTML = FG.section('Buttons', FG.renderButtonsBoard());
    }
    if (o.statesEl && FG) {
      o.statesEl.innerHTML = FG.section('Input states', FG.renderMatrixBoard());
    }
    if (o.instancesEl && FI) {
      FI.mountInstances(o.instancesEl);
    }
    if (o.footerEl && IN && tsSvg) {
      o.footerEl.innerHTML = IN.renderDocumentationFooter(tsSvg);
    }
    if (IN && typeof IN.mountInteractive === 'function') {
      IN.mountInteractive(document.querySelector('.tma-forms-demo') || document.body);
    }
  }

  window.TMAFormsDemo = { mountDemo };
})();
