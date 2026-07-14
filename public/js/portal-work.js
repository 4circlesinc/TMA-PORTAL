/*
 * TMA - Portal Work (Workflows, Templates, Signatures)
 */
(function () {
  'use strict';

  function ui() { return window.TMAPortalUI; }
  function data() { return window.TMAPortalData; }

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
  var sig = { el: null, search: '', status: 'all', adminView: false, editingId: null, wizardStep: 'files', wizardPage: 0 };

  var SIG_WIZARD_STEPS = [
    { key: 'files', label: 'Files and recipients', icon: 'Users' },
    { key: 'fields', label: 'Place fields', icon: 'PencilSimple' },
    { key: 'review', label: 'Review and send', icon: 'EnvelopeSimple' },
  ];

  var SIG_STATUS_STYLE = {
    Draft: '--status-badge-color:rgba(0,0,0,0.45);--status-badge-pill-surface:rgba(0,0,0,0.04);',
    Sent: '--status-badge-color:#6eb5ff;',
    Completed: '--status-badge-color:#71dd8c;',
  };

  function sigStatusBadge(status) {
    var style = SIG_STATUS_STYLE[status] || SIG_STATUS_STYLE.Draft;
    return '<span class="tma-status-badge tma-status-badge--pill tma-status-badge--muted" style="' + style + '">' +
      '<span class="tma-status-badge__label">' + ui().esc(status) + '</span></span>';
  }

  function sigAssigneeInitials(name) {
    return String(name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); })
      .join('');
  }

  function filteredSignatures() {
    var s = data().state();
    var q = sig.search.toLowerCase();
    return s.signatureRequests.filter(function (r) {
      if (!sig.adminView && r.adminOnly) return false;
      if (sig.status !== 'all' && String(r.status || '').toLowerCase() !== sig.status) return false;
      if (q && String(r.doc || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function signatureRecord(id) {
    var s = data().state();
    return s.signatureRequests.filter(function (r) { return r.id === id; })[0] || null;
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

  function saveSignatureWizardFields(root, record) {
    if (!root || !record) return;
    var name = root.querySelector('[data-sig-wizard-name]');
    var email = root.querySelector('[data-sig-wizard-email]');
    var role = root.querySelector('[data-sig-wizard-role]');
    var only = root.querySelector('[data-sig-wizard-only-signer]');
    if (name) record.recipientName = name.value.trim();
    if (email) record.recipientEmail = email.value.trim();
    if (role) record.recipientRole = role.value;
    if (only) record.onlySigner = only.checked;
    if (email && email.value.trim()) record.to = email.value.trim();
    var docName = root.querySelector('[data-sig-wizard-doc-name]');
    if (docName) record.documentName = docName.value.trim();
    data().save();
  }

  function sigFieldCard(label, icon, action) {
    return '<button type="button" class="tma-portal-sig-wizard__field-card" data-sig-field="' + ui().esc(action) + '">' +
      '<span class="tma-portal-sig-wizard__field-card-icon"><img src="images/icons/phosphor/' + icon + '.svg" alt=""></span>' +
      '<span class="tma-portal-sig-wizard__field-card-label">' + ui().esc(label) + '</span>' +
      '</button>';
  }

  function renderSignatureDocumentPage(pageIndex) {
    if (pageIndex === 1) {
      return '<div class="tma-portal-sig-wizard__doc-sheet tma-portal-sig-wizard__doc-sheet--art">' +
        '<div class="tma-portal-sig-wizard__logo-mark" aria-hidden="true">' +
        '<span class="tma-portal-sig-wizard__logo-leaf"></span>' +
        '<span class="tma-portal-sig-wizard__logo-text">Healthy Smiles</span>' +
        '</div></div>';
    }
    return '<div class="tma-portal-sig-wizard__doc-sheet">' +
      '<div class="tma-portal-sig-wizard__doc-brand">iGRAPHIX MARKETING &amp; COMPANY</div>' +
      '<h3 class="tma-portal-sig-wizard__doc-heading">Design Brief – Healthy Smiles Dental Logo Project Overview</h3>' +
      '<table class="tma-portal-sig-wizard__doc-meta">' +
      '<tr><th>Document No.</th><td>HS-DB-001</td><th>Document Title</th><td>Design Brief</td></tr>' +
      '<tr><th>Revision</th><td>1.0</td><th>Date</th><td>07/08/2026</td></tr>' +
      '</table>' +
      '<h4 class="tma-portal-sig-wizard__doc-subhead">Objectives</h4>' +
      '<p class="tma-portal-sig-wizard__doc-copy">Create a professional, trustworthy logo for Healthy Smiles Dental that communicates care, cleanliness, and confidence. The mark should work across signage, digital, and print applications.</p>' +
      '<h4 class="tma-portal-sig-wizard__doc-subhead">Target Audience</h4>' +
      '<p class="tma-portal-sig-wizard__doc-copy">Families and working professionals seeking a modern dental practice with a welcoming brand presence in the local community.</p>' +
      '<h4 class="tma-portal-sig-wizard__doc-subhead">Deliverables</h4>' +
      '<ul class="tma-portal-sig-wizard__doc-list">' +
      '<li>Primary logo and secondary lockup</li>' +
      '<li>Color palette and typography guidance</li>' +
      '<li>Social and letterhead applications</li>' +
      '</ul></div>';
  }

  function renderSignatureWizardFieldsStep(record) {
    var page = sig.wizardPage || 0;
    var docTitle = sigShortFilename(record.doc.replace(/\.[^.]+$/, ''), 24);
    return '<div class="tma-portal-sig-wizard__workspace">' +
      '<aside class="tma-portal-sig-wizard__fields-panel">' +
      '<div class="tma-portal-sig-wizard__fields-head">' +
      '<h3 class="tma-portal-sig-wizard__fields-title">Fields</h3>' +
      '<button type="button" class="tma-portal-link" data-sig-import-fields>Import fields</button>' +
      '</div>' +
      '<p class="tma-portal-sig-wizard__fields-desc">Choose a type of field to place in your document</p>' +
      '<div class="tma-portal-sig-wizard__field-list">' +
      sigFieldCard('Your signature', 'PenNib', 'signature') +
      sigFieldCard('Add text', 'TextAa', 'text') +
      sigFieldCard('Add checkmark', 'CheckSquare', 'checkmark') +
      '</div></aside>' +
      '<div class="tma-portal-sig-wizard__canvas">' +
      '<div class="tma-portal-sig-wizard__canvas-scroll">' + renderSignatureDocumentPage(page) + '</div>' +
      '</div>' +
      '<aside class="tma-portal-sig-wizard__pages-panel">' +
      '<p class="tma-portal-sig-wizard__pages-title" title="' + ui().esc(record.doc) + '">' + ui().esc(docTitle) + '</p>' +
      '<div class="tma-portal-sig-wizard__page-list">' +
      '<button type="button" class="tma-portal-sig-wizard__page-thumb' + (page === 0 ? ' is-active' : '') + '" data-sig-page="0" aria-label="Page 1">' +
      '<span class="tma-portal-sig-wizard__page-mini tma-portal-sig-wizard__page-mini--brief"></span></button>' +
      '<button type="button" class="tma-portal-sig-wizard__page-thumb' + (page === 1 ? ' is-active' : '') + '" data-sig-page="1" aria-label="Page 2">' +
      '<span class="tma-portal-sig-wizard__page-mini tma-portal-sig-wizard__page-mini--logo"></span></button>' +
      '</div></aside></div>';
  }

  function sigReviewDocumentName(record) {
    if (record.documentName) return record.documentName;
    var base = String(record.doc || '').replace(/\.[^.]+$/, '');
    if (/overview$/i.test(base) && base.indexOf('pages') === -1) return base + ' pages';
    return base;
  }

  function renderSignatureWizardReviewStep(record) {
    var readOnly = record.status === 'Completed';
    var docName = sigReviewDocumentName(record);
    var storageFolder = record.storageFolder || 'Personal Folders';
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
    var readOnly = record.status === 'Completed';
    if (sig.wizardStep === 'fields') {
      return renderSignatureWizardFieldsStep(record);
    }
    if (sig.wizardStep === 'review') {
      return renderSignatureWizardReviewStep(record);
    }

    var onlySigner = record.onlySigner !== false;
    var recipientName = record.recipientName || (onlySigner ? 'Travis Francis' : '');
    var recipientEmail = record.recipientEmail || record.to || (onlySigner ? 'igraphixmarketingco@gmail.com' : '');
    return '<section class="tma-portal-sig-wizard__section">' +
      '<h3 class="tma-portal-sig-wizard__section-title">Document to send</h3>' +
      '<div class="tma-portal-sig-wizard__doc-card">' +
      '<div class="tma-portal-sig-wizard__doc-thumb">' +
      (readOnly ? '' : '<button type="button" class="tma-portal-sig-wizard__doc-remove" data-sig-wizard-remove-doc aria-label="Remove document"><img src="images/icons/phosphor/X.svg" alt=""></button>') +
      '<div class="tma-portal-sig-wizard__doc-preview" aria-hidden="true">' +
      '<span class="tma-portal-sig-wizard__doc-preview-title">' + ui().esc(sigShortFilename(record.doc.replace(/\.[^.]+$/, ''), 42)) + '</span>' +
      '<span class="tma-portal-sig-wizard__doc-preview-line"></span>' +
      '<span class="tma-portal-sig-wizard__doc-preview-line"></span>' +
      '<span class="tma-portal-sig-wizard__doc-preview-line tma-portal-sig-wizard__doc-preview-line--short"></span>' +
      '</div></div>' +
      '<p class="tma-portal-sig-wizard__doc-name" title="' + ui().esc(record.doc) + '">' + ui().esc(sigShortFilename(record.doc)) + '</p>' +
      '</div></section>' +
      '<section class="tma-portal-sig-wizard__section">' +
      '<div class="tma-portal-sig-wizard__section-head">' +
      '<h3 class="tma-portal-sig-wizard__section-title">Who are the recipients?</h3>' +
      '<label class="tma-portal-checkbox tma-portal-sig-wizard__only-signer">' +
      '<input type="checkbox" data-sig-wizard-only-signer' + (onlySigner ? ' checked' : '') + (readOnly ? ' disabled' : '') + '>' +
      '<span>I\'m the only signer</span>' +
      '<span class="tma-portal-help" title="Send the document only to yourself for signing">&#9432;</span>' +
      '</label></div>' +
      '<div class="tma-portal-sig-wizard__recipient">' +
      '<span class="tma-portal-sig-wizard__recipient-label">Recipient 1</span>' +
      '<div class="tma-portal-sig-wizard__recipient-fields">' +
      ui().field('Name*', ui().input({ value: recipientName, attrs: 'data-sig-wizard-name' + (readOnly ? ' readonly' : '') })) +
      ui().field('Email*', ui().input({ type: 'email', value: recipientEmail, attrs: 'data-sig-wizard-email' + (readOnly ? ' readonly' : '') })) +
      ui().field('Role', ui().select(['Signer', 'Approver', 'CC'], record.recipientRole || 'Signer', 'data-sig-wizard-role' + (readOnly ? ' disabled' : ''), 'Recipient role')) +
      '</div></div></section>';
  }

  function renderSignatureWizard(record) {
    if (!record) return '';
    var readOnly = record.status === 'Completed';
    var backLabel = sig.wizardStep !== 'files' && !readOnly ? 'Previous step' : '';
    var nextLabel = sig.wizardStep === 'review'
      ? (readOnly ? 'Download' : 'Save completed document')
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
      saveSignatureWizardFields(root, record);
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

    root.querySelectorAll('[data-sig-field]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-sig-field');
        var labels = { signature: 'Signature field', text: 'Text field', checkmark: 'Checkmark field' };
        ui().toast('Placing ' + (labels[kind] || 'field') + '…');
      });
    });

    root.querySelectorAll('[data-sig-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sig.wizardPage = parseInt(btn.getAttribute('data-sig-page'), 10) || 0;
        renderSignatures();
      });
    });

    var importFields = root.querySelector('[data-sig-import-fields]');
    if (importFields) {
      importFields.addEventListener('click', function () {
        ui().toast('Import fields…');
      });
    }

    var storageEdit = root.querySelector('[data-sig-wizard-storage-edit]');
    if (storageEdit) {
      storageEdit.addEventListener('click', function () {
        ui().openModal({
          title: 'Store signed document in',
          body:
            ui().field('Folder', ui().select(
              ['Personal Folders', 'Shared Folders', 'Test'],
              record.storageFolder || 'Personal Folders',
              'data-sig-wizard-storage-select',
              'Folder'
            )) +
            '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Save', attrs: 'data-sig-wizard-storage-save' }) + '</div>',
          onMount: function (host) {
            host.querySelector('[data-sig-wizard-storage-save]').addEventListener('click', function () {
              var sel = host.querySelector('[data-sig-wizard-storage-select]');
              record.storageFolder = sel ? sel.value : 'Personal Folders';
              data().save();
              ui().closeModal();
              renderSignatures();
            });
          },
        });
      });
    }

    var backBtn = root.querySelector('[data-sig-wizard-back]');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        saveSignatureWizardFields(root, record);
        if (sig.wizardStep === 'review') sig.wizardStep = 'fields';
        else if (sig.wizardStep === 'fields') sig.wizardStep = 'files';
        renderSignatures();
      });
    }

    var nextBtn = root.querySelector('[data-sig-wizard-next]');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        saveSignatureWizardFields(root, record);
        if (record.status === 'Completed') {
          ui().toast('Downloading signed document…');
          return;
        }
        if (sig.wizardStep === 'files') {
          var email = root.querySelector('[data-sig-wizard-email]');
          var name = root.querySelector('[data-sig-wizard-name]');
          if (!name || !name.value.trim() || !email || !email.value.trim()) {
            (name && !name.value.trim() ? name : email).focus();
            ui().toast('Add recipient name and email');
            return;
          }
          sig.wizardStep = 'fields';
          renderSignatures();
          return;
        }
        if (sig.wizardStep === 'fields') {
          sig.wizardStep = 'review';
          renderSignatures();
          return;
        }
        var docNameInput = root.querySelector('[data-sig-wizard-doc-name]');
        if (docNameInput && !docNameInput.value.trim()) {
          docNameInput.focus();
          ui().toast('Add a document name');
          return;
        }
        record.status = 'Completed';
        record.assigneeName = record.recipientName || record.to || data().state().user.name;
        if (record.documentName) {
          var extMatch = String(record.doc || '').match(/(\.[^.]+)$/);
          record.doc = record.documentName + (extMatch ? extMatch[1] : '.pdf');
        }
        data().save();
        data().logNotification('Signed document saved to ' + (record.storageFolder || 'Personal Folders'), record.recipientEmail || record.to);
        ui().toast('Signed document saved');
        closeWizard();
      });
    }

    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeWizard();
    });
  }

  function openSignatureWizard(record) {
    if (!record) return;
    sig.editingId = record.id;
    sig.wizardStep = record.status === 'Completed' ? 'review' : 'files';
    sig.wizardPage = 0;
    renderSignatures();
  }

  function signatureCard(r) {
    var isDraft = r.status === 'Draft';
    var isCompleted = r.status === 'Completed';
    var meta = isDraft
      ? '<span class="tma-portal-sig-card__meta">Auto-deletes in ' + (r.autoDeleteDays || 30) + ' day(s)</span>'
      : isCompleted
        ? '<div class="tma-portal-sig-card__assign">' +
          '<span class="tma-portal-sig-card__assign-label">Assigned to</span>' +
          '<span class="tma-portal-sig-card__avatar" aria-hidden="true">' + ui().esc(r.assigneeInitials || sigAssigneeInitials(r.assigneeName || r.to)) + '</span>' +
          '<span class="tma-portal-sig-card__assign-name">' + ui().esc(r.assigneeName || r.to || '-') + '</span>' +
          '</div>'
        : '<span class="tma-portal-sig-card__meta">' + ui().esc(r.to || '-') + '</span>';
    var action = isDraft
      ? ui().btn({ label: 'Delete', variant: 'ghost', small: true, attrs: 'data-sig-delete="' + r.id + '"' })
      : isCompleted
        ? ui().btn({ label: 'Download', small: true, attrs: 'data-sig-download="' + r.id + '"' })
        : '';

    return '<article class="tma-portal-sig-card" data-sig-open="' + r.id + '" tabindex="0" aria-labelledby="sig-title-' + r.id + '">' +
      '<div class="tma-portal-sig-card__main">' +
      '<h3 class="tma-portal-sig-card__title" id="sig-title-' + r.id + '" title="' + ui().esc(r.doc) + '">' + ui().esc(r.doc) + '</h3>' +
      sigStatusBadge(r.status || 'Draft') +
      '</div>' +
      meta +
      '<div class="tma-portal-sig-card__actions">' + action + '</div>' +
      '</article>';
  }

  function createSignatureModal() {
    ui().openModal({
      title: 'Create signature request',
      body:
        ui().field('Document name', ui().input({ placeholder: 'Contract.pdf', attrs: 'data-sig-new-doc' })) +
        ui().field('Recipient email', ui().input({ type: 'email', placeholder: 'signer@example.com', attrs: 'data-sig-new-to' })) +
        '<div class="tma-portal-form-actions">' + ui().btn({ label: 'Create', attrs: 'data-sig-new-create' }) + '</div>',
      onMount: function (host) {
        host.querySelector('[data-sig-new-create]').addEventListener('click', function () {
          var docInput = host.querySelector('[data-sig-new-doc]');
          var toInput = host.querySelector('[data-sig-new-to]');
          var doc = docInput ? docInput.value.trim() : '';
          var to = toInput ? toInput.value.trim() : '';
          if (!doc || !to) {
            (doc ? toInput : docInput).focus();
            ui().toast('Add document name and recipient email');
            return;
          }
          var s = data().state();
          s.signatureRequests.unshift({
            id: data().uid('sig'),
            doc: doc,
            to: to,
            status: 'Draft',
            autoDeleteDays: 30,
            created: data().shortDate(),
            onlySigner: false,
            recipientName: '',
            recipientEmail: to,
            recipientRole: 'Signer',
          });
          data().save();
          ui().closeModal();
          ui().toast('Signature request created');
          openSignatureWizard(s.signatureRequests[0]);
        });
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

    var s = data().state();
    var list = filteredSignatures();
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
      ui().headDropdown({
        label: 'Create signature request',
        primary: true,
        alignEnd: true,
        wrapAttrs: 'data-sig-new-dropdown',
        items: [
          { label: 'Send for signature', action: 'send' },
          { label: 'Sign a document yourself', action: 'self' },
        ],
      }) +
      '</div></div>' +
      '<div class="tma-portal-toolbar">' +
      '<div class="tma-portal-toolbar__group tma-portal-toolbar__group--search">' +
      ui().searchInput('Search', 'data-sig-search', sig.search, { focused: restoreSearch }) +
      '</div>' +
      '<div class="tma-portal-toolbar__group tma-portal-toolbar__group--filters">' +
      ui().field('Status', ui().select(
        [
          { value: 'all', label: 'Show All' },
          { value: 'draft', label: 'Draft' },
          { value: 'sent', label: 'Sent' },
          { value: 'completed', label: 'Completed' },
        ],
        sig.status,
        'data-sig-status',
        'Status'
      )) +
      '<label class="tma-portal-checkbox tma-portal-checkbox--toolbar">' +
      '<input type="checkbox" data-sig-admin' + (sig.adminView ? ' checked' : '') + '>' +
      '<span>Admin View</span>' +
      '<span class="tma-portal-help" title="Show signature requests from all users on this account">&#9432;</span>' +
      '</label>' +
      '</div></div>' +
      (list.length
        ? '<div class="tma-portal-sig-list">' + list.map(signatureCard).join('') + '</div>'
        : s.signatureRequests.length
          ? ui().emptyState({
              illustration: 'Illustration06',
              title: 'No signature requests match your filters',
              subtitle: 'Try a different status or search term.',
            })
          : ui().emptyState({
              illustration: 'Illustration06',
              title: 'You don’t have any signature requests yet',
              subtitle: 'Need to get a signature? Create a request.',
              button: ui().headDropdown({
                label: 'Create signature request',
                primary: true,
                alignEnd: true,
                wrapAttrs: 'data-sig-new-dropdown',
                items: [
                  { label: 'Send for signature', action: 'send' },
                  { label: 'Sign a document yourself', action: 'self' },
                ],
              }),
            })) +
      '</div>';

    ui().wireToolbarSearch(el, '[data-sig-search]', function (val) {
      sig.search = val;
      renderSignatures();
    });

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
        renderSignatures();
      });
    }

    var adminCheck = el.querySelector('[data-sig-admin]');
    if (adminCheck) {
      adminCheck.addEventListener('change', function () {
        sig.adminView = adminCheck.checked;
        renderSignatures();
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
        var st = data().state();
        st.signatureRequests = st.signatureRequests.filter(function (r) { return r.id !== id; });
        data().save();
        ui().toast('Signature request deleted');
        renderSignatures();
      });
    });

    el.querySelectorAll('[data-sig-download]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        ui().toast('Downloading signed document…');
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
    renderSignatures();
  }

  window.TMAPortalSignatures = {
    closeWizardChrome: closeSignaturesWizardChrome,
    clearLock: clearSignaturesWizardLock,
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
