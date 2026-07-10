/* TMA — Card component */
(function () {
  'use strict';

  const svg = (key, cls, w, h) => (window.TMACardIcons && window.TMACardIcons.svg(key, cls, w, h)) || '';

  const DEFAULT_PRICE_FEATURES = [
    'Single user license',
    'Component properties',
    'Interactive components',
    'Light & Dark theme',
    '30+ Page examples',
    'Lifetime Updates',
  ];

  const CODE_BLOCK_LINES = [
    '<span class="tma-card__code-comment">// Type some code -&gt; </span>',
    ' ',
    '<span class="tma-card__code-object">console</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">log</span> <span class="tma-card__code-string">"oO08 iIlL1 g9qCGQ ~-+=&gt;"</span><span class="tma-card__code-punct">; </span>',
    '<span class="tma-card__code-comment">// â é ù ï ø ç Ã Ē Æ œ </span>',
    ' ',
    '<span class="tma-card__code-keyword">function</span> <span class="tma-card__code-fn">updateGutters</span><span class="tma-card__code-punct">(</span><span class="tma-card__code-var">cm</span><span class="tma-card__code-punct">) { </span>',
    '    <span class="tma-card__code-keyword">var</span> <span class="tma-card__code-var">gutters</span> <span class="tma-card__code-punct">= </span><span class="tma-card__code-var">cm</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">display</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">gutters</span><span class="tma-card__code-punct">, </span>',
    '        <span class="tma-card__code-var">__specs</span> <span class="tma-card__code-punct">= </span><span class="tma-card__code-var">cm</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">options</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">gutters</span><span class="tma-card__code-punct">; </span>',
    ' ',
    '    <span class="tma-card__code-builtin">removeChildren</span><span class="tma-card__code-punct">(</span><span class="tma-card__code-var">gutters</span><span class="tma-card__code-punct">); </span>',
    ' ',
    '    <span class="tma-card__code-keyword">for</span> <span class="tma-card__code-punct">(</span><span class="tma-card__code-keyword">var</span> <span class="tma-card__code-var">i</span> <span class="tma-card__code-punct">= </span><span class="tma-card__code-number">0</span><span class="tma-card__code-punct">; </span><span class="tma-card__code-var">i</span> <span class="tma-card__code-punct">&lt; </span><span class="tma-card__code-object">specs</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">length</span><span class="tma-card__code-punct">; ++</span><span class="tma-card__code-var">i</span><span class="tma-card__code-punct">) { </span>',
    '        <span class="tma-card__code-keyword">var</span> <span class="tma-card__code-var">gutterClass</span> <span class="tma-card__code-punct">= </span><span class="tma-card__code-var">__specs</span><span class="tma-card__code-punct">[</span><span class="tma-card__code-var">i</span><span class="tma-card__code-punct">]; </span>',
    '        <span class="tma-card__code-keyword">var</span> <span class="tma-card__code-var">gElt</span> <span class="tma-card__code-punct">= </span><span class="tma-card__code-var">gutters</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">appendChild</span><span class="tma-card__code-punct">( </span>',
    '            <span class="tma-card__code-builtin">elt</span><span class="tma-card__code-punct">( </span>',
    '                <span class="tma-card__code-string">"div"</span><span class="tma-card__code-punct">, </span>',
    '                <span class="tma-card__code-keyword">null</span><span class="tma-card__code-punct">, </span>',
    '                <span class="tma-card__code-string">"CodeMirror-gutter "</span> <span class="tma-card__code-punct">+ </span><span class="tma-card__code-var">gutterClass </span>',
    '            <span class="tma-card__code-punct">) </span>',
    '        <span class="tma-card__code-punct">); </span>',
    '        <span class="tma-card__code-keyword">if</span> <span class="tma-card__code-punct">(</span><span class="tma-card__code-var">gutterClass</span> <span class="tma-card__code-punct">== </span><span class="tma-card__code-string">"CodeMirror-linenumbers"</span><span class="tma-card__code-punct">) { </span>',
    '            <span class="tma-card__code-var">cm</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">display</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">lineGutter</span> <span class="tma-card__code-punct">= </span><span class="tma-card__code-var">gElt</span><span class="tma-card__code-punct">; </span>',
    '            <span class="tma-card__code-var">gElt</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">style</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">width</span> <span class="tma-card__code-punct">= (</span><span class="tma-card__code-var">cm</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">display</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">lineNumWidth</span> <span class="tma-card__code-punct">|| </span><span class="tma-card__code-string">1</span><span class="tma-card__code-punct">) + </span><span class="tma-card__code-string">"px"</span><span class="tma-card__code-punct">; </span>',
    '        <span class="tma-card__code-punct">} </span>',
    '    <span class="tma-card__code-punct">} </span>',
    '    <span class="tma-card__code-var">gutters</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">style</span><span class="tma-card__code-punct">.</span><span class="tma-card__code-method">display</span> <span class="tma-card__code-punct">= </span><span class="tma-card__code-var">i</span> <span class="tma-card__code-punct">? </span><span class="tma-card__code-string">""</span> <span class="tma-card__code-punct">: </span><span class="tma-card__code-string">"none"</span><span class="tma-card__code-punct">; </span>',
    '    <span class="tma-card__code-builtin">updateGutterSpace</span><span class="tma-card__code-punct">(</span><span class="tma-card__code-var">cm</span><span class="tma-card__code-punct">); </span>',
    ' ',
    '    <span class="tma-card__code-keyword">return</span> <span class="tma-card__code-keyword">false</span><span class="tma-card__code-punct">; </span>',
    '<span class="tma-card__code-punct">} </span>',
  ];

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function avatarBase() {
    if (typeof location === 'undefined') return '../images/avatars/';
    const path = location.pathname || '';
    if (/\.html$/i.test(path)) {
      const segments = path.split('/').filter(Boolean);
      if (segments.length && /\.[a-z0-9]+$/i.test(segments[segments.length - 1])) segments.pop();
      if (segments.length === 0) return 'images/avatars/';
      return `${'../'.repeat(segments.length)}images/avatars/`;
    }
    return 'images/avatars/';
  }

  function assetRoot() {
    if (typeof location === 'undefined') return '../images/';
    const path = location.pathname || '';
    if (/\.html$/i.test(path)) {
      const segments = path.split('/').filter(Boolean);
      if (segments.length && /\.[a-z0-9]+$/i.test(segments[segments.length - 1])) segments.pop();
      if (segments.length === 0) return 'images/';
      return `${'../'.repeat(segments.length)}images/`;
    }
    return 'images/';
  }

  const BRAND_LOGO_ALIASES = {
    Medium: 'PriorityMedium40',
    Medium40: 'PriorityMedium40',
  };

  const UI_ICON_FILES = {
    FolderNotch24: 'icons/phosphor/FolderNotch.svg',
    CurrencyCircleDollar24: 'icons/phosphor/CurrencyCircleDollar.svg',
    UsersThree24: 'icons/phosphor/UsersThree.svg',
    ArrowRise16: 'icons/tma/ArrowRise.svg',
    ArrowFall16: 'icons/tma/ArrowFall.svg',
  };

  function resolveLogoIcon(key) {
    if (!key) return 'Figma40';
    if (key.endsWith('40')) return key;
    return `${key}40`;
  }

  function brandLogoFile(key) {
    const resolved = resolveLogoIcon(key);
    return BRAND_LOGO_ALIASES[resolved] || BRAND_LOGO_ALIASES[key] || resolved;
  }

  function brandLogoSrc(key) {
    return assetRoot() + 'icons/brands/' + brandLogoFile(key) + '.svg';
  }

  function uiIconSrc(key) {
    const rel = UI_ICON_FILES[key];
    return rel ? assetRoot() + rel : '';
  }

  function renderBrandLogo(key) {
    return `<img src="${esc(brandLogoSrc(key))}" alt="" class="tma-card__logo-img" width="40" height="40" />`;
  }

  function renderFileIcon(key, cls, w, h) {
    const src = uiIconSrc(key);
    if (!src) return '';
    return `<img src="${esc(src)}" alt="" class="${esc(cls)}" width="${w}" height="${h}" />`;
  }

  function resolveIconKey(key, size) {
    if (!key) return '';
    const suffix = String(size);
    return key.endsWith(suffix) ? key : `${key}${suffix}`;
  }

  function renderChip(label, color) {
    const c = color || 'purple';
    return `<span class="tma-card__chip tma-card__chip--${esc(c)}"><span class="tma-card__chip-dot">${svg('Dot12', 'tma-card__chip-dot-svg', 12, 12)}</span><span class="tma-card__chip-label">${esc(label)}</span></span>`;
  }

  function renderStatusChip(label) {
    return `<span class="tma-card__status-chip"><span class="tma-card__status-chip-label">${esc(label)}</span></span>`;
  }

  function renderStrip(percent, opts) {
    const o = opts || {};
    const p = Math.max(0, Math.min(100, percent == null ? 75 : percent));
    const full = o.full || p >= 100;
    const color = o.color || 'purple';
    const fullCls = full ? ' tma-card__strip--full' : '';
    const colorCls = color ? ` tma-card__strip--${esc(color)}` : '';
    return `<div class="tma-card__strip${fullCls}${colorCls}"><span class="tma-card__strip-fill tma-card__strip-fill--${esc(color)}" style="width:${p}%"></span></div>`;
  }

  function renderAvatar(key, size) {
    const sz = size || 28;
    const smCls = sz === 24 ? ' tma-card__avatar--sm' : '';
    return `<img src="${esc(avatarBase() + key + '.png')}" alt="" class="tma-card__avatar${smCls}" width="${sz}" height="${sz}" />`;
  }

  function renderAvatarGroup(group, size) {
    if (!group || !group.length) return '';
    const sz = size || 28;
    const smCls = sz === 24 ? ' tma-card__avatar--sm' : '';
    const avatars = group.slice(0, 2);
    const more = group[2];
    const avatarsHtml = avatars.map((key, i) => {
      const overlap = i > 0 ? ' tma-card__avatar--overlap' : '';
      return `<img src="${esc(avatarBase() + key + '.png')}" alt="" class="tma-card__avatar${smCls}${overlap}" width="${sz}" height="${sz}" />`;
    }).join('');
    const moreHtml = more != null ? `<span class="tma-card__avatar-more${smCls}">+${esc(more)}</span>` : '';
    return `<div class="tma-card__avatar-group">${avatarsHtml}${moreHtml}</div>`;
  }

  function renderMetaAvatars(o) {
    const size = o.avatarSize || 28;
    if (o.avatarGroup) return renderAvatarGroup(o.avatarGroup, size);
    if (o.avatar) return renderAvatar(o.avatar, size);
    return '';
  }

  function renderProgressCard(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '32267:8047';
    const title = o.title || 'TMA';
    const dueDate = o.dueDate || 'Due Date: Nov 10, 2022';
    const status = o.status || 'In Progress';
    const statusColor = o.statusColor || 'purple';
    const completed = o.completed != null ? o.completed : 36;
    const total = o.total != null ? o.total : 49;
    const percent = o.percent != null ? o.percent : 75;
    const boardCls = String(nodeId).startsWith('33160') ? ' tma-card--progress-board' : '';

    return `<article class="tma-card tma-card--progress${boardCls}" data-node-id="${esc(nodeId)}">
      <div class="tma-card__header">
        <div class="tma-card__copy">
          <p class="tma-card__title">${esc(title)}</p>
          <p class="tma-card__subtitle">${esc(dueDate)}</p>
        </div>
        <div class="tma-card__logo" aria-hidden="true">${renderBrandLogo(o.logoIcon)}</div>
      </div>
      <div class="tma-card__meta-row">
        ${renderMetaAvatars(o)}
        ${renderChip(status, statusColor)}
      </div>
      ${renderStrip(percent, { color: o.stripColor || statusColor, full: o.fullStrip || percent >= 100 })}
      <div class="tma-card__stats">
        <p class="tma-card__tasks"><span class="tma-card__tasks-done">${completed}</span><span class="tma-card__tasks-sep"> / </span><span class="tma-card__tasks-total">${total}</span><span class="tma-card__tasks-label"> Total Tasks</span></p>
        <p class="tma-card__percent">${percent}%</p>
      </div>
    </article>`;
  }

  function renderStatCard(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '33160:10066';
    const label = o.label || 'Current Projects';
    const value = o.value != null ? o.value : '268';
    const trend = o.trend || '+11.02%';
    const trendUp = o.trendUp != null ? o.trendUp : true;
    const bg = o.bg || '#edeefc';
    const iconKey = resolveIconKey(o.icon || 'FolderNotch', 24);
    const trendIcon = trendUp ? 'ArrowRise16' : 'ArrowFall16';
    const trendCls = trendUp ? 'tma-card__stat-trend--up' : 'tma-card__stat-trend--down';

    return `<article class="tma-card tma-card--stat" data-node-id="${esc(nodeId)}" style="background:${esc(bg)}">
      <div class="tma-card__stat-row tma-card__stat-row--top">
        <p class="tma-card__stat-label">${esc(label)}</p>
        <span class="tma-card__stat-icon" aria-hidden="true">${renderFileIcon(iconKey, 'tma-card__stat-icon-svg', 24, 24)}</span>
      </div>
      <div class="tma-card__stat-row tma-card__stat-row--bottom">
        <p class="tma-card__stat-value">${esc(value)}</p>
        <div class="tma-card__stat-trend ${trendCls}">
          <span class="tma-card__stat-trend-label">${esc(trend)}</span>
          <span class="tma-card__stat-trend-icon" aria-hidden="true">${renderFileIcon(trendIcon, 'tma-card__stat-trend-icon-svg', 16, 16)}</span>
        </div>
      </div>
    </article>`;
  }

  function renderTaskCard(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '33160:10081';
    const tag = o.tag || 'Technical Debt Reduction';
    const title = o.title || 'Meeting with customer';
    const description = o.description || '';
    const attachments = o.attachments != null ? o.attachments : 0;
    const comments = o.comments != null ? o.comments : 0;

    return `<article class="tma-card tma-card--task" data-node-id="${esc(nodeId)}">
      <span class="tma-card__task-tag">${esc(tag)}</span>
      <p class="tma-card__task-title">${esc(title)}</p>
      <p class="tma-card__task-description">${esc(description)}</p>
      <div class="tma-card__task-footer">
        ${renderMetaAvatars({ ...o, avatarSize: 24 })}
        <div class="tma-card__task-metrics">
          <span class="tma-card__task-metric">
            <span class="tma-card__task-metric-icon" aria-hidden="true">${svg('Paperclip16', 'tma-card__task-metric-icon-svg', 16, 16)}</span>
            <span class="tma-card__task-metric-label">${attachments}</span>
          </span>
          <span class="tma-card__task-metric">
            <span class="tma-card__task-metric-icon" aria-hidden="true">${svg('ChatText16', 'tma-card__task-metric-icon-svg', 16, 16)}</span>
            <span class="tma-card__task-metric-label">${comments}</span>
          </span>
        </div>
      </div>
    </article>`;
  }

  function renderPriceCard(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '33160:10093';
    const title = o.title || 'PRO version';
    const price = o.price || '$9.9';
    const features = o.features || DEFAULT_PRICE_FEATURES;
    const buttonLabel = o.buttonLabel || 'Choose Plan';

    const featuresHtml = features.map((feature) => `<li class="tma-card__price-feature">
        <span class="tma-card__price-check" aria-hidden="true">${svg('Check24', 'tma-card__price-check-svg', 24, 24)}</span>
        <span class="tma-card__price-feature-label">${esc(feature)}</span>
      </li>`).join('');

    return `<article class="tma-card tma-card--price" data-node-id="${esc(nodeId)}">
      <p class="tma-card__price-title">${esc(title)}</p>
      <div class="tma-card__price-amount-row">
        <p class="tma-card__price-amount">${esc(price)}</p>
        <p class="tma-card__price-period">/month</p>
      </div>
      <ul class="tma-card__price-features">${featuresHtml}</ul>
      <button type="button" class="tma-card__price-button">${esc(buttonLabel)}</button>
    </article>`;
  }

  function renderUsageCard(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '33160:10096';
    const title = o.title || 'Precise Usage';
    const description = o.description || '';
    const selected = !!o.selected;
    const showRadio = o.radio != null ? o.radio : true;
    const selectedCls = selected ? ' tma-card--usage-selected' : '';

    const radioHtml = showRadio
      ? `<span class="tma-card__usage-radio" aria-hidden="true">${svg(selected ? 'RadioAlt24' : 'Circle24', 'tma-card__usage-radio-svg', 24, 24)}</span>`
      : '';

    return `<button type="button" class="tma-card tma-card--usage${selectedCls}" data-node-id="${esc(nodeId)}">
      ${radioHtml}
      <span class="tma-card__usage-copy">
        <span class="tma-card__usage-title">${esc(title)}</span>
        <span class="tma-card__usage-description">${esc(description)}</span>
      </span>
    </button>`;
  }

  function renderCreditCardBrand(cardType) {
    const type = cardType || 'visa';
    if (type === 'paypal') {
      return `<img src="${esc(brandLogoSrc('PayPal'))}" alt="" class="tma-card__card-brand-img tma-card__card-brand-img--paypal" width="33" height="40" />`;
    }
    if (type === 'mastercard') return svg('Mastercard40', 'tma-card__card-brand-svg', 40, 24);
    return svg('Visa40', 'tma-card__visa-svg', 40, 14);
  }

  function renderCreditCardType(cardType) {
    return renderCreditCardBrand(cardType);
  }

  function renderCreditCard(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '32267:8050';
    const variant = o.variant || 'default';
    const name = o.name || 'ByeWind';
    const status = o.status || 'Active';
    const groups = o.groups || ['9656', '6598', '1236', '4698'];
    const expiry = o.expiry || 'Exp 06/25';
    const editLabel = o.editLabel || 'Edit';
    const cardType = o.cardType || 'visa';
    const hover = !!o.hover;
    const edit = o.edit != null ? o.edit : variant === 'default';
    const email = o.email || '';
    const showStatus = o.showStatus !== false && variant !== 'compact';

    const hoverCls = hover ? ' tma-card--credit-hover' : '';
    const variantCls = variant !== 'default' ? ` tma-card--credit-${esc(variant)}` : '';
    const tag = variant === 'button' ? 'button' : 'article';
    const typeAttr = variant === 'button' ? ' type="button"' : '';

    if (cardType === 'paypal') {
      return `<article class="tma-card tma-card--credit tma-card--credit-paypal${hoverCls}" data-node-id="${esc(nodeId)}">
        <div class="tma-card__credit-top tma-card__credit-top--solo">
          <p class="tma-card__credit-name">${esc(name)}</p>
        </div>
        <p class="tma-card__credit-email tma-card__credit-email--primary">${esc(email)}</p>
        <div class="tma-card__credit-footer tma-card__credit-footer--brand">
          <div class="tma-card__card-brand" aria-hidden="true">${renderCreditCardType('paypal')}</div>
        </div>
      </article>`;
    }

    if (variant === 'button') {
      return `<${tag}${typeAttr} class="tma-card tma-card--credit tma-card--credit-button${hoverCls}" data-node-id="${esc(nodeId)}">
        <div class="tma-card__credit-top">
          <p class="tma-card__credit-name">${esc(name)}</p>
        </div>
        ${email ? `<p class="tma-card__credit-email">${esc(email)}</p>` : ''}
        <div class="tma-card__credit-footer">
          <div class="tma-card__card-brand" aria-hidden="true">${renderCreditCardType(cardType)}</div>
        </div>
      </${tag}>`;
    }

    const numberHtml = groups.map((g) => `<span class="tma-card__number-group">${esc(g)}</span>`).join('');
    const editHtml = edit && variant === 'default'
      ? `<button type="button" class="tma-card__edit">${esc(editLabel)}</button>`
      : '';
    const statusHtml = showStatus ? renderStatusChip(status) : '';

    return `<${tag}${typeAttr} class="tma-card tma-card--credit${variantCls}${hoverCls}" data-node-id="${esc(nodeId)}">
      ${editHtml}
      <div class="tma-card__credit-top">
        <p class="tma-card__credit-name">${esc(name)}</p>
        ${statusHtml}
      </div>
      <div class="tma-card__number">${numberHtml}</div>
      <div class="tma-card__credit-footer">
        <p class="tma-card__expiry">${esc(expiry)}</p>
        <div class="tma-card__card-brand" aria-hidden="true">${renderCreditCardType(cardType)}</div>
      </div>
    </${tag}>`;
  }

  function renderAddressLines(o) {
    if (Array.isArray(o.lines) && o.lines.length) {
      return o.lines.map((line) => `<p class="tma-card__address-line">${esc(line)}</p>`).join('');
    }
    const raw = o.address || '';
    const lines = raw.split(/,\s*/).filter(Boolean);
    if (!lines.length) return `<p class="tma-card__address-line">${esc(raw)}</p>`;
    return lines.map((line) => `<p class="tma-card__address-line">${esc(line)}</p>`).join('');
  }

  function renderAddressCard(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '33160:10102';
    const label = o.label || 'Address';
    const status = o.status || 'Active';
    const active = !!o.active;
    const edit = !!o.edit;
    const hoverCls = o.hover !== false ? ' tma-card--address-hover' : '';

    const statusHtml = active ? renderStatusChip(status) : '';
    const editHtml = edit ? `<button type="button" class="tma-card__edit">${esc(o.editLabel || 'Edit')}</button>` : '';
    const activeCls = active ? ' tma-card--address-active' : '';
    const tag = o.static || edit ? 'div' : 'button';
    const typeAttr = tag === 'button' ? ' type="button"' : '';

    return `<${tag}${typeAttr} class="tma-card tma-card--address${activeCls}${hoverCls}" data-node-id="${esc(nodeId)}">
      ${editHtml}
      <div class="tma-card__address-top">
        <p class="tma-card__address-label">${esc(label)}</p>
        ${statusHtml}
      </div>
      <div class="tma-card__address-lines">${renderAddressLines(o)}</div>
    </${tag}>`;
  }

  function renderAddAddressCard(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '33160:10104';
    const label = o.label || 'Add Address';

    return `<button type="button" class="tma-card tma-card--add-address" data-node-id="${esc(nodeId)}">
      <span class="tma-card__add-address-icon" aria-hidden="true">${svg('Add16', 'tma-card__add-address-icon-svg', 16, 16)}</span>
      <span class="tma-card__add-address-label">${esc(label)}</span>
    </button>`;
  }

  function renderCodeBlock(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '33250:2266';
    const lang = o.lang || 'js';
    const lines = o.lines || CODE_BLOCK_LINES;

    const lineNums = Array.from({ length: 30 }, (_, i) => `<span class="tma-card__code-ln">${i + 1}</span>`).join('');
    const codeHtml = lines.map((line) => `<div class="tma-card__code-line">${line || ' '}</div>`).join('');

    return `<article class="tma-card tma-card--code-block" data-node-id="${esc(nodeId)}">
      <div class="tma-card__code-toolbar">
        <span class="tma-card__code-lang">${esc(lang)}</span>
        <div class="tma-card__code-actions">
          <button type="button" class="tma-card__code-action" aria-label="Copy">${svg('Copy16Duotone', 'tma-card__code-action-svg', 16, 16)}</button>
          <button type="button" class="tma-card__code-action" aria-label="Expand">${svg('ArrowsOutSimple16', 'tma-card__code-action-svg', 16, 16)}</button>
        </div>
      </div>
      <div class="tma-card__code-body">
        <div class="tma-card__code-gutter" aria-hidden="true">${lineNums}</div>
        <div class="tma-card__code-source">${codeHtml}</div>
      </div>
      <span class="tma-card__code-resize" aria-hidden="true">${svg('RoundedCorner16', 'tma-card__code-resize-svg', 16, 16)}</span>
    </article>`;
  }

  function renderDocumentationFooter(opts) {
    const o = typeof opts === 'function' ? { socialSvg: opts } : (opts || {});
    const ts = o.socialSvg || (() => '');
    const nodeId = o.nodeId || '32267:8051';
    const copyright = o.copyright || '© 2026 TM ANTOINE Advisory. All rights reserved.';

    return `<footer class="tma-card-doc__footer" data-node-id="${esc(nodeId)}">
      <div class="tma-card-doc__footer-brand">
        <div class="tma-card-doc__logo" aria-hidden="true">
          ${ts('TMALogoMark', 'tma-card-doc__logo-icon', 28, 28)}
          <span class="tma-card-doc__wordmark">
            ${ts('TMALogoWordmark', 'tma-card-doc__wordmark-left', 53, 12)}
            ${ts('TMALogoSuffix', 'tma-card-doc__wordmark-right', 15, 12)}
          </span>
        </div>
        <p class="tma-card-doc__copyright">${esc(copyright)}</p>
      </div>
      <div class="tma-card-doc__socials">
        <a class="tma-card-doc__social" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="Twitter">${ts('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-card-doc__social" href="https://www.instagram.com/farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${ts('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-card-doc__social" href="https://www.threads.net/@farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Threads">${ts('ThreadsLogo', '', 28, 28)}</a>
        <a class="tma-card-doc__social" href="https://dribbble.com/byewind" target="_blank" rel="noopener noreferrer" aria-label="Dribbble">${ts('DribbbleSocial', '', 28, 28)}</a>
        <a class="tma-card-doc__social" href="https://www.behance.net/ByeWind" target="_blank" rel="noopener noreferrer" aria-label="Behance">${ts('BehanceSocial', '', 28, 28)}</a>
        <a class="tma-card-doc__social" href="https://www.figma.com/@byewind" target="_blank" rel="noopener noreferrer" aria-label="Figma">${ts('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-card-doc__social" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${ts('TMALogoMark', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function mountDocumentation(opts) {
    const o = opts || {};
    const footerEl = o.footerEl;
    const socialSvg = o.socialSvg;
    if (footerEl) {
      footerEl.innerHTML = renderDocumentationFooter({
        socialSvg,
        nodeId: o.nodeId,
        copyright: o.copyright,
      });
    }
  }

  window.TMACard = {
    brandLogoSrc,
    renderChip,
    renderStatusChip,
    renderStrip,
    renderProgressCard,
    renderStatCard,
    renderTaskCard,
    renderPriceCard,
    renderUsageCard,
    renderCreditCard,
    renderAddressCard,
    renderAddAddressCard,
    renderCodeBlock,
    renderDocumentationFooter,
    mountDocumentation,
  };
})();
