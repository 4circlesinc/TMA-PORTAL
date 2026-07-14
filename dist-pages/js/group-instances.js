/* TMA - Group instances showcase (Figma 32729:396128) - absolute layout */
(function () {
  'use strict';

  const FRAME = { w: 1660, h: 512 };

  const MAIL_NAV = [
    { key: 'compose', label: 'Compose', icon: 'PencilSimpleLine20', active: true },
    { key: 'inbox', label: 'Inbox', icon: 'Tray20' },
    { key: 'sent', label: 'Sent', icon: 'PaperPlaneRight20' },
    { key: 'draft', label: 'Draft', icon: 'FileText20' },
    { key: 'archive', label: 'Archive', icon: 'Archive20' },
    { key: 'trash', label: 'Trash', icon: 'Trash20' },
  ];

  const WEEK_DAYS = [
    { day: 'SU', date: '22' },
    { day: 'Mo', date: '23', active: true },
    { day: 'Tu', date: '24' },
    { day: 'We', date: '25' },
    { day: 'Th', date: '26' },
    { day: 'Fr', date: '27' },
    { day: 'Sa', date: '28' },
  ];

  const RANGE_LABELS = ['1-1', '2-10', '10-50', '50+'];

  const SOCIAL_STATS = [
    { icon: 'HeartStraight16', count: '189' },
    { icon: 'ChatTeardropDots16', count: '26' },
    { icon: 'ShareNetwork16', count: '12' },
    { icon: 'PaperPlaneTilt16', count: '6' },
  ];

  const NAV_LINKS = ['Product', 'Solutions', 'Resources', 'Download', 'Pricing'];

  const ICON_TEXT_FULL = [
    { icon: 'UserCircle16', label: 'Developer' },
    { icon: 'MapPin16', label: 'SF, Bay Area' },
    { icon: 'EnvelopeSimple16', label: 'byewind@twitter.com' },
    { icon: 'Phone16', label: '+852 19850622' },
  ];

  const ICON_TEXT_SHORT = ICON_TEXT_FULL.slice(0, 3);

  const ATTACH_STATS = [
    { icon: 'Paperclip16', count: '6' },
    { icon: 'ChatText16', count: '8' },
  ];

  const COUNTRY_TAGS = ['United States', 'Canada', 'Other'];
  const WEEK_TAGS = ['Current Week', 'Previous Week'];

  function gi(key, cls, w, h) {
    const sources = [
      window.TMAGroupInstancesIcons,
      window.TMAButtonDocIcons,
      window.TMAGroupDocIcons,
      window.TMALineIcons,
      window.TMAPopoverIcons,
      window.TMATableSearchIcons,
      window.TMACardIcons,
      window.TMAButtonInstancesIcons,
      window.TMAInputIcons,
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

  function place(x, y, w, h, html, nodeId) {
    const size = w != null && h != null
      ? `width:${w}px;height:${h}px;`
      : '';
    return `<div class="tma-grp-inst__node" style="left:${x}px;top:${y}px;${size}" data-node-id="${esc(nodeId)}">${html}</div>`;
  }

  function renderGroup(cls, html, attrs) {
    const a = attrs || {};
    const role = a.role ? ` role="${esc(a.role)}"` : '';
    const aria = a.ariaLabel ? ` aria-label="${esc(a.ariaLabel)}"` : '';
    return `<div class="tma-grp-inst__group ${cls || ''}"${role}${aria}>${html}</div>`;
  }

  function renderMailSidebar() {
    const items = MAIL_NAV.map((item) => {
      const active = item.active ? ' tma-grp-inst__mail-btn--active' : '';
      return `<button type="button" class="tma-grp-inst__mail-btn${active}" data-mail-key="${esc(item.key)}" aria-pressed="${item.active ? 'true' : 'false'}">
        <span class="tma-grp-inst__mail-icon">${gi(item.icon, 'tma-grp-inst__mail-icon-svg', 20, 20)}</span>
        <span class="tma-grp-inst__mail-label">${esc(item.label)}</span>
      </button>`;
    }).join('');
    return renderGroup('tma-grp-inst__group--mail', items, { role: 'group', ariaLabel: 'Mail navigation' });
  }

  function renderUploadZone() {
    return renderGroup('tma-grp-inst__group--upload', `
      <span class="tma-grp-inst__upload-copy">Drop files here or upload files</span>
      <button type="button" class="tma-grp-inst__pill-btn tma-grp-inst__pill-btn--filled">Upload</button>
    `, { role: 'group' });
  }

  function renderWeekPicker() {
    const days = WEEK_DAYS.map((item) => {
      const active = item.active ? ' tma-grp-inst__day--active' : '';
      return `<button type="button" class="tma-grp-inst__day${active}" data-day="${esc(item.day)}" aria-pressed="${item.active ? 'true' : 'false'}">
        <span class="tma-grp-inst__day-name">${esc(item.day)}</span>
        <span class="tma-grp-inst__day-date">${esc(item.date)}</span>
      </button>`;
    }).join('');
    return renderGroup('tma-grp-inst__group--week', days, { role: 'group', ariaLabel: 'Week picker' });
  }

  function renderRangeInputs() {
    const inputs = RANGE_LABELS.map((label, i) => {
      const active = i === 0 ? ' tma-grp-inst__range--active' : '';
      return `<button type="button" class="tma-grp-inst__range${active}" data-range="${esc(label)}" aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(label)}</button>`;
    }).join('');
    return renderGroup('tma-grp-inst__group--range', inputs, { role: 'group', ariaLabel: 'Range selection' });
  }

  function renderEmailDivider() {
    return renderGroup('tma-grp-inst__group--divider', `
      <span class="tma-grp-inst__divider-line" aria-hidden="true"></span>
      <span class="tma-grp-inst__divider-label">Or with Email</span>
      <span class="tma-grp-inst__divider-line" aria-hidden="true"></span>
    `, { role: 'separator' });
  }

  function renderSocialStats() {
    const items = SOCIAL_STATS.map((item) => `
      <button type="button" class="tma-grp-inst__stat-btn">
        <span class="tma-grp-inst__stat-icon">${gi(item.icon, 'tma-grp-inst__stat-icon-svg', 16, 16)}</span>
        <span class="tma-grp-inst__stat-count">${esc(item.count)}</span>
      </button>
    `).join('');
    return renderGroup('tma-grp-inst__group--stats', items, { role: 'group' });
  }

  function renderTabsLegends() {
    return renderGroup('tma-grp-inst__group--tabs', `
      <span class="tma-grp-inst__tab tma-grp-inst__tab--active">Total Users</span>
      <span class="tma-grp-inst__tab tma-grp-inst__tab--muted">Total Projects</span>
      <span class="tma-grp-inst__tab tma-grp-inst__tab--muted">Operating Status</span>
      <span class="tma-grp-inst__pipe" aria-hidden="true">|</span>
      <span class="tma-grp-inst__tag">
        <span class="tma-grp-inst__tag-dot">${gi('Dot12', 'tma-grp-inst__tag-dot-svg', 4.5, 4.5)}</span>
        <span class="tma-grp-inst__tag-label">This year</span>
      </span>
      <span class="tma-grp-inst__tag">
        <span class="tma-grp-inst__tag-dot">${gi('Dot12', 'tma-grp-inst__tag-dot-svg', 4.5, 4.5)}</span>
        <span class="tma-grp-inst__tag-label">Last year</span>
      </span>
    `, { role: 'group' });
  }

  function renderRevenueTags() {
    return renderGroup('tma-grp-inst__group--revenue', `
      <span class="tma-grp-inst__tab tma-grp-inst__tab--active">Revenue</span>
      <span class="tma-grp-inst__pipe" aria-hidden="true">|</span>
      <span class="tma-grp-inst__tag">
        <span class="tma-grp-inst__tag-dot">${gi('Dot12', 'tma-grp-inst__tag-dot-svg', 4.5, 4.5)}</span>
        <span class="tma-grp-inst__tag-label">Current Week <strong>$58,211</strong></span>
      </span>
      <span class="tma-grp-inst__tag">
        <span class="tma-grp-inst__tag-dot">${gi('Dot12', 'tma-grp-inst__tag-dot-svg', 4.5, 4.5)}</span>
        <span class="tma-grp-inst__tag-label">Previous Week <strong>$68,768</strong></span>
      </span>
    `, { role: 'group' });
  }

  function renderNavLinks() {
    const links = NAV_LINKS.map((label) => `
      <button type="button" class="tma-grp-inst__link-btn">${esc(label)}</button>
    `).join('');
    return renderGroup('tma-grp-inst__group--links', links, { role: 'group' });
  }

  function renderActionRow(labels, withPlus) {
    const btns = labels.map((label, i) => {
      const icon = withPlus && i === 0
        ? `<span class="tma-grp-inst__action-icon">${gi('Plus16', 'tma-grp-inst__action-icon-svg', 16, 16)}</span>`
        : '';
      return `<button type="button" class="tma-grp-inst__action-btn">${icon}<span>${esc(label)}</span></button>`;
    }).join('');
    const more = `<button type="button" class="tma-grp-inst__action-btn tma-grp-inst__action-btn--icon" aria-label="More">${gi('ThreeDots16', 'tma-grp-inst__action-icon-svg', 16, 16)}</button>`;
    return renderGroup('tma-grp-inst__group--actions', `${btns}${more}`, { role: 'group' });
  }

  function renderIconTextRow(items) {
    const row = items.map((item) => `
      <span class="tma-grp-inst__icon-text">
        <span class="tma-grp-inst__icon-text-icon">${gi(item.icon, 'tma-grp-inst__icon-text-icon-svg', 16, 16)}</span>
        <span class="tma-grp-inst__icon-text-label">${esc(item.label)}</span>
      </span>
    `).join('');
    return renderGroup('tma-grp-inst__group--icon-text', row, { role: 'group' });
  }

  function renderAttachStats() {
    const items = ATTACH_STATS.map((item) => `
      <span class="tma-grp-inst__icon-text">
        <span class="tma-grp-inst__icon-text-icon">${gi(item.icon, 'tma-grp-inst__icon-text-icon-svg', 16, 16)}</span>
        <span class="tma-grp-inst__icon-text-label">${esc(item.count)}</span>
      </span>
    `).join('');
    return renderGroup('tma-grp-inst__group--attach', items, { role: 'group' });
  }

  function renderDotTags(labels) {
    const tags = labels.map((label) => `
      <span class="tma-grp-inst__tag">
        <span class="tma-grp-inst__tag-dot">${gi('Dot12', 'tma-grp-inst__tag-dot-svg', 4.5, 4.5)}</span>
        <span class="tma-grp-inst__tag-label">${esc(label)}</span>
      </span>
    `).join('');
    return renderGroup('tma-grp-inst__group--tags', tags, { role: 'group' });
  }

  function renderCountdown() {
    const units = [
      { value: '32', label: 'Hours' },
      { value: '43', label: 'Minutes' },
      { value: '23', label: 'Seconds' },
    ];
    const parts = [];
    units.forEach((unit, i) => {
      if (i > 0) parts.push('<span class="tma-grp-inst__count-sep">:</span>');
      parts.push(`<div class="tma-grp-inst__count-unit">
        <span class="tma-grp-inst__count-value">${esc(unit.value)}</span>
        <span class="tma-grp-inst__count-label">${esc(unit.label)}</span>
      </div>`);
    });
    return renderGroup('tma-grp-inst__group--countdown', parts.join(''), { role: 'group', ariaLabel: 'Countdown timer' });
  }

  function renderInstances() {
    const parts = [];

    parts.push(`<div class="tma-grp-inst" data-node-id="32729:396128" style="width:${FRAME.w}px;height:${FRAME.h}px">
      <svg class="tma-grp-inst__dash-border" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAME.w} ${FRAME.h}" preserveAspectRatio="none">
        <rect x="1" y="1" width="${FRAME.w - 2}" height="${FRAME.h - 2}" rx="48" ry="48"/>
      </svg>
      <div class="tma-grp-inst__canvas">`);

    parts.push(place(100, 100, 154, 288, renderMailSidebar(), '32729:396144'));
    parts.push(place(285, 100, 384, 56, renderUploadZone(), '32729:396138'));
    parts.push(place(285, 166, 384, 44, renderWeekPicker(), '32729:396137'));
    parts.push(place(285, 220, 384, 40, renderRangeInputs(), '32729:396140'));
    parts.push(place(285, 270, 384, 16, renderEmailDivider(), '32729:396139'));
    parts.push(place(285, 296, 255, 24, renderSocialStats(), '32729:396145'));

    parts.push(place(689, 100, 518, 20, renderTabsLegends(), '32729:396129'));
    parts.push(place(689, 130, 428, 20, renderRevenueTags(), '32729:396130'));
    parts.push(place(689, 160, 438, 24, renderNavLinks(), '32729:396131'));
    parts.push(place(689, 198, 225, 24, renderActionRow(['Add User', 'Add Target'], true), '32729:396132'));
    parts.push(place(689, 236, 170, 24, renderActionRow(['Follow', 'Hire Me'], false), '32729:396133'));
    parts.push(place(689, 284, 471, 16, renderIconTextRow(ICON_TEXT_FULL), '32729:396141'));
    parts.push(place(689, 322, 345, 16, renderIconTextRow(ICON_TEXT_SHORT), '32729:396142'));
    parts.push(place(689, 360, 71, 16, renderAttachStats(), '32729:396143'));

    parts.push(place(1235, 100, 259, 20, renderDotTags(COUNTRY_TAGS), '32729:396135'));
    parts.push(place(1235, 130, 226, 20, renderDotTags(WEEK_TAGS), '32729:396134'));
    parts.push(place(1235, 170, 325, 76, renderCountdown(), '32729:396136'));

    parts.push('</div></div>');
    return parts.join('');
  }

  function wireMailNav(root) {
    const group = root.querySelector('.tma-grp-inst__group--mail');
    if (!group) return;
    group.addEventListener('click', (event) => {
      const btn = event.target.closest('.tma-grp-inst__mail-btn');
      if (!btn || !group.contains(btn)) return;
      group.querySelectorAll('.tma-grp-inst__mail-btn').forEach((item) => {
        item.classList.remove('tma-grp-inst__mail-btn--active');
        item.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('tma-grp-inst__mail-btn--active');
      btn.setAttribute('aria-pressed', 'true');
    });
  }

  function wireWeekPicker(root) {
    const group = root.querySelector('.tma-grp-inst__group--week');
    if (!group) return;
    group.addEventListener('click', (event) => {
      const btn = event.target.closest('.tma-grp-inst__day');
      if (!btn || !group.contains(btn)) return;
      group.querySelectorAll('.tma-grp-inst__day').forEach((item) => {
        item.classList.remove('tma-grp-inst__day--active');
        item.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('tma-grp-inst__day--active');
      btn.setAttribute('aria-pressed', 'true');
    });
  }

  function wireRangeInputs(root) {
    const group = root.querySelector('.tma-grp-inst__group--range');
    if (!group) return;
    group.addEventListener('click', (event) => {
      const btn = event.target.closest('.tma-grp-inst__range');
      if (!btn || !group.contains(btn)) return;
      group.querySelectorAll('.tma-grp-inst__range').forEach((item) => {
        item.classList.remove('tma-grp-inst__range--active');
        item.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('tma-grp-inst__range--active');
      btn.setAttribute('aria-pressed', 'true');
    });
  }

  function wireInteractivity(root) {
    if (!root) return;
    wireMailNav(root);
    wireWeekPicker(root);
    wireRangeInputs(root);
  }

  function mountInstances(el, opts) {
    if (!el) return;
    el.innerHTML = renderInstances();
    if (!opts || opts.interactive !== false) wireInteractivity(el);
  }

  window.TMAGroupInstances = {
    FRAME,
    MAIL_NAV,
    WEEK_DAYS,
    renderInstances,
    mountInstances,
    wireInteractivity,
  };
})();
