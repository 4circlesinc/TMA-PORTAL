/*
 * Save to Application Folder.
 *
 * A file that arrived in a message or an email belongs, more often than not,
 * in an applicant's folder. Getting it there meant downloading it to the
 * computer and uploading it again. This dialog files a copy straight into the
 * document library: find the applicant (or any folder) by name, or browse,
 * step into the subfolder, and save. The server does the same checks an
 * upload does — the reader must be allowed to add files to that folder, and
 * the file's type is inspected from its bytes.
 *
 *   TMASaveToFolder.open({ kind: 'messaging' | 'mail', id: <attachment uuid>, name: 'scan.pdf' })
 *
 * Global: window.TMASaveToFolder
 */
(function () {
  'use strict';

  var FILES = '/portal/files';

  function ui() { return window.TMAPortalUI; }
  function net() { return window.TMAFilesNet; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(message, tone) {
    var u = ui();
    if (u && u.toast) u.toast(message, { state: tone === 'negative' ? 'failure' : 'successful' });
  }

  function saveUrl(kind, id) {
    return (kind === 'mail' ? '/portal/mail/attachments/' : '/portal/messaging/attachments/') +
      encodeURIComponent(id) + '/save';
  }

  function folderIcon(folder) {
    if (window.TMAFolderIcons && window.TMAFolderIcons.html) {
      var count = (folder.fileCount || 0) + (folder.folderCount || 0);
      return window.TMAFolderIcons.html(count ? 'FolderFilled' : 'FolderEmpty', folder.colour, folder.iconName, 20);
    }

    return '<img src="images/icons/phosphor/Folder.svg" alt="" width="20" height="20">';
  }

  /*
   * Where a search result sits, so two folders both called "Main Applicant"
   * can be told apart: the applicant's name is in the path above it.
   */
  function pathLabel(folder) {
    var path = folder && folder.path;
    if (Array.isArray(path) && path.length) {
      return path.map(function (p) { return p && (p.name || p); }).filter(Boolean).join(' / ');
    }
    if (folder && folder.parent && folder.parent.name) return folder.parent.name;

    return '';
  }

  function open(opts) {
    opts = opts || {};
    var u = ui();
    var n = net();
    if (!u || !u.openModal || !n || !opts.id) return;

    var pick = { folder: null, name: '', crumb: [], query: '', searchSeq: 0 };

    u.openModal({
      title: 'Save to Application Folder',
      cls: 'tma-save-folder',
      body:
        '<p class="tma-portal-modal__text">Save a copy of <strong>' + esc(opts.name || 'this file') + '</strong> into the document library. ' +
        'Find the applicant, open the subfolder it belongs in, then save.</p>' +
        '<div class="tma-dash__clients-field">' +
        '<label class="tma-dash__clients-field-label" for="tma-save-folder-search">Find an applicant or folder</label>' +
        '<input type="search" id="tma-save-folder-search" class="tma-dash__clients-field-input" data-save-search' +
        ' placeholder="Search" autocomplete="off" spellcheck="false">' +
        '</div>' +
        '<div class="tma-portal-picker" data-save-picker></div>' +
        '<div class="tma-portal-modal__foot">' +
        '<span class="tma-save-folder__where" data-save-where></span>' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-save-cancel>Cancel</button>' +
        '<button type="button" class="tma-no-data__btn" data-save-ok disabled>Save here</button>' +
        '</div>',
      onMount: function (host) {
        var body = host.querySelector('[data-save-picker]');
        var search = host.querySelector('[data-save-search]');
        var ok = host.querySelector('[data-save-ok]');
        var where = host.querySelector('[data-save-where]');
        var timer = null;

        host.querySelector('[data-save-cancel]').addEventListener('click', function () { u.closeModal(); });

        function paintWhere() {
          ok.disabled = !pick.folder;
          where.textContent = pick.folder ? 'Saving to ' + (pick.name || 'this folder') : 'Choose a folder';
        }

        function rows(folders, withPath) {
          if (!folders.length) {
            return '<p class="tma-portal-picker__empty">' +
              (withPath ? 'No folders match.' : 'No subfolders here. Save into this folder, or go back.') + '</p>';
          }

          return folders.map(function (f) {
            var sub = withPath ? pathLabel(f) : '';
            return '<button type="button" class="tma-portal-picker__folder" data-save-open="' + esc(f.id) + '"' +
              ' data-save-open-name="' + esc(f.name) + '">' + folderIcon(f) +
              '<span class="tma-save-folder__name">' + esc(f.name) +
              (sub ? '<span class="tma-save-folder__path">' + esc(sub) + '</span>' : '') +
              '</span></button>';
          }).join('');
        }

        function bindRows() {
          body.querySelectorAll('[data-save-open]').forEach(function (b) {
            b.addEventListener('click', function () {
              pick.folder = b.getAttribute('data-save-open');
              pick.name = b.getAttribute('data-save-open-name') || '';
              pick.query = '';
              if (search) search.value = '';
              browse();
            });
          });
          body.querySelectorAll('[data-save-crumb]').forEach(function (b) {
            b.addEventListener('click', function () {
              pick.folder = b.getAttribute('data-save-crumb') || null;
              pick.name = b.getAttribute('data-save-crumb-name') || '';
              browse();
            });
          });
        }

        function browse() {
          paintWhere();
          body.innerHTML = u.loading ? u.loading({ count: 4 }) : '<p class="tma-portal-picker__empty">Loading…</p>';
          var p = new URLSearchParams();
          p.set('section', 'my');
          if (pick.folder) p.set('folder', pick.folder);
          p.set('only', 'folders');
          p.set('perPage', '200');
          p.set('sort', 'name');
          n.fetchJSON(FILES + '/?' + p.toString()).then(function (res) {
            var trail = res.breadcrumb || [];
            var crumbs = '<button type="button" class="tma-portal-picker__crumb" data-save-crumb="">Top level</button>';
            trail.forEach(function (c, i) {
              var here = i === trail.length - 1;
              crumbs += ' / <button type="button" class="tma-portal-picker__crumb' + (here ? ' is-current' : '') + '"' +
                (here ? ' aria-current="location"' : '') +
                ' data-save-crumb="' + esc(c.id) + '" data-save-crumb-name="' + esc(c.name) + '">' + esc(c.name) + '</button>';
            });
            if (trail.length) pick.name = trail[trail.length - 1].name || pick.name;
            paintWhere();
            body.innerHTML = '<div class="tma-portal-picker__crumbs">' + crumbs + '</div>' +
              '<div class="tma-portal-picker__list">' + rows(res.folders || [], false) + '</div>';
            bindRows();
          }).catch(function () {
            body.innerHTML = '<p class="tma-portal-picker__empty">Could not load folders.</p>';
          });
        }

        function find(query) {
          var seq = ++pick.searchSeq;
          body.innerHTML = u.loading ? u.loading({ count: 3 }) : '<p class="tma-portal-picker__empty">Searching…</p>';
          var p = new URLSearchParams();
          p.set('section', 'all');
          p.set('search', query);
          p.set('only', 'folders');
          p.set('perPage', '30');
          n.fetchJSON(FILES + '/?' + p.toString()).then(function (res) {
            if (seq !== pick.searchSeq) return;
            body.innerHTML = '<div class="tma-portal-picker__list">' + rows(res.folders || [], true) + '</div>';
            bindRows();
          }).catch(function () {
            if (seq !== pick.searchSeq) return;
            body.innerHTML = '<p class="tma-portal-picker__empty">Could not search folders.</p>';
          });
        }

        if (search) {
          search.addEventListener('input', function () {
            var q = search.value.trim();
            if (timer) clearTimeout(timer);
            timer = setTimeout(function () {
              if (q.length >= 2) find(q);
              else if (!q) browse();
            }, 250);
          });
          search.focus();
        }

        ok.addEventListener('click', function () {
          if (!pick.folder || ok.disabled) return;
          ok.disabled = true;
          ok.textContent = 'Saving…';
          n.fetchJSON(saveUrl(opts.kind, opts.id), { method: 'POST', json: { folderId: pick.folder } })
            .then(function (res) {
              u.closeModal();
              var folderName = (res && res.folder && res.folder.name) || pick.name || 'the folder';
              toast('Saved to ' + folderName + '.', 'positive');
              if (typeof opts.onSaved === 'function') opts.onSaved(res);
            })
            .catch(function (err) {
              ok.disabled = false;
              ok.textContent = 'Save here';
              toast((err && err.message) || 'Could not save this file.', 'negative');
            });
        });

        browse();
      },
    });
  }

  /*
   * Any button marked data-save-attachment opens the dialog, wherever it is
   * drawn — the application's Messages tab, a message bubble, an email.
   */
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-save-attachment]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    // From the viewer: put it away first, so the dialog is not drawn behind it.
    if (btn.closest('.tma-lightbox') && window.TMAPortalLightbox && window.TMAPortalLightbox.close) {
      window.TMAPortalLightbox.close();
    }
    open({
      kind: btn.getAttribute('data-save-attachment-kind') || 'messaging',
      id: btn.getAttribute('data-save-attachment'),
      name: btn.getAttribute('data-save-attachment-name') || '',
    });
  }, true);

  window.TMASaveToFolder = { open: open };
})();
