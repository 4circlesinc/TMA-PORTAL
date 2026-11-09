/*
 * TMA - Request Files
 * Global: window.TMAFileRequests
 *
 * One modal, three entry points: the Dashboard shortcut, the File Library
 * (toolbar, folder menu and File Box), and a client's Documents tab. They all
 * open the *same* dialog against the same endpoint, the alternative, three
 * dialogs that look alike, is how the old prototype ended up with a Dashboard
 * version that only asked for an email address and a File Box version that
 * asked for a different one, neither of which sent anything anywhere.
 *
 * The caller supplies context (a folder, a client) and the modal fills it in;
 * nothing else about it changes between callers.
 *
 * The destination is chosen here, while signed in, and stored on the request.
 * The public upload page never gets to name a folder, see
 * App\Http\Controllers\Files\PublicUploadController.
 */
(function () {
  'use strict';

  function ui() { return window.TMAPortalUI; }
  function net() { return window.TMAFilesNet; }
  function esc(s) { return ui() ? ui().esc(s) : String(s == null ? '' : s); }

  var GB = 1024 * 1024 * 1024;
  var MB = 1024 * 1024;

  /* Matches FileRequests::MAX_BYTES_CEILING. A request with no stored maximum
     still lands here, so "no maximum" is never announced as unbounded. */
  var MAX_BYTES_CEILING = 10 * MB;

  /*
   * The extensions a request link may ask for, one chip each.
   *
   * These were five bundles ("Documents", "Spreadsheets") whose contents were
   * only described in grey hint text, so nobody choosing "Documents" could see
   * that it also let in .rtf and .md. A person deciding what a stranger may
   * send them is deciding about extensions, so extensions are what the modal
   * offers. The server still accepts the old group keys, see
   * FileRequests::normalizeExtensions, so links made before this still work.
   *
   * Each carries its own file mark, resolved through TMAFileIcons from a
   * sample filename, which is the same map the file lists draw from.
   */
  var EXTENSIONS = [
    { ext: 'pdf', label: 'PDF' },
    { ext: 'doc', label: 'DOC' },
    { ext: 'docx', label: 'DOCX' },
    { ext: 'xls', label: 'XLS' },
    { ext: 'xlsx', label: 'XLSX' },
    { ext: 'ods', label: 'ODS' },
    { ext: 'csv', label: 'CSV' },
    { ext: 'ppt', label: 'PPT' },
    { ext: 'pptx', label: 'PPTX' },
    { ext: 'jpg', label: 'JPG' },
    { ext: 'png', label: 'PNG' },
  ];

  /** The file mark for an extension, from the one map the file lists use. */
  function extIconSrc(ext) {
    if (window.TMAFileIcons && window.TMAFileIcons.fileIconFromFilename) {
      return window.TMAFileIcons.fileIconFromFilename('sample.' + ext);
    }
    return 'images/icons/tma/DefaultIcon.svg';
  }

  /* Every mark offered above is a brand mark today, so nothing is stamped in
     practice; the check stays because adding one ink extension back to the
     list would otherwise paint a black square on a dark ground. Same stamp
     file-thumbs.js applies. */
  function extIconClass(src) {
    var mono = window.TMAFileIcons && window.TMAFileIcons.isMonoIcon
      && window.TMAFileIcons.isMonoIcon(src);
    return 'tma-portal-request__chip-icon' + (mono ? ' is-mono' : '');
  }

  /* Both choices are small on purpose, see App\Support\Files\FileRequests,
     which refuses anything above the larger one whatever is asked for. */
  var SIZE_CHOICES = [
    { value: 5 * MB, label: '5 MB' },
    { value: 10 * MB, label: '10 MB' },
  ];

  function humanSize(bytes) {
    var n = Math.min(bytes || MAX_BYTES_CEILING, MAX_BYTES_CEILING);
    if (n >= GB) return (n / GB).toFixed(n % GB ? 1 : 0) + ' GB';
    return Math.round(n / MB) + ' MB';
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing else to try */ }
    ta.remove();
  }

  /* Two weeks out, as a yyyy-mm-dd the date input accepts. Rendered from the
     browser's own clock so the default matches the reader's calendar. */
  function defaultExpiry() {
    var d = new Date();
    d.setDate(d.getDate() + 14);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function folderIconHtml(folder, size) {
    var px = size || 20;
    var base = folder && ((folder.fileCount || 0) + (folder.folderCount || 0)) === 0 ? 'FolderEmpty' : 'FolderFilled';
    if (window.TMAFolderIcons) return window.TMAFolderIcons.html(base, folder && folder.colour, folder && folder.iconName, px);
    return '<img src="images/icons/phosphor/' + base + '.svg" alt="" width="' + px + '" height="' + px + '">';
  }

  /* ── the modal ──────────────────────────────────────── */

  /**
   * @param {object} [ctx]
   * @param {string} [ctx.folderId]    destination folder uuid
   * @param {string} [ctx.folderName]  what to call it before it is loaded
   * @param {string} [ctx.clientId]    client uid, for a request about one client
   * @param {string} [ctx.clientName]
   * @param {string} [ctx.title]       pre-filled request title
   * @param {Function} [ctx.onCreated] called with the created request
   */
  /* What the form offers when the options cannot be read: the firm's usual. */
  var FALLBACK_OPTIONS = {
    reminders: {
      days: 3,
      choosable: true,
      choices: [
        { value: 0, label: 'Never' }, { value: 1, label: 'Every day' }, { value: 2, label: 'Every 2 days' },
        { value: 3, label: 'Every 3 days' }, { value: 7, label: 'Every week' },
      ],
    },
    defaults: { maxFiles: 5, allowedExtensions: ['pdf'] },
  };

  function open(ctx) {
    ctx = ctx || {};

    if (!ui() || !net()) return;

    // The reminder choices are the firm's (an administrator may fix them),
    // so they are read before the form is drawn.
    net().fetchJSON(net().url('/requests/options'))
      .then(function (res) { openWith(ctx, res && res.reminders ? res : FALLBACK_OPTIONS); })
      .catch(function () { openWith(ctx, FALLBACK_OPTIONS); });
  }

  function openWith(ctx, options) {
    var defaults = options.defaults || FALLBACK_OPTIONS.defaults;
    var groups = {};
    (defaults.allowedExtensions || ['pdf']).forEach(function (ext) { groups[ext] = true; });

    var draft = {
      title: ctx.title || (ctx.clientName ? 'Documents for ' + ctx.clientName : 'Please upload your documents'),
      message: '',
      folder: ctx.folderId || null,
      folderName: ctx.folderName || (ctx.folderId ? 'Selected folder' : 'File Box'),
      client: ctx.clientId || null,
      clientName: ctx.clientName || null,
      recipientEmail: '',
      recipientName: '',
      // Somebody on the portal, picked from the people this reader can reach.
      person: null,
      groups: groups,
      maxBytes: MAX_BYTES_CEILING,
      maxFiles: defaults.maxFiles || 5,
      reminders: options.reminders || FALLBACK_OPTIONS.reminders,
      allowMultiple: true,
      password: '',
      usePassword: false,
      expiresAt: defaultExpiry(),
      useExpiry: true,
      // Staff may also ask for named checklist documents on an application,
      // found by search; offered where no application is already in hand.
      offerDocuments: !ctx.clientId && canRequestDocuments(),
    };

    ui().openModal({
      title: 'Request Files',
      body: '<div class="tma-portal-request" data-request-body>' + formHtml(draft) + '</div>',
      onMount: function (host) { wireForm(host, draft, ctx); },
    });
  }

  function canRequestDocuments() {
    if (!window.TMACipDocumentRequests) return false;
    var me = window.TMACurrentUser && window.TMACurrentUser.get && window.TMACurrentUser.get();
    if (!me || !me.isStaff) return false;
    var access = window.TMAPortalAccess;

    return !access || !access.can || access.can('cip.view') || access.can('clients.view');
  }

  /* A field whose answer is required: the form's own red asterisk. */
  function requiredField(label, controlHtml) {
    return '<div class="tma-portal-field">' +
      '<span class="tma-portal-field__label">' + esc(label) +
      '<span class="tma-portal-field__required" aria-hidden="true">*</span></span>' +
      controlHtml +
      '</div>';
  }

  /* A person's picture, or their initials, the size of a picker row's mark. */
  function personFace(person) {
    var src = person && person.photo;
    if (!src && window.TMACurrentUser && window.TMACurrentUser.initialsFor && person) {
      src = window.TMACurrentUser.initialsFor(person.name || person.email || '', person.id || person.email || '');
    }

    return src
      ? '<img class="tma-cip-table__applicant-face" src="' + esc(src) + '" alt="" width="26" height="26">'
      : '<span class="tma-cip-table__applicant-face" aria-hidden="true"></span>';
  }

  function optionRow(label, hint, controlHtml, required) {
    return '<div class="tma-portal-request__row">' +
      '<div class="tma-portal-request__row-copy">' +
      '<span class="tma-portal-request__row-label">' + esc(label) +
      (required ? '<span class="tma-portal-field__required" aria-hidden="true">*</span>' : '') + '</span>' +
      (hint ? '<span class="tma-portal-request__row-hint">' + esc(hint) + '</span>' : '') +
      '</div>' +
      '<div class="tma-portal-request__row-control">' + controlHtml + '</div>' +
      '</div>';
  }

  function formHtml(draft) {
    var sizeOptions = SIZE_CHOICES.map(function (s) {
      return { value: String(s.value), label: s.label };
    });

    return '' +
      // One wrapper so the destination picker can hide the whole form without
      // destroying it, see pickDestination.
      '<div data-req-form>' +

      // ── which kind of request
      (draft.offerDocuments
        ? '<div class="tma-portal-request__section">' +
          '<h3 class="tma-portal-request__heading">What are you asking for?</h3>' +
          '<div class="tma-portal-radio-row">' +
          '<label class="tma-portal-radio"><input type="radio" name="tma-req-kind" value="files" data-req-kind checked>' +
          '<span class="tma-portal-radio__dot" aria-hidden="true"></span> Any files, into a folder</label>' +
          '<label class="tma-portal-radio"><input type="radio" name="tma-req-kind" value="documents" data-req-kind>' +
          '<span class="tma-portal-radio__dot" aria-hidden="true"></span> Documents on an application</label>' +
          '</div></div>'
        : '') +

      // ── what you are asking for
      '<div class="tma-portal-request__section">' +
      requiredField('Request title', ui().input({
        value: draft.title,
        placeholder: 'Please upload your documents',
        attrs: 'data-req-title maxlength="150" aria-required="true"',
      })) +
      requiredField('Instructions',
        '<textarea class="tma-portal-textarea" data-req-message maxlength="2000" rows="3" aria-required="true"' +
        ' placeholder="Tell them exactly which documents you need, and anything they should know."></textarea>') +
      '</div>' +

      // ── where it lands
      '<div class="tma-portal-request__section">' +
      '<h3 class="tma-portal-request__heading">Where uploads go</h3>' +
      '<div class="tma-portal-request__dest" data-req-dest>' +
      '<span class="tma-portal-request__dest-icon">' +
      '<img src="images/icons/phosphor/FolderFilled.svg" alt="" width="20" height="20"></span>' +
      '<span class="tma-portal-request__dest-name" data-req-dest-name>' + esc(draft.folderName) + '</span>' +
      '<button type="button" class="tma-portal-link" data-req-pick>Change</button>' +
      '</div>' +
      (draft.clientName
        ? '<p class="tma-portal-request__note">Filed under <strong>' + esc(draft.clientName) + '</strong>.</p>'
        : '') +
      '</div>' +

      // ── who it goes to
      '<div class="tma-portal-request__section">' +
      '<h3 class="tma-portal-request__heading">Who you are asking</h3>' +
      '<div class="tma-portal-radio-row">' +
      '<label class="tma-portal-radio"><input type="radio" name="tma-req-who" value="user" data-req-who checked>' +
      '<span class="tma-portal-radio__dot" aria-hidden="true"></span> Someone on the portal</label>' +
      '<label class="tma-portal-radio"><input type="radio" name="tma-req-who" value="external" data-req-who>' +
      '<span class="tma-portal-radio__dot" aria-hidden="true"></span> Someone else</label>' +
      '</div>' +
      // Somebody on the portal: found by name or address, their own details used.
      '<div data-req-who-user>' +
      '<div data-req-person-chosen hidden></div>' +
      '<div data-req-person-find>' +
      requiredField('Find a person', ui().input({
        type: 'search',
        placeholder: 'Name or email address',
        attrs: 'data-req-person-search autocomplete="off" spellcheck="false"',
      })) +
      '<div class="tma-portal-picker" data-req-person-results>' +
      '<p class="tma-portal-picker__empty">Type a name or an email address.</p></div>' +
      '</div>' +
      '<p class="tma-portal-request__note">They get the email, and a message and a notification in the portal, each with the link.</p>' +
      '</div>' +
      // Anybody else: their email address is all it takes.
      '<div data-req-who-external hidden>' +
      requiredField('Email address', ui().input({ type: 'email', value: draft.recipientEmail, placeholder: 'jane@example.com', attrs: 'data-req-remail' })) +
      '</div>' +
      '</div>' +

      // ── the rules
      '<div class="tma-portal-request__section">' +
      '<h3 class="tma-portal-request__heading">Rules</h3>' +

      optionRow('Allowed file types', 'At least one. Only these can be uploaded.',
        '<div class="tma-portal-request__chips">' +
        EXTENSIONS.map(function (e) {
          var src = extIconSrc(e.ext);
          return '<label class="tma-portal-request__chip">' +
            '<input type="checkbox" data-req-group="' + esc(e.ext) + '"' + (draft.groups[e.ext] ? ' checked' : '') + '>' +
            '<img class="' + extIconClass(src) + '" src="' + esc(src) + '"' +
            ' alt="" width="16" height="16" aria-hidden="true">' +
            '<span>' + esc(e.label) + '</span></label>';
        }).join('') +
        '</div>', true) +

      optionRow('Maximum file size', null,
        ui().select(sizeOptions, String(draft.maxBytes), 'data-req-size', 'Maximum file size')) +

      optionRow('Multiple files', 'Turn off to accept a single file and close the link.',
        ui().toggle(draft.allowMultiple, 'data-req-multiple', 'Allow multiple files')) +

      optionRow('How many files', null,
        ui().input({ type: 'number', value: String(draft.maxFiles), attrs: 'data-req-maxfiles min="1" max="200"' })) +

      optionRow('Reminders',
        draft.reminders.choosable
          ? 'How often they are reminded, by email and in the portal, until it arrives.'
          : 'Set by your administrator.',
        ui().select(draft.reminders.choices || [], String(draft.reminders.days), 'data-req-reminder' +
          (draft.reminders.choosable ? '' : ' disabled'), 'Reminder frequency')) +

      optionRow('Expires', 'The link stops accepting uploads after this date.',
        '<div class="tma-portal-request__inline">' +
        ui().toggle(draft.useExpiry, 'data-req-use-expiry', 'Set an expiry date') +
        '<input class="tma-portal-input" type="date" data-req-expiry value="' + esc(draft.expiresAt) + '">' +
        '</div>') +

      optionRow('Password protect', 'Send the password separately from the link.',
        '<div class="tma-portal-request__inline">' +
        ui().toggle(false, 'data-req-use-password', 'Require a password') +
        ui().input({ type: 'text', placeholder: 'At least 4 characters', attrs: 'data-req-password autocomplete="off" disabled' }) +
        '</div>') +

      '</div>' +

      '<p class="tma-portal-request__error" data-req-error hidden></p>' +

      '<div class="tma-portal-form-actions tma-portal-form-actions--start">' +
      ui().btn({ label: 'Create link', icon: 'LinkSimple', attrs: ' data-req-create' }) +
      ui().btn({ label: 'Create and send', icon: 'PaperPlaneTilt', variant: 'ghost', attrs: ' data-req-send' }) +
      ui().btn({ label: 'Cancel', variant: 'ghost', attrs: ' data-portal-modal-close' }) +
      '</div>' +

      '</div>';
  }

  /** The created-request panel: the link, and what to do with it. */
  function doneHtml(req) {
    var rules = [];
    if (req.allowedExtensions && req.allowedExtensions.length) {
      rules.push(req.allowedExtensions.map(function (e) { return e.toUpperCase(); }).join(', '));
    }
    rules.push('up to ' + humanSize(req.maxBytes));
    rules.push(req.maxFiles === 1 ? 'one file' : req.maxFiles + ' files');
    if (req.hasPassword) rules.push('password protected');
    if (req.expiresAt) rules.push('expires ' + new Date(req.expiresAt).toLocaleDateString());

    return '' +
      '<div class="tma-portal-request__done">' +
      '<p class="tma-portal-request__done-title">Your upload link is ready</p>' +
      '<p class="tma-portal-request__note">Uploads land in <strong>' + esc(req.destination.name) + '</strong>: ' +
      esc(rules.join(' · ')) + '.</p>' +
      '<div class="tma-portal-share__link-row">' +
      '<input type="text" class="tma-portal-share__link" data-req-link readonly value="' + esc(req.link) + '">' +
      '<button type="button" class="tma-no-data__btn" data-req-copy>Copy</button>' +
      '</div>' +
      '<div class="tma-portal-request__pair" style="margin-top:var(--space-12)">' +
      ui().field('Email it to', ui().input({
        type: 'email',
        value: req.recipientEmail || '',
        placeholder: 'jane@example.com',
        attrs: 'data-req-done-email',
      })) +
      '<div class="tma-portal-field"><span class="tma-portal-field__label">&nbsp;</span>' +
      ui().btn({ label: 'Send request', icon: 'PaperPlaneTilt', attrs: ' data-req-done-send' }) +
      '</div>' +
      '</div>' +
      '<p class="tma-portal-request__error" data-req-error hidden></p>' +
      '<div class="tma-portal-form-actions tma-portal-form-actions--start">' +
      ui().btn({ label: 'Done', variant: 'ghost', attrs: ' data-portal-modal-close' }) +
      '</div>' +
      '</div>';
  }

  function showError(host, message) {
    var el = host.querySelector('[data-req-error]');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  function wireForm(host, draft, ctx) {
    var body = host.querySelector('[data-request-body]');
    var pwInput = host.querySelector('[data-req-password]');
    var pwToggle = host.querySelector('[data-req-use-password]');
    var expiryInput = host.querySelector('[data-req-expiry]');
    var expiryToggle = host.querySelector('[data-req-use-expiry]');
    var multipleToggle = host.querySelector('[data-req-multiple]');
    var maxFilesInput = host.querySelector('[data-req-maxfiles]');

    // A password field that is enabled but ignored, or a count that is asked
    // for and then overridden, is how a form teaches people not to trust it.
    // Each dependent control follows its own switch.
    function syncPassword() {
      pwInput.disabled = !pwToggle.checked;
      if (!pwToggle.checked) pwInput.value = '';
    }
    function syncExpiry() {
      expiryInput.disabled = !expiryToggle.checked;
    }
    function syncMultiple() {
      maxFilesInput.disabled = !multipleToggle.checked;
      if (!multipleToggle.checked) maxFilesInput.value = '1';
      else if (maxFilesInput.value === '1') maxFilesInput.value = '5';
    }

    pwToggle.addEventListener('change', syncPassword);
    expiryToggle.addEventListener('change', syncExpiry);
    multipleToggle.addEventListener('change', syncMultiple);
    syncPassword();
    syncExpiry();
    syncMultiple();

    host.querySelector('[data-req-pick]').addEventListener('click', function () {
      pickDestination(host, draft);
    });

    wireRecipient(host, draft);

    host.querySelectorAll('[data-req-kind]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (radio.checked && radio.value === 'documents') pickApplication(host);
      });
    });

    function collect() {
      var groups = [];
      host.querySelectorAll('[data-req-group]').forEach(function (box) {
        if (box.checked) groups.push(box.getAttribute('data-req-group'));
      });

      var size = parseInt(host.querySelector('[data-req-size]').value, 10) || 0;
      var multiple = multipleToggle.checked;
      var whoEl = host.querySelector('[data-req-who]:checked');
      var who = whoEl ? whoEl.value : 'external';
      var reminderEl = host.querySelector('[data-req-reminder]');

      return {
        who: who,
        title: (host.querySelector('[data-req-title]').value || '').trim(),
        message: (host.querySelector('[data-req-message]').value || '').trim() || null,
        folder: draft.folder,
        client: draft.client,
        recipientUserId: who === 'user' && draft.person ? draft.person.id : null,
        recipientName: null,
        recipientEmail: who === 'external' ? ((host.querySelector('[data-req-remail]').value || '').trim() || null) : null,
        allowedExtensions: groups.length ? groups : null,
        maxBytes: size || null,
        maxFiles: multiple ? (parseInt(maxFilesInput.value, 10) || 5) : 1,
        allowMultiple: multiple,
        password: pwToggle.checked ? pwInput.value : null,
        expiresAt: expiryToggle.checked ? (expiryInput.value || null) : null,
        reminderEveryDays: reminderEl ? parseInt(reminderEl.value, 10) : null,
      };
    }

    function create(send) {
      var payload = collect();

      if (!payload.title) {
        showError(host, 'Give the request a title so the recipient knows what it is for.');
        host.querySelector('[data-req-title]').focus();
        return;
      }
      if (!payload.message) {
        showError(host, 'Add instructions so they know exactly what to upload.');
        host.querySelector('[data-req-message]').focus();
        return;
      }
      if (payload.who === 'user' && !payload.recipientUserId) {
        showError(host, 'Choose the person you are asking.');
        var find = host.querySelector('[data-req-person-search]');
        if (find) find.focus();
        return;
      }
      if (payload.who === 'external' && !payload.recipientEmail) {
        showError(host, 'Add the email address of the person you are asking.');
        host.querySelector('[data-req-remail]').focus();
        return;
      }
      if (!payload.allowedExtensions) {
        showError(host, 'Choose at least one file type they may upload.');
        return;
      }
      delete payload.who;
      if (payload.password !== null && payload.password.length < 4) {
        showError(host, 'A password needs at least 4 characters.');
        pwInput.focus();
        return;
      }

      showError(host, '');
      payload.send = !!send;

      var buttons = host.querySelectorAll('[data-req-create], [data-req-send]');
      buttons.forEach(function (b) { b.disabled = true; });

      net().fetchJSON(net().url('/requests'), { method: 'POST', json: payload })
        .then(function (res) {
          body.innerHTML = doneHtml(res.request);
          wireDone(host, res.request, ctx);
          ui().toast(res.emailed ? 'Request sent' : 'Upload link created');
          if (typeof ctx.onCreated === 'function') ctx.onCreated(res.request);
        })
        .catch(function (err) {
          buttons.forEach(function (b) { b.disabled = false; });
          showError(host, (err && err.message) || 'Could not create the request.');
        });
    }

    host.querySelector('[data-req-create]').addEventListener('click', function () { create(false); });
    host.querySelector('[data-req-send]').addEventListener('click', function () { create(true); });
  }

  /*
   * Who is being asked.
   *
   * Somebody on the portal is found among the people this reader may reach
   * (the same list Messages offers them) and their own name and address are
   * used; anybody else is a name and an address typed in.
   */
  function wireRecipient(host, draft) {
    var userBox = host.querySelector('[data-req-who-user]');
    var externalBox = host.querySelector('[data-req-who-external]');
    var chosen = host.querySelector('[data-req-person-chosen]');
    var find = host.querySelector('[data-req-person-find]');
    var input = host.querySelector('[data-req-person-search]');
    var results = host.querySelector('[data-req-person-results]');
    var seq = 0;
    var timer = null;

    host.querySelectorAll('[data-req-who]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        userBox.hidden = radio.value !== 'user';
        externalBox.hidden = radio.value !== 'external';
        showError(host, '');
      });
    });

    function paintChosen() {
      var person = draft.person;
      chosen.hidden = !person;
      find.hidden = !!person;
      if (!person) {
        chosen.innerHTML = '';
        return;
      }
      chosen.innerHTML = '<div class="tma-portal-picker__list"><div class="tma-portal-picker__folder is-current">' +
        personFace(person) +
        '<span class="tma-save-folder__name">' + esc(person.name || person.email) +
        (person.email ? '<span class="tma-save-folder__path">' + esc(person.email) + '</span>' : '') +
        '</span>' +
        '<button type="button" class="tma-portal-link" data-req-person-change>Change</button>' +
        '</div></div>';
      chosen.querySelector('[data-req-person-change]').addEventListener('click', function () {
        draft.person = null;
        paintChosen();
        input.value = '';
        results.innerHTML = '<p class="tma-portal-picker__empty">Type a name or an email address.</p>';
        input.focus();
      });
    }

    function search(q) {
      var mine = ++seq;
      results.innerHTML = ui().loading({ count: 3 });
      net().fetchJSON('/portal/messaging/contacts?q=' + encodeURIComponent(q))
        .then(function (res) {
          if (mine !== seq) return;
          var people = (res && res.contacts) || [];
          if (!people.length) {
            results.innerHTML = '<p class="tma-portal-picker__empty">Nobody on the portal matches. Choose “Someone else” to enter their details.</p>';
            return;
          }
          results.innerHTML = '<div class="tma-portal-picker__list">' + people.slice(0, 12).map(function (person, i) {
            return '<button type="button" class="tma-portal-picker__folder" data-req-person="' + i + '">' +
              personFace(person) +
              '<span class="tma-save-folder__name">' + esc(person.name || person.email) +
              (person.email ? '<span class="tma-save-folder__path">' + esc(person.email) + '</span>' : '') +
              '</span></button>';
          }).join('') + '</div>';
          results.querySelectorAll('[data-req-person]').forEach(function (b) {
            b.addEventListener('click', function () {
              draft.person = people[parseInt(b.getAttribute('data-req-person'), 10)];
              showError(host, '');
              paintChosen();
            });
          });
        })
        .catch(function () {
          if (mine !== seq) return;
          results.innerHTML = '<p class="tma-portal-picker__empty">Could not search the portal.</p>';
        });
    }

    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        if (q.length >= 2) search(q);
        else results.innerHTML = '<p class="tma-portal-picker__empty">Type a name or an email address.</p>';
      }, 250);
    });

    paintChosen();
  }

  function wireDone(host, req, ctx) {
    var panel = host.querySelector('.tma-portal-request__done');
    var link = host.querySelector('[data-req-link]');

    host.querySelector('[data-req-copy]').addEventListener('click', function () {
      link.select();
      copyText(link.value);
      ui().toast('Link copied');
    });

    // This panel's own Done button did not exist when openModal wired the
    // dialog, so it needs binding here. Scoped to the panel: the header close
    // and the backdrop are already wired, and re-selecting them would stack a
    // second handler on each.
    panel.querySelectorAll('[data-portal-modal-close]').forEach(function (b) {
      b.addEventListener('click', ui().closeModal);
    });

    var send = host.querySelector('[data-req-done-send]');
    send.addEventListener('click', function () {
      var email = (host.querySelector('[data-req-done-email]').value || '').trim();
      if (!email) {
        showError(host, 'Enter an email address to send this to.');
        return;
      }
      showError(host, '');
      send.disabled = true;
      net().fetchJSON(net().url('/requests/' + encodeURIComponent(req.id) + '/send'), {
        method: 'POST',
        json: { email: email },
      })
        .then(function () {
          ui().toast('Request sent to ' + email);
          ui().closeModal();
          if (typeof ctx.onCreated === 'function') ctx.onCreated(req);
        })
        .catch(function (err) {
          send.disabled = false;
          showError(host, (err && err.message) || 'Could not send the request.');
        });
    });
  }

  /*
   * The destination picker.
   *
   * Layered over the form rather than replacing it. Rebuilding the form
   * afterwards would be simpler to write and would silently throw away
   * everything already typed into it, the title, the instructions, the
   * recipient, because those live in the DOM, not in `draft`. Hiding it
   * instead means coming back lands on the form exactly as it was left.
   */
  /*
   * Documents on an application: find it by applicant, number or provider —
   * each result with the applicant's own picture, as the applications table
   * shows them — then choose the documents in the checklist dialog.
   */
  function applicantFace(row) {
    var src = row && row.photo;
    if (!src && window.TMACurrentUser && window.TMACurrentUser.initialsFor && row && row.applicantName) {
      src = window.TMACurrentUser.initialsFor(row.applicantName, row.id || row.applicantName);
    }

    return src
      ? '<img class="tma-cip-table__applicant-face" src="' + esc(src) + '" alt="" width="26" height="26">'
      : '<span class="tma-cip-table__applicant-face" aria-hidden="true"></span>';
  }

  function pickApplication(host) {
    var body = host.querySelector('[data-request-body]');
    var form = body.querySelector('[data-req-form]');

    var panel = document.createElement('div');
    panel.className = 'tma-portal-request__picker';
    panel.innerHTML =
      '<h3 class="tma-portal-request__heading">Find the application</h3>' +
      ui().field('Applicant, application number or provider', ui().input({
        type: 'search',
        placeholder: 'Search',
        attrs: 'data-req-app-search autocomplete="off" spellcheck="false"',
      })) +
      '<div class="tma-portal-picker" data-req-app-results>' +
      '<p class="tma-portal-picker__empty">Type a name or a number.</p></div>' +
      '<div class="tma-portal-form-actions tma-portal-form-actions--start">' +
      ui().btn({ label: 'Back', variant: 'ghost', attrs: ' data-req-app-back' }) +
      '</div>';

    form.hidden = true;
    body.appendChild(panel);

    var input = panel.querySelector('[data-req-app-search]');
    var results = panel.querySelector('[data-req-app-results]');
    var seq = 0;
    var timer = null;

    function back() {
      panel.remove();
      form.hidden = false;
      var files = form.querySelector('[data-req-kind][value="files"]');
      if (files) files.checked = true;
    }

    function choose(row) {
      results.innerHTML = ui().loading({ count: 2 });
      net().fetchJSON('/portal/cip/applications/' + encodeURIComponent(row.id))
        .then(function (res) {
          var record = res && res.application;
          if (!record) throw new Error('Could not open this application.');
          ui().closeModal();
          window.TMACipDocumentRequests.open(record);
        })
        .catch(function (err) {
          results.innerHTML = '<p class="tma-portal-picker__empty">' + esc((err && err.message) || 'Could not open this application.') + '</p>';
        });
    }

    function search(q) {
      var mine = ++seq;
      results.innerHTML = ui().loading({ count: 3 });
      var p = new URLSearchParams();
      p.set('q', q);
      p.set('perPage', '12');
      net().fetchJSON('/portal/cip/applications?' + p.toString())
        .then(function (res) {
          if (mine !== seq) return;
          var rows = (res && res.applications) || [];
          if (!rows.length) {
            results.innerHTML = '<p class="tma-portal-picker__empty">No applications match.</p>';
            return;
          }
          results.innerHTML = '<div class="tma-portal-picker__list">' + rows.map(function (row, i) {
            var meta = [row.number, row.provider].filter(Boolean).join(' · ');
            return '<button type="button" class="tma-portal-picker__folder" data-req-app="' + i + '">' +
              applicantFace(row) +
              '<span class="tma-save-folder__name">' + esc(row.applicantName || row.number || 'Application') +
              (meta ? '<span class="tma-save-folder__path">' + esc(meta) + '</span>' : '') +
              '</span>' +
              (row.statusLabel
                ? '<span class="tma-portal-status tma-portal-status--' + esc(row.statusTone || 'neutral') +
                  ' tma-portal-status--inline">' + esc(row.statusLabel) + '</span>'
                : '') +
              '</button>';
          }).join('') + '</div>';
          results.querySelectorAll('[data-req-app]').forEach(function (b) {
            b.addEventListener('click', function () { choose(rows[parseInt(b.getAttribute('data-req-app'), 10)]); });
          });
        })
        .catch(function () {
          if (mine !== seq) return;
          results.innerHTML = '<p class="tma-portal-picker__empty">Could not search applications.</p>';
        });
    }

    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        if (q.length >= 2) search(q);
        else results.innerHTML = '<p class="tma-portal-picker__empty">Type a name or a number.</p>';
      }, 250);
    });
    panel.querySelector('[data-req-app-back]').addEventListener('click', back);
    input.focus();
  }

  function pickDestination(host, draft) {
    var body = host.querySelector('[data-request-body]');
    var form = body.querySelector('[data-req-form]');
    var current = { folder: draft.folder, name: draft.folderName };

    var panel = document.createElement('div');
    panel.className = 'tma-portal-request__picker';
    panel.innerHTML =
      '<h3 class="tma-portal-request__heading">Choose where uploads go</h3>' +
      '<div class="tma-portal-picker" data-req-picker>' + ui().loading({ count: 4 }) + '</div>' +
      '<div class="tma-portal-form-actions tma-portal-form-actions--start">' +
      ui().btn({ label: 'Use this folder', attrs: ' data-req-pick-ok' }) +
      ui().btn({ label: 'Back', variant: 'ghost', attrs: ' data-req-pick-cancel' }) +
      '</div>';

    form.hidden = true;
    body.appendChild(panel);

    var list = panel.querySelector('[data-req-picker]');

    function restore(commit) {
      if (commit) {
        draft.folder = current.folder;
        draft.folderName = current.name;
        var n = form.querySelector('[data-req-dest-name]');
        if (n) n.textContent = draft.folderName;
      }
      panel.remove();
      form.hidden = false;
    }

    function load() {
      list.innerHTML = ui().loading({ count: 4 });
      var p = new URLSearchParams();
      // "my" is the same section the File Library's own Move picker browses,
      // so the folders offered here are exactly the ones this account may
      // write to, and the server re-checks that on create regardless.
      p.set('section', 'my');
      if (current.folder) p.set('folder', current.folder);
      p.set('perPage', '200');
      p.set('sort', 'name');

      net().fetchJSON(net().url('/?' + p.toString()))
        .then(function (res) {
          var crumbs = '<button type="button" class="tma-portal-picker__crumb" data-req-crumb="">File Box</button>';
          (res.breadcrumb || []).forEach(function (c) {
            crumbs += ' / <button type="button" class="tma-portal-picker__crumb" data-req-crumb="' + esc(c.id) + '">' + esc(c.name) + '</button>';
          });

          var folders = res.folders || [];
          var rows = folders.length
            ? folders.map(function (f) {
              return '<button type="button" class="tma-portal-picker__folder" data-req-open="' + esc(f.id) + '" data-req-name="' + esc(f.name) + '">' +
                folderIconHtml(f, 20) + '<span>' + esc(f.name) + '</span></button>';
            }).join('')
            : '<p class="tma-portal-picker__empty">No subfolders here.</p>';

          list.innerHTML = '<div class="tma-portal-picker__crumbs">' + crumbs + '</div>' +
            '<div class="tma-portal-picker__list">' + rows + '</div>';

          list.querySelectorAll('[data-req-open]').forEach(function (b) {
            b.addEventListener('click', function () {
              current.folder = b.getAttribute('data-req-open');
              current.name = b.getAttribute('data-req-name');
              load();
            });
          });
          list.querySelectorAll('[data-req-crumb]').forEach(function (b) {
            b.addEventListener('click', function () {
              current.folder = b.getAttribute('data-req-crumb') || null;
              current.name = b.textContent.trim() || 'File Box';
              load();
            });
          });
        })
        .catch(function () {
          list.innerHTML = '<p class="tma-portal-picker__empty">Could not load folders.</p>';
        });
    }

    panel.querySelector('[data-req-pick-ok]').addEventListener('click', function () { restore(true); });
    panel.querySelector('[data-req-pick-cancel]').addEventListener('click', function () { restore(false); });

    load();
  }

  window.TMAFileRequests = {
    open: open,
    humanSize: humanSize,
  };
})();
