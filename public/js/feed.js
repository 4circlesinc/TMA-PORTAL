/*
 * TMA - Social Feed ( /social/feed )
 * Global: window.TMAFeed
 */
(function () {
  'use strict';

  var ICON = 'images/icons/phosphor/';
  var AVATAR = 'images/avatars/';

  var POST_TYPES = [
    { id: 'discussion', label: 'Discussion', icon: 'ChatTeardropText', tone: 'discussion' },
    { id: 'question', label: 'Question', icon: 'Question', tone: 'question' },
    { id: 'praise', label: 'Praise', icon: 'Medal', tone: 'praise' },
    { id: 'poll', label: 'Poll', icon: 'ChartBarHorizontal', tone: 'poll' },
  ];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderTypeBtn(type, activeId) {
    var isActive = type.id === activeId;
    return (
      '<button type="button" class="tma-dash__feed-compose-type' +
      (isActive ? ' tma-dash__feed-compose-type--active' : '') +
      '" data-feed-type="' + esc(type.id) + '" aria-pressed="' + (isActive ? 'true' : 'false') + '">' +
      '<span class="tma-dash__feed-compose-type-icon tma-dash__feed-compose-type-icon--' + esc(type.tone) + '">' +
      '<img src="' + ICON + type.icon + '.svg" alt="" width="16" height="16">' +
      '</span>' +
      '<span class="tma-dash__feed-compose-type-label">' + esc(type.label) + '</span>' +
      '</button>'
    );
  }

  function renderComposer(activeType) {
    var typesHtml = POST_TYPES.map(function (type) {
      return renderTypeBtn(type, activeType);
    }).join('');

    return (
      '<section class="tma-dash__feed-composer" aria-label="Create post">' +
      '<button type="button" class="tma-dash__feed-compose-prompt" data-feed-compose-open>' +
      '<img class="tma-dash__feed-compose-avatar" src="' + AVATAR + 'AvatarByewind.png" alt="" width="40" height="40">' +
      '<span class="tma-dash__feed-compose-placeholder">Share thoughts, ideas, or updates</span>' +
      '</button>' +
      '<div class="tma-dash__feed-compose-divider" aria-hidden="true"></div>' +
      '<div class="tma-dash__feed-compose-actions">' +
      '<div class="tma-dash__feed-compose-types" role="group" aria-label="Post type">' + typesHtml + '</div>' +
      '<button type="button" class="tma-dash__feed-compose-drafts" data-feed-drafts>' +
      '<img src="' + ICON + 'PencilSimple.svg" alt="" width="16" height="16">' +
      '<span>Drafts</span>' +
      '</button>' +
      '</div>' +
      '</section>'
    );
  }

  function setActiveType(root, typeId) {
    root.querySelectorAll('[data-feed-type]').forEach(function (btn) {
      var on = btn.getAttribute('data-feed-type') === typeId;
      btn.classList.toggle('tma-dash__feed-compose-type--active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    root._feedActiveType = typeId;
  }

  function bindEvents(root) {
    root.addEventListener('click', function (e) {
      var typeBtn = e.target.closest('[data-feed-type]');
      if (typeBtn) {
        setActiveType(root, typeBtn.getAttribute('data-feed-type'));
        return;
      }
      if (e.target.closest('[data-feed-compose-open]')) {
        if (window.TMAToast && window.TMAToast.showFloatingToast) {
          window.TMAToast.showFloatingToast('Composer coming soon', { state: 'neutral' });
        }
        return;
      }
      if (e.target.closest('[data-feed-drafts]')) {
        if (window.TMAToast && window.TMAToast.showFloatingToast) {
          window.TMAToast.showFloatingToast('No drafts yet', { state: 'neutral' });
        }
      }
    });
  }

  function mount(root) {
    if (!root) return;
    if (root._feedMounted) return;
    root._feedMounted = true;
    root._feedActiveType = 'discussion';

    root.innerHTML =
      '<div class="tma-dash__feed-page">' +
      renderComposer('discussion') +
      '<div class="tma-dash__feed-stream" data-feed-stream aria-label="Feed posts"></div>' +
      '</div>';

    bindEvents(root);
  }

  var UNREAD_MENTIONS = 4;

  function getUnreadCount() {
    return UNREAD_MENTIONS;
  }

  window.TMAFeed = { mount: mount, getUnreadCount: getUnreadCount };
})();
