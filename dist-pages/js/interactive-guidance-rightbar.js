/* TMA - Rightbar interactive guidance panel (Figma 30484:299250) */
(function () {
  'use strict';

  const DOC = window.TMAInteractiveGuidanceDoc;
  const PH = '../images/icons/phosphor/';
  const AV = '../images/avatars/';

  function icon(file, size) {
    const s = size || 16;
    return `<img src="${PH}${file}.svg" alt="" class="ig-rightbar__icon" width="${s}" height="${s}" />`;
  }

  function callout(title, body, cls) {
    return `<div class="ig-rightbar__callout ${cls || ''}">${title ? `<strong>${title}</strong>` : ''}${body}</div>`;
  }

  function tooltip(label, shortcut) {
    const key = shortcut ? `<span class="ig-rightbar__tooltip-key">${shortcut}</span>` : '';
    return `<div class="ig-rightbar__tooltip"><span>${label}</span>${key}</div>`;
  }

  function noticeRow(opts) {
    const tone = opts.tone || 'purple';
    return `<div class="ig-rightbar__notice">
      <span class="ig-rightbar__notice-icon ig-rightbar__notice-icon--${tone}">${icon(opts.icon, 16)}</span>
      <div class="ig-rightbar__notice-body">
        <div class="ig-rightbar__notice-title">${opts.title}</div>
        <div class="ig-rightbar__notice-meta">${opts.meta}</div>
      </div>
    </div>`;
  }

  function activityRow(opts) {
    return `<div class="ig-rightbar__activity">
      <img src="${AV}${opts.avatar}" alt="" class="ig-rightbar__avatar" width="24" height="24" />
      <div class="ig-rightbar__notice-body">
        <div class="ig-rightbar__notice-title">${opts.title}</div>
        <div class="ig-rightbar__notice-meta">${opts.meta}</div>
      </div>
    </div>`;
  }

  function contactRow(opts) {
    return `<div class="ig-rightbar__contact">
      <img src="${AV}${opts.avatar}" alt="" class="ig-rightbar__avatar" width="24" height="24" />
      <span class="ig-rightbar__contact-name">${opts.name}</span>
    </div>`;
  }

  function popoverItem(iconName, label, opts) {
    const danger = opts && opts.danger;
    const divider = opts && opts.divider;
    const html = `<div class="ig-rightbar__popover-item${danger ? ' ig-rightbar__popover-item--danger' : ''}">${icon(iconName, 16)}<span>${label}</span></div>`;
    return divider ? `<div class="ig-rightbar__popover-divider"></div>${html}` : html;
  }

  function renderRightbarPanel() {
    const notifications = [
      { title: 'You fixed a bug.', meta: 'Just now', icon: 'BugBeetle', tone: 'purple' },
      { title: 'New user registered.', meta: '59 minutes ago', icon: 'User', tone: 'blue' },
      { title: 'You fixed a bug.', meta: '12 hours ago', icon: 'BugBeetle', tone: 'purple' },
      { title: 'Andi Lane subscribed to you.', meta: 'Today, 11:59 AM', icon: 'Broadcast', tone: 'blue' },
    ].map(noticeRow).join('');

    const activities = [
      { avatar: 'AvatarAbstract03.png', title: 'Changed the style.', meta: 'Just now' },
      { avatar: 'AvatarFemale03.png', title: 'Released a new version.', meta: '59 minutes ago' },
      { avatar: 'AvatarMale02.png', title: 'Submitted a bug.', meta: '12 hours ago' },
      { avatar: 'Avatar3d03.png', title: 'Modified A data in Page X.', meta: 'Today, 11:59 AM' },
      { avatar: 'AvatarAbstract04.png', title: 'Deleted a page in Project X.', meta: 'Feb 2, 2026' },
    ].map(activityRow).join('');

    const contacts = [
      { avatar: 'AvatarFemale06.png', name: 'Natali Craig' },
      { avatar: 'AvatarMale01.png', name: 'Drew Cano' },
      { avatar: 'AvatarFemale01.png', name: 'Andi Lane' },
      { avatar: 'AvatarMale04.png', name: 'Koray Okumus' },
      { avatar: 'AvatarFemale04.png', name: 'Kate Morrison' },
      { avatar: 'AvatarFemale05.png', name: 'Melody Macy' },
    ].map(contactRow).join('');

    return `<aside class="ig-rightbar__panel" data-node-id="33305:34974" aria-label="Rightbar example">
      <div class="ig-rightbar__section">
        <div class="ig-rightbar__section-head">
          <span class="ig-rightbar__section-title">Notifications</span>
          ${icon('DotsThree', 16)}
        </div>
        ${notifications}
      </div>
      <div class="ig-rightbar__section ig-rightbar__section--activities">
        <div class="ig-rightbar__section-head">
          <span class="ig-rightbar__section-title">Activities</span>
        </div>
        <div class="ig-rightbar__activities-wrap">
          <div class="ig-rightbar__timeline" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
          ${activities}
        </div>
      </div>
      <div class="ig-rightbar__section">
        <div class="ig-rightbar__section-head">
          <span class="ig-rightbar__section-title">Clients</span>
        </div>
        ${contacts}
      </div>
      <span class="ig-rightbar__resize-cursor" aria-hidden="true"></span>
    </aside>`;
  }

  function renderBasicStage() {
    return `<div class="ig-rightbar__stage ig-rightbar__stage--basic" data-node-id="387056:522957">
      ${callout('Title', '<p>Click the title to collapse the content.</p>', 'ig-rightbar__callout--title')}
      <p class="ig-rightbar__hint ig-rightbar__hint--tooltip">Hover: Tooltip</p>
      ${tooltip('Tooltip', '⌘')}
      ${callout(
        'Action button',
        '<p>The action button is only displayed when the cursor is over the content block.</p>',
        'ig-rightbar__callout--action-notifications'
      )}
      ${callout('Action button', '', 'ig-rightbar__callout--action-activities')}
      ${callout('Action button', '', 'ig-rightbar__callout--action-contacts')}
      ${callout(
        'Users',
        '<p>Possible interactions:</p><ul><li>Open the chat interface.</li><li>Open the associated chat software.</li><li>Go to the user page.</li></ul>',
        'ig-rightbar__callout--users'
      )}
      ${callout(
        'Width adjustable',
        '<p>Minimum: 212</p><p>Max. : The page width cannot exceed 40%</p>',
        'ig-rightbar__callout--width'
      )}
      <div class="ig-rightbar__popover ig-rightbar__popover--notifications">
        ${popoverItem('Check', 'Mark all as read')}
        ${popoverItem('Archive', 'Archive all')}
        ${popoverItem('Gear', 'Settings')}
      </div>
      <div class="ig-rightbar__popover ig-rightbar__popover--activities">
        <div class="ig-rightbar__popover-item ig-rightbar__popover-item--plain"><span>See all activities</span></div>
      </div>
      <div class="ig-rightbar__popover ig-rightbar__popover--contacts">
        ${popoverItem('Plus', 'New conversation')}
        ${popoverItem('ChatsCircle', 'New conversation')}
        ${popoverItem('Trash', 'Delete all conversation', { divider: true, danger: true })}
      </div>
      ${renderRightbarPanel()}
    </div>`;
  }

  function renderLoadMorePanel() {
    const items = [
      { title: 'You have a bug that needs to be fixed.', meta: 'Just now', icon: 'BugBeetle', tone: 'purple' },
      { title: 'New user registered', meta: '59 minutes ago', icon: 'User', tone: 'blue' },
      { title: 'You have a bug that needs to be fixed.', meta: '12 hours ago', icon: 'BugBeetle', tone: 'purple' },
      { title: 'Andi Lane subscribed to you', meta: 'Today, 11:59 AM', icon: 'Broadcast', tone: 'blue' },
      { title: 'You have a bug that needs to be fixed.', meta: 'Just now', icon: 'BugBeetle', tone: 'purple' },
      { title: 'New user registered', meta: '59 minutes ago', icon: 'User', tone: 'blue' },
      { title: 'You have a bug that needs to be fixed.', meta: '12 hours ago', icon: 'BugBeetle', tone: 'purple' },
      { title: 'Andi Lane subscribed to you', meta: 'Today, 11:59 AM', icon: 'Broadcast', tone: 'blue' },
    ].map(noticeRow).join('');

    return `<aside class="ig-rightbar__panel ig-rightbar__panel--load-more" data-node-id="387056:522980" aria-label="Notifications load more">
      <div class="ig-rightbar__section">
        <div class="ig-rightbar__section-head">
          <span class="ig-rightbar__section-title ig-rightbar__section-title--bold">Notifications</span>
        </div>
        ${items}
        <button type="button" class="ig-rightbar__load-more">Load more</button>
      </div>
    </aside>`;
  }

  function renderLoadMoreStage() {
    return `<div class="ig-rightbar__stage ig-rightbar__stage--load-more" data-node-id="387056:522979">
      ${callout('Click to load', '', 'ig-rightbar__callout--load-more')}
      ${renderLoadMorePanel()}
    </div>`;
  }

  function renderRightbar() {
    return `<article class="ig-doc ig-rightbar" data-node-id="30484:299250">
      ${DOC.renderDocHero('Rightbar', 'Interactive guidance')}
      <section class="ig-doc__section" data-node-id="387056:522955">
        <h3 class="ig-doc__heading">Basic interaction</h3>
        <div class="ig-doc__body">${renderBasicStage()}</div>
      </section>
      <section class="ig-doc__section" data-node-id="387056:522977">
        <h3 class="ig-doc__heading">Loading more notifications</h3>
        <div class="ig-doc__body">${renderLoadMoreStage()}</div>
      </section>
      ${DOC.renderDocFooter()}
    </article>`;
  }

  window.TMAInteractiveGuidanceRightbar = { renderRightbar };
})();
