/* TMA - Input component */
(function () {
  'use strict';

  const svg = (key, cls, w, h) => (window.TMAInputIcons && window.TMAInputIcons.svg(key, cls, w, h)) || '';

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stateCls(state) {
    return state === 'active' ? ' tma-input--active' : '';
  }

  function isInteractive(o) {
    return o.interactive !== false;
  }

  function attrValue(value) {
    return value != null && value !== '' ? ` value="${esc(value)}"` : '';
  }

  function attrPlaceholder(placeholder) {
    return placeholder ? ` placeholder="${esc(placeholder)}"` : '';
  }

  function renderTextControl(opts) {
    const o = opts || {};
    const sizeCls = o.size === 'lg' ? 'tma-input__control--lg' : 'tma-input__control--md';
    const extra = o.className ? ` ${o.className}` : '';
    const disabled = o.disabled ? ' disabled' : '';
    const name = o.name ? ` name="${esc(o.name)}"` : '';
    const dataField = o.dataField ? ` data-field="${esc(o.dataField)}"` : '';
    const type = o.type || 'text';
    const readOnly = o.readOnly ? ' readonly' : '';
    return `<input type="${type}" class="tma-input__control ${sizeCls}${extra}"${name}${dataField}${attrValue(o.value)}${attrPlaceholder(o.placeholder)}${disabled}${readOnly}>`;
  }

  function renderTextareaControl(opts) {
    const o = opts || {};
    const disabled = o.disabled ? ' disabled' : '';
    const name = o.name ? ` name="${esc(o.name)}"` : '';
    const max = o.max ? ` maxlength="${o.max}"` : '';
    const body = o.value != null ? esc(o.value) : '';
    return `<textarea class="tma-input__control tma-input__control--textarea"${name}${attrPlaceholder(o.placeholder)}${disabled}${max}>${body}</textarea>`;
  }

  function renderSelectControl(opts) {
    const o = opts || {};
    const options = o.options || [];
    const disabled = o.disabled ? ' disabled' : '';
    const name = o.name ? ` name="${esc(o.name)}"` : '';
    const extra = o.className ? ` ${o.className}` : '';
    const optsHtml = options.map((item) => {
      const selected = item.selected || item.value === o.value ? ' selected' : '';
      const dis = item.disabled ? ' disabled' : '';
      return `<option value="${esc(item.value)}"${selected}${dis}>${esc(item.label)}</option>`;
    }).join('');
    return `<select class="tma-input__control tma-input__control--select${extra}"${name}${disabled}>${optsHtml}</select>`;
  }

  function renderResize(size) {
    const key = size === 16 ? 'RoundedCorner16' : 'RoundedCorner20';
    return `<span class="tma-input__resize" aria-hidden="true">${svg(key, 'tma-input__resize-svg', size, size)}</span>`;
  }

  function renderContent1Row(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '32728:395059';
    const state = o.state || 'default';
    const placeholder = o.placeholder || 'Input fields';
    const value = o.value != null ? o.value : (state === 'active' ? placeholder : '');

    if (isInteractive(o)) {
      return `<div class="tma-input tma-input--1row${stateCls(state)}" data-node-id="${esc(nodeId)}">
        ${renderTextControl({ size: 'lg', placeholder, value: value || undefined })}
      </div>`;
    }

    const tag = o.tag === 'div' ? 'div' : 'button';
    const typeAttr = tag === 'button' ? ' type="button"' : '';

    return `<${tag}${typeAttr} class="tma-input tma-input--1row${stateCls(state)}" data-node-id="${esc(nodeId)}">
      <span class="tma-input__placeholder tma-input__placeholder--lg">${esc(placeholder)}</span>
    </${tag}>`;
  }

  function renderTitle2RowVertical(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '32728:395058';
    const state = o.state || 'default';
    const title = o.title || 'Title';
    const value = o.value != null ? o.value : (state === 'active' ? title : '');

    if (isInteractive(o)) {
      return `<div class="tma-input tma-input--title-vertical${stateCls(state)}" data-node-id="${esc(nodeId)}">
        ${renderTextControl({ size: 'lg', placeholder: title, value: value || undefined })}
      </div>`;
    }

    const tag = o.tag === 'div' ? 'div' : 'button';
    const typeAttr = tag === 'button' ? ' type="button"' : '';

    return `<${tag}${typeAttr} class="tma-input tma-input--title-vertical${stateCls(state)}" data-node-id="${esc(nodeId)}">
      <span class="tma-input__placeholder tma-input__placeholder--lg">${esc(title)}</span>
    </${tag}>`;
  }

  function renderTextarea(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '32728:395054';
    const state = o.state || 'default';
    const text = o.text;
    const placeholder = o.placeholder || 'Textarea';
    const counter = o.counter;
    const isActive = state === 'active';
    const heightCls = counter ? ' tma-input--textarea-counter' : ' tma-input--textarea';

    if (isInteractive(o)) {
      const counterHtml = counter
        ? `<div class="tma-input__textarea-footer"><span class="tma-input__counter" data-max="200">${esc(counter)}</span>${renderResize(16)}</div>`
        : renderResize(20);
      return `<div class="tma-input tma-input--textarea-wrap${heightCls}${stateCls(state)}" data-node-id="${esc(nodeId)}">
        ${renderTextareaControl({ placeholder, value: isActive && text != null ? text : undefined, max: counter ? 200 : undefined })}
        ${counterHtml}
      </div>`;
    }

    const textHtml = isActive && text != null
      ? `<span class="tma-input__value">${esc(text)}</span>`
      : `<span class="tma-input__placeholder tma-input__placeholder--md">${esc(placeholder)}</span>`;

    const footerHtml = counter
      ? `<div class="tma-input__textarea-footer">
          <span class="tma-input__counter">${esc(counter)}</span>
          ${renderResize(16)}
        </div>`
      : renderResize(20);

    return `<div class="tma-input tma-input--textarea-wrap${heightCls}${stateCls(state)}" data-node-id="${esc(nodeId)}">
      ${textHtml}
      ${footerHtml}
    </div>`;
  }

  function renderTitleInputVertical(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '32728:395057';
    const state = o.state || 'default';
    const title = o.title || 'Title';
    const placeholder = o.placeholder || 'Input fields';
    const value = o.value != null ? o.value : (state === 'active' ? placeholder : '');

    if (isInteractive(o)) {
      return `<div class="tma-input tma-input--title-input${stateCls(state)}" data-node-id="${esc(nodeId)}">
        <span class="tma-input__label">${esc(title)}</span>
        ${renderTextControl({ size: 'md', placeholder, value: value || undefined })}
      </div>`;
    }

    const tag = o.tag === 'div' ? 'div' : 'button';
    const typeAttr = tag === 'button' ? ' type="button"' : '';

    return `<${tag}${typeAttr} class="tma-input tma-input--title-input${stateCls(state)}" data-node-id="${esc(nodeId)}">
      <span class="tma-input__label">${esc(title)}</span>
      <span class="tma-input__placeholder tma-input__placeholder--md">${esc(placeholder)}</span>
    </${tag}>`;
  }

  function renderSelect(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '32728:395056';
    const state = o.state || 'default';
    const placeholder = o.placeholder || 'Select';
    const value = o.value || (state === 'active' ? 'selected' : '');

    if (isInteractive(o)) {
      const options = o.options || [
        { value: '', label: placeholder, disabled: true, selected: !value },
        { value: 'selected', label: 'Selected', selected: !!value },
        { value: 'option-2', label: 'Option 2' },
        { value: 'option-3', label: 'Option 3' },
      ];
      return `<div class="tma-input tma-input--select${stateCls(state)}" data-node-id="${esc(nodeId)}">
        <span class="tma-input__select-row">
          ${renderSelectControl({ value, options })}
          <span class="tma-input__select-icon" aria-hidden="true">${svg('ArrowLineUpDown16', 'tma-input__select-icon-svg', 16, 16)}</span>
        </span>
      </div>`;
    }

    const tag = o.tag === 'div' ? 'div' : 'button';
    const typeAttr = tag === 'button' ? ' type="button"' : '';

    return `<${tag}${typeAttr} class="tma-input tma-input--select${stateCls(state)}" data-node-id="${esc(nodeId)}">
      <span class="tma-input__select-row">
        <span class="tma-input__placeholder tma-input__placeholder--lg">${esc(placeholder)}</span>
        <span class="tma-input__select-icon" aria-hidden="true">${svg('ArrowLineUpDown16', 'tma-input__select-icon-svg', 16, 16)}</span>
      </span>
    </${tag}>`;
  }

  function renderCommandInput(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '32728:395062';
    const placeholder = o.placeholder || "Ask a question or request, or type '/' for suggestions";

    if (isInteractive(o)) {
      return `<div class="tma-input tma-input--command" data-node-id="${esc(nodeId)}">
        <textarea class="tma-input__command-control" rows="1" placeholder="${esc(placeholder)}"></textarea>
        <div class="tma-input__command-toolbar">
          <div class="tma-input__command-actions">
            <button type="button" class="tma-input__command-btn" aria-label="AI suggestions">${svg('Stars16', 'tma-input__command-btn-svg', 16, 16)}</button>
            <button type="button" class="tma-input__command-btn" aria-label="Attach file">${svg('Paperclip16', 'tma-input__command-btn-svg', 16, 16)}</button>
          </div>
          <button type="button" class="tma-input__command-send" aria-label="Send">${svg('PaperPlaneRight20', 'tma-input__command-send-svg', 20, 20)}</button>
        </div>
      </div>`;
    }

    return `<div class="tma-input tma-input--command" data-node-id="${esc(nodeId)}">
      <p class="tma-input__command-placeholder">${esc(placeholder)}</p>
      <div class="tma-input__command-toolbar">
        <div class="tma-input__command-actions">
          <button type="button" class="tma-input__command-btn" aria-label="AI suggestions">${svg('Stars16', 'tma-input__command-btn-svg', 16, 16)}</button>
          <button type="button" class="tma-input__command-btn" aria-label="Attach file">${svg('Paperclip16', 'tma-input__command-btn-svg', 16, 16)}</button>
        </div>
        <button type="button" class="tma-input__command-send" aria-label="Send">${svg('PaperPlaneRight20', 'tma-input__command-send-svg', 20, 20)}</button>
      </div>
    </div>`;
  }

  function renderTagInput(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '32728:395063';
    const title = o.title || 'Title';
    const tags = o.tags || ['List Item', 'Tag'];

    const tagsHtml = tags.map((label) => `<span class="tma-input__tag">
        <span class="tma-input__tag-label">${esc(label)}</span>
        <button type="button" class="tma-input__tag-close" aria-label="Remove ${esc(label)}">${svg('Close12', 'tma-input__tag-close-svg', 12, 12)}</button>
      </span>`).join('');

    const entryHtml = isInteractive(o)
      ? '<input type="text" class="tma-input__tag-entry" placeholder="" aria-label="Add tag">'
      : '';

    return `<div class="tma-input tma-input--tags" data-node-id="${esc(nodeId)}">
      <span class="tma-input__label">${esc(title)}</span>
      <div class="tma-input__tag-row">${tagsHtml}${entryHtml}</div>
    </div>`;
  }

  function place(left, top, html, nodeId, w, h) {
    let style = `left:${left}px;top:${top}px`;
    if (w != null) style += `;width:${w}px`;
    if (h != null) style += `;height:${h}px`;
    return `<div class="tma-input-doc__grid-item" style="${style}" data-node-id="${esc(nodeId)}">${html}</div>`;
  }

  function renderExamplesGrid() {
    return `<div class="tma-input-doc__grid" data-node-id="32728:395047">
      ${place(0, 0, renderContent1Row({ nodeId: '32728:395059', state: 'default' }), '32728:395059', 200, 56)}
      ${place(210, 0, renderContent1Row({ nodeId: '32728:395053', state: 'active' }), '32728:395053', 200, 56)}
      ${place(0, 66, renderTitle2RowVertical({ nodeId: '32728:395058', state: 'default' }), '32728:395058', 200, 74)}
      ${place(210, 66, renderTitle2RowVertical({ nodeId: '32728:395052', state: 'active' }), '32728:395052', 200, 74)}
      ${place(0, 150, renderTextarea({ nodeId: '32728:395054', state: 'default' }), '32728:395054', 200, 44)}
      ${place(210, 150, renderTextarea({ nodeId: '32728:395048', state: 'active', text: 'Text' }), '32728:395048', 200, 44)}
      ${place(0, 216, renderTextarea({ nodeId: '32728:395055', state: 'default', counter: '0/200' }), '32728:395055', 200, 60)}
      ${place(210, 216, renderTextarea({ nodeId: '32728:395049', state: 'active', text: 'Text', counter: '0/200' }), '32728:395049', 200, 60)}
      ${place(0, 286, renderTitleInputVertical({ nodeId: '32728:395057', state: 'default' }), '32728:395057', 200, 84)}
      ${place(210, 286, renderTitleInputVertical({ nodeId: '32728:395051', state: 'active' }), '32728:395051', 200, 84)}
      ${place(0, 380, renderSelect({ nodeId: '32728:395056', state: 'default' }), '32728:395056', 200, 56)}
      ${place(210, 380, renderSelect({ nodeId: '32728:395050', state: 'active' }), '32728:395050', 200, 56)}
    </div>`;
  }

  function renderDocumentationFooter(socialSvg) {
    const ts = socialSvg || (() => '');
    return `<footer class="tma-input-doc__footer" data-node-id="32728:395064">
      <div class="tma-input-doc__footer-brand">
        <div class="tma-input-doc__logo" aria-hidden="true">
          ${ts('TMALogoMark', 'tma-input-doc__logo-icon', 28, 28)}
          <span class="tma-input-doc__wordmark">
            ${ts('TMALogoWordmark', 'tma-input-doc__wordmark-left', 53, 12)}
            ${ts('TMALogoSuffix', 'tma-input-doc__wordmark-right', 15, 12)}
          </span>
        </div>
        <p class="tma-input-doc__copyright">© 2026 TM ANTOINE Advisory. All rights reserved.</p>
      </div>
      <div class="tma-input-doc__socials">
        <a class="tma-input-doc__social" href="https://twitter.com/FarewelltoWind" target="_blank" rel="noopener noreferrer" aria-label="Twitter">${ts('TwitterSocial', '', 28, 28)}</a>
        <a class="tma-input-doc__social" href="https://www.instagram.com/farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${ts('InstagramSocial', '', 28, 28)}</a>
        <a class="tma-input-doc__social" href="https://www.threads.net/@farewelltowind" target="_blank" rel="noopener noreferrer" aria-label="Threads">${ts('ThreadsLogo', '', 28, 28)}</a>
        <a class="tma-input-doc__social" href="https://dribbble.com/byewind" target="_blank" rel="noopener noreferrer" aria-label="Dribbble">${ts('DribbbleSocial', '', 28, 28)}</a>
        <a class="tma-input-doc__social" href="https://www.behance.net/ByeWind" target="_blank" rel="noopener noreferrer" aria-label="Behance">${ts('BehanceSocial', '', 28, 28)}</a>
        <a class="tma-input-doc__social" href="https://www.figma.com/@byewind" target="_blank" rel="noopener noreferrer" aria-label="Figma">${ts('FigmaSocial', '', 28, 28)}</a>
        <a class="tma-input-doc__social" href="#" target="_blank" rel="noopener noreferrer" aria-label="Website">${ts('TMALogoMark', '', 28, 28)}</a>
      </div>
    </footer>`;
  }

  function mountDocumentation(opts) {
    const o = opts || {};
    const gridEl = o.gridEl;
    const commandEl = o.commandEl;
    const tagsEl = o.tagsEl;
    const footerEl = o.footerEl;
    const socialSvg = o.socialSvg;

    if (gridEl) gridEl.innerHTML = renderExamplesGrid();
    if (commandEl) commandEl.innerHTML = renderCommandInput({ nodeId: '32728:395062' });
    if (tagsEl) tagsEl.innerHTML = renderTagInput({ nodeId: '32728:395063' });
    if (footerEl && socialSvg) footerEl.innerHTML = renderDocumentationFooter(socialSvg);
    if (typeof window.TMAInput.mountInteractive === 'function') {
      window.TMAInput.mountInteractive(document);
    }
  }

  function guidanceStateCls(state) {
    return state ? ` tma-input--state-${state}` : '';
  }

  function renderGuidanceTrailing(state) {
    if (state === 'focus') {
      return `<span class="tma-input__guidance-trailing">${svg('XCircle16', 'tma-input__guidance-icon', 16, 16)}</span>`;
    }
    if (state === 'progress') {
      return `<span class="tma-input__guidance-trailing">${svg('Loading16', 'tma-input__guidance-spinner', 16, 16)}</span>`;
    }
    if (state === 'done') {
      return `<span class="tma-input__guidance-trailing tma-input__guidance-trailing--done">${svg('Check20', 'tma-input__guidance-icon', 20, 20)}</span>`;
    }
    if (state === 'error') {
      return `<span class="tma-input__guidance-trailing">${svg('Warning20', 'tma-input__guidance-icon', 20, 20)}</span>`;
    }
    return '';
  }

  function renderGuidanceRow(inner, state) {
    const trailing = renderGuidanceTrailing(state);
    if (!trailing) return inner;
    return `<span class="tma-input__guidance-row">${inner}${trailing}</span>`;
  }

  function renderGuidanceSearch(opts) {
    const o = opts || {};
    const state = o.state || 'default';
    const variant = o.variant || 'filled';
    const wide = o.wide || ['focus', 'progress', 'done', 'error'].includes(state);
    const stateCls = guidanceStateCls(state);
    const variantCls = variant === 'outline' ? ' tma-cs-search--outline' : ' tma-cs-search--filled';
    const typing = ['focus', 'progress', 'done', 'error'].includes(state);
    const text = typing ? 'Typing|' : 'Search';
    const textCls = typing ? 'tma-cs-search__value' : 'tma-cs-search__placeholder';
    const tag = state === 'hover' ? 'button' : 'div';
    const typeAttr = tag === 'button' ? ' type="button"' : '';

    let trailing = '';
    if (state === 'focus') {
      trailing = `<span class="tma-cs-search__trailing tma-cs-search__trailing--muted">${svg('XCircle16', 'tma-cs-search__icon', 16, 16)}</span>`;
    } else if (state === 'progress') {
      trailing = `<span class="tma-cs-search__trailing">${svg('Loading16', 'tma-cs-search__spinner', 20, 20)}</span>`;
    } else if (state === 'done') {
      trailing = `<span class="tma-cs-search__trailing tma-cs-search__trailing--done">${svg('CheckCircle20', 'tma-cs-search__icon', 20, 20)}</span>`;
    }

    const kbd = !typing && state !== 'progress' && state !== 'done' && state !== 'error'
      ? '<span class="tma-cs-search__kbd">/</span>'
      : '';

    const widthStyle = wide ? ' tma-cs-search--wide' : '';

    return `<${tag}${typeAttr} class="tma-cs-search${variantCls}${stateCls}${widthStyle}">
      <span class="tma-cs-search__icon-wrap">${svg('Search16', 'tma-cs-search__search-icon', 16, 16)}</span>
      <span class="${textCls}">${esc(text)}</span>
      ${trailing}
      ${kbd}
    </${tag}>`;
  }

  function renderGuidanceField(opts) {
    const o = opts || {};
    const variant = o.variant || '1row';
    const state = o.state || 'default';
    const nodeId = o.nodeId || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const variantCls = ` tma-input--guidance-${variant}`;
    const stateCls = guidanceStateCls(state);
    const tag = variant === 'select' || state === 'hover' ? 'button' : 'div';
    const typeAttr = tag === 'button' ? ' type="button"' : '';
    let inner = '';

    if (variant === '1row') {
      const placeholder = state === 'disabled' ? 'Text' : 'Input fields';
      const value = ['focus', 'progress', 'done', 'error'].includes(state) ? placeholder : '';
      inner = value
        ? `<span class="tma-input__value tma-input__value--lg">${esc(value)}</span>`
        : `<span class="tma-input__placeholder tma-input__placeholder--lg">${esc(placeholder)}</span>`;
      inner = renderGuidanceRow(inner, state);
    } else if (variant === 'title-vertical') {
      if (state === 'focus' || state === 'progress' || state === 'done' || state === 'error') {
        inner = renderGuidanceRow(
          `<span class="tma-input__guidance-stack"><span class="tma-input__label tma-input__label--focus">Title</span><span class="tma-input__value tma-input__value--lg">Text 2</span></span>`,
          state,
        );
      } else {
        inner = `<span class="tma-input__placeholder tma-input__placeholder--lg">Title</span>`;
      }
    } else if (variant === 'textarea') {
      const isValue = ['focus', 'progress', 'done', 'error', 'hover'].includes(state);
      const text = isValue ? 'Text' : 'Textarea';
      const textCls = isValue ? 'tma-input__value' : 'tma-input__placeholder tma-input__placeholder--md';
      inner = renderGuidanceRow(`<span class="${textCls}">${esc(text)}</span>`, state);
      inner += renderResize(20);
    } else if (variant === 'textarea-counter') {
      const isValue = ['focus', 'progress', 'done', 'error', 'hover'].includes(state);
      const text = isValue ? 'Textarea' : 'Textarea';
      const textCls = isValue && state !== 'default' ? 'tma-input__value' : 'tma-input__placeholder tma-input__placeholder--md';
      inner = renderGuidanceRow(`<span class="${textCls}">${esc(text)}</span>`, state);
      inner += `<div class="tma-input__textarea-footer"><span class="tma-input__counter">0/200</span>${renderResize(16)}</div>`;
    } else if (variant === 'title-input') {
      if (state === 'focus' || state === 'progress' || state === 'done' || state === 'error') {
        inner = renderGuidanceRow(
          `<span class="tma-input__guidance-stack"><span class="tma-input__label tma-input__label--focus">Title</span><span class="tma-input__value">Input fields</span></span>`,
          state,
        );
      } else {
        inner = `<span class="tma-input__label">Title</span><span class="tma-input__placeholder tma-input__placeholder--md">Input fields</span>`;
      }
    } else if (variant === 'select') {
      const placeholder = state === 'disabled' ? 'Select' : (['focus', 'progress', 'done', 'error'].includes(state) ? 'Selected' : 'Select');
      const cls = ['focus', 'progress', 'done', 'error'].includes(state)
        ? 'tma-input__value tma-input__value--lg'
        : 'tma-input__placeholder tma-input__placeholder--lg';
      inner = `<span class="tma-input__select-row">${renderGuidanceRow(`<span class="${cls}">${esc(placeholder)}</span>`, state)}<span class="tma-input__select-icon" aria-hidden="true">${svg('ArrowLineUpDown16', 'tma-input__select-icon-svg', 16, 16)}</span></span>`;
    }

    const field = `<${tag}${typeAttr} class="tma-input tma-input--guidance${variantCls}${stateCls}"${nodeAttr}>${inner}</${tag}>`;
    if (state === 'error') {
      return `<div class="tma-input-guidance-field-wrap">${field}${renderErrorMessage()}</div>`;
    }
    return field;
  }

  function renderAppleButton() {
    return `<button type="button" class="tma-forms-guidance-page__apple-btn">
      <span class="tma-forms-guidance-page__apple-icon" aria-hidden="true">${svg('Apple24', '', 24, 24)}</span>
      <span class="tma-forms-guidance-page__apple-label">Sign in with Apple</span>
    </button>`;
  }

  function renderFormButtonGroup(variant) {
    const loading = variant === 'loading';
    const primary = loading
      ? `<button type="button" class="tma-forms-guidance-page__form-btn tma-forms-guidance-page__form-btn--loading" aria-label="Saving">${svg('Loading16', 'tma-forms-guidance-page__form-btn-spinner', 16, 16)}</button>`
      : '<button type="button" class="tma-forms-guidance-page__form-btn tma-forms-guidance-page__form-btn--primary">Save Changes</button>';
    return `<div class="tma-forms-guidance-page__form-bar">
      <button type="button" class="tma-forms-guidance-page__form-btn tma-forms-guidance-page__form-btn--secondary">Cancel</button>
      ${primary}
    </div>`;
  }

  function renderSavedToast() {
    return `<div class="tma-forms-guidance-page__saved-toast" role="status">
      <span class="tma-forms-guidance-page__saved-toast-icon" aria-hidden="true">${svg('CheckCircle20', '', 20, 20)}</span>
      <span class="tma-forms-guidance-page__saved-toast-text">Saved</span>
    </div>`;
  }

  function renderSelectDropdown() {
    const items = ['Text', 'Text', 'Text'].map((label) =>
      `<div class="tma-forms-guidance-page__select-item">${esc(label)}</div>`,
    ).join('');
    return `<div class="tma-forms-guidance-page__select-menu">${items}</div>`;
  }

  function renderRadio(opts) {
    const o = opts || {};
    const selected = o.selected !== false;
    const state = o.state || 'default';
    const disabled = state === 'disabled';
    const hover = state === 'hover';
    let iconKey = 'Radio32';
    if (selected) iconKey = hover ? 'Radio32Selected' : 'Radio32Selected';
    else if (hover) iconKey = 'Radio32Hover';
    const cls = [
      'tma-forms-guidance-page__control',
      selected ? 'tma-forms-guidance-page__control--selected' : '',
      disabled ? 'tma-forms-guidance-page__control--disabled' : '',
      hover ? 'tma-forms-guidance-page__control--hover' : '',
    ].filter(Boolean).join(' ');
    const tag = disabled ? 'div' : 'button';
    const typeAttr = tag === 'button' ? ' type="button"' : '';
    const disabledAttr = disabled ? ' aria-disabled="true"' : '';
    return `<${tag}${typeAttr} class="${cls}"${disabledAttr} data-control="radio" aria-pressed="${selected ? 'true' : 'false'}">${svg(iconKey, 'tma-forms-guidance-page__control-svg', 32, 32)}</${tag}>`;
  }

  function renderCheckbox(opts) {
    const o = opts || {};
    const checked = o.checked || 'unchecked';
    const state = o.state || 'default';
    const disabled = state === 'disabled';
    const hover = state === 'hover';
    let iconKey = 'Checkbox32';
    if (checked === 'checked') iconKey = 'Checkbox32Checked';
    else if (checked === 'indeterminate') iconKey = 'Checkbox32Indeterminate';
    else if (hover) iconKey = 'Checkbox32Hover';
    const cls = [
      'tma-forms-guidance-page__control',
      disabled ? 'tma-forms-guidance-page__control--disabled' : '',
      hover ? 'tma-forms-guidance-page__control--hover' : '',
    ].filter(Boolean).join(' ');
    const tag = disabled ? 'div' : 'button';
    const typeAttr = tag === 'button' ? ' type="button"' : '';
    const disabledAttr = disabled ? ' aria-disabled="true"' : '';
    return `<${tag}${typeAttr} class="${cls}"${disabledAttr} data-control="checkbox" aria-checked="${checked === 'indeterminate' ? 'mixed' : (checked === 'checked' ? 'true' : 'false')}">${svg(iconKey, 'tma-forms-guidance-page__control-svg', 32, 32)}</${tag}>`;
  }

  function renderSwitch(opts) {
    const o = opts || {};
    const on = o.on !== false;
    const state = o.state || 'default';
    const disabled = state === 'disabled';
    const hover = state === 'hover';
    let iconKey = on ? 'Switch32On' : 'Switch32Off';
    if (hover) iconKey = on ? 'Switch32OnHover' : 'Switch32OffHover';
    const cls = [
      'tma-forms-guidance-page__control',
      disabled ? 'tma-forms-guidance-page__control--disabled' : '',
      hover ? 'tma-forms-guidance-page__control--hover' : '',
    ].filter(Boolean).join(' ');
    const tag = disabled ? 'div' : 'button';
    const typeAttr = tag === 'button' ? ' type="button"' : '';
    const disabledAttr = disabled ? ' aria-disabled="true"' : '';
    return `<${tag}${typeAttr} class="${cls}"${disabledAttr} data-control="switch" aria-pressed="${on ? 'true' : 'false'}">${svg(iconKey, 'tma-forms-guidance-page__control-svg', 32, 32)}</${tag}>`;
  }

  function renderErrorMessage() {
    return '<p class="tma-input-guidance-field-wrap__error">Error messages.</p>';
  }

  function renderFormPlaceholder1Row(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const placeholder = o.placeholder || 'Input fields';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const hasValue = o.value != null && o.value !== '';
    const activeCls = hasValue ? ' tma-input--active tma-input--has-value' : '';
    return `<div class="tma-input tma-input--form-1row${activeCls}"${nodeAttr}>
      ${renderTextControl({
        size: 'md',
        placeholder,
        value: o.value,
        name: o.name,
        dataField: o.dataField,
        type: o.type,
      })}
    </div>`;
  }

  function renderFormTitleValue(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const title = o.title || 'Title';
    const glassCls = o.glass ? ' tma-input--glass' : '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const hasValue = o.value != null && o.value !== '';
    const activeCls = hasValue ? ' tma-input--active tma-input--has-value' : '';
    return `<div class="tma-input tma-input--form-field${glassCls}${activeCls}"${nodeAttr}>
      <span class="tma-input__label">${esc(title)}</span>
      ${renderTextControl({
        size: 'md',
        placeholder: o.placeholder,
        value: o.value,
        name: o.name,
        dataField: o.dataField,
        type: o.type,
      })}
    </div>`;
  }

  function renderFormDateField(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const title = o.title || 'Date';
    const glassCls = o.glass ? ' tma-input--glass' : '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const hasValue = o.value != null && o.value !== '';
    const activeCls = hasValue || o.valueBlack ? ' tma-input--active tma-input--has-value' : '';
    return `<div class="tma-input tma-input--form-field${glassCls}${activeCls}"${nodeAttr}>
      <span class="tma-input__label">${esc(title)}</span>
      <span class="tma-input__form-row">
        <span class="tma-input__icon-text">
          <span class="tma-input__form-icon" aria-hidden="true">${svg('CalendarBlank20', 'tma-input__form-icon-svg', 20, 20)}</span>
          ${renderTextControl({
            size: 'md',
            placeholder: o.placeholder,
            value: o.value,
            name: o.name,
            dataField: o.dataField,
            className: 'tma-input__control--grow',
            readOnly: o.readOnly,
          })}
        </span>
        <span class="tma-input__select-icon" aria-hidden="true">${svg('ArrowLineUpDown16', 'tma-input__select-icon-svg', 16, 16)}</span>
      </span>
    </div>`;
  }

  function renderFormSelectValue(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const title = o.title || 'Select';
    const value = o.value || '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const options = o.options || [
      { value, label: value, selected: true },
      { value: 'option-2', label: 'Option 2' },
      { value: 'option-3', label: 'Option 3' },
    ];
    return `<div class="tma-input tma-input--form-field tma-input--active tma-input--has-value"${nodeAttr}>
      <span class="tma-input__label">${esc(title)}</span>
      <span class="tma-input__form-row">
        ${renderSelectControl({ value, options, className: 'tma-input__control--grow' })}
        <span class="tma-input__select-icon" aria-hidden="true">${svg('ArrowLineUpDown16', 'tma-input__select-icon-svg', 16, 16)}</span>
      </span>
    </div>`;
  }

  function renderFormCheckboxGroup(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const title = o.title || 'Options';
    const items = o.items || [];
    const glassCls = o.glass ? ' tma-input--glass' : '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const itemsHtml = items.map((item) => {
      const iconKey = item.checked ? 'Checkbox20Checked' : 'Checkbox20Unchecked';
      return `<span class="tma-input__form-check-item">
        <button type="button" class="tma-input__form-check" aria-pressed="${item.checked ? 'true' : 'false'}">${svg(iconKey, 'tma-input__form-check-svg', 20, 20)}</button>
        <span class="tma-input__value">${esc(item.label)}</span>
      </span>`;
    }).join('');
    return `<div class="tma-input tma-input--form-field${glassCls}"${nodeAttr}>
      <span class="tma-input__label">${esc(title)}</span>
      <span class="tma-input__form-check-row">${itemsHtml}</span>
    </div>`;
  }

  function renderFormSwitchField(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const title = o.title || 'Status';
    const text = o.text || '';
    const on = o.on !== false;
    const glassCls = o.glass ? ' tma-input--glass' : '';
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const iconKey = on ? 'Switch28On' : 'Switch28Off';
    return `<div class="tma-input tma-input--form-field${glassCls}"${nodeAttr}>
      <span class="tma-input__label">${esc(title)}</span>
      <span class="tma-input__form-row">
        <button type="button" class="tma-input__form-switch" aria-pressed="${on ? 'true' : 'false'}">${svg(iconKey, 'tma-input__form-switch-svg', 28, 28)}</button>
        <span class="tma-input__label tma-input__label--inline">${esc(text)}</span>
      </span>
    </div>`;
  }

  function renderFormCommandInput(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '32728:395276';
    const placeholder = o.placeholder || "Ask a question or request, or type '/' for suggestions";
    return `<div class="tma-input tma-input--command tma-input--form-wide" data-node-id="${esc(nodeId)}">
      <textarea class="tma-input__command-control" rows="2" placeholder="${esc(placeholder)}"></textarea>
      <div class="tma-input__command-toolbar">
        <div class="tma-input__command-actions">
          <button type="button" class="tma-input__command-btn" aria-label="AI suggestions">${svg('Stars16', 'tma-input__command-btn-svg', 16, 16)}</button>
          <button type="button" class="tma-input__command-btn" aria-label="Attach file">${svg('Paperclip16', 'tma-input__command-btn-svg', 16, 16)}</button>
        </div>
        <button type="button" class="tma-input__command-send" aria-label="Send">${svg('PaperPlaneRight20', 'tma-input__command-send-svg', 20, 20)}</button>
      </div>
    </div>`;
  }

  function renderFormTagInput(opts) {
    const o = opts || {};
    const nodeId = o.nodeId || '';
    const title = o.title || 'Title';
    const tags = o.tags || ['List Item', 'Tag'];
    const nodeAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : '';
    const tagsHtml = tags.map((label) => `<span class="tma-input__tag">
        <span class="tma-input__tag-label">${esc(label)}</span>
        <button type="button" class="tma-input__tag-close" aria-label="Remove ${esc(label)}">${svg('Close12', 'tma-input__tag-close-svg', 12, 12)}</button>
      </span>`).join('');
    return `<div class="tma-input tma-input--tags tma-input--form-wide tma-input--has-value"${nodeAttr}>
      <span class="tma-input__label">${esc(title)}</span>
      <div class="tma-input__tag-row">${tagsHtml}<input type="text" class="tma-input__tag-entry" aria-label="Add tag"></div>
    </div>`;
  }

  window.TMAInput = {
    renderContent1Row,
    renderTitle2RowVertical,
    renderTextarea,
    renderTitleInputVertical,
    renderSelect,
    renderCommandInput,
    renderTagInput,
    renderExamplesGrid,
    renderDocumentationFooter,
    mountDocumentation,
    renderGuidanceSearch,
    renderGuidanceField,
    renderAppleButton,
    renderFormButtonGroup,
    renderSavedToast,
    renderSelectDropdown,
    renderRadio,
    renderCheckbox,
    renderSwitch,
    renderErrorMessage,
    renderFormPlaceholder1Row,
    renderFormTitleValue,
    renderFormDateField,
    renderFormSelectValue,
    renderFormCheckboxGroup,
    renderFormSwitchField,
    renderFormCommandInput,
    renderFormTagInput,
  };
})();
