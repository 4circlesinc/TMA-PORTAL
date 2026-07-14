/*
 * TMA - Portal Inbox (Received / Sent / Archived) + Compose
 * Secure message center: composing creates a Sent item and a
 * notification-history entry; received messages can be archived.
 * Registers view: 'inbox'.
 */
(function () {
  'use strict';

  function ui() { return window.TMAPortalUI; }
  function data() { return window.TMAPortalData; }

  var state = { el: null, folder: 'received' };

  var FOLDER_FOR_NAV = {
    'inbox-received': 'received',
    'inbox-sent': 'sent',
    'inbox-archived': 'archived',
  };

  var TITLES = { received: 'Received', sent: 'Sent', archived: 'Archived' };

  function composeModal() {
    ui().openModal({
      title: 'Compose message',
      body:
        ui().field('To (email address)', ui().input({ type: 'email', placeholder: 'client@example.com', attrs: 'data-inbox-to' })) +
        ui().field('Subject', ui().input({ placeholder: 'Subject', attrs: 'data-inbox-subject' })) +
        '<div class="tma-portal-field"><span class="tma-portal-field__label">Message</span>' +
        '<textarea class="tma-portal-textarea" data-inbox-body placeholder="Write your message…"></textarea></div>' +
        '<label class="tma-portal-checkbox"><input type="checkbox" data-inbox-copy><span>Send me a copy of this message</span></label>' +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Send', icon: 'PaperPlaneTilt', attrs: 'data-inbox-send' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-inbox-send]').addEventListener('click', function () {
          var to = host.querySelector('[data-inbox-to]').value.trim();
          var subject = host.querySelector('[data-inbox-subject]').value.trim() || '(no subject)';
          if (!to) { host.querySelector('[data-inbox-to]').focus(); return; }
          var s = data().state();
          var msg = {
            id: data().uid('msg'),
            folder: 'sent',
            to: to,
            from: s.user.email,
            subject: subject,
            body: host.querySelector('[data-inbox-body]').value.trim(),
            date: data().dateTime(),
          };
          s.messages.unshift(msg);
          if (host.querySelector('[data-inbox-copy]').checked) {
            s.messages.unshift(Object.assign({}, msg, { id: data().uid('msg'), folder: 'received', from: s.user.email, to: s.user.email }));
          }
          data().save();
          data().logNotification('Message “' + subject + '” sent to ' + to, to);
          ui().closeModal();
          ui().toast('Message sent');
          render();
        });
      },
    });
  }

  function openMessage(m) {
    ui().openModal({
      title: m.subject,
      body:
        '<p><strong>' + (state.folder === 'sent' ? 'To' : 'From') + ':</strong> ' + ui().esc(state.folder === 'sent' ? m.to : m.from) + '</p>' +
        '<p><strong>Date:</strong> ' + ui().esc(m.date) + '</p>' +
        '<p>' + ui().esc(m.body || '(no message body)') + '</p>' +
        '<div class="tma-portal-form-actions">' +
        (m.folder === 'received' ? ui().btn({ label: 'Archive', variant: 'ghost', attrs: 'data-inbox-archive="' + m.id + '"' }) : '') +
        (m.folder === 'archived' ? ui().btn({ label: 'Move to Received', variant: 'ghost', attrs: 'data-inbox-unarchive="' + m.id + '"' }) : '') +
        '</div>',
      onMount: function (host) {
        var archive = host.querySelector('[data-inbox-archive]');
        if (archive) archive.addEventListener('click', function () {
          m.folder = 'archived';
          data().save();
          ui().closeModal();
          ui().toast('Message archived');
          render();
        });
        var unarchive = host.querySelector('[data-inbox-unarchive]');
        if (unarchive) unarchive.addEventListener('click', function () {
          m.folder = 'received';
          data().save();
          ui().closeModal();
          ui().toast('Message moved to Received');
          render();
        });
      },
    });
  }

  function render() {
    var el = state.el;
    if (!el) return;
    var s = data().state();
    var list = s.messages.filter(function (m) { return m.folder === state.folder; });

    var emptyCopy = {
      received: { title: 'There are no items in your inbox.', subtitle: 'Messages and file-share notifications sent to you will appear here.' },
      sent: { title: 'No sent messages yet', subtitle: 'Messages you compose will appear here.' },
      archived: { title: 'No archived messages', subtitle: 'Archive received messages to keep your inbox tidy.' },
    }[state.folder];

    el.innerHTML =
      '<div class="tma-portal-page">' +
      '<div class="tma-portal-head">' +
      '<h2 class="tma-portal-head__title">' + TITLES[state.folder] + '</h2>' +
      '<div class="tma-portal-head__actions">' + ui().btn({ label: 'Compose', icon: 'NotePencil', variant: 'ghost', attrs: 'data-inbox-compose' }) + '</div>' +
      '</div>' +
      (list.length
        ? ui().table([state.folder === 'sent' ? 'To' : 'From', 'Subject', 'Date'], list.map(function (m) {
            return '<tr class="tma-portal-msg-row" data-inbox-open="' + m.id + '" tabindex="0">' +
              '<td class="tma-portal-table__muted">' + ui().esc(state.folder === 'sent' ? m.to : m.from) + '</td>' +
              '<td class="tma-portal-msg-row__subject">' + ui().esc(m.subject) + '</td>' +
              '<td class="tma-portal-table__muted">' + ui().esc(m.date) + '</td></tr>';
          }).join(''))
        : ui().emptyState({
            illustration: 'Illustration02',
            title: emptyCopy.title,
            subtitle: emptyCopy.subtitle,
          })) +
      '</div>';

    el.querySelector('[data-inbox-compose]').addEventListener('click', composeModal);

    el.querySelectorAll('[data-inbox-open]').forEach(function (row) {
      function open() {
        var m = s.messages.filter(function (x) { return x.id === row.getAttribute('data-inbox-open'); })[0];
        if (m) openMessage(m);
      }
      row.addEventListener('click', open);
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  function mount(el, opts) {
    state.el = el;
    if (opts && opts.navId && FOLDER_FOR_NAV[opts.navId]) state.folder = FOLDER_FOR_NAV[opts.navId];
    render();
  }

  if (window.TMAPortalViews) window.TMAPortalViews.register('inbox', mount);
})();
