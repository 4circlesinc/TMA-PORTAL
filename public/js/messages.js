/*
 * TMA - Messages page ( /social/messages )
 * Global: window.TMAMessages
 */
(function () {
  'use strict';

  var AVATAR = 'images/avatars/';
  var ICON = 'images/icons/phosphor/';
  var EMOJI = 'images/emoji/';

  var ICONS = {
    NotePencil: ICON + 'NotePencil.svg',
    GearSix: ICON + 'GearSix.svg',
    MagnifyingGlass: ICON + 'MagnifyingGlass.svg',
    Phone: ICON + 'Phone.svg',
    VideoCamera: ICON + 'VideoCamera.svg',
    DotsThree: ICON + 'DotsThree.svg',
    PaperPlaneRight: ICON + 'PaperPlaneRight.svg',
    Smiley: ICON + 'Smiley.svg',
    Paperclip: ICON + 'Paperclip.svg',
    Microphone: ICON + 'Microphone.svg',
    ArrowBendUpLeft: ICON + 'ArrowBendUpLeft.svg',
    Heart: ICON + 'Heart.svg',
    User: ICON + 'User.svg',
    ThreadsLogo: ICON + 'ThreadsLogo.svg',
    CaretLeft: ICON + 'CaretLeft.svg',
    PushPin: ICON + 'PushPin.svg',
    BellSlash: ICON + 'BellSlash.svg',
    Archive: ICON + 'Archive.svg',
    Trash: ICON + 'Trash.svg',
    CheckCircle: ICON + 'CheckCircle.svg',
  };

  var MESSAGES_MOBILE_MQ = '(max-width: 1024px)';

  function isMessagesMobile() {
    return window.matchMedia(MESSAGES_MOBILE_MQ).matches;
  }

  function isMessagesReading(state) {
    return isMessagesMobile() && !!state.reading && !!state.selectedId;
  }

  var BYEWIND_MESSAGES = [
    {
      type: 'in',
      time: '11:42 AM',
      html:
        '<p>hi ByeWind, I saw your work on Dribbble and it\'s awesome.</p>' +
        '<p>I would like to know more about it. Could you send me your website?</p>',
    },
    { type: 'divider', label: 'Today, 11:59 AM' },
    { type: 'out', text: 'Thank you. Of course. Just a moment, please.', time: '11:58 AM' },
    {
      type: 'link',
      url: 'portal.tmantoine.com',
      title: 'TM ANTOINE Advisory',
      time: '11:59 AM',
    },
    { type: 'in', text: 'Got it, thank you.', heart: true, time: '12:01 PM' },
    { type: 'out', emoji: 'WinkingFace.svg', time: '12:02 PM' },
  ];

  var THREADS = [
    { id: 'william', name: 'William Johnson', preview: 'What about the second plan', time: '18:30', avatar: 'AvatarAbstract04', presence: { lastSeen: 'Last seen 2 hr ago' } },
    {
      id: 'byewind',
      name: 'ByeWind',
      preview: 'Are you free tonight?',
      time: '19:28',
      avatar: 'AvatarByewind',
      unread: 12,
      presence: { online: true },
      messages: BYEWIND_MESSAGES,
    },
    { id: 'natali', name: 'Natali Craig', preview: 'Hi', time: '17:52', avatar: 'AvatarFemale06', unread: 5, presence: { online: true } },
    { id: 'drew', name: 'Drew Cano', preview: "Let's go fishing! – Hey, You wanna join...", time: '10:12', avatar: 'AvatarMale01', presence: { lastSeen: 'Last seen 12 min ago' } },
    {
      id: 'bruce',
      name: 'Bruce Wayne, James Davis',
      preview: 'You have a new follower',
      time: '06:30',
      group: ['AvatarAbstract02', 'AvatarMale01'],
    },
    { id: 'orlando', name: 'Orlando Diggs', preview: "Hey man – Nah man sorry i don't. Should i get it?", time: 'Mar 12', avatar: 'AvatarMale03', presence: { lastSeen: 'Last seen yesterday' } },
    {
      id: 'sarah',
      name: 'Sarah Jackson, Michael Brown, Christopher Lee',
      preview: "Yes, I think it's a great idea",
      time: 'Mar 12',
      group: ['AvatarFemale02', 'AvatarMale01', 'AvatarMale05'],
    },
    { id: 'andi', name: 'Andi Lane', preview: 'Re: New mail settings – Will you answer him asap?', time: 'Mar 11', avatar: 'AvatarFemale01', presence: { online: true } },
    {
      id: 'group',
      name: 'Group',
      preview: 'You have a new follower',
      time: 'Mar 10',
      group: ['AvatarFemale05', 'AvatarAbstract03', 'Avatar3D03'],
    },
    { id: 'john', name: 'John Smith', preview: "There's a bug you need to deal with.", time: 'Mar 9', avatar: 'AvatarMale02' },
    { id: 'kate', name: 'Kate Morrison', preview: 'I think we should use the first version.', time: 'Mar 9', avatar: 'AvatarFemale04', presence: { lastSeen: 'Last seen 3 hr ago' } },
    { id: 'threads', name: 'Threads', preview: 'You have a new follower', time: 'Mar 8', brand: 'ThreadsLogo' },
    {
      id: 'koray',
      name: 'Koray Okumus',
      preview: "Let's talk about the search box interaction again",
      time: 'Mar 7',
      avatar: 'AvatarMale04',
      presence: { lastSeen: 'Last seen Mar 7' },
    },
  ];

  function clientContact(id) {
    if (!id || !window.TMAClients || !window.TMAClients.contactFor) return null;
    if (window.TMAClients.hasContact && !window.TMAClients.hasContact(id)) return null;
    try {
      return window.TMAClients.contactFor(id);
    } catch (err) {
      return null;
    }
  }

  function clientProfileSubtitle(contact) {
    if (!contact) return '';
    return [
      contact.nickname ? '"' + contact.nickname + '"' : '',
      contact.work && contact.work.jobTitle,
      contact.work && contact.work.company,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function resolveThread(row) {
    if (!row || !row.id || row.group || row.brand) return row;
    var contact = clientContact(row.id);
    if (!contact) return row;
    var resolved = Object.assign({}, row);
    resolved.name = contact.name;
    resolved.subtitle = clientProfileSubtitle(contact);
    if (contact.photo) {
      resolved.photo = contact.photo;
      resolved.user = false;
    } else if (contact.avatar) {
      resolved.avatar = contact.avatar;
      resolved.user = false;
    } else if (contact.initial) {
      resolved.initial = contact.initial;
      resolved.initialColor = contact.initialColor;
      resolved.user = false;
    }
    return resolved;
  }

  function isDirectThread(row) {
    return !row.group && !row.brand;
  }

  function threadPresence(row) {
    if (row.presence) return row.presence;
    if (row.group) return { label: 'Group chat' };
    if (row.brand) return { label: 'Official account' };
    return { lastSeen: 'Last seen recently' };
  }

  function renderPresence(row) {
    var presence = threadPresence(row);
    if (presence.online) {
      return (
        '<span class="tma-dash__messages-chat-presence tma-dash__messages-chat-presence--online">' +
        '<span class="tma-dash__messages-chat-presence-dot" aria-hidden="true"></span>' +
        '<span>Online</span></span>'
      );
    }
    var label = presence.label || presence.lastSeen || 'Offline';
    return '<span class="tma-dash__messages-chat-presence">' + esc(label) + '</span>';
  }

  function renderContactName(row) {
    row = resolveThread(row);
    var displayName = row.name.split(',')[0];
    if (!isDirectThread(row)) {
      return '<span class="tma-dash__messages-chat-name">' + esc(displayName) + '</span>';
    }
    return (
      '<a class="tma-dash__messages-chat-name tma-dash__messages-chat-name-link" href="/clients/' +
      encodeURIComponent(row.id) +
      '" data-messages-contact="' +
      esc(row.id) +
      '" aria-label="View ' +
      esc(displayName) +
      ' profile">' +
      esc(displayName) +
      '</a>'
    );
  }

  function renderChatContactText(row) {
    row = resolveThread(row);
    var html = renderContactName(row);
    if (row.subtitle) {
      html += '<span class="tma-dash__messages-chat-subtitle">' + esc(row.subtitle) + '</span>';
    }
    html += renderPresence(row);
    return html;
  }

  function renderChatThreadIcon(row) {
    row = resolveThread(row);
    var icon = threadIcon(row);
    if (!isDirectThread(row)) return icon;
    var displayName = row.name.split(',')[0];
    return (
      '<a class="tma-dash__messages-chat-avatar-link" href="/clients/' +
      encodeURIComponent(row.id) +
      '" data-messages-contact="' +
      esc(row.id) +
      '" aria-label="View ' +
      esc(displayName) +
      ' profile">' +
      icon +
      '</a>'
    );
  }

  function openClientProfile(id) {
    if (!id || !window.TMADashboard || !window.TMADashboard.navigate) return;
    var contact = clientContact(id);
    var thread = THREADS.filter(function (r) { return r.id === id; })[0];
    var name = contact ? contact.name : thread ? thread.name.split(',')[0] : 'Client';
    window.TMADashboard.navigate({
      navId: 'clients',
      view: 'clients',
      title: name,
      crumb: 'Clients / ' + name,
      clientsScreen: 'detail',
      contactId: id,
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function threadIcon(row) {
    if (row.brand) {
      return (
        '<span class="tma-dash__messages-row-icon">' +
        '<img src="' + esc(ICONS[row.brand] || ICON + row.brand + '.svg') + '" alt="">' +
        '</span>'
      );
    }
    if (row.photo) {
      return (
        '<span class="tma-dash__messages-row-avatar">' +
        '<img src="' + esc(row.photo) + '" alt="">' +
        '</span>'
      );
    }
    if (row.initial) {
      var initialColor =
        row.initialColor === 'green'
          ? ' tma-dash__messages-row-avatar--green'
          : ' tma-dash__messages-row-avatar--blue';
      return (
        '<span class="tma-dash__messages-row-avatar tma-dash__messages-row-avatar--initial' +
        initialColor +
        '">' +
        esc(row.initial) +
        '</span>'
      );
    }
    if (row.user) {
      return (
        '<span class="tma-dash__messages-row-avatar tma-dash__messages-row-avatar--user">' +
        '<img src="' + esc(ICONS.User) + '" alt="">' +
        '</span>'
      );
    }
    if (row.group) {
      return (
        '<span class="tma-dash__messages-row-avatar tma-dash__messages-row-avatar--group">' +
        row.group
          .slice(0, 2)
          .map(function (a, i) {
            return '<img class="tma-dash__messages-row-avatar-part tma-dash__messages-row-avatar-part--' + (i + 1) + '" src="' + AVATAR + esc(a) + '.png" alt="">';
          })
          .join('') +
        '</span>'
      );
    }
    return (
      '<span class="tma-dash__messages-row-avatar">' +
      '<img src="' + AVATAR + esc(row.avatar) + '.png" alt="">' +
      '</span>'
    );
  }

  function isThreadOnline(row) {
    return !!(threadPresence(row).online && isDirectThread(row));
  }

  function renderInboxThreadIcon(row) {
    var icon = threadIcon(resolveThread(row));
    if (!isThreadOnline(row)) return icon;
    return (
      '<span class="tma-dash__messages-row-avatar-wrap tma-dash__messages-row-avatar-wrap--online">' +
      icon +
      '<span class="tma-dash__messages-row-online-dot" aria-hidden="true"></span>' +
      '</span>'
    );
  }

  function renderBadge(count) {
    if (!count) return '';
    if (window.TMABadge) {
      return window.TMABadge.renderBadge({ type: 'number', value: String(count), color: 'indigo' });
    }
    return '<span class="tma-dash__messages-unread">' + esc(count) + '</span>';
  }

  function renderComposeBtn(className, attrs) {
    return (
      '<button type="button" class="' +
      className +
      '" aria-label="New message"' +
      (attrs || '') +
      '>' +
      '<img src="' + ICONS.NotePencil + '" alt="">' +
      '</button>'
    );
  }

  function renderListTools(forMobileHead) {
    return (
      '<div class="tma-dash__messages-list-tools">' +
      (forMobileHead ? '' : renderComposeBtn('tma-dash__messages-icon-btn')) +
      '<button type="button" class="tma-dash__messages-icon-btn" aria-label="Settings">' +
      '<img src="' + ICONS.GearSix + '" alt="">' +
      '</button>' +
      '</div>'
    );
  }

  function renderMessagesMobileFab() {
    return renderComposeBtn('tma-dash__messages-compose-fab', ' data-messages-compose');
  }

  function renderListHead() {
    return (
      '<div class="tma-dash__messages-list-head">' +
      renderListTools() +
      '<div class="tma-dash__messages-search" role="search">' +
      '<img src="' + ICONS.MagnifyingGlass + '" alt="">' +
      '<span class="tma-dash__messages-search-text">Search</span>' +
      '<kbd class="tma-dash__kbd">/</kbd>' +
      '</div>' +
      '</div>'
    );
  }

  function renderListMobileHead() {
    return (
      '<div class="tma-dash__messages-list-mobile-head">' +
      '<span class="tma-dash__messages-list-mobile-title">Messages</span>' +
      '<div class="tma-dash__messages-list-mobile-actions">' +
      renderListTools(true) +
      '</div>' +
      '</div>'
    );
  }

  function getVisibleThreads(state) {
    return THREADS.map(function (row, index) {
      return { row: row, index: index };
    })
      .filter(function (entry) {
        return !(state.removedIds && state.removedIds[entry.row.id]);
      })
      .sort(function (a, b) {
        var aPin = state.pinnedIds && state.pinnedIds[a.row.id] ? 1 : 0;
        var bPin = state.pinnedIds && state.pinnedIds[b.row.id] ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
        return a.index - b.index;
      })
      .map(function (entry) {
        return entry.row;
      });
  }

  function buildMessagesRowInner(row, state) {
    var item = resolveThread(row);
    var pinned = state.pinnedIds && state.pinnedIds[row.id];
    var muted = state.mutedIds && state.mutedIds[row.id];
    return (
      renderInboxThreadIcon(row) +
      '<span class="tma-dash__messages-row-text">' +
      '<span class="tma-dash__messages-row-name">' +
      esc(item.name) +
      (pinned
        ? '<img class="tma-dash__messages-row-pin" src="' + ICONS.PushPin + '" alt="" width="14" height="14" aria-hidden="true">'
        : '') +
      (muted
        ? '<img class="tma-dash__messages-row-mute" src="' + ICONS.BellSlash + '" alt="" width="14" height="14" aria-hidden="true">'
        : '') +
      '</span>' +
      '<span class="tma-dash__messages-row-preview">' +
      esc(row.preview) +
      '</span>' +
      '</span>' +
      '<span class="tma-dash__messages-row-meta">' +
      '<span class="tma-dash__messages-row-time">' +
      esc(row.time) +
      '</span>' +
      renderBadge(row.unread) +
      '</span>'
    );
  }

  function buildMessagesRowHtml(row, state) {
    var active = state.selectedId === row.id;
    var pinned = state.pinnedIds && state.pinnedIds[row.id];
    var muted = state.mutedIds && state.mutedIds[row.id];
    var rowCls =
      'tma-dash__messages-row' +
      (active ? ' tma-dash__messages-row--active' : '') +
      (pinned ? ' tma-dash__messages-row--pinned' : '') +
      (muted ? ' tma-dash__messages-row--muted' : '');
    return (
      '<div class="' +
      rowCls +
      '" data-messages-row="' +
      esc(row.id) +
      '" role="button" tabindex="0">' +
      buildMessagesRowInner(row, state) +
      '</div>'
    );
  }

  function buildMessagesRowSwipeWrap(row, state, rowHtml) {
    var rowId = row.id;
    var pinned = state.pinnedIds && state.pinnedIds[row.id];
    var muted = state.mutedIds && state.mutedIds[row.id];
    return (
      '<div class="tma-dash__messages-row-swipe" data-messages-row-swipe="' +
      esc(rowId) +
      '">' +
      '<div class="tma-dash__messages-row-swipe-actions tma-dash__messages-row-swipe-actions--left" aria-hidden="true">' +
      '<button type="button" class="tma-dash__messages-row-swipe-action tma-dash__messages-row-swipe-action--pin"' +
      ' data-messages-row-swipe-action="pin" data-messages-row-id="' +
      esc(rowId) +
      '" aria-label="' +
      (pinned ? 'Unpin conversation' : 'Pin conversation') +
      '">' +
      '<img class="tma-dash__messages-row-swipe-action-icon" src="' +
      ICONS.PushPin +
      '" alt="" width="18" height="18">' +
      (pinned ? 'Unpin' : 'Pin') +
      '</button>' +
      '<button type="button" class="tma-dash__messages-row-swipe-action tma-dash__messages-row-swipe-action--mute"' +
      ' data-messages-row-swipe-action="mute" data-messages-row-id="' +
      esc(rowId) +
      '" aria-label="' +
      (muted ? 'Unmute conversation' : 'Mute conversation') +
      '">' +
      '<img class="tma-dash__messages-row-swipe-action-icon" src="' +
      ICONS.BellSlash +
      '" alt="" width="18" height="18">' +
      (muted ? 'Unmute' : 'Mute') +
      '</button>' +
      '</div>' +
      '<div class="tma-dash__messages-row-swipe-actions tma-dash__messages-row-swipe-actions--right" aria-hidden="true">' +
      '<button type="button" class="tma-dash__messages-row-swipe-action tma-dash__messages-row-swipe-action--archive"' +
      ' data-messages-row-swipe-action="archive" data-messages-row-id="' +
      esc(rowId) +
      '" aria-label="Archive">' +
      'Archive</button>' +
      '<button type="button" class="tma-dash__messages-row-swipe-action tma-dash__messages-row-swipe-action--delete"' +
      ' data-messages-row-swipe-action="delete" data-messages-row-id="' +
      esc(rowId) +
      '" aria-label="Delete">' +
      '<img class="tma-dash__messages-row-swipe-delete-icon" src="' +
      ICONS.Trash +
      '" alt="" width="24" height="24">' +
      '</button></div>' +
      '<div class="tma-dash__messages-row-swipe-track" data-messages-row-swipe-track tabindex="0" role="group" aria-label="Conversation">' +
      rowHtml +
      '</div></div>'
    );
  }

  function renderList(state) {
    var mobile = isMessagesMobile();
    return (
      '<div class="tma-dash__messages-list">' +
      (mobile ? renderListMobileHead() : renderListHead()) +
      '<div class="tma-dash__messages-list-body">' +
      getVisibleThreads(state)
        .map(function (row) {
          if (mobile) return buildMessagesRowSwipeWrap(row, state, buildMessagesRowHtml(row, state));
          var active = state.selectedId === row.id;
          var pinned = state.pinnedIds && state.pinnedIds[row.id];
          var muted = state.mutedIds && state.mutedIds[row.id];
          return (
            '<button type="button" class="tma-dash__messages-row' +
            (active ? ' tma-dash__messages-row--active' : '') +
            (pinned ? ' tma-dash__messages-row--pinned' : '') +
            (muted ? ' tma-dash__messages-row--muted' : '') +
            '" data-messages-row="' +
            esc(row.id) +
            '">' +
            buildMessagesRowInner(row, state) +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '</div>'
    );
  }

  var COMPOSER_EMOJIS = [
    { file: 'WinkingFace.svg', char: '😉' },
    { file: 'FaceTearsJoy.svg', char: '😂' },
    { file: 'SmilingFaceSunglasses.svg', char: '😎' },
    { file: 'FaceBlowingKiss.svg', char: '😘' },
    { file: 'RedHeart.svg', char: '❤️' },
    { file: 'SmilingFaceHearts.svg', char: '🥰' },
    { file: 'GrinningCat.svg', char: '😺' },
    { file: 'LoudlyCryingFace.svg', char: '😭' },
    { file: 'FaceSteamFromNose.svg', char: '😤' },
    { file: 'GrinningFaceSweat.svg', char: '😅' },
    { file: 'SmilingFaceHorns.svg', char: '😈' },
    { file: 'SkullCrossbones.svg', char: '☠️' },
    { file: 'HundredPoints.svg', char: '💯' },
    { file: 'BombEmoji.svg', char: '💣' },
    { file: 'SnowflakeEmoji.svg', char: '❄️' },
    { file: 'Snowman.svg', char: '⛄' },
    { file: 'UmbrellaEmoji.svg', char: '☂️' },
    { file: 'RobotEmoji.svg', char: '🤖' },
    { file: 'SeeMonkey.svg', char: '🙈' },
    { file: 'WinkingFaceTongue.svg', char: '😜' },
    { file: 'HeartArrow.svg', char: '💘' },
  ];

  var MESSAGE_ICON_PATHS = {
    Smiley:
      'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216ZM80,108a12,12,0,1,1,12,12A12,12,0,0,1,80,108Zm96,0a12,12,0,1,1-12-12A12,12,0,0,1,176,108Zm-1.07,48c-10.29,17.79-27.4,28-46.93,28s-36.63-10.2-46.92-28a8,8,0,1,1,13.84-8c7.47,12.91,19.21,20,33.08,20s25.61-7.1,33.07-20a8,8,0,0,1,13.86,8Z',
    ArrowBendUpLeft:
      'M232,200a8,8,0,0,1-16,0,88.1,88.1,0,0,0-88-88H51.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,85.66,61.66L51.31,96H128A104.11,104.11,0,0,1,232,200Z',
    ArrowBendUpRight:
      'M229.66,109.66l-48,48a8,8,0,0,1-11.32-11.32L204.69,112H128a88.1,88.1,0,0,0-88,88,8,8,0,0,1-16,0A104.11,104.11,0,0,1,128,96h76.69L170.34,61.66a8,8,0,0,1,11.32-11.32l48,48A8,8,0,0,1,229.66,109.66Z',
    DotsThree:
      'M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128Zm56-12a12,12,0,1,0,12,12A12,12,0,0,0,196,116ZM60,116a12,12,0,1,0,12,12A12,12,0,0,0,60,116Z',
    Paperclip:
      'M209.66,122.34a8,8,0,0,1,0,11.32l-82.05,82a56,56,0,0,1-79.2-79.21L147.67,35.73a40,40,0,1,1,56.61,56.55L105,193A24,24,0,1,1,71,159L154.3,74.38A8,8,0,1,1,165.7,85.6L82.39,170.31a8,8,0,1,0,11.27,11.36L192.93,81A24,24,0,1,0,159,47L59.76,147.68a40,40,0,1,0,56.53,56.62l82.06-82A8,8,0,0,1,209.66,122.34Z',
    Microphone:
      'M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z',
    PaperPlaneRight:
      'M231.87,114l-168-95.89A16,16,0,0,0,40.92,37.34L71.55,128,40.92,218.67A16,16,0,0,0,56,240a16.15,16.15,0,0,0,7.93-2.1l167.92-96.05a16,16,0,0,0,.05-27.89ZM56,224a.56.56,0,0,0,0-.12L85.74,136H144a8,8,0,0,0,0-16H85.74L56.06,32.16A.46.46,0,0,0,56,32l168,95.83Z',
  };

  function renderMessagesIcon(name) {
    var path = MESSAGE_ICON_PATHS[name];
    if (!path) return '';
    return (
      '<svg class="tma-dash__messages-icon" viewBox="0 0 256 256" aria-hidden="true">' +
      '<path d="' +
      path +
      '"></path></svg>'
    );
  }

  var REPLY_SWIPE_MAX = 72;
  var REPLY_SWIPE_TRIGGER = 56;

  function getReplySwipeTrigger() {
    return isMessagesMobile() ? 44 : REPLY_SWIPE_TRIGGER;
  }

  function messagesWheelDeltaX(e, fallbackWidth) {
    var dx = e.deltaX;
    if (e.deltaMode === 1) dx *= 16;
    else if (e.deltaMode === 2) dx *= fallbackWidth || 320;
    return dx;
  }

  function focusComposerInput(root) {
    var composer = root.querySelector('.tma-dash__messages-composer');
    var input = root.querySelector('[data-messages-composer-input]');
    if (composer) composer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (input) input.focus();
  }

  function messagePreview(msg) {
    if (msg.type === 'divider') return '';
    if (msg.emoji) return 'Emoji';
    if (msg.type === 'link') return msg.title || msg.url || 'Link';
    if (msg.text) return msg.text;
    if (msg.html) {
      var plain = msg.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return plain.length > 96 ? plain.slice(0, 96) + '…' : plain;
    }
    return 'Message';
  }

  function messageReplyLabel(msg, row) {
    row = resolveThread(row);
    if (msg.type === 'in') return 'Replying to ' + row.name.split(',')[0];
    return 'Replying to yourself';
  }

  function clearReplyTo(state) {
    state.replyTo = null;
  }

  function setReplyTo(state, index) {
    state.replyTo = { threadId: state.selectedId, index: index };
  }

  function getReplyMessage(state, row) {
    if (!state.replyTo || state.replyTo.threadId !== state.selectedId || !row || !row.messages) return null;
    return row.messages[state.replyTo.index] || null;
  }

  function renderSwipeReplyIcon(side) {
    var icon = side === 'in' ? 'ArrowBendUpRight' : 'ArrowBendUpLeft';
    return (
      '<span class="tma-dash__messages-bubble-swipe-reply" aria-hidden="true">' +
      renderMessagesIcon(icon) +
      '</span>'
    );
  }

  function renderSwipeTrack(content, side) {
    return (
      '<div class="tma-dash__messages-bubble-swipe">' +
      renderSwipeReplyIcon(side) +
      '<div class="tma-dash__messages-bubble-track" data-messages-swipe-track>' +
      content +
      '</div></div>'
    );
  }

  function renderReplyPreview(state, row) {
    var msg = getReplyMessage(state, row);
    if (!msg || msg.type === 'divider') return '';
    return (
      '<div class="tma-dash__messages-reply-preview">' +
      '<span class="tma-dash__messages-reply-preview-bar" aria-hidden="true"></span>' +
      '<span class="tma-dash__messages-reply-preview-body">' +
      '<span class="tma-dash__messages-reply-preview-label">' +
      esc(messageReplyLabel(msg, row)) +
      '</span>' +
      '<span class="tma-dash__messages-reply-preview-text">' +
      esc(messagePreview(msg)) +
      '</span></span>' +
      '<button type="button" class="tma-dash__messages-reply-preview-clear" data-messages-reply-clear aria-label="Cancel reply">' +
      '<span aria-hidden="true">×</span></button></div>'
    );
  }

  function renderLinkActionBtn(action, index) {
    var replyAttr = action.icon === 'ArrowBendUpLeft' ? ' data-messages-reply="' + index + '"' : '';
    return (
      '<button type="button" class="tma-dash__messages-icon-btn tma-dash__messages-link-action-btn" aria-label="' +
      esc(action.label) +
      '"' +
      replyAttr +
      '>' +
      renderMessagesIcon(action.icon) +
      '</button>'
    );
  }

  function renderHeartReaction() {
    return (
      '<span class="tma-dash__messages-heart" aria-hidden="true">' +
      '<svg class="tma-dash__messages-heart-icon" viewBox="0 0 256 256" aria-hidden="true">' +
      '<path d="M240,102a62.07,62.07,0,0,0-82-46C159.73,48.88,141.65,40,121,40a62.07,62.07,0,0,0-62,62c0,70,103.79,126.66,108.21,129a8,8,0,0,0,7.58,0C136.21,228.66,240,172,240,102Z"></path>' +
      '</svg></span>'
    );
  }

  function resolveMessageTime(msg, row) {
    if (msg && msg.time) return msg.time;
    if (row && row.time) return row.time;
    return '';
  }

  function renderBubbleTime(msg, row) {
    var time = resolveMessageTime(msg, row);
    if (!time) return '';
    return '<time class="tma-dash__messages-bubble-time">' + esc(time) + '</time>';
  }

  function renderHtmlWithTime(html, timeHtml) {
    if (!timeHtml) return html;
    if (html.indexOf('</p>') === -1) {
      return (
        '<p class="tma-dash__messages-bubble-line">' +
        html +
        ' ' +
        timeHtml +
        '</p>'
      );
    }
    var lastClose = html.lastIndexOf('</p>');
    var before = html.slice(0, lastClose);
    var lastOpen = before.lastIndexOf('<p');
    if (lastOpen !== -1) {
      var tagEnd = before.indexOf('>', lastOpen);
      var openTag = before.slice(lastOpen, tagEnd + 1);
      var withClass = openTag;
      if (openTag.indexOf('tma-dash__messages-bubble-line') === -1) {
        if (openTag.indexOf('class="') !== -1) {
          withClass = openTag.replace('class="', 'class="tma-dash__messages-bubble-line ');
        } else {
          withClass = openTag.replace('<p>', '<p class="tma-dash__messages-bubble-line">').replace('<p ', '<p class="tma-dash__messages-bubble-line" ');
        }
      }
      before = before.slice(0, lastOpen) + withClass + before.slice(tagEnd + 1);
    }
    return before + ' ' + timeHtml + html.slice(lastClose);
  }

  function renderBubble(msg, index, isReplyTarget, row) {
    if (msg.type === 'divider') {
      return '<div class="tma-dash__messages-divider">' + esc(msg.label) + '</div>';
    }

    var timeHtml = renderBubbleTime(msg, row);

    if (msg.type === 'link') {
      var linkCard =
        '<div class="tma-dash__messages-link-card">' +
        '<div class="tma-dash__messages-link-visual" aria-hidden="true">' +
        '<img src="images/brand/tma/tma-logo-mark.png" alt="TM ANTOINE">' +
        '</div>' +
        '<div class="tma-dash__messages-link-body">' +
        '<div class="tma-dash__messages-link-url">' +
        esc(msg.url) +
        '</div>' +
        '<div class="tma-dash__messages-link-title tma-dash__messages-bubble-line">' +
        '<span class="tma-dash__messages-bubble-copy">' +
        esc(msg.title) +
        '</span>' +
        timeHtml +
        '</div>' +
        '</div></div>';
      return (
        '<div class="tma-dash__messages-bubble-row tma-dash__messages-bubble-row--out' +
        '" data-messages-swipe="out" data-messages-index="' +
        index +
        '">' +
        '<div class="tma-dash__messages-link-wrap">' +
        renderSwipeTrack(linkCard, 'out') +
        '<div class="tma-dash__messages-link-actions">' +
        [
          { icon: 'Smiley', label: 'React' },
          { icon: 'ArrowBendUpLeft', label: 'Reply' },
          { icon: 'DotsThree', label: 'More' },
        ]
          .map(function (action) {
            return renderLinkActionBtn(action, index);
          })
          .join('') +
        '</div></div></div>'
      );
    }

    var side = msg.type === 'in' ? 'in' : 'out';
    var inner = '';

    if (msg.emoji) {
      inner =
        '<div class="tma-dash__messages-bubble-line tma-dash__messages-bubble-line--emoji">' +
        '<img class="tma-dash__messages-emoji" src="' +
        EMOJI +
        esc(msg.emoji) +
        '" alt="">' +
        timeHtml +
        '</div>';
    } else if (msg.html) {
      inner =
        '<div class="tma-dash__messages-bubble-text">' +
        renderHtmlWithTime(msg.html, timeHtml) +
        '</div>';
    } else {
      inner =
        '<div class="tma-dash__messages-bubble-text">' +
        '<p class="tma-dash__messages-bubble-line">' +
        '<span class="tma-dash__messages-bubble-copy">' +
        esc(msg.text) +
        '</span>' +
        timeHtml +
        '</p></div>';
    }

    var heart = msg.heart ? renderHeartReaction() : '';
    var bubble =
      '<div class="tma-dash__messages-bubble tma-dash__messages-bubble--' + side + '">' + inner + '</div>' + heart;

    return (
      '<div class="tma-dash__messages-bubble-row tma-dash__messages-bubble-row--' +
      side +
      '" data-messages-swipe="' +
      side +
      '" data-messages-index="' +
      index +
      '">' +
      renderSwipeTrack(bubble, side) +
      '</div>'
    );
  }

  function getInboxUnreadCount(state) {
    return getVisibleThreads(state || {}).reduce(function (total, row) {
      return total + (row.unread || 0);
    }, 0);
  }

  function getComposerDraft(state) {
    if (!state.composerDrafts) state.composerDrafts = {};
    return state.composerDrafts[state.selectedId] || '';
  }

  function setComposerDraft(state, text) {
    if (!state.composerDrafts) state.composerDrafts = {};
    state.composerDrafts[state.selectedId] = text;
  }

  function getComposerAttachments(state) {
    if (!state.composerAttachments) state.composerAttachments = {};
    return state.composerAttachments[state.selectedId] || [];
  }

  function renderComposerActionBtn(id, icon, label, extraAttrs) {
    return (
      '<button type="button" class="tma-dash__messages-composer-btn" data-messages-composer-' +
      id +
      ' aria-label="' +
      esc(label) +
      '"' +
      (extraAttrs || '') +
      '>' +
      renderMessagesIcon(icon) +
      '</button>'
    );
  }

  function renderEmojiPicker(state) {
    var open = !!state.emojiPickerOpen;
    return (
      '<div class="tma-dash__messages-emoji-picker' +
      (open ? ' tma-dash__messages-emoji-picker--open' : '') +
      '" data-messages-emoji-picker' +
      (open ? '' : ' hidden') +
      ' role="dialog" aria-label="Choose emoji">' +
      '<div class="tma-dash__messages-emoji-picker-grid">' +
      COMPOSER_EMOJIS.map(function (item) {
        return (
          '<button type="button" class="tma-dash__messages-emoji-picker-item" data-messages-emoji-char="' +
          esc(item.char) +
          '" aria-label="Insert emoji">' +
          '<img src="' +
          EMOJI +
          esc(item.file) +
          '" alt="">' +
          '</button>'
        );
      }).join('') +
      '</div></div>'
    );
  }

  function renderComposerAttachments(state) {
    var files = getComposerAttachments(state);
    if (!files.length) return '';
    return (
      '<div class="tma-dash__messages-composer-attachments">' +
      files
        .map(function (name) {
          return '<span class="tma-dash__messages-composer-attachment">' + esc(name) + '</span>';
        })
        .join('') +
      '</div>'
    );
  }

  function renderComposer(state) {
    var draft = getComposerDraft(state);
    var attachCount = getComposerAttachments(state).length;
    var attachLabel = attachCount ? 'Attach file, ' + attachCount + ' attached' : 'Attach file';
    var voiceActive = !!state.voiceRecording;
    return (
      '<div class="tma-dash__messages-composer-wrap">' +
      renderEmojiPicker(state) +
      renderComposerAttachments(state) +
      '<div class="tma-dash__messages-composer-main">' +
      '<div class="tma-dash__messages-composer-input' +
      (draft ? ' tma-dash__messages-composer-input--filled' : '') +
      '" contenteditable="true" data-messages-composer-input data-placeholder="Type message" role="textbox" aria-multiline="true" aria-label="Message">' +
      esc(draft) +
      '</div>' +
      '<div class="tma-dash__messages-composer-tools">' +
      renderComposerActionBtn(
        'emoji',
        'Smiley',
        'Add emoji',
        ' aria-expanded="' + (state.emojiPickerOpen ? 'true' : 'false') + '" aria-haspopup="dialog"'
      ) +
      renderComposerActionBtn('attach', 'Paperclip', attachLabel) +
      '<input type="file" class="tma-dash__messages-composer-file" data-messages-composer-file hidden multiple>' +
      renderComposerActionBtn(
        'voice',
        'Microphone',
        voiceActive ? 'Recording voice note' : 'Record voice note',
        voiceActive ? ' aria-pressed="true"' : ' aria-pressed="false"'
      ) +
      '<button type="button" class="tma-dash__messages-composer-btn tma-dash__messages-composer-send" data-messages-composer-send aria-label="Send message">' +
      renderMessagesIcon('PaperPlaneRight') +
      '</button></div></div></div>'
    );
  }

  function insertComposerText(input, text) {
    if (!input || !text) return;
    input.focus();
    var selection = window.getSelection();
    if (!selection) return;
    var range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !input.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    range.deleteContents();
    var node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function syncComposerInputState(input) {
    if (!input) return;
    var hasText = (input.textContent || '').trim().length > 0;
    input.classList.toggle('tma-dash__messages-composer-input--filled', hasText);
  }

  function bindComposer(root, state, render) {
    var composer = root.querySelector('.tma-dash__messages-composer');
    if (!composer) return;

    var input = composer.querySelector('[data-messages-composer-input]');
    var emojiBtn = composer.querySelector('[data-messages-composer-emoji]');
    var attachBtn = composer.querySelector('[data-messages-composer-attach]');
    var fileInput = composer.querySelector('[data-messages-composer-file]');
    var voiceBtn = composer.querySelector('[data-messages-composer-voice]');
    var sendBtn = composer.querySelector('[data-messages-composer-send]');
    var picker = composer.querySelector('[data-messages-emoji-picker]');

    if (input) {
      syncComposerInputState(input);
      input.addEventListener('input', function () {
        setComposerDraft(state, input.textContent || '');
        syncComposerInputState(input);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (sendBtn) sendBtn.click();
        }
      });
    }

    function closeEmojiPicker() {
      state.emojiPickerOpen = false;
      if (picker) {
        picker.hidden = true;
        picker.classList.remove('tma-dash__messages-emoji-picker--open');
      }
      if (emojiBtn) emojiBtn.setAttribute('aria-expanded', 'false');
    }

    function toggleEmojiPicker() {
      state.emojiPickerOpen = !state.emojiPickerOpen;
      if (picker) {
        picker.hidden = !state.emojiPickerOpen;
        picker.classList.toggle('tma-dash__messages-emoji-picker--open', state.emojiPickerOpen);
      }
      if (emojiBtn) emojiBtn.setAttribute('aria-expanded', state.emojiPickerOpen ? 'true' : 'false');
    }

    if (emojiBtn) {
      emojiBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleEmojiPicker();
      });
    }

    if (picker) {
      picker.querySelectorAll('[data-messages-emoji-char]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          insertComposerText(input, btn.getAttribute('data-messages-emoji-char'));
          closeEmojiPicker();
        });
      });
    }

    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', function () {
        fileInput.click();
      });
      fileInput.addEventListener('change', function () {
        if (!fileInput.files || !fileInput.files.length) return;
        if (!state.composerAttachments) state.composerAttachments = {};
        var existing = state.composerAttachments[state.selectedId] || [];
        for (var i = 0; i < fileInput.files.length; i++) {
          existing.push(fileInput.files[i].name);
        }
        state.composerAttachments[state.selectedId] = existing;
        fileInput.value = '';
        render();
      });
    }

    if (voiceBtn) {
      function stopVoice() {
        if (!state.voiceRecording) return;
        state.voiceRecording = false;
        voiceBtn.classList.remove('tma-dash__messages-composer-btn--active');
        voiceBtn.setAttribute('aria-pressed', 'false');
        voiceBtn.setAttribute('aria-label', 'Record voice note');
      }

      voiceBtn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        state.voiceRecording = true;
        voiceBtn.classList.add('tma-dash__messages-composer-btn--active');
        voiceBtn.setAttribute('aria-pressed', 'true');
        voiceBtn.setAttribute('aria-label', 'Recording voice note');
        voiceBtn.setPointerCapture(e.pointerId);
      });

      voiceBtn.addEventListener('pointerup', stopVoice);
      voiceBtn.addEventListener('pointercancel', stopVoice);
      voiceBtn.addEventListener('pointerleave', function (e) {
        if (voiceBtn.hasPointerCapture(e.pointerId)) stopVoice();
      });
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        var text = input ? (input.textContent || '').trim() : getComposerDraft(state).trim();
        if (!text && !getComposerAttachments(state).length) return;
        setComposerDraft(state, '');
        if (state.composerAttachments) delete state.composerAttachments[state.selectedId];
        state.emojiPickerOpen = false;
        state.voiceRecording = false;
        render();
      });
    }

    if (!root._messagesComposerDocBound) {
      root._messagesComposerDocBound = true;
      document.addEventListener('click', function (e) {
        if (!state.emojiPickerOpen) return;
        var activeComposer = root.querySelector('.tma-dash__messages-composer');
        if (activeComposer && activeComposer.contains(e.target)) return;
        state.emojiPickerOpen = false;
        var activePicker = root.querySelector('[data-messages-emoji-picker]');
        if (activePicker) {
          activePicker.hidden = true;
          activePicker.classList.remove('tma-dash__messages-emoji-picker--open');
        }
        var activeEmojiBtn = root.querySelector('[data-messages-composer-emoji]');
        if (activeEmojiBtn) activeEmojiBtn.setAttribute('aria-expanded', 'false');
      });
    }
  }

  function renderChatBackBtn(state) {
    var unread = getInboxUnreadCount(state);
    var countHtml = unread
      ? '<span class="tma-dash__messages-chat-back-count">' + esc(String(unread)) + '</span>'
      : '';
    var label = unread ? 'Back to Messages, ' + unread + ' unread' : 'Back to Messages';
    return (
      '<button type="button" class="tma-dash__messages-chat-back' +
      (unread ? ' tma-dash__messages-chat-back--unread' : '') +
      '" data-messages-back aria-label="' +
      esc(label) +
      '">' +
      '<img src="' +
      ICONS.CaretLeft +
      '" alt="">' +
      countHtml +
      '</button>'
    );
  }

  function renderChat(state) {
    var row = THREADS.filter(function (r) {
      return r.id === state.selectedId;
    })[0];

    if (!row) {
      return '<div class="tma-dash__messages-chat tma-dash__messages-chat--empty"><p>Select a conversation</p></div>';
    }

    var messages = row.messages || [{ type: 'in', text: row.preview }];
    var mobile = isMessagesMobile();

    return (
      '<div class="tma-dash__messages-chat">' +
      '<div class="tma-dash__messages-chat-head">' +
      '<div class="tma-dash__messages-chat-contact">' +
      (mobile && isMessagesReading(state) ? renderChatBackBtn(state) : '') +
      renderChatThreadIcon(row) +
      '<span class="tma-dash__messages-chat-contact-text">' +
      renderChatContactText(row) +
      '</span>' +
      '</div>' +
      '<div class="tma-dash__messages-chat-actions">' +
      [
        { icon: 'Phone', label: 'Call' },
        { icon: 'VideoCamera', label: 'Video call' },
        { icon: 'DotsThree', label: 'More' },
      ]
        .map(function (action) {
          return (
            '<button type="button" class="tma-dash__messages-icon-btn" aria-label="' +
            esc(action.label) +
            '">' +
            '<img src="' +
            esc(ICONS[action.icon]) +
            '" alt="">' +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '</div>' +
      '<div class="tma-dash__messages-chat-body">' +
      messages
        .map(function (msg, index) {
          return renderBubble(msg, index, state.replyTo && state.replyTo.index === index, row);
        })
        .join('') +
      '</div>' +
      '<div class="tma-dash__messages-composer' +
      (state.replyTo && state.replyTo.threadId === state.selectedId ? ' tma-dash__messages-composer--reply' : '') +
      '">' +
      renderReplyPreview(state, row) +
      renderComposer(state) +
      '</div>' +
      '</div>'
    );
  }

  function renderLayout(state) {
    var layoutCls = 'tma-dash__messages-layout';
    if (isMessagesMobile()) {
      layoutCls += ' tma-dash__messages-layout--mobile';
      if (isMessagesReading(state)) layoutCls += ' tma-dash__messages-layout--mobile-reading';
    }
    var html = '<div class="' + layoutCls + '">' + renderList(state) + renderChat(state) + '</div>';
    if (isMessagesMobile() && !isMessagesReading(state)) {
      html += renderMessagesMobileFab();
    }
    return html;
  }

  function getMessagesDashRoot() {
    return document.querySelector('.tma-dash');
  }

  function ensureMessagesMobileHeader(root, state) {
    var dash = getMessagesDashRoot();
    if (!dash) return;

    dash.classList.toggle('tma-dash--messages-mobile', isMessagesMobile());
    dash.classList.toggle('tma-dash--messages-mobile-reading', isMessagesReading(state));

    if (typeof dash._syncSidebarToggleIcon === 'function') dash._syncSidebarToggleIcon();
  }

  function clearMessagesMobileHeader() {
    var dash = getMessagesDashRoot();
    if (!dash) return;
    dash.classList.remove('tma-dash--messages-mobile', 'tma-dash--messages-mobile-reading');
    if (typeof dash._syncSidebarToggleIcon === 'function') dash._syncSidebarToggleIcon();
  }

  function bindMessageSwipes(root, state, render) {
    var chatBody = root.querySelector('.tma-dash__messages-chat-body');

    root.querySelectorAll('[data-messages-swipe]').forEach(function (row) {
      if (row.dataset.messagesSwipeBound) return;
      row.dataset.messagesSwipeBound = '1';

      var side = row.getAttribute('data-messages-swipe');
      var index = parseInt(row.getAttribute('data-messages-index'), 10);
      var swipe = row.querySelector('.tma-dash__messages-bubble-swipe');
      var track = row.querySelector('[data-messages-swipe-track]');
      var replyIcon = row.querySelector('.tma-dash__messages-bubble-swipe-reply');
      if (!track || !swipe || side !== 'in' && side !== 'out') return;

      var startX = 0;
      var startY = 0;
      var startOffset = 0;
      var dragging = false;
      var moved = false;
      var wheelEndTimer = null;

      function getCurrentOffset() {
        var match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform || '');
        return match ? parseFloat(match[1]) : 0;
      }

      function setOffset(px) {
        var clamped =
          side === 'in'
            ? Math.max(0, Math.min(REPLY_SWIPE_MAX, px))
            : Math.min(0, Math.max(-REPLY_SWIPE_MAX, px));
        var progress = Math.abs(clamped) / REPLY_SWIPE_MAX;

        if (Math.abs(clamped) < 1) {
          track.style.transform = '';
          swipe.classList.remove('is-replying');
          if (replyIcon) replyIcon.style.opacity = '';
          return 0;
        }

        track.style.transform = 'translateX(' + clamped + 'px)';
        swipe.classList.toggle('is-replying', progress > 0.12);
        if (replyIcon) replyIcon.style.opacity = String(Math.min(1, progress * 1.35));
        return clamped;
      }

      function resetSwipe(animate) {
        track.classList.remove('is-dragging');
        swipe.classList.remove('is-replying');
        if (replyIcon) replyIcon.style.opacity = '';
        if (chatBody) chatBody.classList.remove('is-swipe-dragging');
        if (animate) {
          track.style.transform = '';
          return;
        }
        setOffset(0);
      }

      function clearWheelEndTimer() {
        if (wheelEndTimer) {
          clearTimeout(wheelEndTimer);
          wheelEndTimer = null;
        }
      }

      function finishSwipeGesture() {
        if (!track.isConnected) return;
        track.classList.remove('is-dragging');
        if (chatBody) chatBody.classList.remove('is-swipe-dragging');
        var current = getCurrentOffset();
        var trigger = getReplySwipeTrigger();

        if (side === 'in' && current >= trigger) {
          triggerReply();
          return;
        }
        if (side === 'out' && current <= -trigger) {
          triggerReply();
          return;
        }

        resetSwipe(true);
      }

      function scheduleWheelEnd() {
        clearWheelEndTimer();
        wheelEndTimer = setTimeout(finishSwipeGesture, 160);
      }

      function triggerReply() {
        clearWheelEndTimer();
        setReplyTo(state, index);
        resetSwipe(true);
        render();
        focusComposerInput(root);
      }

      function wheelDeltaX(e) {
        return messagesWheelDeltaX(e, track.clientWidth || wrap.offsetWidth || 320);
      }

      function beginDrag(clientX, clientY) {
        clearWheelEndTimer();
        dragging = true;
        moved = false;
        startX = clientX;
        startY = clientY;
        startOffset = getCurrentOffset();
        track.classList.add('is-dragging');
      }

      function moveDrag(clientX, clientY, prevent) {
        if (!dragging) return;
        var dx = clientX - startX;
        var dy = clientY - startY;
        if (!moved) {
          if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          if (Math.abs(dy) > Math.abs(dx)) {
            dragging = false;
            track.classList.remove('is-dragging');
            return;
          }
          moved = true;
          if (chatBody) chatBody.classList.add('is-swipe-dragging');
        }
        if (prevent) prevent();
        setOffset(startOffset + dx);
      }

      function endDrag() {
        if (!dragging) {
          track.classList.remove('is-dragging');
          if (chatBody) chatBody.classList.remove('is-swipe-dragging');
          return;
        }
        dragging = false;
        finishSwipeGesture();
      }

      track.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target.closest('.tma-dash__messages-link-action-btn')) return;
        beginDrag(e.clientX, e.clientY);
        track.setPointerCapture(e.pointerId);
      });

      track.addEventListener(
        'pointermove',
        function (e) {
          if (!dragging) return;
          moveDrag(e.clientX, e.clientY, function () {
            e.preventDefault();
          });
        },
        { passive: false }
      );

      track.addEventListener('pointerup', function (e) {
        if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
        endDrag();
      });

      track.addEventListener('pointercancel', function (e) {
        if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
        endDrag();
      });

      track.addEventListener(
        'wheel',
        function (e) {
          if (dragging) return;
          if (e.target.closest('.tma-dash__messages-link-action-btn')) return;

          var dx = wheelDeltaX(e);
          var dy = e.deltaY;
          if (Math.abs(dx) < 0.5) return;

          var current = getCurrentOffset();
          var movement = -dx;
          var forward = side === 'in' ? movement > 0 : movement < 0;
          var backward = side === 'in' ? movement < 0 && current > 0 : movement > 0 && current < 0;

          if (!forward && !backward) {
            if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
            return;
          }

          if (Math.abs(dx) <= Math.abs(dy) * 0.85 && Math.abs(current) < 1) return;

          e.preventDefault();
          track.classList.add('is-dragging');
          if (chatBody) chatBody.classList.add('is-swipe-dragging');
          setOffset(current + movement);
          scheduleWheelEnd();
        },
        { passive: false }
      );
    });
  }

  function ensureMessagesToast(dash) {
    if (!dash || dash.querySelector('[data-messages-toast]')) return;
    var toast = document.createElement('div');
    toast.className = 'tma-dash__messages-toast';
    toast.hidden = true;
    toast.setAttribute('data-messages-toast', '');
    toast.innerHTML =
      '<img src="' + ICONS.CheckCircle + '" alt="">' +
      '<span data-messages-toast-text></span>';
    dash.appendChild(toast);
  }

  function showMessagesToast(root, message) {
    var dash = root.closest('.tma-dash');
    if (!dash) return;
    ensureMessagesToast(dash);
    var toast = dash.querySelector('[data-messages-toast]');
    var text = dash.querySelector('[data-messages-toast-text]');
    if (!toast || !text) return;
    text.textContent = message;
    toast.hidden = false;
    window.requestAnimationFrame(function () {
      toast.classList.add('tma-dash__messages-toast--visible');
    });
    window.clearTimeout(dash._messagesToastTimer);
    dash._messagesToastTimer = window.setTimeout(function () {
      toast.classList.remove('tma-dash__messages-toast--visible');
      window.setTimeout(function () {
        toast.hidden = true;
      }, 240);
    }, 2800);
  }

  function closeMessagesRowSwipes(root, except) {
    if (!root) return;
    root.querySelectorAll('[data-messages-row-swipe]').forEach(function (wrap) {
      if (except && wrap === except) return;
      if (!wrap.classList.contains('is-open-left') && !wrap.classList.contains('is-open-right')) return;
      wrap.classList.remove(
        'is-open-left',
        'is-open-right',
        'is-right-wide',
        'is-left-wide',
        'is-dragging'
      );
      wrap.style.removeProperty('--messages-swipe-right-width');
      wrap.style.removeProperty('--messages-swipe-left-width');
      var track = wrap.querySelector('[data-messages-row-swipe-track]');
      if (track) track.style.transform = '';
    });
  }

  function animateMessagesRowDismiss(wrap, destination, callback) {
    if (!wrap) {
      if (callback) callback();
      return;
    }
    var track = wrap.querySelector('[data-messages-row-swipe-track]');
    var max = wrap.offsetWidth || 0;
    var isDelete = destination === 'trash';
    wrap.style.setProperty('--messages-swipe-row-h', wrap.offsetHeight + 'px');
    wrap.classList.remove('is-dragging', 'is-open-left', 'is-open-right');
    wrap.classList.add(isDelete ? 'is-deleting' : 'is-archiving');
    wrap.style.setProperty('--messages-swipe-right-width', max + 'px');
    wrap.classList.add('is-right-wide');
    if (track) track.style.transform = 'translateX(-' + max + 'px)';

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      if (callback) callback();
    }

    window.setTimeout(function () {
      wrap.classList.add('is-dismissing--collapse');
      function onCollapseEnd(e) {
        if (e.target !== wrap || e.propertyName !== 'max-height') return;
        wrap.removeEventListener('transitionend', onCollapseEnd);
        finish();
      }
      wrap.addEventListener('transitionend', onCollapseEnd);
      window.setTimeout(finish, 360);
    }, 280);
    window.setTimeout(finish, 720);
  }

  function dismissMessagesRow(state, id, destination) {
    if (!id) return;
    if (!state.removedIds) state.removedIds = {};
    state.removedIds[id] = destination;
    if (state.selectedId === id) {
      state.selectedId = null;
      state.reading = false;
    }
  }

  function commitMessagesRowAction(root, state, render, id, action) {
    if (!id) return;
    if (action === 'pin') {
      if (!state.pinnedIds) state.pinnedIds = {};
      if (state.pinnedIds[id]) delete state.pinnedIds[id];
      else state.pinnedIds[id] = true;
      showMessagesToast(root, state.pinnedIds[id] ? 'Conversation pinned' : 'Conversation unpinned');
    } else if (action === 'mute') {
      if (!state.mutedIds) state.mutedIds = {};
      if (state.mutedIds[id]) delete state.mutedIds[id];
      else state.mutedIds[id] = true;
      showMessagesToast(root, state.mutedIds[id] ? 'Conversation muted' : 'Conversation unmuted');
    } else if (action === 'archive') {
      dismissMessagesRow(state, id, 'archive');
      showMessagesToast(root, 'Conversation archived');
    } else if (action === 'trash') {
      dismissMessagesRow(state, id, 'trash');
      showMessagesToast(root, 'Conversation deleted');
    }
    render();
    var dash = document.querySelector('.tma-dash');
    if (dash && typeof dash._syncTabBarBadges === 'function') dash._syncTabBarBadges();
  }

  function applyMessagesRowAction(root, state, render, id, action, wrap) {
    if (!id || (wrap && (wrap.classList.contains('is-deleting') || wrap.classList.contains('is-archiving')))) {
      return;
    }
    closeMessagesRowSwipes(root);
    if ((action === 'trash' || action === 'archive') && wrap) {
      animateMessagesRowDismiss(wrap, action, function () {
        commitMessagesRowAction(root, state, render, id, action);
      });
      return;
    }
    commitMessagesRowAction(root, state, render, id, action);
  }

  function bindMessagesInboxSwipes(root, state, render) {
    if (!isMessagesMobile() || isMessagesReading(state)) return;

    var listBody = root.querySelector('.tma-dash__messages-list-body');

    root.querySelectorAll('[data-messages-row-swipe]').forEach(function (wrap) {
      if (wrap.dataset.swipeBound) return;
      wrap.dataset.swipeBound = '1';

      var track = wrap.querySelector('[data-messages-row-swipe-track]');
      if (!track) return;

      var startX = 0;
      var startOffset = 0;
      var dragging = false;
      var moved = false;
      var wheelEndTimer = null;

      function swipeMaxWidth() {
        return wrap.offsetWidth || 0;
      }

      function getCurrentOffset() {
        var match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(track.style.transform || '');
        return match ? parseFloat(match[1]) : 0;
      }

      function clearWheelEndTimer() {
        if (wheelEndTimer) {
          clearTimeout(wheelEndTimer);
          wheelEndTimer = null;
        }
      }

      function leftSnapWidth() {
        return 168;
      }

      function rightSnapWidth() {
        return 168;
      }

      function syncLeftReveal(revealPx) {
        var max = swipeMaxWidth();
        var width = Math.max(0, Math.min(max, revealPx));
        if (width < 1) {
          wrap.style.removeProperty('--messages-swipe-left-width');
          wrap.classList.remove('is-left-wide');
          return 0;
        }
        wrap.style.setProperty('--messages-swipe-left-width', width + 'px');
        wrap.classList.toggle('is-left-wide', width >= max * 0.92);
        return width;
      }

      function resetLeftReveal() {
        wrap.style.removeProperty('--messages-swipe-left-width');
        wrap.classList.remove('is-left-wide');
      }

      function syncRightReveal(revealPx) {
        var max = swipeMaxWidth();
        var width = Math.max(0, Math.min(max, revealPx));
        if (width < 1) {
          wrap.style.removeProperty('--messages-swipe-right-width');
          wrap.classList.remove('is-right-wide');
          return 0;
        }
        wrap.style.setProperty('--messages-swipe-right-width', width + 'px');
        wrap.classList.toggle('is-right-wide', width >= max * 0.92);
        return width;
      }

      function resetRightReveal() {
        wrap.style.removeProperty('--messages-swipe-right-width');
        wrap.classList.remove('is-right-wide');
      }

      function setOffset(px) {
        var max = swipeMaxWidth();
        var clamped = Math.max(-max, Math.min(max, px));

        if (Math.abs(clamped) < 1) {
          track.style.transform = '';
          resetRightReveal();
          resetLeftReveal();
          wrap.classList.remove('is-open-left', 'is-open-right');
          return 0;
        }

        if (clamped > 0) {
          resetRightReveal();
          var leftReveal = syncLeftReveal(clamped);
          track.style.transform = 'translateX(' + leftReveal + 'px)';
          wrap.classList.toggle('is-open-left', leftReveal > 8);
          wrap.classList.remove('is-open-right');
          return leftReveal;
        }

        resetLeftReveal();
        var rightReveal = syncRightReveal(Math.abs(clamped));
        track.style.transform = 'translateX(-' + rightReveal + 'px)';
        wrap.classList.remove('is-open-left');
        wrap.classList.toggle('is-open-right', rightReveal > 8);
        return -rightReveal;
      }

      function snapOpen(direction) {
        closeMessagesRowSwipes(root, wrap);
        if (direction === 'left') {
          var snap = leftSnapWidth();
          syncLeftReveal(snap);
          track.style.transform = 'translateX(' + snap + 'px)';
          wrap.classList.add('is-open-left');
        } else if (direction === 'right') {
          var deleteSnap = rightSnapWidth();
          syncRightReveal(deleteSnap);
          track.style.transform = 'translateX(-' + deleteSnap + 'px)';
          wrap.classList.add('is-open-right');
        }
      }

      function closeSwipe() {
        wrap.classList.remove(
          'is-open-left',
          'is-open-right',
          'is-right-wide',
          'is-left-wide',
          'is-dragging'
        );
        resetRightReveal();
        resetLeftReveal();
        track.style.transform = '';
      }

      function resolveInboxSwipe() {
        wrap.classList.remove('is-dragging');
        if (listBody) listBody.classList.remove('is-swipe-dragging');

        var current = getCurrentOffset();
        var max = swipeMaxWidth();
        var id = wrap.getAttribute('data-messages-row-swipe');

        if (current >= max * 0.75) {
          applyMessagesRowAction(root, state, render, id, 'pin', wrap);
          return true;
        }
        if (current <= -max * 0.75) {
          applyMessagesRowAction(root, state, render, id, 'trash', wrap);
          return true;
        }

        if (current > max * 0.35) snapOpen('left');
        else if (current < -max * 0.35) snapOpen('right');
        else closeSwipe();
        return false;
      }

      function finishWheelSwipe() {
        clearWheelEndTimer();
        if (!track.isConnected) return;
        moved = true;
        resolveInboxSwipe();
      }

      function scheduleWheelEnd() {
        clearWheelEndTimer();
        wheelEndTimer = setTimeout(finishWheelSwipe, 160);
      }

      track.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        clearWheelEndTimer();
        dragging = true;
        moved = false;
        startX = e.clientX;
        startOffset = getCurrentOffset();
        wrap.classList.add('is-dragging');
        track.setPointerCapture(e.pointerId);
      });

      track.addEventListener(
        'pointermove',
        function (e) {
          if (!dragging) return;
          var delta = e.clientX - startX;
          if (Math.abs(delta) > 6) moved = true;
          setOffset(startOffset + delta);
        },
        { passive: false }
      );

      function openThreadFromSwipe(id) {
        if (!id) return;
        state.selectedId = id;
        state.reading = true;
        clearReplyTo(state);
        render();
      }

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        clearWheelEndTimer();
        if (e && track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);

        var wasTap = !moved;
        if (resolveInboxSwipe()) return;

        if (
          moved &&
          (wrap.classList.contains('is-open-left') || wrap.classList.contains('is-open-right'))
        ) {
          wrap.dataset.swipeMoved = '1';
          window.requestAnimationFrame(function () {
            delete wrap.dataset.swipeMoved;
          });
          return;
        }

        if (!wasTap) return;
        if (wrap.classList.contains('is-open-left') || wrap.classList.contains('is-open-right')) {
          closeMessagesRowSwipes(root);
          return;
        }
        wrap.dataset.tapHandled = '1';
        window.requestAnimationFrame(function () {
          delete wrap.dataset.tapHandled;
        });
        openThreadFromSwipe(wrap.getAttribute('data-messages-row-swipe'));
      }

      track.addEventListener('pointerup', endDrag);
      track.addEventListener('pointercancel', endDrag);

      track.addEventListener(
        'wheel',
        function (e) {
          if (dragging) return;

          var dx = messagesWheelDeltaX(e, track.clientWidth || wrap.offsetWidth || 320);
          var dy = e.deltaY;
          if (Math.abs(dx) < 0.5) return;

          var current = getCurrentOffset();
          var movement = -dx;

          if (Math.abs(dx) <= Math.abs(dy) * 0.85 && Math.abs(current) < 1) return;

          e.preventDefault();
          moved = true;
          wrap.classList.add('is-dragging');
          if (listBody) listBody.classList.add('is-swipe-dragging');
          setOffset(current + movement);
          scheduleWheelEnd();
        },
        { passive: false }
      );
    });

    root.querySelectorAll('[data-messages-row-swipe-action]').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var action = btn.getAttribute('data-messages-row-swipe-action');
        var id = btn.getAttribute('data-messages-row-id');
        var wrap = btn.closest('[data-messages-row-swipe]');
        if (action === 'delete') action = 'trash';
        applyMessagesRowAction(root, state, render, id, action, wrap);
      });
    });

    if (!root.dataset.messagesSwipeDismissBound) {
      root.dataset.messagesSwipeDismissBound = '1';
      document.addEventListener('click', function (e) {
        if (!e.target.closest('[data-messages-row-swipe]')) closeMessagesRowSwipes(root);
      });
    }
  }

  function wireEvents(root, state, render) {
    if (!isMessagesMobile()) {
      root.querySelectorAll('[data-messages-row]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.selectedId = btn.getAttribute('data-messages-row');
          clearReplyTo(state);
          render();
        });
      });
    }

    root.querySelectorAll('[data-messages-contact]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        openClientProfile(link.getAttribute('data-messages-contact'));
      });
    });

    root.querySelectorAll('[data-messages-reply]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        var index = parseInt(btn.getAttribute('data-messages-reply'), 10);
        if (isNaN(index)) return;
        setReplyTo(state, index);
        render();
        focusComposerInput(root);
      });
    });

    var clearReplyBtn = root.querySelector('[data-messages-reply-clear]');
    if (clearReplyBtn) {
      clearReplyBtn.addEventListener('click', function () {
        clearReplyTo(state);
        render();
      });
    }

    bindMessageSwipes(root, state, render);
    bindMessagesInboxSwipes(root, state, render);
    bindComposer(root, state, render);

    var backBtn = root.querySelector('[data-messages-back]');
    if (backBtn && root._messagesOnBack) {
      backBtn.addEventListener('click', root._messagesOnBack);
    }
  }

  function mount(root) {
    var state = root._messagesState || {
      selectedId: 'byewind',
      reading: false,
      replyTo: null,
      composerDrafts: {},
      composerAttachments: {},
      emojiPickerOpen: false,
      voiceRecording: false,
      pinnedIds: {},
      mutedIds: {},
      removedIds: {},
    };
    root._messagesState = state;

    function render() {
      root.innerHTML = renderLayout(state);
      ensureMessagesMobileHeader(root, state);
      wireEvents(root, state, render);
      var dash = document.querySelector('.tma-dash');
      if (dash && typeof dash._syncTabBarBadges === 'function') dash._syncTabBarBadges();
    }

    root._messagesOnBack = function () {
      state.reading = false;
      render();
    };

    if (root._messagesMounted) {
      render();
      return;
    }
    root._messagesMounted = true;

    var mobileMq = window.matchMedia(MESSAGES_MOBILE_MQ);
    function onMobileBreakpoint() {
      if (!isMessagesMobile()) state.reading = false;
      render();
    }
    if (typeof mobileMq.addEventListener === 'function') {
      mobileMq.addEventListener('change', onMobileBreakpoint);
    } else if (typeof mobileMq.addListener === 'function') {
      mobileMq.addListener(onMobileBreakpoint);
    }

    render();
  }

  window.TMAMessages = {
    mount: mount,
    clearMobileHeader: clearMessagesMobileHeader,
    getInboxUnreadCount: getInboxUnreadCount,
  };
})();
