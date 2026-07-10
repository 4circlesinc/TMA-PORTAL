/* TMA — Frame instances showcase (Figma 33159:3529) — absolute layout */
(function () {
  'use strict';

  const FRAME = { w: 2630, h: 1064 };

  const MSG_COL_520 = [
    { name: 'ByeWind', avatar: 'AvatarByewind', msg: 'Are you free tonight?', time: '19:28', variant: 'message' },
    { name: 'Slack', brandIcon: 'Slack40', msg: 'Invite your team to Slack', time: '18:30', variant: 'message-bg' },
    { name: 'Natali Craig', avatar: 'AvatarFemale06', msg: 'Hi', time: '17:52', variant: 'message-border' },
    { name: 'Drew Cano', avatar: 'AvatarMale02', msg: 'Sure, see you then!', time: '16:45', variant: 'message-border' },
    { name: 'Orlando Diggs', avatar: 'AvatarMale03', msg: 'Thanks for the update', time: '15:20', variant: 'message-border' },
    { name: 'Emma Smith', avatar: 'Avatar3d04', msg: 'Can we reschedule?', time: '14:08', variant: 'message-border' },
    { name: 'Karina Clark', avatar: 'AvatarFemale04', msg: 'Meeting notes attached', time: '13:55', variant: 'message-border' },
    { name: 'Robert Fox', avatar: 'AvatarMale01', msg: 'Looks good to me', time: '12:30', variant: 'message-border' },
    { name: 'Jane Cooper', avatar: 'AvatarFemale01', msg: 'Will do, thanks!', time: '11:15', variant: 'message-border' },
    { name: 'Leslie Alexander', avatar: 'AvatarFemale02', msg: 'On my way', time: '10:42', variant: 'message-border' },
    { name: 'Cody Fisher', avatar: 'AvatarMale04', msg: 'Got it', time: '09:18', variant: 'message-border' },
    { name: 'Esther Howard', avatar: 'AvatarFemale03', msg: 'Perfect timing', time: '08:05', variant: 'message-border' },
    { name: 'Jenny Wilson', avatar: 'AvatarFemale05', msg: 'See you tomorrow', time: '07:30', variant: 'message-border' },
  ];

  const MSG_COL_780 = [
    { name: 'William Johnson', avatar: 'AvatarAbstract04', msg: 'What about the second plan', time: '18:30', variant: 'message' },
    { name: 'ByeWind', avatar: 'AvatarByewind', msg: 'Are you free tonight?', time: '19:28', badge: '12', variant: 'message-bg' },
    { name: 'Natali Craig', avatar: 'AvatarFemale06', msg: 'Hi', time: '17:52', badge: '5', variant: 'message-border' },
    { name: 'Drew Cano', avatar: 'AvatarMale02', msg: 'Sure, see you then!', time: '16:45', badge: '3', variant: 'message-border' },
    { name: 'Orlando Diggs', avatar: 'AvatarMale03', msg: 'Thanks for the update', time: '15:20', badge: '8', variant: 'message-border' },
    { name: 'Emma Smith', avatar: 'Avatar3d04', msg: 'Can we reschedule?', time: '14:08', badge: '2', variant: 'message-border' },
    { name: 'Karina Clark', avatar: 'AvatarFemale04', msg: 'Meeting notes attached', time: '13:55', variant: 'message-border' },
    { name: 'Robert Fox', avatar: 'AvatarMale01', msg: 'Looks good to me', time: '12:30', badge: '1', variant: 'message-border' },
    { name: 'Jane Cooper', avatar: 'AvatarFemale01', msg: 'Will do, thanks!', time: '11:15', variant: 'message-border' },
    { name: 'Leslie Alexander', avatar: 'AvatarFemale02', msg: 'On my way', time: '10:42', badge: '4', variant: 'message-border' },
    { name: 'Cody Fisher', avatar: 'AvatarMale04', msg: 'Got it', time: '09:18', variant: 'message-border' },
    { name: 'Esther Howard', avatar: 'AvatarFemale03', msg: 'Perfect timing', time: '08:05', badge: '6', variant: 'message-border' },
    { name: 'Jenny Wilson', avatar: 'AvatarFemale05', msg: 'See you tomorrow', time: '07:30', variant: 'message-border' },
  ];

  const TASK_ROWS = [
    { title: 'Coffee detail page', due: 'Due Date: Jun 24, 2022', iconPath: 'icons/brands/PriorityMedium40.svg' },
    { title: 'Atica Banking', due: 'Due Date: Jun 20, 2022', iconPath: 'icons/brands/Github40.svg' },
    { title: 'Fitnes App', due: 'Due Date: Nov 10, 2022', iconPath: 'icons/brands/Figma40.svg' },
    { title: 'Finance Dispatch', due: 'Due Date: Nov 10, 2022', iconPath: 'icons/brands/Slack40.svg' },
    { title: 'Aviasales App', due: 'Due Date: Oct 25, 2022', iconPath: 'icons/brands/Loop40.svg' },
    { title: 'Coffee detail page', due: 'Due Date: Jun 24, 2022', iconPath: 'icons/brands/Messenger40.svg' },
    { title: 'Product page redesign', due: 'Due Date: Jun 20, 2022', iconPath: 'icons/brands/Dribbble40.svg' },
    { title: 'Landing page design', due: 'Due Date: Jun 20, 2022', iconPath: 'icons/brands/ChatGPT40.svg' },
    { title: 'Company logo design', due: 'Due Date: Feb 21, 2022', iconPath: 'icons/brands/Dropbox40.svg' },
    { title: 'Drinking bottle graphics', due: 'Due Date: Nov 10, 2022', iconPath: 'icons/brands/Behance40.svg' },
    { title: 'Coffee detail page - Main Page', due: 'Due Date: Nov 10, 2022', iconPath: 'icons/brands/Copilot40.svg' },
    { title: 'TMA', due: 'Due Date: Nov 10, 2022', iconPath: 'icons/brands/TMALogoMark40.svg' },
  ];

  const FEATURE_BLOCKS = [
    { icon: 'RocketLaunchDuotone32', title: 'Launch product', subtitle: 'If you haven\'t launched your product yet, come back when you do.', tall: true },
    { icon: 'ClockDuotone32', title: 'Waiting for data', subtitle: 'Wait for your product running data.', short: true },
    { icon: 'Add32', title: 'Adding data', subtitle: 'Please add data manually on other pages.', tall: true },
    { title: 'Project tech requirements.pdf', subtitle: '5.6 MB / Just now / Karina Clark', file: true, fileIcon: 'icons/phosphor/FilePdf.svg', download: true, downloadName: 'Project tech requirements.pdf' },
    { title: 'Dashboard-design.jpg', subtitle: '2.3 MB / 59 minutes ago / Marcus Blake', file: true, fileIcon: 'icons/phosphor/FileImage.svg' },
    { title: 'Completed Project Stylings.pdf', subtitle: '4.6 MB / 12 hours ago / Terry Barry', file: true, fileIcon: 'icons/phosphor/FilePdf.svg' },
    { title: 'Create Project Wireframes.xls', subtitle: '1.2 MB / Today, 11:59 AM / Roth Bloom', file: true, fileIcon: 'icons/tma/XlsxIcon.svg' },
    { title: 'Project tech requirements.pdf', subtitle: '2.8 MB / Yesterday / Natali Craig', file: true, fileIcon: 'icons/phosphor/FilePdf.svg' },
  ];

  const ATTACH_STATS = [
    { avatar: 'Avatar3d02', paperclip: '6', chat: '17' },
    { avatar: 'AvatarByewind', paperclip: '6', chat: '12' },
    { avatar: 'AvatarFemale04', paperclip: '8', chat: '15' },
    { avatar: 'Avatar3d01', paperclip: '2', chat: '15' },
    { avatar: 'AvatarFemale01', paperclip: '9', chat: '19' },
    { avatarGroup: ['Avatar3d01', 'AvatarFemale04'], more: '+3', paperclip: '6', chat: '82' },
    { avatar: 'AvatarFemale06', paperclip: '1', chat: '18' },
    { avatar: 'AvatarMale01', paperclip: '6', chat: '21' },
    { avatar: 'AvatarAbstract04', paperclip: '8', chat: '22' },
    { avatar: 'AvatarFemale05', paperclip: '12', chat: '32' },
    { avatar: 'AvatarAbstract01', paperclip: '8', chat: '21' },
    { avatar: 'AvatarMale03', paperclip: '3', chat: '12' },
  ];

  const SETTINGS_CHECKBOX = [
    { title: 'Notifications', email: true, phone: true, border: true },
    { title: 'Newsletters', email: true, phone: false, border: false },
    { title: 'Product updates', email: true, phone: true, border: false },
    { title: 'Tips and tutorials', email: false, phone: false, border: false },
  ];

  const ARTICLE_ROWS = [
    { title: 'How to set API', subtitle: 'Use images to enhance your post, improve its flow, add humor and explain complex topics.', tall: true },
    { title: 'Getting started guide', subtitle: 'Learn the basics of TMA and build your first dashboard in minutes.' },
    { title: 'Design system overview', subtitle: 'Explore components, tokens, and patterns that power TMA.' },
    { title: 'Advanced customization', subtitle: 'Tailor TMA to your brand with themes, overrides, and extensions.', tall: true },
    { title: 'Integration patterns', subtitle: 'Connect TMA with your existing tools and workflows seamlessly.', tall: true },
    { title: 'Performance tips', subtitle: 'Optimize your TMA implementation for speed and accessibility.', tall: true },
    { title: 'Migration guide', subtitle: 'Move from other design systems to TMA with confidence.' },
    { title: 'Community resources', subtitle: 'Join the TMA community and access templates, plugins, and support.' },
  ];

  const SNOW_SWITCH_ROWS = [
    { title: 'TMA', subtitle: 'An advanced Dashboard / SaaS UI kit and design system for Figma.', brandIcon: 'icons/brands/TMALogoMark40.svg', on: true, border: true },
    { title: 'Twitter', subtitle: 'From breaking news and entertainment to sports and politics, get the full story.', socialIcon: 'TwitterSocial', on: false, border: true },
    { title: 'Figma', subtitle: 'the collaborative interface design tool.', brandIcon: 'icons/brands/Figma40.svg', on: true, border: true },
    { title: 'Instagram', subtitle: 'A simple, fun & creative way to capture, edit & share photos, videos & messages with friends & family.', socialIcon: 'InstagramSocial', on: false, border: false },
  ];

  const PRODUCT_CARDS = [
    { title: 'Timeson Women\'s V Neck Short Sleeve Curved Hem Sheer Chiffon Blouse Shirts Tops', to: 'Dan Wilson', label: 'Label', chipColor: 'orange', image: 'products/frame-product-01.png' },
    { title: 'Hanes Women\'s Perfect-T Long Sleeve T-shirt', to: 'Jason Bourne', label: 'Label', chipColor: 'purple', image: 'products/frame-product-02.png' },
    { title: 'Timeson Women\'s V Neck Short Sleeve Curved Hem Sheer Chiffon Blouse Shirts Tops', to: 'Marie Durant', label: 'Label', chipColor: 'blue', image: 'products/frame-product-03.png' },
    { title: 'SIVVAN Scrubs for Women - Long Sleeve Comfort Underscrub Tee', to: 'Jason Bourne', label: 'Label', chipColor: 'green', image: 'products/frame-product-04.png' },
  ];

  const PRODUCT_LABEL_CYCLE = [
    { label: 'Label', chipColor: 'orange' },
    { label: 'Draft', chipColor: 'purple' },
    { label: 'Sent', chipColor: 'blue' },
    { label: 'Archived', chipColor: 'green' },
  ];

  const CALENDAR_INSTANCES = [
    { id: 3618, x: 1260, y: 100, w: 100, h: 64, data: { title: 'Cloud project meeting', time: '8:00 - 10:00', bg: 'rgba(0,0,0,0.03)' } },
    { id: 3614, x: 1260, y: 174, w: 100, h: 64, data: { title: 'Test the prototypes', time: '8:30 - 10:00', bg: '#e6f1fd' } },
    { id: 3615, x: 1260, y: 248, w: 100, h: 64, data: { title: 'Design feedback', time: '8:30 - 9:50', bg: '#edeefc' } },
    { id: 3611, x: 1260, y: 322, w: 100, h: 96, data: { title: 'Meeting with Emma', time: '10:30 - 12:30', bg: 'rgba(0,0,0,0.03)', avatars: ['AvatarFemale02'], border: '#e6f1fd' } },
    { id: 3617, x: 1260, y: 428, w: 100, h: 96, data: { title: 'Requirements discussion', time: '10:30 - 12:30', bg: '#edeefc', avatars: ['AvatarByewind', 'AvatarFemale05'], border: '#edeefc' } },
    { id: 3613, x: 1260, y: 534, w: 100, h: 80, data: { title: 'Drew birthday', time: '11:00 - 16:00', bg: '#e6f1fd', avatars: ['AvatarByewind', 'AvatarFemale05'], more: '+9', border: '#e6f1fd' } },
    { id: 3616, x: 1370, y: 100, w: 100, h: 48, data: { title: 'Team Lunch', time: '13:00 - 14:00', bg: 'rgba(0,0,0,0.03)', short: true } },
    { id: 3620, x: 1370, y: 158, w: 100, h: 48, data: { title: 'Test', time: '14:00 - 15:00', bg: '#edeefc', short: true } },
    { id: 3619, x: 1370, y: 216, w: 100, h: 96, data: { title: 'Project Kick off', time: '14:30 - 16:00', bg: '#e6f1fd', avatars: ['AvatarMale05', 'AvatarAbstract04'], border: '#e6f1fd' } },
    { id: 3610, x: 1370, y: 322, w: 100, h: 96, data: { title: 'Meeting with John', time: '14:30 - 16:30', bg: '#e6f1fd', avatars: ['Avatar3d04'], border: '#e6f1fd' } },
    { id: 3612, x: 1370, y: 428, w: 100, h: 96, data: { title: 'New Product meeting', time: '15:30 - 18:00', bg: 'rgba(0,0,0,0.03)', avatars: ['AvatarAbstract04', 'AvatarMale03', 'AvatarMale02'], border: '#e6f1fd' } },
  ];

  function cardIcon(key, cls, w, h) {
    if (window.TMACardIcons && window.TMACardIcons.svg) {
      return window.TMACardIcons.svg(key, cls, w, h);
    }
    return '';
  }

  function fi(key, cls, w, h) {
    const sources = [
      window.TMACardIcons,
      window.TMAFrameInstancesIcons,
      window.TMAInputIcons,
      window.TMAGroupInstancesIcons,
      window.TMAButtonDocIcons,
      window.TMALineIcons,
      window.TMATableSearchIcons,
      window.TMAPopoverIcons,
      window.TMAButtonInstancesIcons,
      window.TMAFrameDocIcons,
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

  function imagesBase(subpath) {
    if (typeof location === 'undefined') return `../images/${subpath}`;
    const segments = (location.pathname || '').split('/').filter(Boolean);
    if (segments.length && /\.[a-z0-9]+$/i.test(segments[segments.length - 1])) segments.pop();
    if (segments.length === 0) return `images/${subpath}`;
    return `${'../'.repeat(segments.length)}images/${subpath}`;
  }

  function brandImg(relativePath, cls, w, h) {
    const src = imagesBase(relativePath);
    const size = `width:${w}px;height:${h}px`;
    return `<img class="${cls || ''}" src="${esc(src)}" alt="" style="${size};object-fit:contain" />`;
  }

  function localImg(relativePath, cls, w, h) {
    const src = imagesBase(relativePath);
    const size = `width:${w}px;height:${h}px`;
    return `<img class="${cls || ''}" src="${esc(src)}" alt="" style="${size};object-fit:cover" />`;
  }

  function place(x, y, w, h, html, nodeId) {
    const size = w != null && h != null
      ? `width:${w}px;height:${h}px;`
      : '';
    return `<div class="tma-frame-inst__node" style="left:${x}px;top:${y}px;${size}" data-node-id="${esc(nodeId)}">${html}</div>`;
  }

  function renderTextBlock(opts) {
    const o = opts || {};
    const subtitle = o.subtitle
      ? `<span class="tma-frame-inst__text-sub">${esc(o.subtitle)}</span>`
      : '';
    const titleClass = o.titleSemibold ? ' tma-frame-inst__text-title--semibold' : '';
    const titleCls = o.titleEllipsis ? ' tma-frame-inst__text-title--ellipsis' : '';
    const blockCls = o.compact ? ' tma-frame-inst__text-block--compact' : '';
    return `<span class="tma-frame-inst__text-block${blockCls}">
      <span class="tma-frame-inst__text-title${titleClass}${titleCls}">${esc(o.title)}</span>
      ${subtitle}
    </span>`;
  }

  function renderBadge(count) {
    return `<span class="tma-frame-inst__badge">${esc(count)}</span>`;
  }

  function renderAvatar24(avatar, brandIcon) {
    if (brandIcon) {
      const brandPath = `icons/brands/${brandIcon}.svg`;
      return `<span class="tma-frame-inst__avatar tma-frame-inst__avatar--brand">${brandImg(brandPath, 'tma-frame-inst__avatar-brand-img', 24, 24)}</span>`;
    }
    return `<span class="tma-frame-inst__avatar">${localImg(`avatars/${avatar}.png`, 'tma-frame-inst__avatar-img', 24, 24)}</span>`;
  }

  function renderCheckboxInline(checked) {
    const key = checked ? 'Checkbox20Checked' : 'Checkbox20Unchecked';
    return `<button type="button" class="tma-frame-inst__checkbox" data-frame-checkbox aria-pressed="${checked ? 'true' : 'false'}">${fi(key, 'tma-frame-inst__checkbox-svg', 20, 20)}</button>`;
  }

  function renderCheckboxOption(label, checked) {
    return `<span class="tma-frame-inst__check-option">
      ${renderCheckboxInline(checked)}
      <span class="tma-frame-inst__check-label">${esc(label)}</span>
    </span>`;
  }

  function renderMessage(opts) {
    const o = opts || {};
    const mods = [
      'tma-frame-inst__frame',
      o.variant === 'message-bg' ? ' tma-frame-inst__frame--bg' : '',
      o.variant === 'message-border' ? ' tma-frame-inst__frame--border' : '',
    ].join('');
    const metaParts = [];
    if (o.time) metaParts.push(`<span class="tma-frame-inst__message-time">${esc(o.time)}</span>`);
    if (o.badge) metaParts.push(renderBadge(o.badge));
    const meta = metaParts.length
      ? `<div class="tma-frame-inst__message-group${o.badge ? ' tma-frame-inst__message-group--stack' : ''}">${metaParts.join('')}</div>`
      : '';
    return `<div class="${mods}">
      <div class="tma-frame-inst__icon-text tma-frame-inst__icon-text--nowrap">
        ${renderAvatar24(o.avatar, o.brandIcon)}
        ${renderTextBlock({ title: o.name, subtitle: o.msg })}
      </div>
      ${meta}
    </div>`;
  }

  function renderTaskRow(opts) {
    const o = opts || {};
    const iconHtml = o.iconPath
      ? brandImg(o.iconPath, 'tma-frame-inst__task-brand-img', 40, 40)
      : fi(o.icon, 'tma-frame-inst__task-priority-svg', 40, 40);
    return `<div class="tma-frame-inst__frame tma-frame-inst__frame--task">
      ${renderTextBlock({ title: o.title, subtitle: o.due, titleSemibold: true, titleEllipsis: true })}
      <span class="tma-frame-inst__task-icon">${iconHtml}</span>
    </div>`;
  }

  function renderFeatureIcon(opts) {
    const o = opts || {};
    const cls = o.short ? ' tma-frame-inst__frame--feature-short' : ' tma-frame-inst__frame--feature';
    return `<div class="tma-frame-inst__frame${cls}">
      <span class="tma-frame-inst__feature-icon">${fi(o.icon, 'tma-frame-inst__feature-icon-svg', 32, 32)}</span>
      ${renderTextBlock({ title: o.title, subtitle: o.subtitle, titleSemibold: true })}
    </div>`;
  }

  function renderFeatureFile(opts) {
    const o = opts || {};
    const iconBg = o.iconBg || 'transparent';
    const iconHtml = o.fileIcon
      ? localImg(o.fileIcon, 'tma-frame-inst__file-icon-img', 16, 16)
      : fi('FolderNotch24', 'tma-frame-inst__file-icon-svg', 16, 16);
    const downloadHtml = o.download
      ? `<button type="button" class="tma-frame-inst__file-btn" data-frame-download data-download-name="${esc(o.downloadName || o.title)}" aria-label="Download">${localImg('icons/phosphor/DownloadSimple.svg', 'tma-frame-inst__file-btn-img', 16, 16)}</button>`
      : '';
    const frameCls = o.download ? ' tma-frame-inst__frame--file' : ' tma-frame-inst__frame--file-text';
    return `<div class="tma-frame-inst__frame${frameCls}">
      <div class="tma-frame-inst__icon-text tma-frame-inst__icon-text--nowrap">
        <span class="tma-frame-inst__file-icon-wrap" style="background:${esc(iconBg)}">${iconHtml}</span>
        ${renderTextBlock({ title: o.title, subtitle: o.subtitle, compact: true })}
      </div>
      ${downloadHtml}
    </div>`;
  }

  function renderAttachAvatarStack(avatars, more) {
    const items = (avatars || []).map((avatar, i) => (
      `<span class="tma-frame-inst__attach-avatar-item${i > 0 ? ' tma-frame-inst__attach-avatar-item--overlap' : ''}">${renderAvatar24(avatar)}</span>`
    )).join('');
    const moreHtml = more
      ? `<span class="tma-frame-inst__attach-avatar-more">${esc(more)}</span>`
      : '';
    return `<div class="tma-frame-inst__attach-avatars">${items}${moreHtml}</div>`;
  }

  function renderAttachAvatars(o) {
    const slotCls = 'tma-frame-inst__attach-avatar-slot';
    if (o.avatarGroup) {
      return `<span class="${slotCls}">${renderAttachAvatarStack(o.avatarGroup, o.more)}</span>`;
    }
    return `<span class="${slotCls}">${renderAvatar24(o.avatar)}</span>`;
  }

  function renderAttachStats(opts) {
    const o = opts || {};
    return `<div class="tma-frame-inst__frame tma-frame-inst__frame--attach">
      ${renderAttachAvatars(o)}
      <div class="tma-frame-inst__attach-group">
        <span class="tma-frame-inst__attach-stat tma-frame-inst__attach-stat--clip">
          <span class="tma-frame-inst__attach-icon">${fi('Paperclip16', 'tma-frame-inst__attach-icon-svg', 16, 16)}</span>
          <span class="tma-frame-inst__attach-count">${esc(o.paperclip)}</span>
        </span>
        <span class="tma-frame-inst__attach-stat tma-frame-inst__attach-stat--chat">
          <span class="tma-frame-inst__attach-icon">${fi('ChatText16', 'tma-frame-inst__attach-icon-svg', 16, 16)}</span>
          <span class="tma-frame-inst__attach-count">${esc(o.chat)}</span>
        </span>
      </div>
    </div>`;
  }

  function renderSettingsCheckbox(opts) {
    const o = opts || {};
    const borderCls = o.border ? ' tma-frame-inst__frame--settings-border' : '';
    return `<div class="tma-frame-inst__frame tma-frame-inst__frame--settings${borderCls}">
      <span class="tma-frame-inst__settings-title">${esc(o.title)}</span>
      <div class="tma-frame-inst__settings-group">
        ${renderCheckboxOption('Email', o.email)}
        ${renderCheckboxOption('Phone', o.phone)}
      </div>
    </div>`;
  }

  function renderSettingsTitle(title) {
    return `<div class="tma-frame-inst__frame tma-frame-inst__frame--settings-title">
      <span class="tma-frame-inst__settings-title">${esc(title)}</span>
    </div>`;
  }

  function renderArticleRow(opts) {
    const o = opts || {};
    const borderCls = o.border !== false ? ' tma-frame-inst__frame--article-border' : '';
    const tallCls = o.tall ? ' tma-frame-inst__frame--article-tall' : '';
    return `<div class="tma-frame-inst__frame tma-frame-inst__frame--article${borderCls}${tallCls}">
      ${renderTextBlock({ title: o.title, subtitle: o.subtitle, titleSemibold: true })}
      <button type="button" class="tma-frame-inst__article-btn" data-frame-article-btn>Get Started</button>
    </div>`;
  }

  function renderSwitchIcon(o) {
    if (o.brandIcon) {
      return `<span class="tma-frame-inst__switch-brand">${brandImg(o.brandIcon, 'tma-frame-inst__switch-brand-img', 32, 32)}</span>`;
    }
    if (o.socialIcon) {
      return `<span class="tma-frame-inst__switch-brand">${fi(o.socialIcon, 'tma-frame-inst__switch-brand-svg', 32, 32)}</span>`;
    }
    return `<span class="tma-frame-inst__switch-brand">${cardIcon(o.icon || 'SnowLogo40', 'tma-frame-inst__switch-brand-svg', 32, 32)}</span>`;
  }

  function renderSnowSwitch(opts) {
    const o = opts || {};
    const borderCls = o.border ? ' tma-frame-inst__frame--switch-border' : '';
    const switchKey = o.on ? 'Switch32On' : 'Switch32Off';
    const switchHtml = `<button type="button" class="tma-frame-inst__switch" data-frame-switch aria-pressed="${o.on ? 'true' : 'false'}">${fi(switchKey, 'tma-frame-inst__switch-svg', 32, 32)}</button>`;
    return `<div class="tma-frame-inst__frame tma-frame-inst__frame--switch${borderCls}">
      <div class="tma-frame-inst__icon-text tma-frame-inst__icon-text--nowrap">
        ${renderSwitchIcon(o)}
        ${renderTextBlock({ title: o.title, subtitle: o.subtitle, titleSemibold: true })}
      </div>
      <span class="tma-frame-inst__switch-wrap">${switchHtml}</span>
    </div>`;
  }

  function renderProductCard(opts) {
    const o = opts || {};
    const chipCls = o.chipColor ? ` tma-frame-inst__product-chip--${o.chipColor}` : '';
    const imagePath = o.image || 'products/frame-product-01.png';
    return `<div class="tma-frame-inst__frame tma-frame-inst__frame--product" data-frame-product>
      <div class="tma-frame-inst__icon-text tma-frame-inst__icon-text--nowrap">
        <span class="tma-frame-inst__product-img">${localImg(imagePath, 'tma-frame-inst__product-img-el', 48, 48)}</span>
        ${renderTextBlock({ title: o.title, subtitle: `To: ${o.to}`, titleEllipsis: true, compact: true })}
      </div>
      <div class="tma-frame-inst__product-group">
        <div class="tma-frame-inst__product-menu-wrap">
          <button type="button" class="tma-frame-inst__product-menu" data-frame-product-menu aria-expanded="false" aria-haspopup="menu" aria-label="More">${fi('ThreeDots20', 'tma-frame-inst__product-menu-svg', 20, 20)}</button>
          <div class="tma-frame-inst__product-dropdown" role="menu" hidden>
            <button type="button" class="tma-frame-inst__product-dropdown-item" role="menuitem" data-action="view">View product</button>
            <button type="button" class="tma-frame-inst__product-dropdown-item" role="menuitem" data-action="edit-label">Edit label</button>
            <button type="button" class="tma-frame-inst__product-dropdown-item" role="menuitem" data-action="remove">Remove</button>
          </div>
        </div>
        <span class="tma-frame-inst__product-chip${chipCls}" data-frame-product-chip data-chip-color="${esc(o.chipColor || 'orange')}">${esc(o.label)}</span>
      </div>
    </div>`;
  }

  function renderAvatarStack(avatars, borderColor, more) {
    const border = borderColor || '#e6f1fd';
    const items = (avatars || []).map((avatar) => (
      `<span class="tma-frame-inst__calendar-avatar-item" style="--avatar-border:${esc(border)}">${renderAvatar24(avatar)}</span>`
    )).join('');
    const moreHtml = more
      ? `<span class="tma-frame-inst__calendar-avatar-more" style="--avatar-border:${esc(border)}">${esc(more)}</span>`
      : '';
    return `<div class="tma-frame-inst__calendar-avatars">${items}${moreHtml}</div>`;
  }

  function renderCalendarCard(opts) {
    const o = opts || {};
    const bg = o.bg || 'rgba(0,0,0,0.03)';
    const shortCls = o.short ? ' tma-frame-inst__calendar-card--short' : '';
    const avatarsHtml = o.avatars && o.avatars.length
      ? renderAvatarStack(o.avatars, o.border, o.more)
      : '';
    return `<div class="tma-frame-inst__calendar-card${shortCls}" style="background:${esc(bg)}">
      ${renderTextBlock({ title: o.title, subtitle: o.time })}
      ${avatarsHtml}
    </div>`;
  }

  function responsiveItem(nodeId, html, cls) {
    const extra = cls ? ` ${cls}` : '';
    return `<div class="tma-frame-inst-responsive__item${extra}" data-node-id="${esc(nodeId)}">${html}</div>`;
  }

  function renderResponsiveLayout() {
    const sections = [];

    sections.push(`<section class="tma-frame-inst-responsive__section">
      <h3 class="tma-frame-inst-responsive__heading">Settings &amp; articles</h3>
      <div class="tma-frame-inst-responsive__grid">
        ${SETTINGS_CHECKBOX.map((item, i) => responsiveItem(`33159:${3601 + i}`, renderSettingsCheckbox(item))).join('')}
        ${responsiveItem('33159:3605', renderSettingsTitle('Account'))}
        ${ARTICLE_ROWS.map((item, i) => {
          const ids = [3588, 3589, 3590, 3595, 3597, 3596, 3598, 3599];
          return responsiveItem(`33159:${ids[i]}`, renderArticleRow(item));
        }).join('')}
        ${responsiveItem('33159:3600', renderArticleRow({ title: 'Release notes', subtitle: 'See what\'s new in the latest TMA update.', border: false }))}
      </div>
    </section>`);

    sections.push(`<section class="tma-frame-inst-responsive__section">
      <h3 class="tma-frame-inst-responsive__heading">Messages</h3>
      <div class="tma-frame-inst-responsive__grid">
        ${MSG_COL_520.map((item, i) => responsiveItem(`33159:${3530 + i}`, renderMessage(item))).join('')}
      </div>
    </section>`);

    sections.push(`<section class="tma-frame-inst-responsive__section">
      <h3 class="tma-frame-inst-responsive__heading">Messages with badges</h3>
      <div class="tma-frame-inst-responsive__grid">
        ${MSG_COL_780.map((item, i) => responsiveItem(`33159:${3543 + i}`, renderMessage(item))).join('')}
      </div>
    </section>`);

    sections.push(`<section class="tma-frame-inst-responsive__section">
      <h3 class="tma-frame-inst-responsive__heading">Tasks</h3>
      <div class="tma-frame-inst-responsive__grid">
        ${TASK_ROWS.map((item, i) => responsiveItem(`33159:${3570 - i}`, renderTaskRow(item))).join('')}
      </div>
    </section>`);

    sections.push(`<section class="tma-frame-inst-responsive__section">
      <h3 class="tma-frame-inst-responsive__heading">Calendar widgets</h3>
      <div class="tma-frame-inst-responsive__grid tma-frame-inst-responsive__grid--calendar">
        ${CALENDAR_INSTANCES.map((item) => responsiveItem(`33159:${item.id}`, renderCalendarCard(item.data), 'tma-frame-inst-responsive__item--calendar')).join('')}
      </div>
    </section>`);

    sections.push(`<section class="tma-frame-inst-responsive__section">
      <h3 class="tma-frame-inst-responsive__heading">Features &amp; files</h3>
      <div class="tma-frame-inst-responsive__grid">
        ${FEATURE_BLOCKS.map((item, i) => {
          const nodeNum = i < 3 ? 3556 + i : 3571 + (i - 3);
          const html = item.file ? renderFeatureFile(item) : renderFeatureIcon(item);
          return responsiveItem(`33159:${nodeNum}`, html);
        }).join('')}
      </div>
    </section>`);

    sections.push(`<section class="tma-frame-inst-responsive__section">
      <h3 class="tma-frame-inst-responsive__heading">Attachment stats</h3>
      <div class="tma-frame-inst-responsive__grid">
        ${ATTACH_STATS.map((item, i) => responsiveItem(`33159:${3587 - i}`, renderAttachStats(item))).join('')}
      </div>
    </section>`);

    sections.push(`<section class="tma-frame-inst-responsive__section">
      <h3 class="tma-frame-inst-responsive__heading">Integrations</h3>
      <div class="tma-frame-inst-responsive__grid">
        ${SNOW_SWITCH_ROWS.map((item, i) => {
          const nodeNums = [3591, 3593, 3592, 3594];
          return responsiveItem(`33159:${nodeNums[i]}`, renderSnowSwitch(item));
        }).join('')}
      </div>
    </section>`);

    sections.push(`<section class="tma-frame-inst-responsive__section">
      <h3 class="tma-frame-inst-responsive__heading">Product cards</h3>
      <div class="tma-frame-inst-responsive__grid">
        ${PRODUCT_CARDS.map((item, i) => responsiveItem(`33159:${3606 + i}`, renderProductCard(item))).join('')}
      </div>
    </section>`);

    return `<div class="tma-frame-inst-responsive" data-node-id="33159:3529-responsive">${sections.join('')}</div>`;
  }

  function renderMainBoard() {
    const parts = [];

    parts.push(`<svg class="tma-frame-inst__dash-border" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAME.w} ${FRAME.h}" preserveAspectRatio="none">
      <rect x="1" y="1" width="${FRAME.w - 2}" height="${FRAME.h - 2}" rx="48" ry="48"/>
    </svg>
    <div class="tma-frame-inst__canvas">`);

    const msg520Y = [100, 160, 220, 288, 356, 424, 492, 560, 628, 696, 764, 832, 900];
    const msg520H = [52, 52, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60];
    MSG_COL_520.forEach((item, i) => {
      parts.push(place(520, msg520Y[i], 240, msg520H[i], renderMessage(item), `33159:${3530 + i}`));
    });

    const msg780Y = [100, 160, 222, 292, 360, 428, 496, 564, 632, 700, 768, 836, 904];
    const msg780H = [52, 54, 62, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60];
    MSG_COL_780.forEach((item, i) => {
      parts.push(place(780, msg780Y[i], 240, msg780H[i], renderMessage(item), `33159:${3543 + i}`));
    });

    const featurePos = [
      [1490, 100, 280, 64],
      [1490, 174, 280, 44],
      [1490, 228, 280, 64],
      [1490, 312, 280, 40],
      [1490, 362, 280, 40],
      [1490, 412, 280, 40],
      [1490, 462, 280, 40],
      [1490, 512, 280, 40],
    ];
    FEATURE_BLOCKS.forEach((item, i) => {
      const nodeNum = i < 3 ? 3556 + i : 3571 + (i - 3);
      const html = item.file ? renderFeatureFile(item) : renderFeatureIcon(item);
      parts.push(place(featurePos[i][0], featurePos[i][1], featurePos[i][2], featurePos[i][3], html, `33159:${nodeNum}`));
    });

    const taskY = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650];
    TASK_ROWS.forEach((item, i) => {
      parts.push(place(1040, taskY[i], 200, 40, renderTaskRow(item), `33159:${3570 - i}`));
    });

    const attachY = [100, 134, 168, 202, 236, 270, 304, 338, 372, 406, 440, 474];
    ATTACH_STATS.forEach((item, i) => {
      parts.push(place(1790, attachY[i], 180, 24, renderAttachStats(item), `33159:${3587 - i}`));
    });

    parts.push(place(100, 324, 400, 68, renderArticleRow(ARTICLE_ROWS[0]), '33159:3588'));
    parts.push(place(100, 402, 400, 52, renderArticleRow(ARTICLE_ROWS[1]), '33159:3589'));
    parts.push(place(100, 464, 400, 52, renderArticleRow(ARTICLE_ROWS[2]), '33159:3590'));
    parts.push(place(100, 536, 400, 52, renderArticleRow(ARTICLE_ROWS[3]), '33159:3595'));
    parts.push(place(100, 598, 400, 68, renderArticleRow(ARTICLE_ROWS[4]), '33159:3597'));
    parts.push(place(100, 676, 400, 68, renderArticleRow(ARTICLE_ROWS[5]), '33159:3596'));
    parts.push(place(100, 754, 400, 68, renderArticleRow(ARTICLE_ROWS[6]), '33159:3598'));
    parts.push(place(100, 832, 400, 52, renderArticleRow(ARTICLE_ROWS[7]), '33159:3599'));
    parts.push(place(100, 894, 400, 52, renderArticleRow({ title: 'Release notes', subtitle: 'See what\'s new in the latest TMA update.', border: false }), '33159:3600'));

    const switchY = [100, 162, 224, 286];
    SNOW_SWITCH_ROWS.forEach((item, i) => {
      parts.push(place(1990, switchY[i], 240, 52, renderSnowSwitch(item), `33159:${3591 + (i === 0 ? 0 : i === 1 ? 2 : i === 2 ? 1 : 3)}`));
    });

    const settingsY = [100, 146, 192, 238];
    SETTINGS_CHECKBOX.forEach((item, i) => {
      parts.push(place(100, settingsY[i], 400, 36, renderSettingsCheckbox(item), `33159:${3601 + i}`));
    });
    parts.push(place(100, 284, 400, 20, renderSettingsTitle('Account'), '33159:3605'));

    const productY = [100, 158, 216, 274];
    PRODUCT_CARDS.forEach((item, i) => {
      parts.push(place(2250, productY[i], 280, 48, renderProductCard(item), `33159:${3606 + i}`));
    });

    CALENDAR_INSTANCES.forEach((item) => {
      parts.push(place(item.x, item.y, item.w, item.h, renderCalendarCard(item.data), `33159:${item.id}`));
    });

    parts.push('</div>');
    return parts.join('');
  }

  function renderInstances() {
    return `<div class="tma-frame-demo__stage" data-frame-showcase>
      <div class="tma-frame-demo__board-wrap tma-frame-demo__board-wrap--main">
        <div class="tma-frame-demo__boards tma-frame-demo__boards--main" data-frame-board-main>
          <div class="tma-frame-inst" data-node-id="33159:3529" style="width:${FRAME.w}px;height:${FRAME.h}px">
            ${renderMainBoard()}
          </div>
        </div>
      </div>
      ${renderResponsiveLayout()}
    </div>`;
  }

  function fitBoard(wrap, board, designW, designH) {
    if (!wrap || !board) return;
    const available = wrap.clientWidth;
    const scale = Math.min(1, available / designW);
    board.style.transform = scale < 1 ? `scale(${scale})` : '';
    wrap.style.height = `${Math.ceil(designH * scale)}px`;
  }

  function fitShowcase(root) {
    const stage = root && root.querySelector('[data-frame-showcase]');
    if (!stage) return;

    const mainWrap = stage.querySelector('.tma-frame-demo__board-wrap--main');
    const mainBoard = stage.querySelector('[data-frame-board-main]');

    if (window.matchMedia('(max-width: 900px)').matches) {
      if (mainBoard) mainBoard.style.transform = '';
      if (mainWrap) mainWrap.style.height = '';
      return;
    }

    fitBoard(mainWrap, mainBoard, FRAME.w, FRAME.h);
  }

  function showToast(message) {
    const existing = document.querySelector('.tma-frame-inst__toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'tma-frame-inst__toast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('tma-frame-inst__toast--visible');
    });

    window.setTimeout(() => {
      toast.classList.remove('tma-frame-inst__toast--visible');
      window.setTimeout(() => toast.remove(), 200);
    }, 2200);
  }

  function toggleCheckbox(btn) {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    btn.innerHTML = fi(
      next ? 'Checkbox20Checked' : 'Checkbox20Unchecked',
      'tma-frame-inst__checkbox-svg',
      20,
      20,
    );
  }

  function toggleSwitch(btn) {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    btn.innerHTML = fi(
      next ? 'Switch32On' : 'Switch32Off',
      'tma-frame-inst__switch-svg',
      32,
      32,
    );
  }

  function closeProductMenus(root, except) {
    root.querySelectorAll('[data-frame-product-menu]').forEach((menuBtn) => {
      if (except && menuBtn === except) return;
      const wrap = menuBtn.closest('.tma-frame-inst__product-menu-wrap');
      const dropdown = wrap && wrap.querySelector('.tma-frame-inst__product-dropdown');
      menuBtn.setAttribute('aria-expanded', 'false');
      if (dropdown) dropdown.hidden = true;
    });
  }

  function cycleProductChip(chip) {
    const currentColor = chip.getAttribute('data-chip-color') || 'orange';
    const idx = PRODUCT_LABEL_CYCLE.findIndex((item) => item.chipColor === currentColor);
    const next = PRODUCT_LABEL_CYCLE[(idx + 1) % PRODUCT_LABEL_CYCLE.length];
    chip.textContent = next.label;
    chip.setAttribute('data-chip-color', next.chipColor);
    const colorCls = next.chipColor === 'orange'
      ? 'tma-frame-inst__product-chip'
      : `tma-frame-inst__product-chip tma-frame-inst__product-chip--${next.chipColor}`;
    chip.className = colorCls;
    return next.label;
  }

  function getProductTitle(row) {
    const title = row.querySelector('.tma-frame-inst__text-title');
    return title ? title.textContent.trim() : 'Product';
  }

  function triggerDownload(filename) {
    const content = `Demo download for ${filename}\nGenerated from TMA Frame instances showcase.`;
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    showToast(`Downloading ${filename}`);
  }

  function wireCheckboxes(root) {
    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-frame-checkbox]');
      if (!btn || !root.contains(btn)) return;
      event.preventDefault();
      toggleCheckbox(btn);
    });
  }

  function wireSwitches(root) {
    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-frame-switch]');
      if (!btn || !root.contains(btn)) return;
      event.preventDefault();
      toggleSwitch(btn);
      const row = btn.closest('.tma-frame-inst__frame--switch');
      const title = row && row.querySelector('.tma-frame-inst__text-title');
      const name = title ? title.textContent.trim() : 'Integration';
      const state = btn.getAttribute('aria-pressed') === 'true' ? 'enabled' : 'disabled';
      showToast(`${name} ${state}`);
    });
  }

  function wireFileDownloads(root) {
    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-frame-download]');
      if (!btn || !root.contains(btn)) return;
      event.preventDefault();
      triggerDownload(btn.getAttribute('data-download-name') || 'download.txt');
    });
  }

  function wireArticleButtons(root) {
    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-frame-article-btn]');
      if (!btn || !root.contains(btn)) return;
      event.preventDefault();
      const row = btn.closest('.tma-frame-inst__frame--article');
      const title = row && row.querySelector('.tma-frame-inst__text-title');
      showToast(title ? `Opening ${title.textContent.trim()}` : 'Get Started');
    });
  }

  function wireProductMenus(root) {
    root.addEventListener('click', (event) => {
      const menuBtn = event.target.closest('[data-frame-product-menu]');
      if (menuBtn && root.contains(menuBtn)) {
        event.preventDefault();
        event.stopPropagation();
        const wrap = menuBtn.closest('.tma-frame-inst__product-menu-wrap');
        const dropdown = wrap && wrap.querySelector('.tma-frame-inst__product-dropdown');
        const isOpen = menuBtn.getAttribute('aria-expanded') === 'true';
        closeProductMenus(root);
        if (!isOpen && dropdown) {
          dropdown.hidden = false;
          menuBtn.setAttribute('aria-expanded', 'true');
        }
        return;
      }

      const actionBtn = event.target.closest('.tma-frame-inst__product-dropdown-item');
      if (!actionBtn || !root.contains(actionBtn)) return;

      event.preventDefault();
      const row = actionBtn.closest('[data-frame-product]');
      const title = row ? getProductTitle(row) : 'Product';
      const action = actionBtn.getAttribute('data-action');

      if (action === 'view') {
        showToast(`Viewing ${title}`);
      } else if (action === 'edit-label') {
        const chip = row && row.querySelector('[data-frame-product-chip]');
        const label = chip ? cycleProductChip(chip) : 'Label';
        showToast(`${title} label set to ${label}`);
      } else if (action === 'remove') {
        row.classList.add('tma-frame-inst__frame--product-removed');
        showToast(`Removed ${title}`);
      }

      closeProductMenus(root);
    });
  }

  let productMenuDismissBound = false;

  function bindProductMenuDismiss(root) {
    if (productMenuDismissBound) return;
    productMenuDismissBound = true;
    document.addEventListener('click', () => {
      const scope = root || document.querySelector('[data-frame-showcase]');
      if (!scope) return;
      closeProductMenus(scope);
    });
  }

  function wireInteractivity(root) {
    if (!root) return;
    wireCheckboxes(root);
    wireSwitches(root);
    wireFileDownloads(root);
    wireArticleButtons(root);
    wireProductMenus(root);
    bindProductMenuDismiss(root);
  }

  function mountInstances(el, opts) {
    if (!el) return;
    el.innerHTML = renderInstances();
    if (!opts || opts.interactive !== false) wireInteractivity(el);
    const fit = () => fitShowcase(el);
    fit();
    window.addEventListener('resize', fit);
  }

  window.TMAFrameInstances = {
    mountInstances,
    wireInteractivity,
    renderInstances,
    fitShowcase,
    FRAME,
  };
})();
