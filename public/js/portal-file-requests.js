/*
 * TMA - Request Files
 * Global: window.TMAFileRequests
 *
 * One modal, three entry points: the Dashboard shortcut, the File Library
 * (toolbar, folder menu and File Box), and a client's Documents tab. They all
 * open the *same* dialog against the same endpoint — the alternative, three
 * dialogs that look alike, is how the old prototype ended up with a Dashboard
 * version that only asked for an email address and a File Box version that
 * asked for a different one, neither of which sent anything anywhere.
 *
 * The caller supplies context (a folder, a client) and the modal fills it in;
 * nothing else about it changes between callers.
 *
 * The destination is chosen here, while signed in, and stored on the request.
 * The public upload page never gets to name a folder — see
 * App\Http\Controllers\Files\PublicUploadController.
 */
(function () {
  'use strict';

  function ui() { return window.TMAPortalUI; }
  function net() { return window.TMAFilesNet; }
  function esc(s) { return ui() ? ui().esc(s) : String(s == null ? '' : s); }

  var GB = 1024 * 1024 * 1024;
  var MB = 1024 * 1024;

  /* Mirrors App\Support\Files\FileRequests::TYPE_GROUPS. The server owns the
     real list; these are the labels and the order they are offered in. */
  var TYPE_GROUPS = [
    { key: 'documents', label: 'Documents', hint: 'PDF, Word, text' },
    { key: 'spreadsheets', label: 'Spreadsheets', hint: 'Excel, CSV' },
    { key: 'presentations', label: 'Presentations', hint: 'PowerPoint' },
    { key: 'images', label: 'Images', hint: 'JPG, PNG, HEIC' },
    { key: 'archives', label: 'Archives', hint: 'ZIP, RAR' },
  ];

  var SIZE_CHOICES = [
    { value: 10 * MB, label: '10 MB' },
    { value: 25 * MB, label: '25 MB' },
    { value: 100 * MB, label: '100 MB' },
    { value: 500 * MB, label: '500 MB' },
    { value: 0, label: 'No limit (up to 2 GB)' },
  ];

  function humanSize(bytes) {
    if (!bytes) return '2 GB';
    if (bytes >= GB) return (bytes / GB).toFixed(bytes % GB ? 1 : 0) + ' GB';
    return Math.round(bytes / MB) + ' MB';
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
    var base = folder && folder.fileCount === 0 ? 'FolderEmpty' : 'FolderFilled';
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
  function open(ctx) {
    ctx = ctx || {};

    if (!ui() || !net()) return;

    var draft = {
      title: ctx.title || (ctx.clientName ? 'Documents for ' + ctx.clientName : 'Please upload your documents'),
      message: '',
      folder: ctx.folderId || null,
      folderName: ctx.folderName || (ctx.folderId ? 'Selected folder' : 'File Box'),
      client: ctx.clientId || null,
      clientName: ctx.clientName || null,
      recipientEmail: '',
      recipientName: '',
      groups: {},
      maxBytes: 100 * MB,
      maxFiles: 20,
      allowMultiple: true,
      password: '',
      usePassword: false,
      expiresAt: defaultExpiry(),
      useExpiry: true,
    };

    ui().openModal({
      title: 'Request Files',
      body: '<div class="tma-portal-request" data-request-body>' + formHtml(draft) + '</div>',
      onMount: function (host) { wireForm(host, draft, ctx); },
    });
  }

  function optionRow(label, hint, controlHtml) {
    return '<div class="tma-portal-request__row">' +
      '<div class="tma-portal-request__row-copy">' +
      '<span class="tma-portal-request__row-label">' + esc(label) + '</span>' +
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
      // destroying it — see pickDestination.
      '<div data-req-form>' +

      // ── what you are asking for
      '<div class="tma-portal-request__section">' +
      ui().field('Request title', ui().input({
        value: draft.title,
        placeholder: 'Please upload your documents',
        attrs: 'data-req-title maxlength="150"',
      })) +
      '<div class="tma-portal-field">' +
      '<span class="tma-portal-field__label">Instructions</span>' +
      '<textarea class="tma-portal-textarea" data-req-message maxlength="2000" rows="3"' +
      ' placeholder="Tell them exactly which documents you need, and anything they should know."></textarea>' +
      '</div>' +
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
      '<div class="tma-portal-request__pair">' +
      ui().field('Name', ui().input({ value: draft.recipientName, placeholder: 'Jane Doe', attrs: 'data-req-rname maxlength="120"' })) +
      ui().field('Email address', ui().input({ type: 'email', value: draft.recipientEmail, placeholder: 'jane@example.com', attrs: 'data-req-remail' })) +
      '</div>' +
      '<p class="tma-portal-request__note">Leave the email blank to copy the link and send it yourself.</p>' +
      '</div>' +

      // ── the rules
      '<div class="tma-portal-request__section">' +
      '<h3 class="tma-portal-request__heading">Rules</h3>' +

      optionRow('Allowed file types', 'Everything is accepted when none are ticked.',
        '<div class="tma-portal-request__chips">' +
        TYPE_GROUPS.map(function (g) {
          return '<label class="tma-portal-request__chip">' +
            '<input type="checkbox" data-req-group="' + g.key + '">' +
            '<span>' + esc(g.label) + '</span></label>';
        }).join('') +
        '</div>') +

      optionRow('Maximum file size', null,
        ui().select(sizeOptions, String(draft.maxBytes), 'data-req-size', 'Maximum file size')) +

      optionRow('Multiple files', 'Turn off to accept a single file and close the link.',
        ui().toggle(draft.allowMultiple, 'data-req-multiple', 'Allow multiple files')) +

      optionRow('How many files', null,
        ui().input({ type: 'number', value: String(draft.maxFiles), attrs: 'data-req-maxfiles min="1" max="200"' })) +

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
      ui().btn({ label: 'Create and email', icon: 'PaperPlaneTilt', variant: 'ghost', attrs: ' data-req-send' }) +
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
      '<p class="tma-portal-request__note">Uploads land in <strong>' + esc(req.destination.name) + '</strong> — ' +
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
      else if (maxFilesInput.value === '1') maxFilesInput.value = '20';
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

    function collect() {
      var groups = [];
      host.querySelectorAll('[data-req-group]').forEach(function (box) {
        if (box.checked) groups.push(box.getAttribute('data-req-group'));
      });

      var size = parseInt(host.querySelector('[data-req-size]').value, 10) || 0;
      var multiple = multipleToggle.checked;

      return {
        title: (host.querySelector('[data-req-title]').value || '').trim(),
        message: (host.querySelector('[data-req-message]').value || '').trim() || null,
        folder: draft.folder,
        client: draft.client,
        recipientName: (host.querySelector('[data-req-rname]').value || '').trim() || null,
        recipientEmail: (host.querySelector('[data-req-remail]').value || '').trim() || null,
        allowedExtensions: groups.length ? groups : null,
        maxBytes: size || null,
        maxFiles: multiple ? (parseInt(maxFilesInput.value, 10) || 20) : 1,
        allowMultiple: multiple,
        password: pwToggle.checked ? pwInput.value : null,
        expiresAt: expiryToggle.checked ? (expiryInput.value || null) : null,
      };
    }

    function create(send) {
      var payload = collect();

      if (!payload.title) {
        showError(host, 'Give the request a title so the recipient knows what it is for.');
        host.querySelector('[data-req-title]').focus();
        return;
      }
      if (send && !payload.recipientEmail) {
        showError(host, 'Add an email address, or use “Create link” and send it yourself.');
        host.querySelector('[data-req-remail]').focus();
        return;
      }
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
   * everything already typed into it — the title, the instructions, the
   * recipient — because those live in the DOM, not in `draft`. Hiding it
   * instead means coming back lands on the form exactly as it was left.
   */
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
      // write to — and the server re-checks that on create regardless.
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
