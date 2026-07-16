/*
 * TMA - Portal Work (Workflows, Templates, Signatures)
 */
(function () {
  'use strict';

  function ui() { return window.TMAPortalUI; }
  function net() { return window.TMAFilesNet; }

  /* Signature requests are server-backed; reuse the shared network helper
     (CSRF + JSON error shaping) rather than a second fetch implementation. */
  var SIG_BASE = (window.__TMA_SITE_ROOT || '') + '/portal/signatures';
  function sigUrl(path) { return SIG_BASE + path; }

  /* ── Workflows (minimal) ─────────────────────────── */
  var wf = { el: null, search: '' };

  function mountWorkflows(el) {
    wf.el = el;
    el.innerHTML =
      '<div class="tma-portal-page">' +
      '<div class="tma-portal-head">' +
      '<h2 class="tma-portal-head__title">Workflows</h2>' +
      '</div>' +
      ui().emptyState({
        illustration: 'Illustration06',
        title: 'No workflows yet',
        subtitle: 'Create a workflow to automate feedback, approvals, and more.',
      }) +
      '</div>';
  }

  /* ── Templates (minimal) ─────────────────────────── */
  var tpl = { el: null, search: '' };

  function mountTemplates(el) {
    tpl.el = el;
    el.innerHTML =
      '<div class="tma-portal-page">' +
      '<div class="tma-portal-head">' +
      '<h2 class="tma-portal-head__title">Templates</h2>' +
      '</div>' +
      ui().emptyState({
        illustration: 'Illustration05',
        title: 'No templates yet',
        subtitle: 'Document and project templates will appear here.',
      }) +
      '</div>';
  }

  /* ── Signatures ──────────────────────────────────── */
  var sig = {
    el: null, search: '', status: 'all', adminView: false,
    editingId: null, wizardStep: 'files', wizardPage: 0,
    requests: [], loading: false, error: null, loaded: false,
    canAdminView: false, searchSeq: 0,
    recipients: [],
    // Editor state: the loaded document, the fields placed on it, and the
    // saved recipients fields can be assigned to (uuids, unlike the working
    // copy in `recipients`, which may hold unsaved typing).
    doc: null, docError: null, fields: [], fieldTypes: null,
    savedRecipients: [], selectedFieldId: null, fieldsDirty: false,
  };

  var SIG_WIZARD_STEPS = [
    { key: 'files', label: 'Files and recipients', icon: 'Users' },
    { key: 'fields', label: 'Place fields', icon: 'PencilSimple' },
    { key: 'review', label: 'Review and send', icon: 'EnvelopeSimple' },
  ];

  var SIG_STATUS_FILTERS = [
    { value: 'all', label: 'Show All' },
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Sent' },
    { value: 'viewed', label: 'Viewed' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'declined', label: 'Declined' },
    { value: 'expired', label: 'Expired' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  function sigNewDropdown() {
    return ui().headDropdown({
      label: 'Create signature request',
      primary: true,
      alignEnd: true,
      wrapAttrs: 'data-sig-new-dropdown',
      items: [
        { label: 'Send for signature', action: 'send' },
        { label: 'Sign a document yourself', action: 'self' },
      ],
    });
  }

  /* Loading / error / empty are distinct states: an empty list because the
     request failed must never look like an empty list because there's nothing
     to show. */
  function sigListBody(list) {
    if (sig.loading && !sig.loaded) {
      return ui().loading({ count: 4 });
    }
    if (sig.error) {
      return ui().banner('warning', ui().esc(sig.error) +
        ' <button type="button" class="tma-portal-link" data-sig-retry>Try again</button>');
    }
    if (list.length) {
      return '<div class="tma-portal-sig-list">' + list.map(signatureCard).join('') + '</div>';
    }
    if (sig.search || sig.status !== 'all') {
      return ui().emptyState({
        illustration: 'Illustration06',
        title: 'No signature requests match your filters',
        subtitle: 'Try a different status or search term.',
      });
    }
    return ui().emptyState({
      illustration: 'Illustration06',
      title: 'You don’t have any signature requests yet',
      subtitle: 'Need to get a signature? Create a request.',
      button: sigNewDropdown(),
    });
  }

  /* Keyed by the server's status value. The three original styles are kept
     byte-for-byte; the rest reuse documented palette tokens through the same
     --status-badge-color variable the badge component already exposes. */
  var SIG_MUTED = '--status-badge-color:rgba(0,0,0,0.45);--status-badge-pill-surface:rgba(0,0,0,0.04);';
  var SIG_STATUS_STYLE = {
    draft: SIG_MUTED,
    sent: '--status-badge-color:#6eb5ff;',
    completed: '--status-badge-color:#71dd8c;',
    viewed: '--status-badge-color:var(--color-cyan);',
    in_progress: '--status-badge-color:var(--color-orange);',
    declined: '--status-badge-color:var(--color-red);',
    expired: '--status-badge-color:var(--color-yellow);',
    cancelled: SIG_MUTED,
  };

  function sigStatusBadge(status, label) {
    var style = SIG_STATUS_STYLE[status] || SIG_STATUS_STYLE.draft;
    return '<span class="tma-status-badge tma-status-badge--pill tma-status-badge--muted" style="' + style + '">' +
      '<span class="tma-status-badge__label">' + ui().esc(label || status) + '</span></span>';
  }

  /* Searching and filtering happen server-side, so the list can't drift from
     what the database actually holds. Responses are sequenced because a slow
     early request must never overwrite a newer one's results. */
  function loadSignatures(opts) {
    opts = opts || {};
    var seq = ++sig.searchSeq;
    if (!opts.silent) {
      sig.loading = true;
      sig.error = null;
      renderSignatures();
    }

    var params = new URLSearchParams();
    if (sig.search) params.set('search', sig.search);
    if (sig.status !== 'all') params.set('status', sig.status);
    if (sig.adminView) params.set('scope', 'all');

    return net().fetchJSON(sigUrl('/?' + params.toString()))
      .then(function (res) {
        if (seq !== sig.searchSeq) return;
        sig.requests = res.requests || [];
        sig.canAdminView = !!res.canAdminView;
        sig.loading = false;
        sig.loaded = true;
        sig.error = null;
        renderSignatures();
      })
      .catch(function (err) {
        if (seq !== sig.searchSeq) return;
        sig.loading = false;
        sig.loaded = true;
        sig.error = (err && err.message) || 'Could not load signature requests.';
        renderSignatures();
      });
  }

  function signatureRecord(id) {
    return sig.requests.filter(function (r) { return r.id === id; })[0] || null;
  }

  /* The wizard edits a working copy of the recipient list. Re-rendering on
     add/remove/reorder would throw away whatever is half-typed, so the DOM is
     read back into the working copy first, every time. */
  function sigReadRecipientInputs(root) {
    if (!root) return;
    sig.recipients.forEach(function (r, i) {
      var name = root.querySelector('[data-sig-r-name="' + i + '"]');
      var email = root.querySelector('[data-sig-r-email="' + i + '"]');
      var role = root.querySelector('[data-sig-r-role="' + i + '"]');
      if (name) r.name = name.value;
      if (email) r.email = email.value;
      if (role) r.role = role.value;
    });
  }

  function sigIsOnlySigner() {
    var me = window.TMACurrentUser ? window.TMACurrentUser.get() : null;
    if (!me || sig.recipients.length !== 1) return false;
    return String(sig.recipients[0].email || '').toLowerCase() ===
      String(me.email || '').toLowerCase();
  }

  function sigBlankRecipient() {
    return { name: '', email: '', role: 'signer' };
  }

  function sigPersonRow(p, index) {
    var avatar = p.avatar
      ? '<img class="tma-portal-sig-person__avatar" src="' + ui().esc(p.avatar) + '" alt="">'
      : '<span class="tma-portal-sig-person__avatar tma-portal-sig-person__avatar--initials" aria-hidden="true">' +
        ui().esc(p.initials) + '</span>';

    return '<button type="button" class="tma-portal-sig-person" data-sig-person="' + index + '">' +
      avatar +
      '<span class="tma-portal-sig-person__text">' +
      '<span class="tma-portal-sig-person__name">' + ui().esc(p.name || p.email) +
      (p.isYou ? ' <span class="tma-portal-muted">(you)</span>' : '') + '</span>' +
      '<span class="tma-portal-sig-person__meta">' + ui().esc(p.email) +
      (p.accountType ? ' · ' + ui().esc(p.accountType) : '') + '</span>' +
      '</span></button>';
  }

  /* Pick a recipient from the people already in the portal, rather than
     retyping a colleague's details and risking a typo in the address a
     contract gets sent to. */
  function sigPickPersonModal(index) {
    var timer = null;
    var people = [];

    ui().openModal({
      title: 'Choose a recipient',
      body:
        '<div class="tma-portal-sig-picker">' +
        ui().searchInput('Search people', 'data-sig-person-search') +
        '<div class="tma-portal-sig-picker__list" data-sig-person-list>' +
        ui().loading({ count: 3 }) +
        '</div></div>',
      onMount: function (host) {
        var list = host.querySelector('[data-sig-person-list]');

        function load(search) {
          var params = new URLSearchParams();
          if (search) params.set('search', search);

          net().fetchJSON(sigUrl('/people?' + params.toString()))
            .then(function (res) {
              people = res.people || [];
              if (!people.length) {
                list.innerHTML = ui().emptyState({
                  illustration: 'Illustration06',
                  title: search ? 'Nobody matches' : 'No people to choose from',
                  subtitle: search
                    ? 'Try a different name or email.'
                    : 'You can still type a recipient\'s details by hand.',
                });
                return;
              }
              list.innerHTML = people.map(sigPersonRow).join('');

              list.querySelectorAll('[data-sig-person]').forEach(function (row) {
                row.addEventListener('click', function () {
                  var person = people[parseInt(row.getAttribute('data-sig-person'), 10)];
                  if (!person) return;

                  // Read the DOM first: picking for recipient 2 must not
                  // discard what's already typed into recipient 1.
                  sigReadRecipientInputs(sig.el);
                  sig.recipients[index] = {
                    name: person.name || '',
                    email: person.email || '',
                    role: sig.recipients[index] ? sig.recipients[index].role : 'signer',
                  };
                  ui().closeModal();
                  renderSignatures();
                });
              });
            })
            .catch(function (err) {
              list.innerHTML = ui().banner('warning', ui().esc(
                (err && err.message) || 'Could not load people.'
              ));
            });
        }

        ui().wireToolbarSearch(host, '[data-sig-person-search]', function (val) {
          clearTimeout(timer);
          timer = setTimeout(function () { load(val.trim()); }, 250);
        });

        load('');
      },
    });
  }

  function sigClearFieldErrors(root) {
    root.querySelectorAll('.tma-portal-field--error').forEach(function (el) {
      el.classList.remove('tma-portal-field--error');
    });
    root.querySelectorAll('[data-sig-field-msg]').forEach(function (el) { el.remove(); });
  }

  /* Mark the offending input and say why, right underneath it. */
  function sigShowFieldError(root, bad) {
    sigClearFieldErrors(root);

    var input = root.querySelector('[data-sig-r-' + bad.field + '="' + bad.index + '"]');
    if (!input) return;

    var field = input.closest('.tma-portal-field') || input.parentNode;
    field.classList.add('tma-portal-field--error');
    field.insertAdjacentHTML('beforeend',
      '<span class="tma-portal-field__error" data-sig-field-msg role="alert">' +
      ui().esc(bad.message) + '</span>');

    input.focus();
    // Clear as soon as they start fixing it - a stale error is worse than none.
    input.addEventListener('input', function () { sigClearFieldErrors(root); }, { once: true });
  }

  /* Mirrors the server's rules so the user finds out here rather than in a
     422. The server still enforces all of it - this is courtesy, not trust. */
  function sigFirstInvalidRecipient() {
    var seen = {};
    for (var i = 0; i < sig.recipients.length; i++) {
      var r = sig.recipients[i];
      var name = String(r.name || '').trim();
      var email = String(r.email || '').trim();

      if (!name) {
        return { index: i, field: 'name', message: 'Add recipient name and email' };
      }
      if (!email) {
        return { index: i, field: 'email', message: 'Add recipient name and email' };
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { index: i, field: 'email', message: 'That email address doesn\'t look right' };
      }
      var key = email.toLowerCase();
      if (seen[key]) {
        return { index: i, field: 'email', message: 'Each recipient needs a different email address' };
      }
      seen[key] = true;
    }
    return null;
  }

  function sigRecipientSummary(r) {
    var list = r.recipients || [];
    if (!list.length) return '';
    if (list.length === 1) return list[0].email;
    return list[0].email + ' +' + (list.length - 1) + ' more';
  }

  function sigShortFilename(name, max) {
    var n = String(name || '');
    max = max || 28;
    if (n.length <= max) return n;
    return n.slice(0, max - 3) + '...';
  }

  function sigWizardStepper(activeKey) {
    return '<div class="tma-portal-sig-wizard__steps" role="list">' +
      SIG_WIZARD_STEPS.map(function (step, i) {
        var on = step.key === activeKey;
        var done = SIG_WIZARD_STEPS.findIndex(function (s) { return s.key === activeKey; }) > i;
        return (i ? '<span class="tma-portal-sig-wizard__step-line' + (done ? ' is-done' : '') + '" aria-hidden="true"></span>' : '') +
          '<div class="tma-portal-sig-wizard__step' + (on ? ' is-active' : done ? ' is-done' : '') + '" role="listitem">' +
          '<span class="tma-portal-sig-wizard__step-icon">' +
          (done
            ? '<img src="images/icons/phosphor/CheckCircle.svg" alt="">'
            : '<img src="images/icons/phosphor/' + step.icon + '.svg" alt="">') +
          '</span>' +
          '<span class="tma-portal-sig-wizard__step-label">' + ui().esc(step.label) + '</span>' +
          '</div>';
      }).join('') +
      '</div>';
  }

  /* ── document rendering ──────────────────────────── */

  /* pdf.js ships as ESM and weighs ~1.7 MB with its worker, so it is pulled in
     on first use rather than at page load - nobody who doesn't open the editor
     pays for it. */
  var pdfjsPromise = null;

  function loadPdfjs() {
    if (pdfjsPromise) return pdfjsPromise;
    var root = window.__TMA_SITE_ROOT || '';
    pdfjsPromise = import(root + '/js/vendor/pdf.min.mjs').then(function (lib) {
      // The worker must be same-origin; pdf.js can't infer the path when it's
      // imported from a classic script.
      lib.GlobalWorkerOptions.workerSrc = root + '/js/vendor/pdf.worker.min.mjs';
      return lib;
    }).catch(function (err) {
      pdfjsPromise = null; // let a later attempt retry
      throw err;
    });
    return pdfjsPromise;
  }

  function sigIsImage(record) {
    return /\.(png|jpe?g)$/i.test(String(record.title || '') ) ||
      (record.document && /\.(png|jpe?g)$/i.test(String(record.document.name || '')));
  }

  function sigDocumentUrl(record) {
    return sigUrl('/' + encodeURIComponent(record.id) + '/document');
  }

  /* Loads the document once per wizard session and caches its page count and
     per-page aspect ratios - the field layer needs those to size the canvas
     before a page has finished painting. */
  function sigLoadDocument(record) {
    if (sig.doc && sig.doc.id === record.id) return Promise.resolve(sig.doc);

    if (sigIsImage(record)) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          sig.doc = {
            id: record.id,
            kind: 'image',
            pageCount: 1,
            ratios: [img.naturalHeight / img.naturalWidth],
            image: img,
          };
          resolve(sig.doc);
        };
        img.onerror = function () { reject(new Error('Could not load the document.')); };
        img.src = sigDocumentUrl(record);
      });
    }

    return loadPdfjs()
      .then(function (pdfjs) {
        return pdfjs.getDocument({ url: sigDocumentUrl(record), withCredentials: true }).promise;
      })
      .then(function (pdf) {
        var ratios = [];
        var jobs = [];
        for (var p = 1; p <= pdf.numPages; p++) {
          jobs.push(pdf.getPage(p).then(function (page) {
            var vp = page.getViewport({ scale: 1 });
            ratios[page.pageNumber - 1] = vp.height / vp.width;
          }));
        }
        return Promise.all(jobs).then(function () {
          sig.doc = { id: record.id, kind: 'pdf', pageCount: pdf.numPages, ratios: ratios, pdf: pdf };
          return sig.doc;
        });
      });
  }

  /* Paints one page into a canvas sized to the element's own width, so the
     document scales with the viewport while placement stays page-relative. */
  function sigPaintPage(canvas, pageIndex) {
    var doc = sig.doc;
    if (!doc || !canvas) return Promise.resolve();

    var cssWidth = canvas.clientWidth || canvas.parentNode.clientWidth || 800;
    var dpr = window.devicePixelRatio || 1;
    var ratio = doc.ratios[pageIndex] || 1.294;

    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssWidth * ratio * dpr);
    canvas.style.height = Math.floor(cssWidth * ratio) + 'px';

    var ctx = canvas.getContext('2d');

    if (doc.kind === 'image') {
      ctx.drawImage(doc.image, 0, 0, canvas.width, canvas.height);
      return Promise.resolve();
    }

    return doc.pdf.getPage(pageIndex + 1).then(function (page) {
      var unscaled = page.getViewport({ scale: 1 });
      var viewport = page.getViewport({ scale: (cssWidth * dpr) / unscaled.width });
      // Cancel a still-running paint for this canvas before starting another,
      // or pdf.js throws when two renders share a context.
      if (canvas._sigRenderTask) canvas._sigRenderTask.cancel();
      var task = page.render({ canvasContext: ctx, viewport: viewport });
      canvas._sigRenderTask = task;
      return task.promise.then(
        function () { canvas._sigRenderTask = null; },
        function (err) {
          canvas._sigRenderTask = null;
          // A cancelled paint is expected when the user pages quickly.
          if (!err || err.name !== 'RenderingCancelledException') throw err;
        }
      );
    });
  }

  /* ── field placement ─────────────────────────────── */

  var sigFieldSeq = 0;

  function sigNewFieldId() {
    sigFieldSeq++;
    return 'new-' + sigFieldSeq;
  }

  function sigDefaultRecipient() {
    // Fields default to the first person who actually signs; a CC never does.
    var signers = (sig.savedRecipients || []).filter(function (r) { return r.role !== 'cc'; });
    return (signers[0] || sig.savedRecipients[0] || {}).id || null;
  }

  function sigClamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  /* Repaint only what a field change actually affects.
     A full renderSignatures() would rebuild the canvas element and force
     pdf.js to re-rasterise the page and every thumbnail - on every drag. */
  function sigRefreshFields() {
    var root = sig.el;
    if (!root) return;

    var layer = root.querySelector('[data-sig-field-layer]');
    if (!layer) {
      renderSignatures();
      return;
    }

    layer.innerHTML = sigFieldsOnPage(sig.wizardPage || 0).map(sigPlacedField).join('');
    sigWireFieldLayer(layer);

    var panelHost = root.querySelector('.tma-portal-sig-wizard__fields-panel');
    var existing = panelHost && panelHost.querySelector('.tma-portal-sig-wizard__assign');
    if (existing) existing.remove();
    if (panelHost) {
      panelHost.insertAdjacentHTML('beforeend', sigAssignPanel());
      sigWireAssignPanel(root);
    }

    sigRefreshThumbBadges(root);
  }

  /* Keep the per-page field counts honest without repainting the thumbnails. */
  function sigRefreshThumbBadges(root) {
    root.querySelectorAll('[data-sig-page]').forEach(function (btn) {
      var i = parseInt(btn.getAttribute('data-sig-page'), 10);
      var count = sigFieldsOnPage(i).length;
      var badge = btn.querySelector('.tma-portal-sig-wizard__page-badge');
      if (count && !badge) {
        btn.insertAdjacentHTML('afterbegin',
          '<span class="tma-portal-sig-wizard__page-badge">' + count + '</span>');
      } else if (count && badge) {
        badge.textContent = count;
      } else if (!count && badge) {
        badge.remove();
      }
      btn.setAttribute('aria-label', 'Page ' + (i + 1) + (count ? ', ' + count + ' field(s)' : ''));
    });
  }

  /* Where a click-placed field should land.
     Dropping every one at the page centre stacks them exactly on top of each
     other, and the topmost then swallows the clicks meant for the ones below,
     so they cascade instead. Drag-placed fields ignore this - the pointer
     already said where. */
  function sigFreeSpot(type) {
    var size = SIG_FIELD_SIZE[type] || SIG_FIELD_SIZE.text;
    var taken = sigFieldsOnPage(sig.wizardPage || 0);
    var x = 0.5;
    var y = 0.5;

    for (var attempt = 0; attempt < taken.length + 1; attempt++) {
      var clash = taken.some(function (f) {
        return Math.abs((f.x + f.width / 2) - x) < 0.02 && Math.abs((f.y + f.height / 2) - y) < 0.02;
      });
      if (!clash) break;
      x += 0.035;
      y += 0.045;
      // Wrap back near the top rather than march off the page.
      if (y + size.height / 2 > 0.95) { y = 0.2; x += 0.08; }
      if (x + size.width / 2 > 0.95) { x = 0.2; }
    }

    return { x: x, y: y };
  }

  /* Place a field at a page-relative point, centred on the cursor and kept
     wholly inside the page - the server rejects anything that overhangs. */
  function sigPlaceField(type, xFrac, yFrac) {
    var recipient = sigDefaultRecipient();
    if (!recipient) {
      ui().toastError('Add a recipient before placing fields.');
      return;
    }
    var size = SIG_FIELD_SIZE[type] || SIG_FIELD_SIZE.text;
    var typeMeta = (sig.fieldTypes || []).filter(function (t) { return t.type === type; })[0];

    var field = {
      id: sigNewFieldId(),
      type: type,
      label: typeMeta ? typeMeta.label : type,
      autofilled: !!(typeMeta && typeMeta.autofilled),
      recipient: recipient,
      page: (sig.wizardPage || 0) + 1,
      width: size.width,
      height: size.height,
      x: sigClamp(xFrac - size.width / 2, 0, 1 - size.width),
      y: sigClamp(yFrac - size.height / 2, 0, 1 - size.height),
      required: true,
    };
    sig.fields.push(field);
    sig.selectedFieldId = field.id;
    sig.fieldsDirty = true;
    sigRefreshFields();
  }

  /* Pointer-driven move/resize. Works from a single handler for both so the
     clamping and the commit path can't drift apart. */
  function sigWireFieldDrag(layer) {
    if (!layer) return;

    layer.addEventListener('pointerdown', function (e) {
      var resizeHandle = e.target.closest('[data-sig-field-resize]');
      var el = e.target.closest('[data-sig-placed]');
      if (!el || e.target.closest('[data-sig-field-remove]')) return;

      var id = el.getAttribute('data-sig-placed');
      var field = sig.fields.filter(function (f) { return f.id === id; })[0];
      if (!field) return;

      sig.selectedFieldId = id;
      var mode = resizeHandle ? 'resize' : 'move';
      var rect = layer.getBoundingClientRect();
      var startX = e.clientX;
      var startY = e.clientY;
      var origin = { x: field.x, y: field.y, width: field.width, height: field.height };
      var moved = false;

      e.preventDefault();
      el.setPointerCapture(e.pointerId);

      function onMove(ev) {
        var dx = (ev.clientX - startX) / rect.width;
        var dy = (ev.clientY - startY) / rect.height;
        if (Math.abs(ev.clientX - startX) > 2 || Math.abs(ev.clientY - startY) > 2) moved = true;

        if (mode === 'move') {
          field.x = sigClamp(origin.x + dx, 0, 1 - field.width);
          field.y = sigClamp(origin.y + dy, 0, 1 - field.height);
        } else {
          // Never let a resize push the field past the page edge.
          field.width = sigClamp(origin.width + dx, 0.005, 1 - field.x);
          field.height = sigClamp(origin.height + dy, 0.005, 1 - field.y);
        }
        el.style.left = (field.x * 100) + '%';
        el.style.top = (field.y * 100) + '%';
        el.style.width = (field.width * 100) + '%';
        el.style.height = (field.height * 100) + '%';
      }

      function onUp(ev) {
        el.releasePointerCapture(ev.pointerId);
        layer.removeEventListener('pointermove', onMove);
        layer.removeEventListener('pointerup', onUp);
        layer.removeEventListener('pointercancel', onUp);
        if (moved) sig.fieldsDirty = true;
        // Refresh the selection outline / assign panel. A plain click (no
        // movement) still selects. Fields only, so the page isn't repainted.
        sigRefreshFields();
      }

      layer.addEventListener('pointermove', onMove);
      layer.addEventListener('pointerup', onUp);
      layer.addEventListener('pointercancel', onUp);
    });
  }

  function sigSaveFields(record) {
    if (!record || record.status !== 'draft') return Promise.resolve();
    if (!sig.fieldsDirty) return Promise.resolve();

    return net().fetchJSON(sigUrl('/' + encodeURIComponent(record.id) + '/fields'), {
      method: 'PUT',
      json: {
        fields: sig.fields.map(function (f) {
          return {
            type: f.type,
            recipient: f.recipient,
            page: f.page,
            x: f.x, y: f.y, width: f.width, height: f.height,
            required: f.required,
          };
        }),
      },
    }).then(function (res) {
      sig.fields = res.fields;
      sig.fieldsDirty = false;
      return res.fields;
    }).catch(function (err) {
      ui().toastError((err && err.message) || 'Could not save the fields.');
      throw err;
    });
  }

  /* Load the document and the saved fields for the editor step. */
  function sigOpenEditor(record) {
    sig.docError = null;

    var wantFields = net().fetchJSON(sigUrl('/' + encodeURIComponent(record.id) + '/fields'))
      .then(function (res) {
        sig.fields = res.fields || [];
        sig.fieldTypes = res.types || [];
        sig.fieldsDirty = false;
      });

    return Promise.all([sigLoadDocument(record), wantFields])
      .then(function () {
        // A page the document doesn't have (a shorter file was swapped in).
        if (sig.wizardPage >= sig.doc.pageCount) sig.wizardPage = 0;
        renderSignatures();
      })
      .catch(function (err) {
        sig.docError = (err && err.message) || 'Could not load the document.';
        renderSignatures();
      });
  }

  /* Everything interactive on the place-fields step. Called on every wizard
     render, against freshly created DOM. */
  function wireSignatureEditor(root) {
    var retry = root.querySelector('[data-sig-doc-retry]');
    if (retry) {
      retry.addEventListener('click', function () {
        sig.doc = null;
        sig.docError = null;
        renderSignatures();
        sigOpenEditor(signatureRecord(sig.editingId));
      });
    }

    var canvas = root.querySelector('[data-sig-canvas]');
    var layer = root.querySelector('[data-sig-field-layer]');
    if (!canvas || !sig.doc) return;

    // Paint after layout so clientWidth is real, and repaint on resize since
    // the canvas is sized from its rendered width.
    requestAnimationFrame(function () {
      sigPaintPage(canvas, sig.wizardPage || 0);
      sigPaintThumbs(root);
    });
    sigWatchResize(canvas);

    // Click a palette card to drop a field in the middle of the page.
    root.querySelectorAll('[data-sig-field]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var at = sigFreeSpot(btn.getAttribute('data-sig-field'));
        sigPlaceField(btn.getAttribute('data-sig-field'), at.x, at.y);
      });
      btn.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', btn.getAttribute('data-sig-field'));
        e.dataTransfer.effectAllowed = 'copy';
      });
    });

    // ...or drag it exactly where you want it. The drop target is the layer,
    // which is wired once here; the per-field handlers are re-applied whenever
    // the layer's contents change.
    if (layer) {
      layer.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });
      layer.addEventListener('drop', function (e) {
        e.preventDefault();
        var type = e.dataTransfer.getData('text/plain');
        if (!type) return;
        var rect = layer.getBoundingClientRect();
        sigPlaceField(type, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      });

      sigWireFieldDrag(layer);
      sigWireFieldLayer(layer);
    }

    sigWireAssignPanel(root);
  }

  function sigRemoveField(id) {
    sig.fields = sig.fields.filter(function (f) { return f.id !== id; });
    if (sig.selectedFieldId === id) sig.selectedFieldId = null;
    sig.fieldsDirty = true;
    sigRefreshFields();
  }

  /* Per-field handlers. Re-applied every time the layer is rebuilt. */
  function sigWireFieldLayer(layer) {
    layer.querySelectorAll('[data-sig-field-remove]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        sigRemoveField(btn.getAttribute('data-sig-field-remove'));
      });
    });

    layer.querySelectorAll('[data-sig-placed]').forEach(function (el) {
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        e.preventDefault();
        sigRemoveField(el.getAttribute('data-sig-placed'));
      });
    });
  }

  function sigWireAssignPanel(root) {
    var assign = root.querySelector('[data-sig-field-assign]');
    if (assign) {
      assign.addEventListener('change', function () {
        var f = sig.fields.filter(function (x) { return x.id === sig.selectedFieldId; })[0];
        if (!f) return;
        f.recipient = assign.value;
        sig.fieldsDirty = true;
        sigRefreshFields();
      });
    }

    var required = root.querySelector('[data-sig-field-required]');
    if (required) {
      required.addEventListener('change', function () {
        var f = sig.fields.filter(function (x) { return x.id === sig.selectedFieldId; })[0];
        if (!f) return;
        f.required = required.checked;
        sig.fieldsDirty = true;
        // Only the "opt" marker on the field changes; no page repaint.
        sigRefreshFields();
      });
    }
  }

  /* Repaint on width changes; the canvas is bitmap-sized from CSS width, so a
     sidebar toggle or window resize would otherwise leave it blurry.
     Only ever one observer: the canvas element is replaced on re-render, so a
     new observer per render would pile up watching detached canvases. */
  function sigWatchResize(canvas) {
    if (!window.ResizeObserver) return;
    if (sig.resizeObserver) sig.resizeObserver.disconnect();

    var last = 0;
    sig.resizeObserver = new ResizeObserver(function () {
      var w = canvas.clientWidth;
      // A detached canvas reports 0; nothing to repaint.
      if (!w || Math.abs(w - last) < 2) return;
      last = w;
      sigPaintPage(canvas, sig.wizardPage || 0);
    });
    sig.resizeObserver.observe(canvas);
  }

  function sigPaintThumbs(root) {
    root.querySelectorAll('[data-sig-thumb]').forEach(function (thumb) {
      var i = parseInt(thumb.getAttribute('data-sig-thumb'), 10);
      sigPaintPage(thumb, i);
    });
  }

  /* Persist the draft. Only a draft is editable server-side, so a completed
     request's wizard is read-only and never PATCHes. Multi-recipient entry and
     signing order arrive with the compose flow; the payload is already a list
     so that step won't change this contract. */
  function saveSignatureWizardFields(root, record) {
    if (!root || !record || record.status !== 'draft') return Promise.resolve(record);

    sigReadRecipientInputs(root);

    var docName = root.querySelector('[data-sig-wizard-doc-name]');
    var subject = root.querySelector('[data-sig-wizard-subject]');
    var message = root.querySelector('[data-sig-wizard-message]');

    var payload = {};
    if (docName && docName.value.trim()) {
      // The review step edits the name without its extension; put the original
      // one back so saving can't quietly strip ".pdf" off the title.
      var ext = String(record.title || '').match(/\.[^.]+$/);
      payload.title = docName.value.trim() + (ext ? ext[0] : '');
    }
    if (subject) payload.subject = subject.value.trim() || null;
    if (message) payload.message = message.value.trim() || null;

    // Only send rows the user actually filled in; a blank trailing row is an
    // empty form field, not a recipient.
    var filled = sig.recipients.filter(function (r) {
      return String(r.name || '').trim() && String(r.email || '').trim();
    });
    if (filled.length) {
      payload.recipients = filled.map(function (r, i) {
        return {
          name: String(r.name).trim(),
          email: String(r.email).trim(),
          role: (r.role || 'signer').toLowerCase(),
          order: i + 1,
        };
      });
    }
    if (!Object.keys(payload).length) return Promise.resolve(record);

    return net().fetchJSON(sigUrl('/' + encodeURIComponent(record.id)), {
      method: 'PATCH',
      json: payload,
    }).then(function (res) {
      // Refresh in place so the list behind the wizard stays truthful.
      var i = sig.requests.findIndex(function (r) { return r.id === record.id; });
      if (i !== -1) sig.requests[i] = res.request;
      return res.request;
    }).catch(function (err) {
      ui().toastError((err && err.message) || 'Could not save the request.');
      throw err;
    });
  }

  var SIG_FIELD_ICON = {
    signature: 'PenNib',
    initials: 'PenNib',
    name: 'User',
    email: 'EnvelopeSimple',
    date: 'Calendar',
    text: 'TextAa',
    checkbox: 'CheckSquare',
  };

  /* Default size of a newly dropped field, as a fraction of the page. Roughly
     matches what each type needs to hold at print size. */
  var SIG_FIELD_SIZE = {
    signature: { width: 0.22, height: 0.055 },
    initials: { width: 0.08, height: 0.045 },
    name: { width: 0.22, height: 0.035 },
    email: { width: 0.24, height: 0.035 },
    date: { width: 0.14, height: 0.035 },
    text: { width: 0.2, height: 0.035 },
    checkbox: { width: 0.03, height: 0.02 },
  };

  function sigFieldCard(type, label) {
    var icon = SIG_FIELD_ICON[type] || 'TextAa';
    return '<button type="button" class="tma-portal-sig-wizard__field-card" draggable="true"' +
      ' data-sig-field="' + ui().esc(type) + '" title="Drag onto the document, or click to place">' +
      '<span class="tma-portal-sig-wizard__field-card-icon"><img src="images/icons/phosphor/' + icon + '.svg" alt=""></span>' +
      '<span class="tma-portal-sig-wizard__field-card-label">' + ui().esc(label) + '</span>' +
      '</button>';
  }

  /* Colour-code fields by recipient so it's obvious at a glance who signs what.
     Cycles through the documented palette rather than inventing colours. */
  var SIG_RECIPIENT_COLORS = [
    'var(--color-primary)', 'var(--color-orange)', 'var(--color-green)',
    'var(--color-pink)', 'var(--color-cyan)', 'var(--color-mint)',
  ];

  function sigRecipientColor(recipientId) {
    var list = sig.savedRecipients || [];
    var i = list.findIndex(function (r) { return r.id === recipientId; });
    return SIG_RECIPIENT_COLORS[(i < 0 ? 0 : i) % SIG_RECIPIENT_COLORS.length];
  }

  function sigPlacedField(f) {
    var selected = f.id === sig.selectedFieldId;
    var color = sigRecipientColor(f.recipient);
    return '<div class="tma-portal-sig-field' + (selected ? ' is-selected' : '') + '"' +
      ' data-sig-placed="' + ui().esc(f.id) + '" tabindex="0" role="button"' +
      ' aria-label="' + ui().esc(f.label + ' field') + '"' +
      ' style="left:' + (f.x * 100) + '%;top:' + (f.y * 100) + '%;' +
      'width:' + (f.width * 100) + '%;height:' + (f.height * 100) + '%;' +
      '--sig-field-color:' + color + '">' +
      '<span class="tma-portal-sig-field__label">' +
      '<img src="images/icons/phosphor/' + (SIG_FIELD_ICON[f.type] || 'TextAa') + '.svg" alt="" width="12" height="12">' +
      '<span>' + ui().esc(f.label) + '</span>' +
      (f.required ? '' : '<span class="tma-portal-sig-field__optional">opt</span>') +
      '</span>' +
      '<button type="button" class="tma-portal-sig-field__remove" data-sig-field-remove="' + ui().esc(f.id) + '"' +
      ' aria-label="Remove ' + ui().esc(f.label) + ' field">' +
      '<img src="images/icons/phosphor/X.svg" alt="" width="10" height="10"></button>' +
      '<span class="tma-portal-sig-field__resize" data-sig-field-resize="' + ui().esc(f.id) + '" aria-hidden="true"></span>' +
      '</div>';
  }

  function sigFieldsOnPage(page) {
    return sig.fields.filter(function (f) { return f.page === page + 1; });
  }

  function sigAssignPanel() {
    var f = sig.fields.filter(function (x) { return x.id === sig.selectedFieldId; })[0];
    if (!f) return '';
    var recipients = sig.savedRecipients || [];
    return '<div class="tma-portal-sig-wizard__assign">' +
      '<h4 class="tma-portal-sig-wizard__assign-title">' + ui().esc(f.label) + '</h4>' +
      ui().field('Assigned to', ui().select(
        recipients.map(function (r) {
          return { value: r.id, label: (r.name || r.email) + ' (' + r.role + ')' };
        }),
        f.recipient,
        'data-sig-field-assign',
        'Assigned to'
      )) +
      (f.autofilled
        ? '<p class="tma-portal-sig-wizard__assign-note">Filled in automatically from the recipient.</p>'
        : '<label class="tma-portal-checkbox">' +
          '<input type="checkbox" data-sig-field-required' + (f.required ? ' checked' : '') + '>' +
          '<span>Required</span></label>') +
      '</div>';
  }

  function renderSignatureWizardFieldsStep(record) {
    var page = sig.wizardPage || 0;
    var docTitle = sigShortFilename(record.title.replace(/\.[^.]+$/, ''), 24);
    var pageCount = sig.doc ? sig.doc.pageCount : 0;

    var panel = !sig.savedRecipients || !sig.savedRecipients.length
      ? ui().banner('warning', 'Add a recipient before placing fields.')
      : '<p class="tma-portal-sig-wizard__fields-desc">Drag a field onto the document, or click to place it.</p>' +
        '<div class="tma-portal-sig-wizard__field-list">' +
        (sig.fieldTypes || []).map(function (t) {
          return sigFieldCard(t.type, t.label);
        }).join('') +
        '</div>' +
        sigAssignPanel();

    var canvasInner = sig.docError
      ? ui().banner('warning', ui().esc(sig.docError) +
        ' <button type="button" class="tma-portal-link" data-sig-doc-retry>Try again</button>')
      : !sig.doc
        ? '<div class="tma-portal-sig-wizard__doc-loading">' + ui().loading({ count: 1 }) + '</div>'
        : '<div class="tma-portal-sig-wizard__doc-sheet" data-sig-page-host>' +
          '<canvas class="tma-portal-sig-wizard__doc-canvas" data-sig-canvas></canvas>' +
          '<div class="tma-portal-sig-wizard__field-layer" data-sig-field-layer>' +
          sigFieldsOnPage(page).map(sigPlacedField).join('') +
          '</div></div>';

    return '<div class="tma-portal-sig-wizard__workspace">' +
      '<aside class="tma-portal-sig-wizard__fields-panel">' +
      '<div class="tma-portal-sig-wizard__fields-head">' +
      '<h3 class="tma-portal-sig-wizard__fields-title">Fields</h3>' +
      '</div>' +
      panel +
      '</aside>' +
      '<div class="tma-portal-sig-wizard__canvas">' +
      '<div class="tma-portal-sig-wizard__canvas-scroll">' + canvasInner + '</div>' +
      '</div>' +
      '<aside class="tma-portal-sig-wizard__pages-panel">' +
      '<p class="tma-portal-sig-wizard__pages-title" title="' + ui().esc(record.title) + '">' + ui().esc(docTitle) + '</p>' +
      '<div class="tma-portal-sig-wizard__page-list">' +
      sigPageThumbs(pageCount, page) +
      '</div></aside></div>';
  }

  /* One thumbnail per real page, each painted from the document itself. */
  function sigPageThumbs(pageCount, active) {
    var out = '';
    for (var i = 0; i < pageCount; i++) {
      var count = sigFieldsOnPage(i).length;
      out += '<button type="button" class="tma-portal-sig-wizard__page-thumb' +
        (i === active ? ' is-active' : '') + '" data-sig-page="' + i + '"' +
        ' aria-label="Page ' + (i + 1) + (count ? ', ' + count + ' field(s)' : '') + '">' +
        '<canvas class="tma-portal-sig-wizard__page-mini" data-sig-thumb="' + i + '"></canvas>' +
        (count ? '<span class="tma-portal-sig-wizard__page-badge">' + count + '</span>' : '') +
        '<span class="tma-portal-sig-wizard__page-num">' + (i + 1) + '</span>' +
        '</button>';
    }
    return out;
  }

  /* The name the signed copy will carry, shown without the extension - the
     stamped output decides its own. */
  function sigReviewDocumentName(record) {
    return String(record.title || '').replace(/\.[^.]+$/, '');
  }

  function renderSignatureWizardReviewStep(record) {
    var readOnly = record.status === 'completed';
    var docName = sigReviewDocumentName(record);
    // The real destination folder; "Personal Folders" is the library's own
    // name for the root, not a placeholder.
    var storageFolder = record.folder ? record.folder.name : 'Personal Folders';
    return '<section class="tma-portal-sig-wizard__review-step">' +
      '<div class="tma-portal-sig-wizard__review-form">' +
      ui().field('Document name*', ui().input({
        value: docName,
        attrs: 'data-sig-wizard-doc-name' + (readOnly ? ' readonly' : ''),
      })) +
      '<div class="tma-portal-field tma-portal-sig-wizard__storage-field">' +
      '<span class="tma-portal-field__label">Where would you like to store the Signed Document?</span>' +
      '<div class="tma-portal-sig-wizard__storage-row">' +
      '<span class="tma-portal-sig-wizard__storage-pick">' +
      '<img src="images/icons/phosphor/FolderFilled.svg" alt="" width="20" height="20">' +
      '<span data-sig-wizard-storage-label>' + ui().esc(storageFolder) + '</span>' +
      '</span>' +
      (readOnly ? '' : '<button type="button" class="tma-portal-link" data-sig-wizard-storage-edit>Edit</button>') +
      '</div></div>' +
      '</div></section>';
  }

  function renderSignatureWizardStep(record) {
    var readOnly = record.status === 'completed';
    if (sig.wizardStep === 'fields') {
      return renderSignatureWizardFieldsStep(record);
    }
    if (sig.wizardStep === 'review') {
      return renderSignatureWizardReviewStep(record);
    }

    var onlySigner = sigIsOnlySigner();
    return '<section class="tma-portal-sig-wizard__section">' +
      '<h3 class="tma-portal-sig-wizard__section-title">Document to send</h3>' +
      '<div class="tma-portal-sig-wizard__doc-card">' +
      '<div class="tma-portal-sig-wizard__doc-thumb">' +
      (readOnly ? '' : '<button type="button" class="tma-portal-sig-wizard__doc-remove" data-sig-wizard-remove-doc aria-label="Remove document"><img src="images/icons/phosphor/X.svg" alt=""></button>') +
      '<div class="tma-portal-sig-wizard__doc-preview" aria-hidden="true">' +
      '<span class="tma-portal-sig-wizard__doc-preview-title">' + ui().esc(sigShortFilename(record.title.replace(/\.[^.]+$/, ''), 42)) + '</span>' +
      '<span class="tma-portal-sig-wizard__doc-preview-line"></span>' +
      '<span class="tma-portal-sig-wizard__doc-preview-line"></span>' +
      '<span class="tma-portal-sig-wizard__doc-preview-line tma-portal-sig-wizard__doc-preview-line--short"></span>' +
      '</div></div>' +
      '<p class="tma-portal-sig-wizard__doc-name" title="' + ui().esc(record.title) + '">' + ui().esc(sigShortFilename(record.title)) + '</p>' +
      '</div></section>' +
      '<section class="tma-portal-sig-wizard__section">' +
      '<div class="tma-portal-sig-wizard__section-head">' +
      '<h3 class="tma-portal-sig-wizard__section-title">Who are the recipients?</h3>' +
      '<label class="tma-portal-checkbox tma-portal-sig-wizard__only-signer">' +
      '<input type="checkbox" data-sig-wizard-only-signer' + (onlySigner ? ' checked' : '') + (readOnly ? ' disabled' : '') + '>' +
      '<span>I\'m the only signer</span>' +
      '<span class="tma-portal-help" title="Send the document only to yourself for signing">&#9432;</span>' +
      '</label></div>' +
      '<div class="tma-portal-sig-wizard__recipients" data-sig-recipients>' +
      sig.recipients.map(function (r, i) {
        return sigRecipientBlock(r, i, sig.recipients.length, readOnly);
      }).join('') +
      '</div>' +
      (readOnly ? '' :
        '<button type="button" class="tma-portal-link tma-portal-sig-wizard__add-recipient" data-sig-add-recipient>' +
        '+ Add recipient</button>') +
      '</section>' +
      sigMessageSection(record, readOnly);
  }

  /* Optional subject/message that ride along with the signing invitation. */
  function sigMessageSection(record, readOnly) {
    return '<section class="tma-portal-sig-wizard__section">' +
      '<h3 class="tma-portal-sig-wizard__section-title">Add a message <span class="tma-portal-sig-wizard__optional">Optional</span></h3>' +
      ui().field('Subject', ui().input({
        value: record.subject || '',
        placeholder: 'Please sign: ' + sigShortFilename(record.title, 40),
        attrs: 'data-sig-wizard-subject' + (readOnly ? ' readonly' : ''),
      })) +
      '<div class="tma-portal-field">' +
      '<span class="tma-portal-field__label">Message</span>' +
      '<textarea class="tma-portal-input tma-portal-sig-wizard__message" rows="3"' +
      ' data-sig-wizard-message' + (readOnly ? ' readonly' : '') +
      ' placeholder="Add a note for your recipients"' +
      ' aria-label="Message">' + ui().esc(record.message || '') + '</textarea>' +
      '</div></section>';
  }

  /* One recipient. Order is the position in the list, shown explicitly only
     once there's more than one - a single signer has no order to speak of. */
  function sigRecipientBlock(r, index, count, readOnly) {
    var ordered = count > 1;
    return '<div class="tma-portal-sig-wizard__recipient" data-sig-recipient="' + index + '">' +
      '<div class="tma-portal-sig-wizard__recipient-head">' +
      '<span class="tma-portal-sig-wizard__recipient-label">Recipient ' + (index + 1) + '</span>' +
      (readOnly ? '' :
        '<div class="tma-portal-sig-wizard__recipient-tools">' +
        '<button type="button" class="tma-portal-link tma-portal-sig-wizard__pick-person"' +
        ' data-sig-pick-person="' + index + '">Choose from portal</button>' +
        (ordered
          ? '<button type="button" class="tma-portal-icon-btn" data-sig-move="up" data-sig-index="' + index + '"' +
            (index === 0 ? ' disabled' : '') + ' aria-label="Move recipient ' + (index + 1) + ' earlier">' +
            '<img src="images/icons/phosphor/ArrowUp.svg" alt=""></button>' +
            '<button type="button" class="tma-portal-icon-btn" data-sig-move="down" data-sig-index="' + index + '"' +
            (index === count - 1 ? ' disabled' : '') + ' aria-label="Move recipient ' + (index + 1) + ' later">' +
            '<img src="images/icons/phosphor/ArrowDown.svg" alt=""></button>'
          : '') +
        (count > 1
          ? '<button type="button" class="tma-portal-icon-btn" data-sig-remove-recipient="' + index + '"' +
            ' aria-label="Remove recipient ' + (index + 1) + '">' +
            '<img src="images/icons/phosphor/X.svg" alt=""></button>'
          : '') +
        '</div>') +
      '</div>' +
      '<div class="tma-portal-sig-wizard__recipient-fields">' +
      ui().field('Name*', ui().input({
        value: r.name || '',
        attrs: 'data-sig-r-name="' + index + '"' + (readOnly ? ' readonly' : ''),
      })) +
      ui().field('Email*', ui().input({
        type: 'email',
        value: r.email || '',
        attrs: 'data-sig-r-email="' + index + '"' + (readOnly ? ' readonly' : ''),
      })) +
      ui().field('Role', ui().select(
        [{ value: 'signer', label: 'Signer' }, { value: 'approver', label: 'Approver' }, { value: 'cc', label: 'CC' }],
        r.role || 'signer',
        'data-sig-r-role="' + index + '"' + (readOnly ? ' disabled' : ''),
        'Recipient role'
      )) +
      '</div></div>';
  }

  function renderSignatureWizard(record) {
    if (!record) return '';
    var readOnly = record.status === 'completed';
    var backLabel = sig.wizardStep !== 'files' && !readOnly ? 'Previous step' : '';
    var nextLabel = sig.wizardStep === 'review'
      ? (readOnly ? 'Download' : 'Send for signature')
      : 'Next step';
    var wizardMod = sig.wizardStep === 'fields'
      ? ' tma-portal-sig-wizard--place-fields'
      : sig.wizardStep === 'review'
        ? ' tma-portal-sig-wizard--review'
        : '';

    return '<div class="tma-portal-sig-wizard' + wizardMod + '">' +
      '<header class="tma-portal-sig-wizard__head">' +
      '<h2 class="tma-portal-sig-wizard__title">Signature request</h2>' +
      sigWizardStepper(sig.wizardStep) +
      '<button type="button" class="tma-portal-sig-wizard__close" data-sig-wizard-close aria-label="Close">' +
      '<img src="images/icons/phosphor/X.svg" alt=""></button>' +
      '</header>' +
      '<div class="tma-portal-sig-wizard__body">' + renderSignatureWizardStep(record) + '</div>' +
      '<footer class="tma-portal-sig-wizard__foot">' +
      (backLabel
        ? ui().btn({ label: backLabel, variant: 'ghost', attrs: 'data-sig-wizard-back' })
        : '<span></span>') +
      ui().btn({ label: nextLabel, attrs: 'data-sig-wizard-next' }) +
      '</footer></div>';
  }

  function wireSignatureWizard(root, record) {
    if (!root || !record) return;

    function closeWizard() {
      // Best-effort save on the way out; the list refreshes once it lands so
      // the card can't show a stale title or recipient. Placed fields are
      // saved too - closing the editor is not a reason to lose them.
      var pending = sig.wizardStep === 'fields'
        ? sigSaveFields(record)
        : saveSignatureWizardFields(root, record);

      pending
        .then(function () { loadSignatures({ silent: true }); })
        .catch(function () { /* toast already shown */ });

      sigResetEditor();
      sig.editingId = null;
      sig.wizardStep = 'files';
      sig.wizardPage = 0;
      clearSignaturesWizardLock();
      renderSignatures();
    }

    var closeBtn = root.querySelector('[data-sig-wizard-close]');
    if (closeBtn) closeBtn.addEventListener('click', closeWizard);

    var removeDoc = root.querySelector('[data-sig-wizard-remove-doc]');
    if (removeDoc) {
      removeDoc.addEventListener('click', function () {
        ui().toast('Document removed');
      });
    }

    root.querySelectorAll('[data-sig-pick-person]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sigPickPersonModal(parseInt(btn.getAttribute('data-sig-pick-person'), 10));
      });
    });

    var addRecipient = root.querySelector('[data-sig-add-recipient]');
    if (addRecipient) {
      addRecipient.addEventListener('click', function () {
        sigReadRecipientInputs(root);
        sig.recipients.push(sigBlankRecipient());
        renderSignatures();
        var fresh = sig.el.querySelector('[data-sig-r-name="' + (sig.recipients.length - 1) + '"]');
        if (fresh) fresh.focus();
      });
    }

    root.querySelectorAll('[data-sig-remove-recipient]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sigReadRecipientInputs(root);
        sig.recipients.splice(parseInt(btn.getAttribute('data-sig-remove-recipient'), 10), 1);
        if (!sig.recipients.length) sig.recipients = [sigBlankRecipient()];
        renderSignatures();
      });
    });

    root.querySelectorAll('[data-sig-move]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sigReadRecipientInputs(root);
        var i = parseInt(btn.getAttribute('data-sig-index'), 10);
        var to = btn.getAttribute('data-sig-move') === 'up' ? i - 1 : i + 1;
        if (to < 0 || to >= sig.recipients.length) return;
        var moved = sig.recipients.splice(i, 1)[0];
        sig.recipients.splice(to, 0, moved);
        renderSignatures();
      });
    });

    // "I'm the only signer" fills in the signed-in user and drops any other
    // rows; unchecking gives back an empty form rather than their details.
    var onlySigner = root.querySelector('[data-sig-wizard-only-signer]');
    if (onlySigner) {
      onlySigner.addEventListener('change', function () {
        var me = window.TMACurrentUser ? window.TMACurrentUser.get() : null;
        if (onlySigner.checked && me) {
          sig.recipients = [{ name: me.name || '', email: me.email || '', role: 'signer' }];
        } else {
          sig.recipients = [sigBlankRecipient()];
        }
        renderSignatures();
      });
    }

    wireSignatureEditor(root);

    root.querySelectorAll('[data-sig-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sig.wizardPage = parseInt(btn.getAttribute('data-sig-page'), 10) || 0;
        sig.selectedFieldId = null;
        renderSignatures();
      });
    });

    var storageEdit = root.querySelector('[data-sig-wizard-storage-edit]');
    if (storageEdit) {
      storageEdit.addEventListener('click', function () {
        ui().openModal({
          title: 'Store signed document in',
          body: '<div data-sig-storage-body>' + ui().loading({ count: 1 }) + '</div>',
          onMount: function (host) {
            var body = host.querySelector('[data-sig-storage-body]');

            // Real folders from the library - the destination has to be a
            // place the signed copy can actually be written.
            net().fetchJSON((window.__TMA_SITE_ROOT || '') +
              '/portal/files/?section=my&perPage=200')
              .then(function (res) {
                var folders = (res.folders || []).map(function (f) {
                  return { value: f.id, label: f.name };
                });
                folders.unshift({ value: '', label: 'Personal Folders' });

                body.innerHTML =
                  ui().field('Folder', ui().select(
                    folders,
                    record.folder ? record.folder.id : '',
                    'data-sig-wizard-storage-select',
                    'Folder'
                  )) +
                  '<div class="tma-portal-form-actions">' +
                  ui().btn({ label: 'Save', attrs: 'data-sig-wizard-storage-save' }) +
                  '</div>';

                body.querySelector('[data-sig-wizard-storage-save]').addEventListener('click', function (e) {
                  var saveBtn = e.currentTarget;
                  var sel = body.querySelector('[data-sig-wizard-storage-select]');
                  saveBtn.disabled = true;

                  net().fetchJSON(sigUrl('/' + encodeURIComponent(record.id)), {
                    method: 'PATCH',
                    json: { folderId: sel && sel.value ? sel.value : null },
                  })
                    .then(function (res2) {
                      Object.assign(record, res2.request);
                      ui().closeModal();
                      renderSignatures();
                    })
                    .catch(function (err) {
                      saveBtn.disabled = false;
                      ui().toastError((err && err.message) || 'Could not save the folder.');
                    });
                });
              })
              .catch(function (err) {
                body.innerHTML = ui().banner('warning', ui().esc(
                  (err && err.message) || 'Could not load your folders.'
                ));
              });
          },
        });
      });
    }

    var backBtn = root.querySelector('[data-sig-wizard-back]');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        // Stepping back must not discard placed fields.
        var pending = sig.wizardStep === 'fields'
          ? sigSaveFields(record)
          : saveSignatureWizardFields(root, record)
            .then(function (updated) { Object.assign(record, updated); });

        pending.catch(function () { /* toast already shown */ });

        if (sig.wizardStep === 'review') {
          sig.wizardStep = 'fields';
          renderSignatures();
          sigOpenEditor(record);
          return;
        }
        if (sig.wizardStep === 'fields') sig.wizardStep = 'files';
        renderSignatures();
      });
    }

    var nextBtn = root.querySelector('[data-sig-wizard-next]');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (record.status === 'completed') {
          var signed = record.signedDocument || record.document;
          if (!signed) {
            ui().toastError('That document is no longer available.');
            return;
          }
          window.location.href = (window.__TMA_SITE_ROOT || '') +
            '/portal/files/files/' + encodeURIComponent(signed.id) + '/download';
          return;
        }

        if (sig.wizardStep === 'files') {
          sigReadRecipientInputs(root);
          var bad = sigFirstInvalidRecipient();
          if (bad) {
            // Inline, next to the field at fault. A toast alone is the wrong
            // place for a form error: it's transient, it's at the far end of
            // the screen from where you're typing, and it can be covered.
            sigShowFieldError(root, bad);
            ui().toastError(bad.message);
            return;
          }
          sigClearFieldErrors(root);
          saveSignatureWizardFields(root, record).then(function (updated) {
            Object.assign(record, updated);
            sig.recipients = (updated.recipients || []).map(function (r) {
              return { name: r.name, email: r.email, role: r.role };
            });
            // Fields are assigned to saved recipients by uuid, so the editor
            // reads the persisted list, not the in-progress working copy.
            sig.savedRecipients = updated.recipients || [];
            sig.wizardStep = 'fields';
            renderSignatures();
            sigOpenEditor(record);
          }).catch(function () { /* toast already shown */ });
          return;
        }

        if (sig.wizardStep === 'fields') {
          sigSaveFields(record).then(function () {
            sig.wizardStep = 'review';
            renderSignatures();
          }).catch(function () { /* toast already shown */ });
          return;
        }

        var docNameInput = root.querySelector('[data-sig-wizard-doc-name]');
        if (docNameInput && !docNameInput.value.trim()) {
          docNameInput.focus();
          ui().toast('Add a document name');
          return;
        }

        // Save first, then send: the server rejects anything unsendable
        // (no signer, no fields, a signer with nothing to do) and says why.
        nextBtn.disabled = true;
        saveSignatureWizardFields(root, record)
          .then(function () {
            return net().fetchJSON(sigUrl('/' + encodeURIComponent(record.id) + '/send'), {
              method: 'POST',
              json: {},
            });
          })
          .then(function (res) {
            var count = (res.request.recipients || []).length;
            // Take the sent status locally first: closeWizard tries one last
            // save, and a PATCH against a request that is no longer a draft
            // comes back 422 and toasts an error over the success message.
            Object.assign(record, res.request);
            sig.fieldsDirty = false;
            ui().toast('Sent to ' + count + ' recipient' + (count === 1 ? '' : 's'));
            closeWizard();
            loadSignatures({ silent: true });
          })
          .catch(function (err) {
            nextBtn.disabled = false;
            if (err && err.message) ui().toastError(err.message);
          });
      });
    }

    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeWizard();
    });
  }

  /* Drop the loaded document and everything derived from it. The pdf.js
     document holds a worker and page bitmaps, so leaving it attached to a
     closed wizard keeps that memory alive for nothing. */
  function sigResetEditor() {
    if (sig.resizeObserver) {
      sig.resizeObserver.disconnect();
      sig.resizeObserver = null;
    }
    if (sig.doc && sig.doc.pdf && sig.doc.pdf.destroy) {
      try { sig.doc.pdf.destroy(); } catch (e) { /* already gone */ }
    }
    sig.doc = null;
    sig.docError = null;
    sig.fields = [];
    sig.selectedFieldId = null;
    sig.fieldsDirty = false;
  }

  function openSignatureWizard(record) {
    if (!record) return;
    sigResetEditor();
    sig.editingId = record.id;
    sig.wizardStep = record.status === 'completed' ? 'review' : 'files';
    sig.wizardPage = 0;
    // Seed the working copy from the saved record; a fresh draft starts with
    // one empty row so there's something to type into.
    sig.recipients = (record.recipients || []).map(function (r) {
      return { name: r.name, email: r.email, role: r.role };
    });
    sig.savedRecipients = record.recipients || [];
    if (!sig.recipients.length) sig.recipients = [sigBlankRecipient()];
    renderSignatures();
  }

  function signatureCard(r) {
    var perms = r.permissions || {};
    var isDraft = r.status === 'draft';
    var isCompleted = r.status === 'completed';
    var first = (r.recipients || [])[0];
    var meta = isDraft
      ? '<span class="tma-portal-sig-card__meta">Auto-deletes in ' + (r.autoDeleteDays || 30) + ' day(s)</span>'
      : isCompleted && first
        ? '<div class="tma-portal-sig-card__assign">' +
          '<span class="tma-portal-sig-card__assign-label">Assigned to</span>' +
          '<span class="tma-portal-sig-card__avatar" aria-hidden="true">' + ui().esc(first.initials) + '</span>' +
          '<span class="tma-portal-sig-card__assign-name">' + ui().esc(first.name || first.email) + '</span>' +
          '</div>'
        : '<span class="tma-portal-sig-card__meta">' + ui().esc(sigRecipientSummary(r) || 'No recipients yet') + '</span>';

    // Actions follow the server's permission map, not a guess from the label,
    // so a status that forbids an action never shows its button.
    var action = perms.delete
      ? ui().btn({ label: 'Delete', variant: 'ghost', small: true, attrs: 'data-sig-delete="' + r.id + '"' })
      : perms.downloadSigned
        ? ui().btn({ label: 'Download', small: true, attrs: 'data-sig-download="' + r.id + '"' })
        : perms.remind
          ? ui().btn({ label: 'Remind', small: true, attrs: 'data-sig-remind="' + r.id + '"' })
          : '';

    // Everything else lives behind the row menu rather than crowding the card.
    var menu = '<button type="button" class="tma-portal-icon-btn tma-portal-sig-card__menu"' +
      ' data-sig-card-menu="' + r.id + '" title="More options" aria-label="More options for ' + ui().esc(r.title) + '">' +
      '<img src="images/icons/phosphor/DotsThree.svg" alt=""></button>';

    return '<article class="tma-portal-sig-card" data-sig-open="' + r.id + '" tabindex="0" aria-labelledby="sig-title-' + r.id + '">' +
      '<div class="tma-portal-sig-card__main">' +
      '<h3 class="tma-portal-sig-card__title" id="sig-title-' + r.id + '" title="' + ui().esc(r.title) + '">' + ui().esc(r.title) + '</h3>' +
      sigStatusBadge(r.status, r.statusLabel) +
      '</div>' +
      meta +
      '<div class="tma-portal-sig-card__actions">' + action + menu + '</div>' +
      '</article>';
  }

  /* The document must be a real File Library file - a typed name can't be sent
     for signature. The picker lists only formats the signing pipeline can
     actually handle, so an unsupported file is refused here rather than after
     a recipient has already opened a broken link. */
  function sigPickerRow(f, selectedId) {
    var on = f.id === selectedId;
    return '<button type="button" class="tma-portal-sig-picker__row' + (on ? ' is-selected' : '') + '"' +
      ' data-sig-pick="' + ui().esc(f.id) + '" aria-pressed="' + on + '">' +
      '<img class="tma-portal-sig-picker__icon" src="images/icons/phosphor/' +
      (f.extension === 'pdf' ? 'FilePdf' : 'FileImage') + '.svg" alt="" width="20" height="20">' +
      '<span class="tma-portal-sig-picker__text">' +
      '<span class="tma-portal-sig-picker__name">' + ui().esc(f.name) + '</span>' +
      (f.folder ? '<span class="tma-portal-sig-picker__folder">' + ui().esc(f.folder) + '</span>' : '') +
      '</span></button>';
  }

  function sigDownload(record, which) {
    var doc = record && (which === 'signed' ? (record.signedDocument || record.document) : record.document);
    if (!doc) {
      ui().toastError('That document is no longer available.');
      return;
    }
    window.location.href = (window.__TMA_SITE_ROOT || '') +
      '/portal/files/files/' + encodeURIComponent(doc.id) + '/download';
  }

  function sigRemind(id, btn) {
    if (btn) btn.disabled = true;
    net().fetchJSON(sigUrl('/' + encodeURIComponent(id) + '/remind'), { method: 'POST', json: {} })
      .then(function (res) {
        ui().toast('Reminder sent to ' + res.reminded + ' recipient' + (res.reminded === 1 ? '' : 's'));
      })
      .catch(function (err) {
        ui().toastError((err && err.message) || 'Could not send the reminder.');
      })
      .then(function () { if (btn) btn.disabled = false; });
  }

  /* Signing links are per-recipient, so "copy link" has to ask which one -
     handing over the wrong person's link would let them sign as someone else. */
  function sigCopyLink(record) {
    ui().openModal({
      title: 'Signing links',
      body: '<div data-sig-links>' + ui().loading({ count: 2 }) + '</div>',
      onMount: function (host) {
        var body = host.querySelector('[data-sig-links]');

        net().fetchJSON(sigUrl('/' + encodeURIComponent(record.id) + '/links'))
          .then(function (res) {
            var links = (res.links || []).filter(function (l) { return l.url; });
            if (!links.length) {
              body.innerHTML = ui().banner('info',
                'No live signing links. They expire once signed, cancelled, or past the expiry date.');
              return;
            }
            body.innerHTML = links.map(function (l, i) {
              return '<div class="tma-portal-field">' +
                '<span class="tma-portal-field__label">' + ui().esc(l.name || l.email) +
                (l.canSign ? '' : ' — waiting their turn') + '</span>' +
                '<div class="tma-portal-sig-link-row">' +
                ui().input({ value: l.url, attrs: 'data-sig-link="' + i + '" readonly' }) +
                ui().btn({ label: 'Copy', small: true, attrs: 'data-sig-copy="' + i + '"' }) +
                '</div></div>';
            }).join('');

            body.querySelectorAll('[data-sig-copy]').forEach(function (btn) {
              btn.addEventListener('click', function () {
                var i = btn.getAttribute('data-sig-copy');
                var input = body.querySelector('[data-sig-link="' + i + '"]');
                input.select();
                var copied = false;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(input.value);
                  copied = true;
                } else {
                  try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
                }
                ui().toast(copied ? 'Signing link copied' : 'Press Ctrl/Cmd+C to copy');
              });
            });
          })
          .catch(function (err) {
            body.innerHTML = ui().banner('warning', ui().esc(
              (err && err.message) || 'Could not load the links.'
            ));
          });
      },
    });
  }

  var SIG_EVENT_LABEL = {
    created: 'Created', sent: 'Sent', reminded: 'Reminder sent', viewed: 'Opened',
    field_completed: 'Field completed', signed: 'Signed', completed: 'Completed',
    declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired', downloaded: 'Downloaded',
  };

  /* The audit trail: who did what, when, and from where. */
  function sigActivityModal(record) {
    ui().openModal({
      title: 'Activity',
      body: '<div data-sig-activity>' + ui().loading({ count: 4 }) + '</div>',
      onMount: function (host) {
        var body = host.querySelector('[data-sig-activity]');

        net().fetchJSON(sigUrl('/' + encodeURIComponent(record.id)))
          .then(function (res) {
            var events = res.request.events || [];
            if (!events.length) {
              body.innerHTML = ui().banner('info', 'Nothing has happened yet.');
              return;
            }
            body.innerHTML = ui().table(
              ['Event', 'Who', 'When', 'IP'],
              events.map(function (e) {
                var when = e.at ? new Date(e.at) : null;
                return '<tr>' +
                  '<td>' + ui().esc(SIG_EVENT_LABEL[e.action] || e.action) +
                  (e.meta && e.meta.field ? ' <span class="tma-portal-muted">(' + ui().esc(e.meta.field) + ')</span>' : '') +
                  '</td>' +
                  '<td>' + ui().esc(e.actor || '—') + '</td>' +
                  '<td>' + (when ? ui().esc(when.toLocaleString()) : '—') + '</td>' +
                  '<td>' + ui().esc(e.ip || '—') + '</td>' +
                  '</tr>';
              }).join('')
            );
          })
          .catch(function (err) {
            body.innerHTML = ui().banner('warning', ui().esc(
              (err && err.message) || 'Could not load the activity.'
            ));
          });
      },
    });
  }

  function sigCardAction(action, record, btn) {
    if (action === 'copy') return sigCopyLink(record);
    if (action === 'remind') return sigRemind(record.id, btn);
    if (action === 'original') return sigDownload(record, 'original');
    if (action === 'signed') return sigDownload(record, 'signed');
    if (action === 'activity') return sigActivityModal(record);

    if (action === 'cancel') {
      net().fetchJSON(sigUrl('/' + encodeURIComponent(record.id) + '/cancel'), { method: 'POST', json: {} })
        .then(function () {
          ui().toast('Signature request cancelled');
          loadSignatures({ silent: true });
        })
        .catch(function (err) { ui().toastError((err && err.message) || 'Could not cancel the request.'); });
      return;
    }

    if (action === 'delete') {
      net().fetchJSON(sigUrl('/' + encodeURIComponent(record.id)), { method: 'DELETE' })
        .then(function () {
          ui().toast('Signature request deleted');
          loadSignatures({ silent: true });
        })
        .catch(function (err) { ui().toastError((err && err.message) || 'Could not delete the request.'); });
    }
  }

  function createSignatureModal() {
    var picked = null;
    var timer = null;

    ui().openModal({
      title: 'Create signature request',
      body:
        '<div class="tma-portal-sig-picker">' +
        ui().searchInput('Search your documents', 'data-sig-pick-search') +
        '<div class="tma-portal-sig-picker__list" data-sig-pick-list>' +
        ui().loading({ count: 3 }) +
        '</div></div>' +
        '<div class="tma-portal-form-actions">' +
        ui().btn({ label: 'Create', attrs: 'data-sig-new-create', disabled: true }) +
        '</div>',
      onMount: function (host) {
        var list = host.querySelector('[data-sig-pick-list]');
        var createBtn = host.querySelector('[data-sig-new-create]');

        function loadDocs(search) {
          var params = new URLSearchParams();
          if (search) params.set('search', search);

          net().fetchJSON(sigUrl('/documents?' + params.toString()))
            .then(function (res) {
              var files = res.files || [];
              if (!files.length) {
                list.innerHTML = ui().emptyState({
                  illustration: 'Illustration06',
                  title: search ? 'No documents match' : 'No documents ready to sign',
                  subtitle: search
                    ? 'Try a different search term.'
                    : 'Upload a ' + (res.accepts || []).join(', ').toUpperCase() +
                      ' file to the File Library first.',
                });
                return;
              }
              list.innerHTML = files.map(function (f) { return sigPickerRow(f, picked); }).join('');

              list.querySelectorAll('[data-sig-pick]').forEach(function (row) {
                row.addEventListener('click', function () {
                  picked = row.getAttribute('data-sig-pick');
                  list.querySelectorAll('[data-sig-pick]').forEach(function (other) {
                    var on = other === row;
                    other.classList.toggle('is-selected', on);
                    other.setAttribute('aria-pressed', on);
                  });
                  createBtn.disabled = false;
                });
              });
            })
            .catch(function (err) {
              list.innerHTML = ui().banner('warning', ui().esc(
                (err && err.message) || 'Could not load your documents.'
              ));
            });
        }

        ui().wireToolbarSearch(host, '[data-sig-pick-search]', function (val) {
          clearTimeout(timer);
          timer = setTimeout(function () { loadDocs(val.trim()); }, 250);
        });

        createBtn.addEventListener('click', function () {
          if (!picked) return;
          createBtn.disabled = true;

          net().fetchJSON(sigUrl('/'), { method: 'POST', json: { fileId: picked } })
            .then(function (res) {
              ui().closeModal();
              ui().toast('Signature request created');
              sig.requests.unshift(res.request);
              openSignatureWizard(res.request);
            })
            .catch(function (err) {
              createBtn.disabled = false;
              ui().toastError((err && err.message) || 'Could not create the request.');
            });
        });

        loadDocs('');
      },
    });
  }

  function clearSignaturesWizardLock() {
    var dash = document.querySelector('.tma-dash');
    if (dash) dash.classList.remove('tma-dash--signatures-wizard');
    document.documentElement.classList.remove('tma-dash--signatures-wizard');
    document.documentElement.style.overflow = '';
    document.documentElement.style.touchAction = '';
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
  }

  function syncSignaturesWizardChrome() {
    var on = !!sig.editingId;
    var dash = document.querySelector('.tma-dash');
    if (dash) dash.classList.toggle('tma-dash--signatures-wizard', on);
    document.documentElement.classList.toggle('tma-dash--signatures-wizard', on);
    if (!on) clearSignaturesWizardLock();
  }

  function closeSignaturesWizardChrome() {
    var wasOpen = !!sig.editingId
      || document.documentElement.classList.contains('tma-dash--signatures-wizard')
      || !!(document.querySelector('.tma-dash') && document.querySelector('.tma-dash').classList.contains('tma-dash--signatures-wizard'))
      || !!document.querySelector('.tma-portal-sig-wizard');
    sig.editingId = null;
    sig.wizardStep = 'files';
    sig.wizardPage = 0;
    clearSignaturesWizardLock();
    if (sig.el && sig.el.querySelector('.tma-portal-sig-wizard')) {
      sig.el.innerHTML = '';
    }
    if (!wasOpen) return;
    renderSignatures();
  }

  function renderSignatures() {
    var el = sig.el;
    if (!el) return;

    if (sig.editingId) {
      var editing = signatureRecord(sig.editingId);
      if (!editing) {
        sig.editingId = null;
        sig.wizardStep = 'files';
      } else {
        el.innerHTML = renderSignatureWizard(editing);
        wireSignatureWizard(el, editing);
        syncSignaturesWizardChrome();
        return;
      }
    }

    syncSignaturesWizardChrome();

    var list = sig.requests;
    var active = document.activeElement;
    var restoreSearch = active && active.matches && active.matches('[data-sig-search]');
    var searchCaret = restoreSearch ? active.selectionStart : null;

    el.innerHTML =
      '<div class="tma-portal-page tma-portal-page--signatures">' +
      '<div class="tma-portal-head">' +
      '<div class="tma-portal-head__title-wrap">' +
      '<h2 class="tma-portal-head__title">Signature requests</h2>' +
      '<button type="button" class="tma-portal-icon-btn" data-sig-head-menu title="More options" aria-label="More options">' +
      '<img src="images/icons/phosphor/DotsThree.svg" alt=""></button>' +
      '</div>' +
      '<div class="tma-portal-head__actions">' +
      sigNewDropdown() +
      '</div></div>' +
      '<div class="tma-portal-toolbar">' +
      '<div class="tma-portal-toolbar__group tma-portal-toolbar__group--search">' +
      ui().searchInput('Search', 'data-sig-search', sig.search, { focused: restoreSearch }) +
      '</div>' +
      '<div class="tma-portal-toolbar__group tma-portal-toolbar__group--filters">' +
      ui().field('Status', ui().select(
        SIG_STATUS_FILTERS,
        sig.status,
        'data-sig-status',
        'Status'
      )) +
      (sig.canAdminView
        ? '<label class="tma-portal-checkbox tma-portal-checkbox--toolbar">' +
          '<input type="checkbox" data-sig-admin' + (sig.adminView ? ' checked' : '') + '>' +
          '<span>Admin View</span>' +
          '<span class="tma-portal-help" title="Show signature requests from all users on this account">&#9432;</span>' +
          '</label>'
        : '') +
      '</div></div>' +
      sigListBody(list) +
      '</div>';

    ui().wireToolbarSearch(el, '[data-sig-search]', function (val) {
      sig.search = val;
      // Debounced: the search box hits the database on every keystroke
      // otherwise, and the responses can land out of order.
      clearTimeout(sig.searchTimer);
      sig.searchTimer = setTimeout(function () { loadSignatures({ silent: true }); }, 250);
    });

    var retry = el.querySelector('[data-sig-retry]');
    if (retry) retry.addEventListener('click', function () { loadSignatures(); });

    if (restoreSearch) {
      var searchInput = el.querySelector('[data-sig-search]');
      if (searchInput) {
        searchInput.focus();
        if (searchCaret != null) searchInput.setSelectionRange(searchCaret, searchCaret);
      }
    }

    var statusSelect = el.querySelector('[data-sig-status]');
    if (statusSelect) {
      statusSelect.addEventListener('change', function () {
        sig.status = statusSelect.value;
        loadSignatures();
      });
    }

    var adminCheck = el.querySelector('[data-sig-admin]');
    if (adminCheck) {
      adminCheck.addEventListener('change', function () {
        sig.adminView = adminCheck.checked;
        loadSignatures();
      });
    }

    el.querySelectorAll('[data-sig-open]').forEach(function (card) {
      function open() {
        openSignatureWizard(signatureRecord(card.getAttribute('data-sig-open')));
      }
      card.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        open();
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });

    el.querySelectorAll('[data-sig-delete]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-sig-delete');
        btn.disabled = true;
        net().fetchJSON(sigUrl('/' + encodeURIComponent(id)), { method: 'DELETE' })
          .then(function () {
            ui().toast('Signature request deleted');
            loadSignatures({ silent: true });
          })
          .catch(function (err) {
            btn.disabled = false;
            ui().toastError((err && err.message) || 'Could not delete the request.');
          });
      });
    });

    el.querySelectorAll('[data-sig-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-sig-cancel');
        btn.disabled = true;
        net().fetchJSON(sigUrl('/' + encodeURIComponent(id) + '/cancel'), { method: 'POST', json: {} })
          .then(function () {
            ui().toast('Signature request cancelled');
            loadSignatures({ silent: true });
          })
          .catch(function (err) {
            btn.disabled = false;
            ui().toastError((err && err.message) || 'Could not cancel the request.');
          });
      });
    });

    el.querySelectorAll('[data-sig-download]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        sigDownload(signatureRecord(btn.getAttribute('data-sig-download')), 'signed');
      });
    });

    el.querySelectorAll('[data-sig-remind]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        sigRemind(btn.getAttribute('data-sig-remind'), btn);
      });
    });

    el.querySelectorAll('[data-sig-card-menu]').forEach(function (btn) {
      var record = signatureRecord(btn.getAttribute('data-sig-card-menu'));
      if (!record) return;
      var perms = record.permissions || {};
      var items = [];

      if (perms.remind) items.push({ label: 'Copy signing link', action: 'copy' });
      if (perms.remind) items.push({ label: 'Send a reminder', action: 'remind' });
      if (perms.downloadOriginal) items.push({ label: 'Download original', action: 'original' });
      if (perms.downloadSigned) items.push({ label: 'Download signed copy', action: 'signed' });
      items.push({ label: 'View activity', action: 'activity' });
      if (perms.cancel) items.push({ label: 'Cancel request', action: 'cancel' });
      if (perms.delete) items.push({ label: 'Delete draft', action: 'delete' });

      ui().wireMenu(btn, items, function (pick) {
        sigCardAction(pick.action, record, btn);
      });
    });

    var headMenu = el.querySelector('[data-sig-head-menu]');
    if (headMenu) {
      ui().wireMenu(headMenu, [
        { label: 'Export list' },
        { label: 'Signature settings' },
      ], function () {
        ui().toast('Coming soon');
      });
    }

    ui().wireHeadDropdownAll(el, '[data-sig-new-dropdown]', function (pick) {
      if (pick.action === 'self') {
        ui().toast('Sign a document yourself…');
        return;
      }
      createSignatureModal();
    });
  }

  function mountSignatures(el) {
    sig.el = el;
    // Remounting returns to the list; a wizard left open belongs to the
    // request the user was editing, not to this fresh navigation.
    sig.editingId = null;
    sig.wizardStep = 'files';
    renderSignatures();
    loadSignatures().then(function () {
      // Arriving from "Send for signature" in the File Library: open the draft
      // that hand-off just created.
      if (!sig.pendingOpenId) return;
      var record = signatureRecord(sig.pendingOpenId);
      sig.pendingOpenId = null;
      if (record) openSignatureWizard(record);
    });
  }

  /* Formats the signing pipeline can handle. Mirrors App\Support\Signatures\
     Signable on the server, which is the authority - this only decides whether
     to offer the menu item. */
  var SIG_SIGNABLE_EXT = ['pdf', 'png', 'jpg', 'jpeg'];

  function sigIsSignableName(name) {
    var m = String(name || '').match(/\.([^.]+)$/);
    return !!m && SIG_SIGNABLE_EXT.indexOf(m[1].toLowerCase()) !== -1;
  }

  /* Entry point for "Send for signature" from the File Library. Creates the
     draft, then hands off to the Signatures view with its wizard open. */
  function sendFileForSignature(fileId) {
    return net().fetchJSON(sigUrl('/'), { method: 'POST', json: { fileId: fileId } })
      .then(function (res) {
        sig.requests.unshift(res.request);
        sig.pendingOpenId = res.request.id;
        if (window.TMADashboard) {
          window.TMADashboard.navigate({
            navId: 'signatures',
            view: 'signatures',
            title: 'Signature requests',
            crumb: 'Signatures',
          });
        }
        return res.request;
      })
      .catch(function (err) {
        ui().toastError((err && err.message) || 'Could not start a signature request.');
        throw err;
      });
  }

  window.TMAPortalSignatures = {
    closeWizardChrome: closeSignaturesWizardChrome,
    clearLock: clearSignaturesWizardLock,
    isSignableName: sigIsSignableName,
    sendFileForSignature: sendFileForSignature,
  };

  window.addEventListener('pageshow', function () {
    if (!sig.editingId) clearSignaturesWizardLock();
  });

  if (window.TMAPortalViews) {
    window.TMAPortalViews.register('workflows', mountWorkflows);
    window.TMAPortalViews.register('templates', mountTemplates);
    window.TMAPortalViews.register('signatures', mountSignatures);
  }
})();
