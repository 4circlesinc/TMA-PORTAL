/* TMA — CIP application intake (§2–§6)
 *
 * The form the firm actually files with: the government's own field set, in
 * the government's own order, so what is collected here is what gets
 * submitted. One page, like every other form in the hub — the reader fills
 * it top to bottom and sees the whole ask at once.
 *
 * Fields are keyed by the path the server validates them under —
 * `firstName`, `sponsor.firstName`, `dependents.2.dateOfBirth`. That is the
 * whole trick that lets one set of field helpers draw a main applicant, a
 * sponsor and any number of dependents: a 422 comes back keyed the same way,
 * so the server's objection lands on the exact control that caused it without
 * anything having to translate between the two.
 *
 * Three answers are never asked for. The region follows the country of
 * residence, the application number is minted server-side, and a qualified
 * dependent's number is computed from the dates of birth — the form shows all
 * three so the reader can see what the record will say without being invited
 * to contradict it.
 *
 * Uploads are real files on a multipart body, not base64 in JSON: a scanned
 * passport would grow by a third on the way and put the request through its
 * own size limit for nothing.
 */
(function () {
  'use strict';

  var ui = function () { return window.TMAPortalUI; };
  var MORPH = window.TMAMorph;

  var ICON = 'images/icons/phosphor/';
  /* 2 inches at 300dpi — the same floor App\Support\Cip\PassportPhoto keeps. */
  var PHOTO_MIN_PX = 600;
  var MAX_DOCUMENT_MB = 10;
  /* Matches Intake::MAX_DOCUMENTS_PER_SLOT — the server is the authority. */
  var MAX_DOCUMENTS_PER_SLOT = 10;
  var MAX_DEPENDENTS = 20;

  /* One draft per mount. Deliberately not persisted yet: until the form can
     save a partial application server-side, a "resume" that lived only in
     this tab would promise more than it keeps. */
  function emptyDraft() {
    return {
      providerId: '', firstName: '', lastName: '', gender: '',
      dateOfBirth: '', countryOfBirth: '', countryOfResidence: '',
      occupation: '', passportNumber: '',
      investmentType: '', investmentTypeOther: '', sponsored: '',
    };
  }

  var state = {
    draft: emptyDraft(),
    /* Chosen photos, keyed by the same path the server validates. Kept apart
       from the draft because a File cannot be re-rendered into an attribute
       the way a string can. */
    files: {},
    /* Chosen documents — a LIST per path, because a requirement can be
       answered with more than one scan. Kept apart from `files` so nothing
       has to ask whether the value at a path is one file or several. */
    documents: {},
    /* Data URLs for the photo previews only — display, never the payload. */
    previews: {},
    /* How many dependent blocks are on the page. The rows themselves live in
       the draft under dependents.N.*, so removing one has to close the gap. */
    dependents: 0,
    options: null,
    loading: false,
    error: '',
    saving: false,
    errors: {},
    onDone: null,
  };

  function esc(s) { return ui().esc(s); }

  /* ── what the form owes before it can be filed ─────────────────────
     Mirrors App\Support\Cip\Intake::rules — the server is the authority,
     this only spares the reader a round trip to find out. */
  var PERSON_FIELDS = ['firstName', 'lastName', 'gender', 'dateOfBirth',
    'countryOfBirth', 'countryOfResidence', 'occupation', 'passportNumber'];

  var LABELS = {
    providerId: 'Service provider', firstName: 'First name', lastName: 'Last name',
    gender: 'Gender', dateOfBirth: 'Date of birth', countryOfBirth: 'Country of birth',
    countryOfResidence: 'Country of residence', occupation: 'Occupation',
    passportNumber: 'Passport number', passportPhoto: 'Passport photo',
    passportBioPage: 'Passport bio page', birthCertificate: 'Birth certificate',
    investmentType: 'Investment type', investmentTypeOther: 'Specify investment type',
    sponsored: 'Sponsored', relationship: 'Relationship',
  };

  /* The label for a path: the last segment names the field. */
  function labelFor(path) {
    return LABELS[path.split('.').pop()] || path;
  }

  function sponsored() { return String(state.draft.sponsored) === '1'; }

  /* Every path this form must have an answer for, given what it now says. */
  function requiredPaths() {
    var paths = ['providerId'].concat(PERSON_FIELDS)
      .concat(['investmentType', 'sponsored']);

    if (sponsored()) {
      paths = paths.concat(PERSON_FIELDS.map(function (f) { return 'sponsor.' + f; }));
    }

    for (var i = 0; i < state.dependents; i++) {
      paths = paths.concat(['firstName', 'lastName', 'dateOfBirth', 'relationship']
        .map(function (f) { return 'dependents.' + i + '.' + f; }));
    }

    return paths;
  }

  /* Files are required in their own right — an empty one is not a blank
     string, so it cannot be checked the same way. */
  function requiredFiles() {
    var paths = ['passportPhoto'];
    if (sponsored()) paths.push('sponsor.passportPhoto');

    return paths;
  }

  /* The requirements that take a list, and must have at least one. */
  function requiredDocuments() {
    return ['passportBioPage', 'birthCertificate'];
  }

  function missing() {
    var found = {};

    requiredPaths().forEach(function (path) {
      if (String(state.draft[path] || '').trim() === '') {
        found[path] = labelFor(path) + ' is required';
      }
    });

    requiredFiles().forEach(function (path) {
      if (!state.files[path]) found[path] = labelFor(path) + ' is required';
    });

    requiredDocuments().forEach(function (path) {
      var files = state.documents[path];
      if (!files || !files.length) found[path] = labelFor(path) + ' is required';
    });

    if (state.draft.investmentType === 'other'
      && String(state.draft.investmentTypeOther || '').trim() === '') {
      found.investmentTypeOther = 'Say which investment type this is';
    }

    return found;
  }

  function regionFor(country) {
    var list = (state.options && state.options.countries) || [];
    for (var i = 0; i < list.length; i++) if (list[i].value === country) return list[i].region;
    return '';
  }

  function providerName(id) {
    var list = (state.options && state.options.providers) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
    return '';
  }

  /*
   * Who is qualified dependent number what.
   *
   * Drawn, not asked: §5 numbers qualified dependents by age and the server
   * computes the same order on save. Showing it here means the reader sees
   * the answer the record will hold rather than discovering it afterwards.
   */
  function ordinals() {
    var rows = [];
    for (var i = 0; i < state.dependents; i++) {
      if (state.draft['dependents.' + i + '.relationship'] !== 'qualified_dependent') continue;
      var dob = state.draft['dependents.' + i + '.dateOfBirth'];
      if (!dob) continue;
      rows.push({ index: i, dob: dob });
    }

    // Youngest first — the later the date of birth, the lower the number.
    rows.sort(function (a, b) { return a.dob < b.dob ? 1 : a.dob > b.dob ? -1 : 0; });

    var out = {};
    rows.forEach(function (row, n) { out[row.index] = n + 1; });

    return out;
  }

  /* ── fields ────────────────────────────────────────────────────── */

  function fieldError(path) {
    var msg = state.errors[path];
    return msg ? '<span class="tma-portal-field__error">' + esc(msg) + '</span>' : '';
  }

  function textField(path, opts) {
    opts = opts || {};
    return '<label class="tma-portal-field' + (state.errors[path] ? ' is-invalid' : '') + '">' +
      '<span class="tma-portal-field__label">' + esc(opts.label || labelFor(path)) + '</span>' +
      '<input class="tma-portal-input" type="' + (opts.type || 'text') + '"' +
      ' data-cip-field="' + esc(path) + '"' +
      ' value="' + esc(state.draft[path] || '') + '"' +
      (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
      (opts.max ? ' max="' + esc(opts.max) + '"' : '') +
      ' autocomplete="off">' +
      fieldError(path) +
      '</label>';
  }

  function selectField(path, options, placeholder, opts) {
    opts = opts || {};
    var list = [{ value: '', label: placeholder }].concat(options);
    return '<label class="tma-portal-field' + (state.errors[path] ? ' is-invalid' : '') + '">' +
      '<span class="tma-portal-field__label">' + esc(opts.label || labelFor(path)) + '</span>' +
      '<select class="tma-portal-select" data-cip-field="' + esc(path) + '">' +
      list.map(function (o) {
        return '<option value="' + esc(o.value) + '"' +
          (String(state.draft[path]) === String(o.value) ? ' selected' : '') + '>' +
          esc(o.label) + '</option>';
      }).join('') +
      '</select>' + fieldError(path) +
      '</label>';
  }

  /* The client form's photo control, wearing the passport photo's rules. The
     same component so a person's picture is added the way every other
     person's is; only the constraint is different, and the constraint is the
     one thing worth saying out loud. */
  function photoField(path) {
    var preview = state.previews[path];
    return '<div class="tma-dash__clients-photo' +
      (state.errors[path] ? ' is-invalid' : '') + '">' +
      '<span class="tma-portal-field__label">' + esc(labelFor(path)) + '</span>' +
      '<input type="file" accept="image/jpeg,image/png,image/webp"' +
      ' class="tma-dash__clients-photo-input" data-cip-photo="' + esc(path) + '" aria-hidden="true">' +
      '<div class="tma-dash__clients-photo-wrap">' +
      '<button type="button" class="tma-dash__clients-photo-btn"' +
      (preview ? ' data-has-image="true"' : '') + ' data-cip-photo-btn="' + esc(path) + '">' +
      '<img src="' + ICON + 'User.svg" alt="" class="tma-dash__clients-photo-placeholder" width="40" height="40">' +
      '<img alt="" class="tma-dash__clients-photo-preview" width="80" height="80"' +
      (preview ? ' src="' + esc(preview) + '"' : '') + '>' +
      '</button>' +
      '<button type="button" class="tma-dash__clients-photo-remove"' +
      ' data-cip-photo-remove="' + esc(path) + '" aria-label="Remove photo">' +
      '<img src="' + ICON + 'Xcircle.svg" alt="" class="tma-dash__clients-photo-remove-icon" width="20" height="20">' +
      '</button></div>' +
      '<p class="tma-dash__clients-photo-hint">2×2 inches, square, ' +
      PHOTO_MIN_PX + '×' + PHOTO_MIN_PX + ' pixels or larger.</p>' +
      fieldError(path) +
      '</div>';
  }

  /*
   * A scan, dropped or chosen — and there can be more than one.
   *
   * One requirement is not one sheet of paper: a bio page is often a
   * passport's two pages, a birth certificate arrives with its translation.
   * So the zone keeps saying "drop a file here" after the first, and what has
   * been chosen is listed under it rather than replacing the prompt — the way
   * to add a second must not disappear the moment there is a first.
   *
   * No preview: a reader recognises a document by its filename and its kind,
   * and rendering the first page of a PDF here would be a viewer rather than a
   * form control. The whole zone is the button, so the target for a dropped
   * file and the target for a click are the same shape — a drop area that is
   * smaller than it looks is worse than none.
   */
  function documentField(path) {
    var files = state.documents[path] || [];

    return '<div class="tma-portal-drop' + (state.errors[path] ? ' is-invalid' : '') +
      (files.length ? ' is-filled' : '') + '" data-cip-drop="' + esc(path) + '">' +
      '<span class="tma-portal-field__label">' + esc(labelFor(path)) + '</span>' +
      '<input type="file" accept=".pdf,image/*" multiple class="tma-dash__clients-photo-input"' +
      ' data-cip-file="' + esc(path) + '" aria-hidden="true">' +
      '<button type="button" class="tma-portal-drop__zone" data-cip-file-btn="' + esc(path) + '">' +
      '<img src="' + ICON + 'UploadSimple.svg" alt="" width="20" height="20">' +
      '<span class="tma-portal-drop__hint">' +
      (files.length ? 'Drop another file here, or choose one' : 'Drop a file here, or choose one') +
      '</span>' +
      '<span class="tma-portal-drop__meta">PDF or image, up to ' + MAX_DOCUMENT_MB + 'MB</span>' +
      '</button>' +
      documentList(path, files) +
      fieldError(path) +
      '</div>';
  }

  /* What has been chosen, under the box it was dropped on. */
  function documentList(path, files) {
    if (!files.length) return '';

    return '<ul class="tma-portal-drop__files">' +
      files.map(function (file, index) {
        return '<li class="tma-portal-drop__file">' +
          '<img class="tma-portal-drop__file-icon" src="' + esc(fileIcon(file.name)) +
          '" alt="" width="20" height="20">' +
          '<span class="tma-portal-drop__file-name">' + esc(file.name) + '</span>' +
          '<span class="tma-portal-drop__file-size">' + esc(fileSize(file.size)) + '</span>' +
          '<button type="button" class="tma-portal-drop__file-remove"' +
          ' data-cip-file-remove="' + esc(path) + '" data-cip-file-index="' + index + '"' +
          ' aria-label="Remove ' + esc(file.name) + '">' +
          '<img src="' + ICON + 'Xcircle.svg" alt="" width="16" height="16"></button>' +
          '</li>';
      }).join('') +
      '</ul>';
  }

  /* The File Library's own icon map, so a PDF here is the PDF mark everywhere
     else in the portal rather than a second opinion about what a file is. */
  function fileIcon(name) {
    if (window.TMAFileIcons) return window.TMAFileIcons.fileIconSrc('', name);

    return ICON + 'File.svg';
  }

  function fileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';

    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* ── cards ─────────────────────────────────────────────────────── */

  function card(title, body, opts) {
    opts = opts || {};
    return '<section class="tma-dash__clients-card' +
      (opts.modifier ? ' ' + opts.modifier : '') + '">' +
      '<header class="tma-dash__clients-card-head">' +
      '<h3 class="tma-dash__clients-card-title">' + esc(title) + '</h3>' +
      (opts.action || '') +
      '</header>' +
      body +
      '</section>';
  }

  /*
   * A card whose name is held above it rather than inside.
   *
   * Only the two that name a PERSON on the application — the main applicant
   * and the dependents. Those are the groupings a reader navigates by, and
   * whose fields they are wanting saying before the box rather than within
   * it. Everything else is a card with a title, which is what a card with a
   * title looks like.
   */
  function titledCard(title, body, opts) {
    opts = opts || {};
    return '<section class="tma-portal-section' +
      (opts.modifier ? ' ' + opts.modifier : '') + '">' +
      '<h3 class="tma-portal-section__title">' + esc(title) + '</h3>' +
      '<div class="tma-portal-section__card">' + body + '</div>' +
      '</section>';
  }

  function countryOptions() {
    return ((state.options && state.options.countries) || []).map(function (c) {
      return { value: c.value, label: c.label };
    });
  }

  function genderOptions() {
    return ((state.options && state.options.genders) || []).map(function (g) {
      return { value: g, label: g };
    });
  }

  /* The eight fields §2 asks of a person, and §4 asks again of a sponsor. */
  function personFields(prefix) {
    var countries = countryOptions();
    var region = regionFor(state.draft[prefix + 'countryOfResidence']);

    return '<div class="tma-portal-form-grid">' +
      textField(prefix + 'firstName') +
      textField(prefix + 'lastName') +
      selectField(prefix + 'gender', genderOptions(), 'Select') +
      textField(prefix + 'dateOfBirth', { type: 'date', max: new Date().toISOString().slice(0, 10) }) +
      selectField(prefix + 'countryOfBirth', countries, 'Select a country') +
      selectField(prefix + 'countryOfResidence', countries, 'Select a country') +
      textField(prefix + 'occupation') +
      textField(prefix + 'passportNumber', { placeholder: 'As printed on the bio page' }) +
      '</div>' +
      (region
        ? '<p class="tma-portal-note" data-cip-region="' + esc(prefix) + '">Region: <strong>' +
          esc(region) + '</strong></p>'
        : '');
  }

  function applicantCard() {
    return titledCard('Main applicant',
      photoField('passportPhoto') + personFields(''),
      { modifier: 'tma-portal-section--wide' });
  }

  /* §2's other two uploads, beside the person they belong to. Listed down one
     column: two drop targets side by side are two small drop targets. */
  function documentsCard() {
    return card('Documents',
      '<div class="tma-portal-drops">' +
      documentField('passportBioPage') +
      documentField('birthCertificate') +
      '</div>',
      { modifier: 'tma-dash__clients-card--narrow' });
  }

  function investmentCard() {
    var providers = ((state.options && state.options.providers) || []).map(function (p) {
      return { value: p.id, label: p.name + ' (' + p.code + ')' };
    });
    var types = ((state.options && state.options.investmentTypes) || []).map(function (t) {
      return { value: t.value, label: t.label };
    });

    return card('Investment',
      '<div class="tma-portal-form-grid">' +
      // One provider and nothing to choose: say whose file this is instead
      // of offering a select of one.
      (state.options && state.options.providerFixed
        ? '<div class="tma-portal-field"><span class="tma-portal-field__label">' + esc(LABELS.providerId) + '</span>' +
          '<p class="tma-portal-field__static">' + esc(providerName(state.draft.providerId)) + '</p></div>'
        : selectField('providerId', providers, 'Select a service provider')) +
      selectField('investmentType', types, 'Select an investment type') +
      (state.draft.investmentType === 'other' ? textField('investmentTypeOther') : '') +
      selectField('sponsored', [{ value: '0', label: 'No' }, { value: '1', label: 'Yes' }], 'Select') +
      '</div>');
  }

  /*
   * §4: a sponsored application has a sponsor, asked for now rather than
   * later — the brief calls it part of the same save, and a step that comes
   * afterwards is a step somebody leaves undone.
   */
  function sponsorCard() {
    if (!sponsored()) return '';

    return card('Sponsor',
      photoField('sponsor.passportPhoto') +
      personFields('sponsor.'));
  }

  /* §5: one block per dependent, each with the number the form will carry. */
  function dependentsCard() {
    var numbers = ordinals();
    var rows = '';

    for (var i = 0; i < state.dependents; i++) {
      rows += dependentRow(i, numbers[i]);
    }

    var add = state.dependents < MAX_DEPENDENTS
      ? '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-cip-dependent-add>' +
        'Add dependent</button>'
      : '';

    return titledCard('Dependents',
      (rows || '<p class="tma-portal-note">No dependents on this application.</p>') +
      '<div class="tma-portal-form-actions">' + add + '</div>');
  }

  function dependentRow(i, ordinal) {
    var prefix = 'dependents.' + i + '.';
    var relationship = state.draft[prefix + 'relationship'];
    var title = relationship === 'spouse'
      ? 'Spouse'
      : (ordinal ? 'Qualified Dependent ' + ordinal : 'Dependent');

    return '<div class="tma-portal-repeat" data-cip-dependent="' + i + '">' +
      '<div class="tma-portal-repeat__head">' +
      '<span class="tma-portal-repeat__title">' + esc(title) + '</span>' +
      '<button type="button" class="tma-portal-repeat__remove" data-cip-dependent-remove="' + i + '"' +
      ' aria-label="Remove ' + esc(title) + '">' +
      '<img src="' + ICON + 'Xcircle.svg" alt="" width="18" height="18"></button>' +
      '</div>' +
      '<div class="tma-portal-form-grid">' +
      textField(prefix + 'firstName') +
      textField(prefix + 'lastName') +
      textField(prefix + 'dateOfBirth', { type: 'date', max: new Date().toISOString().slice(0, 10) }) +
      selectField(prefix + 'relationship', [
        { value: 'spouse', label: 'Spouse' },
        { value: 'qualified_dependent', label: 'Qualified dependent' },
      ], 'Select') +
      '</div></div>';
  }

  /* The whole ask on one page, in the government form's order. */
  function formBody() {
    return '<div class="tma-dash__clients-cards tma-dash__clients-cards--intake">' +
      applicantCard() +
      documentsCard() +
      investmentCard() +
      sponsorCard() +
      dependentsCard() +
      '</div>';
  }

  function render(root) {
    if (state.loading) { root.innerHTML = ui().loading(); return; }
    if (state.error) {
      root.innerHTML = '<p class="tma-portal-note">' + esc(state.error) + '</p>';
      return;
    }

    var count = Object.keys(state.errors).length;

    MORPH.patch(root,
      '<div class="tma-dash__clients-form" data-cip-form>' +
      // One summary at the top: a reader who pressed Add and nothing
      // happened deserves to be told why without hunting the page.
      (count
        ? '<p class="tma-portal-modal__error" role="alert">' +
          // Neutral about why: a field can be empty or, in a photo's case,
          // filled with something that cannot be filed.
          esc(count === 1 ? 'Check one answer.' : 'Check ' + count + ' answers.') +
          '</p>'
        : '') +
      formBody() +
      '</div>');
    wire(root);
  }

  /* ── wiring ────────────────────────────────────────────────────── */

  function wire(root) {
    MORPH.unwired(root, '[data-cip-field]').forEach(function (el) {
      var path = el.getAttribute('data-cip-field');
      el.addEventListener('input', function () {
        state.draft[path] = el.value;
        delete state.errors[path];
      });
      el.addEventListener('change', function () {
        state.draft[path] = el.value;
        delete state.errors[path];
        // These change what the form shows: the derived region, the "Other"
        // free text, whether there is a sponsor at all, and the dependent
        // numbering that follows a date of birth or a relationship.
        if (/countryOfResidence$|investmentType$|sponsored$|relationship$|dateOfBirth$/.test(path)) {
          render(root);
        }
      });
    });

    wirePhotos(root);
    wireDocuments(root);
    wireDependents(root);
  }

  /*
   * A photo, measured before it is accepted.
   *
   * The server refuses the same pictures, but a reader who chose a portrait
   * snapshot should learn that while the file picker is still in mind rather
   * than after filling in eight more fields and pressing Add.
   */
  function wirePhotos(root) {
    MORPH.unwired(root, '[data-cip-photo]').forEach(function (input) {
      var path = input.getAttribute('data-cip-photo');
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          measure(ev.target.result, function (why, dataUrl) {
            if (why) {
              state.errors[path] = why;
              delete state.files[path];
              delete state.previews[path];
              input.value = '';
            } else {
              state.files[path] = file;
              state.previews[path] = dataUrl;
              delete state.errors[path];
            }
            render(root);
          });
        };
        reader.readAsDataURL(file);
      });
    });

    MORPH.unwired(root, '[data-cip-photo-btn]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var path = btn.getAttribute('data-cip-photo-btn');
        var input = root.querySelector('[data-cip-photo="' + cssEscape(path) + '"]');
        if (input) input.click();
      });
    });

    MORPH.unwired(root, '[data-cip-photo-remove]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var path = btn.getAttribute('data-cip-photo-remove');
        delete state.files[path];
        delete state.previews[path];
        render(root);
      });
    });
  }

  function wireDocuments(root) {
    MORPH.unwired(root, '[data-cip-file]').forEach(function (input) {
      var path = input.getAttribute('data-cip-file');
      input.addEventListener('change', function () {
        takeDocuments(root, path, input.files, input);
      });
    });

    MORPH.unwired(root, '[data-cip-file-btn]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var path = btn.getAttribute('data-cip-file-btn');
        var input = root.querySelector('[data-cip-file="' + cssEscape(path) + '"]');
        if (input) input.click();
      });
    });

    MORPH.unwired(root, '[data-cip-file-remove]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var path = btn.getAttribute('data-cip-file-remove');
        var list = state.documents[path] || [];
        list.splice(Number(btn.getAttribute('data-cip-file-index')), 1);
        if (!list.length) delete state.documents[path];
        render(root);
      });
    });

    wireDrops(root);
  }

  /*
   * Dropping a file on the zone.
   *
   * dragover has to be cancelled or the browser navigates to the file
   * instead — which loses the half-filled form, so this is the one listener
   * here that matters more for what it prevents than what it does.
   */
  function wireDrops(root) {
    MORPH.unwired(root, '[data-cip-drop]').forEach(function (zone) {
      var path = zone.getAttribute('data-cip-drop');

      ['dragenter', 'dragover'].forEach(function (type) {
        zone.addEventListener(type, function (e) {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.add('is-dragging');
        });
      });

      zone.addEventListener('dragleave', function (e) {
        // Moving between the zone's own children fires dragleave too; only a
        // pointer that has actually left the box should clear the highlight.
        if (zone.contains(e.relatedTarget)) return;
        zone.classList.remove('is-dragging');
      });

      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('is-dragging');
        takeDocuments(root, path, e.dataTransfer && e.dataTransfer.files);
      });
    });
  }

  /*
   * One place documents are accepted, however they arrived.
   *
   * They ADD to what is already there — dropping a second page must not throw
   * away the first. An oversized file is refused by name, so the reader knows
   * which one to shrink, and the files that were fine still land.
   *
   * The input is always cleared: a file picked, removed and picked again is
   * the same value as far as the input is concerned, and `change` would not
   * fire the second time.
   */
  function takeDocuments(root, path, chosen, input) {
    var files = Array.prototype.slice.call(chosen || []);
    var list = state.documents[path] || [];
    var tooBig = [];

    files.forEach(function (file) {
      if (file.size > MAX_DOCUMENT_MB * 1024 * 1024) {
        tooBig.push(file.name);

        return;
      }
      // The same file twice is the reader clicking twice, not two documents.
      var seen = list.some(function (had) {
        return had.name === file.name && had.size === file.size;
      });
      if (!seen) list.push(file);
    });

    if (list.length > MAX_DOCUMENTS_PER_SLOT) {
      list = list.slice(0, MAX_DOCUMENTS_PER_SLOT);
      state.errors[path] = 'Up to ' + MAX_DOCUMENTS_PER_SLOT + ' files here.';
    } else if (tooBig.length) {
      state.errors[path] = tooBig.length === 1
        ? '“' + tooBig[0] + '” is too large. Keep each file under ' + MAX_DOCUMENT_MB + 'MB.'
        : tooBig.length + ' files are too large. Keep each one under ' + MAX_DOCUMENT_MB + 'MB.';
    } else if (list.length) {
      delete state.errors[path];
    }

    if (list.length) state.documents[path] = list;
    if (input) input.value = '';
    render(root);
  }

  function wireDependents(root) {
    var add = MORPH.unwiredOne(root, '[data-cip-dependent-add]');
    if (add) {
      add.addEventListener('click', function () {
        if (state.dependents >= MAX_DEPENDENTS) return;
        state.draft['dependents.' + state.dependents + '.relationship'] = 'qualified_dependent';
        state.dependents += 1;
        render(root);
      });
    }

    MORPH.unwired(root, '[data-cip-dependent-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        removeDependent(Number(btn.getAttribute('data-cip-dependent-remove')));
        render(root);
      });
    });
  }

  /*
   * Removing one closes the gap.
   *
   * The paths are positional — `dependents.2.firstName` — so leaving a hole
   * would send the server a list with a missing index, and every later
   * dependent's answers would belong to somebody else.
   */
  function removeDependent(index) {
    var fields = ['firstName', 'lastName', 'dateOfBirth', 'relationship'];

    for (var i = index; i < state.dependents - 1; i++) {
      fields.forEach(function (f) {
        state.draft['dependents.' + i + '.' + f] = state.draft['dependents.' + (i + 1) + '.' + f];
        delete state.errors['dependents.' + i + '.' + f];
      });
    }

    fields.forEach(function (f) {
      delete state.draft['dependents.' + (state.dependents - 1) + '.' + f];
      delete state.errors['dependents.' + (state.dependents - 1) + '.' + f];
    });

    state.dependents -= 1;
  }

  /* Attribute selectors have to survive the dots in a field path. */
  function cssEscape(value) {
    return window.CSS && window.CSS.escape ? window.CSS.escape(value) : value.replace(/\./g, '\\.');
  }

  /* Square within a pixel or two, and big enough to print at 2 inches. */
  function measure(dataUrl, done) {
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      if (w < PHOTO_MIN_PX || h < PHOTO_MIN_PX) {
        done('A passport photo has to be at least ' + PHOTO_MIN_PX + '×' + PHOTO_MIN_PX +
          ' pixels — this one is ' + w + '×' + h + '.');
        return;
      }
      if (Math.abs(w - h) / Math.max(w, h) > 0.02) {
        done('A passport photo has to be square (2×2 inches) — this one is ' + w + '×' + h + '.');
        return;
      }
      done(null, dataUrl);
    };
    img.onerror = function () { done('That image could not be read. Try a JPG, PNG, or WebP.'); };
    img.src = dataUrl;
  }

  /* ── the wire ──────────────────────────────────────────────────── */

  function xsrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function headers(extra) {
    var out = {
      Accept: 'application/json',
      'X-XSRF-TOKEN': xsrf(),
      'X-Requested-With': 'XMLHttpRequest',
    };
    Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
    // Skip our own echo of the live signal this write raises.
    if (window.TMALive && window.TMALive.headers) {
      var live = window.TMALive.headers();
      Object.keys(live || {}).forEach(function (k) { out[k] = live[k]; });
    }

    return out;
  }

  function api(method, url) {
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: headers({ 'Content-Type': 'application/json' }),
    });
  }

  /*
   * The whole form as one multipart body.
   *
   * The field paths are the form-data names, so `sponsor[firstName]` and
   * `dependents[0][dateOfBirth]` arrive as the nested arrays the validator
   * expects — and come back keyed the same way when it objects.
   */
  function body() {
    var form = new FormData();

    Object.keys(state.draft).forEach(function (path) {
      var value = state.draft[path];
      if (value === '' || value === null || value === undefined) return;
      // Dependents past the visible count are leftovers from a removal.
      if (/^dependents\.(\d+)\./.test(path) && Number(RegExp.$1) >= state.dependents) return;
      // A sponsor's answers are not sent when there is no sponsor.
      if (!sponsored() && path.indexOf('sponsor.') === 0) return;
      form.append(bracketed(path), value);
    });

    Object.keys(state.files).forEach(function (path) {
      if (!sponsored() && path.indexOf('sponsor.') === 0) return;
      form.append(bracketed(path), state.files[path]);
    });

    // A requirement's scans go up as a list, in the order they were added.
    Object.keys(state.documents).forEach(function (path) {
      if (!sponsored() && path.indexOf('sponsor.') === 0) return;
      state.documents[path].forEach(function (file) {
        form.append(bracketed(path) + '[]', file);
      });
    });

    form.append('sponsored', sponsored() ? '1' : '0');

    return form;
  }

  /*
   * The control a server error belongs on.
   *
   * A list's members are keyed by index — `birthCertificate.2` — and there is
   * no control by that name, so the message would land nowhere and the form
   * would refuse to submit with nothing marked. The list itself is the control.
   */
  function fieldForError(key) {
    var listed = key.match(/^([A-Za-z]+)\.\d+$/);

    return listed && requiredDocuments().indexOf(listed[1]) !== -1 ? listed[1] : key;
  }

  /* dependents.0.firstName → dependents[0][firstName] */
  function bracketed(path) {
    var parts = path.split('.');

    return parts[0] + parts.slice(1).map(function (p) { return '[' + p + ']'; }).join('');
  }

  function submit() {
    var root = state.root;
    if (!root || state.saving) return;

    var found = missing();
    if (Object.keys(found).length) {
      state.errors = found;
      render(root);
      // Take the reader to the first thing they still owe.
      var first = root.querySelector('.is-invalid [data-cip-field], .is-invalid');
      if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (first && first.focus) first.focus();

      return;
    }

    state.saving = true;
    if (state.onSaving) state.onSaving(true);

    fetch('/portal/cip/applications', {
      method: 'POST',
      credentials: 'same-origin',
      // No Content-Type: the browser sets the multipart boundary itself.
      headers: headers(),
      body: body(),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        state.saving = false;
        if (state.onSaving) state.onSaving(false);

        if (res.status === 422 && json.errors) {
          // The server's word, field by field — already keyed to our paths,
          // except that one file in a list objects as `passportBioPage.0` and
          // the control it belongs to is `passportBioPage`.
          state.errors = {};
          Object.keys(json.errors).forEach(function (k) {
            state.errors[fieldForError(k)] = json.errors[k][0];
          });
          render(root);

          return;
        }

        if (!res.ok) {
          ui().toastError((json && json.message) || 'Could not file this application');

          return;
        }

        // The caller announces this — it knows where the reader lands next.
        if (state.onDone) state.onDone(json.application);
      });
    }).catch(function () {
      state.saving = false;
      if (state.onSaving) state.onSaving(false);
      ui().toastError('Could not reach the server');
    });
  }

  /* ── mount ─────────────────────────────────────────────────────── */

  function open(root, opts) {
    opts = opts || {};
    state.root = root;
    state.draft = emptyDraft();
    state.files = {};
    state.previews = {};
    state.dependents = 0;
    state.errors = {};
    state.saving = false;
    state.error = '';
    state.onDone = opts.onDone || null;
    state.onSaving = opts.onSaving || null;
    state.loading = true;
    render(root);

    api('GET', '/portal/cip/applications/form').then(function (res) {
      if (!res.ok) throw new Error('form');

      return res.json();
    }).then(function (options) {
      state.options = options;
      // Nothing to choose means the answer is already known.
      if (options.providers && options.providers.length === 1) {
        state.draft.providerId = options.providers[0].id;
      }
      state.loading = false;
      render(root);
    }).catch(function () {
      state.loading = false;
      state.error = 'Couldn’t load the application form. Refresh to try again.';
      render(root);
    });
  }

  // submit() is the page toolbar's Add button: the form looks and behaves
  // like every other form in the hub, so its actions live where they do.
  window.TMACipIntake = { open: open, submit: submit };
})();
