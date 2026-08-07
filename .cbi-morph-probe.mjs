import { chromium } from 'playwright';
import fs from 'fs';

const R = '/Users/vernonfrancis/Github/TMA-PORTAL/public/js/';
const morph = fs.readFileSync(R + 'dom-morph.js', 'utf8');
const tabg = fs.readFileSync(R + 'tab-group.js', 'utf8');
const views = fs.readFileSync(R + 'portal-views.js', 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<div id="root"></div>');
await page.addScriptTag({ content: morph });
await page.addScriptTag({ content: tabg });
await page.addScriptTag({ content: views });

const out = await page.evaluate(() => {
  const ui = window.TMAPortalUI;
  const root = document.getElementById('root');
  const STAGES = [
    { key: '', label: 'All' },
    { key: 'applications', label: 'Applications' },
    { key: 'assessment', label: 'Assessment' },
  ];
  const res = {};

  // ---- A: empty-string tab key never reaches onChange -------------------
  root.innerHTML = ui.tabs(STAGES, 'applications');
  const seen = [];
  ui.wireTabs(root, (key) => seen.push(JSON.stringify(key)));
  root.querySelectorAll('.tma-tab')[0].click();   // "All" (key: '')
  root.querySelectorAll('.tma-tab')[2].click();   // "Assessment"
  res.onChangeCallsAfterClickingAllThenAssessment = seen;

  const raw = [];
  root.addEventListener('tma-tab-change', (e) => raw.push(e.detail.key));
  root.querySelectorAll('.tma-tab')[0].click();
  res.rawDetailKeyForAllTab = raw;

  // ---- B: wrapping the tab group contains the rebuild -------------------
  const root2 = document.createElement('div');
  document.body.appendChild(root2);
  const html = (wrap) =>
    '<div class="page">' +
      '<div class="tma-portal-head">Head</div>' +
      (wrap ? '<div class="cbi-tabs-wrap">' + ui.tabs(STAGES, '') + '</div>' : ui.tabs(STAGES, '')) +
      '<div class="tma-dash__toolbar">' + ui.searchInput('Search', 'data-cbi-search', '') + '</div>' +
      '<div data-cbi-body>rows</div>' +
    '</div>';

  window.TMAMorph.patch(root2, html(true));
  window.PortalTabGroup.init(root2);
  const inp1 = root2.querySelector('[data-cbi-search]');
  inp1.focus();
  window.TMAMorph.patch(root2, html(true));
  res.wrapped_inputReused = inp1 === root2.querySelector('[data-cbi-search]');
  res.wrapped_inputStillFocused = document.activeElement === root2.querySelector('[data-cbi-search]');

  return res;
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
