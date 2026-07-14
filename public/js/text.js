/* TMA - Text component renderer (Figma 32814:289) */
(function () {
  'use strict';

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function lineClass(style, color) {
    const styleMap = {
      12: 'tma-text-inst__line--12',
      14: 'tma-text-inst__line--14',
      '14-semibold': 'tma-text-inst__line--14-semibold',
      '18-semibold': 'tma-text-inst__line--18-semibold',
      '24-semibold': 'tma-text-inst__line--24-semibold',
      '48-semibold': 'tma-text-inst__line--48-semibold',
    };
    const colorMap = {
      primary: 'tma-text-inst__line--primary',
      secondary: 'tma-text-inst__line--secondary',
      link: 'tma-text-inst__line--link',
      white: 'tma-text-inst__line--white',
    };
    return `tma-text-inst__line ${styleMap[style] || styleMap[14]} ${colorMap[color] || colorMap.primary}`;
  }

  function renderLine(text, style, color) {
    return `<p class="${lineClass(style, color)}">${text}</p>`;
  }

  function renderLinkLine(parts) {
    const html = parts.map((part) => {
      if (part.link) {
        return `<span class="${lineClass('14', 'link')}">${esc(part.text)}</span>`;
      }
      return `<span class="${lineClass('14', part.color || 'secondary')}">${esc(part.text)}</span>`;
    }).join('');
    return `<p class="tma-text-inst__line tma-text-inst__line--14 tma-text-inst__line--secondary" style="line-height:0"><span style="line-height:20px">${html}</span></p>`;
  }

  function renderText(opts) {
    const o = opts || {};
    const mode = o.mode || 'single';
    const nodeId = o.nodeId ? ` data-node-id="${esc(o.nodeId)}"` : '';
    const mods = [];

    if (o.borderBottom) mods.push('tma-text-inst__text--border-bottom');
    if (o.center) mods.push('tma-text-inst__text--center');
    if (mode === 'count-vertical' || mode === 'count-horizontal') {
      mods.push('tma-text-inst__text--count');
    }

    const modCls = mods.length ? ` ${mods.join(' ')}` : '';

    if (mode === 'single') {
      return `<div class="tma-text-inst__text${modCls}"${nodeId}>
        ${renderLine(esc(o.text || ''), o.style || '14', o.color || 'secondary')}
      </div>`;
    }

    if (mode === 'stack') {
      const gapCls = o.gap === 8 ? ' tma-text-inst__stack--gap-8' : '';
      const lines = (o.lines || []).map((line) => {
        if (line.linkParts) {
          return renderLinkLine(line.linkParts);
        }
        const style = line.style || (line.semibold ? '14-semibold' : '14');
        const color = line.color || (line.semibold ? 'primary' : 'secondary');
        let content = esc(line.text);
        if (line.ellipsis) {
          return `<p class="${lineClass(style, color)} tma-text--ellipsis">${content}</p>`;
        }
        return renderLine(content, style, color);
      }).join('');
      return `<div class="tma-text-inst__text${modCls}"${nodeId}>
        <div class="tma-text-inst__stack${gapCls}">${lines}</div>
      </div>`;
    }

    if (mode === 'inline') {
      const lines = (o.lines || []).map((line) => {
        const style = line.style || (line.semibold ? '14-semibold' : '14');
        const color = line.color || (line.semibold ? 'primary' : 'secondary');
        return `<p class="${lineClass(style, color)}">${esc(line.text)}</p>`;
      }).join('');
      const nowrap = o.nowrap !== false ? ' tma-text-inst__inline--nowrap' : '';
      return `<div class="tma-text-inst__text${modCls}"${nodeId}>
        <div class="tma-text-inst__inline${nowrap}">${lines}</div>
      </div>`;
    }

    if (mode === 'multi-col') {
      const cols = (o.columns || []).map((col) => {
        const paras = col.map((t) => `<p>${esc(t)}</p>`).join('');
        return `<div class="tma-text-inst__col">${paras}</div>`;
      }).join('');
      return `<div class="tma-text-inst__text${modCls}"${nodeId}>
        <div class="tma-text-inst__multi-col">${cols}</div>
      </div>`;
    }

    if (mode === 'link') {
      return `<div class="tma-text-inst__text${modCls}"${nodeId}>
        ${renderLinkLine(o.parts || [])}
      </div>`;
    }

    if (mode === 'support') {
      return `<div class="tma-text-inst__text tma-text-inst__text--center${modCls}"${nodeId}>
        <div class="tma-text-inst__stack">
          ${renderLine(esc(o.title || ''), '14', 'secondary')}
          ${renderLine(esc(o.link || ''), '14', 'link')}
        </div>
      </div>`;
    }

    if (mode === 'card') {
      const cardType = o.cardType || 'gradient';
      const cardCls = {
        gradient: 'tma-text-inst__card--gradient',
        dark: 'tma-text-inst__card--dark',
        notes: 'tma-text-inst__card--notes',
      }[cardType] || 'tma-text-inst__card--gradient';
      const content = o.lines
        ? o.lines.map((line) => renderLine(esc(line.text), line.style || '48-semibold', line.color || 'white')).join('')
        : renderLine(esc(o.text || ''), o.style || '48-semibold', 'white');
      return `<div class="tma-text-inst__text${modCls}"${nodeId}>
        <div class="tma-text-inst__card ${cardCls}">${content}</div>
      </div>`;
    }

    if (mode === 'count-vertical') {
      const count = o.count || 1;
      const lines = [];
      for (let i = 1; i <= count; i += 1) {
        lines.push(renderLine(esc(i === 1 ? 'Text' : `Text ${i}`), '14', 'primary'));
      }
      return `<div class="tma-text-inst__text${modCls}"${nodeId}>
        <div class="tma-text-inst__stack tma-text-inst__stack--count">${lines.join('')}</div>
      </div>`;
    }

    if (mode === 'count-horizontal') {
      const count = o.count || 1;
      const lines = [];
      for (let i = 1; i <= count; i += 1) {
        lines.push(`<p class="${lineClass('14', 'primary')}">${esc(i === 1 ? 'Text' : `Text ${i}`)}</p>`);
      }
      return `<div class="tma-text-inst__text${modCls}"${nodeId}>
        <div class="tma-text-inst__inline tma-text-inst__inline--nowrap">${lines.join('')}</div>
      </div>`;
    }

    return `<div class="tma-text-inst__text${modCls}"${nodeId}>
      ${renderLine(esc(o.text || 'Text'), '14', 'primary')}
    </div>`;
  }

  function renderTextBlock(opts) {
    const o = opts || {};
    const subtitle = o.subtitle
      ? `<span class="tma-frame-doc__text-sub">${esc(o.subtitle)}</span>`
      : '';
    const titleCls = o.titleSemibold ? ' tma-frame-doc__text-title--semibold' : '';
    const subEllipsis = o.subtitleEllipsis ? ' tma-text--ellipsis' : '';
    return `<span class="tma-frame-doc__text-block">
      <span class="tma-frame-doc__text-title${titleCls}">${esc(o.title)}</span>
      ${o.subtitle ? `<span class="tma-frame-doc__text-sub${subEllipsis}">${esc(o.subtitle)}</span>` : subtitle}
    </span>`;
  }

  window.TMAText = {
    esc,
    renderText,
    renderTextBlock,
    renderLine,
  };
})();
