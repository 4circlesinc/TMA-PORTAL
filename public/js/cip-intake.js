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
  /*
   * The document sections come from the requirement templates the admin
   * screen edits — the server sends them with the form options, so what this
   * wizard asks follows the settings without a deploy. Until the options
   * land, the §2 trio stands in, which is also what an offline mount gets.
   */
  function docFields(section) {
    var reqs = state.options && state.options.requirements;
    var list = reqs && reqs[section];
    if (list && list.length !== undefined) return list;

    return section === 'principal'
      ? [
          { field: 'passportBioPage', key: 'passport_bio_page', label: 'Passport bio page', required: true, atFiling: true },
          { field: 'birthCertificate', key: 'birth_certificate', label: 'Birth certificate', required: true, atFiling: true },
        ]
      : [
          { field: 'passportBioPage', key: 'passport_bio_page', label: 'Passport bio page', required: false, atFiling: false },
          { field: 'birthCertificate', key: 'birth_certificate', label: 'Birth certificate', required: false, atFiling: false },
        ];
  }

  function requirementSections() {
    return ['principal', 'sponsor', 'spouse', 'dependent_under_16', 'dependent_16_over'];
  }

  /* Which checklist a dependent owes, from the same facts the server uses. */
  function dependentSection(index) {
    var prefix = 'dependents.' + index + '.';
    if (state.draft[prefix + 'relationship'] === 'spouse') return 'spouse';
    var cutoff = (state.options && state.options.dependentAgeCutoff) || 16;
    var dob = state.draft[prefix + 'dateOfBirth'];
    if (!dob) return 'dependent_16_over';
    var birth = new Date(dob + 'T00:00:00');
    var now = new Date();
    var age = now.getFullYear() - birth.getFullYear();
    var m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;

    return age < cutoff ? 'dependent_under_16' : 'dependent_16_over';
  }

  function sectionForPath(path) {
    if (path.indexOf('sponsor.') === 0) return 'sponsor';
    var match = path.match(/^dependents\.(\d+)\./);
    if (match) return dependentSection(Number(match[1]));

    return 'principal';
  }

  /* Every list field either section carries, for the checks that need the
     full vocabulary rather than one section's. */
  function allDocFields() {
    var names = {};
    requirementSections().forEach(function (section) {
      docFields(section).forEach(function (d) { names[d.field] = true; });
    });

    return names;
  }

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
    /* Paths the server already holds a file for, when editing. An answer that
       is already filed is answered — the control asks for a replacement, and
       the check below stops demanding one. */
    filed: {},
    /* Per-slot status from the server — whether a filed answer may be replaced
       here or only through Upload new version in the file viewer. */
    filedMeta: {},
    /* The application being edited, or null when this is a new one. */
    applicationId: null,
    /* The filed record the form was opened on. Kept so a save that has to be
       parked offline can say what the record will look like once it lands. */
    record: null,
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

  /* The label for a path: the template's wording where there is one, else
     the built-in map. The last segment names the field. */
  function labelFor(path) {
    var tail = path.split('.').pop();
    var fromTemplate = null;
    docFields(sectionForPath(path)).forEach(function (d) { if (d.field === tail) fromTemplate = d.label; });

    return fromTemplate || LABELS[tail] || tail;
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
    // The main applicant's only, and only the ones the templates demand at
    // filing. §2's upload list is theirs; a sponsor's scans are offered here
    // but not made the reason a draft cannot start.
    return docFields('principal')
      .filter(function (d) { return d.atFiling; })
      .map(function (d) { return d.field; });
  }

  function missing() {
    var found = {};

    requiredPaths().forEach(function (path) {
      if (String(state.draft[path] || '').trim() === '') {
        found[path] = labelFor(path) + ' is required';
      }
    });

    requiredFiles().forEach(function (path) {
      if (!state.files[path] && !state.filed[path]) found[path] = labelFor(path) + ' is required';
    });

    requiredDocuments().forEach(function (path) {
      var files = state.documents[path];
      if ((!files || !files.length) && !state.filed[path]) {
        found[path] = labelFor(path) + ' is required';
      }
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

  /*
   * Whether this control is one the form will not file without.
   *
   * Read from the same lists {@see missing} checks rather than a flag passed
   * in beside each field, so a mark can never promise something the check
   * does not enforce. It follows the form as it changes: a sponsor's fields
   * are required only once Sponsored is Yes, "Specify investment type" only
   * once Other is picked, and a sponsor's scans never — those are offered.
   */
  function isRequired(path) {
    if (path === 'investmentTypeOther') return state.draft.investmentType === 'other';

    return requiredPaths().indexOf(path) !== -1
      || requiredFiles().indexOf(path) !== -1
      || requiredDocuments().indexOf(path) !== -1;
  }

  /* A label, and the mark if there is one. Hidden from screen readers, which
     are told by aria-required on the control itself. */
  function fieldLabel(path, text) {
    return '<span class="tma-portal-field__label">' + esc(text) +
      (isRequired(path)
        ? '<span class="tma-portal-field__required" aria-hidden="true">*</span>'
        : '') +
      '</span>';
  }

  function requiredAttr(path) {
    return isRequired(path) ? ' aria-required="true"' : '';
  }

  function textField(path, opts) {
    opts = opts || {};
    return '<label class="tma-portal-field' + (state.errors[path] ? ' is-invalid' : '') + '">' +
      fieldLabel(path, opts.label || labelFor(path)) +
      '<input class="tma-portal-input" type="' + (opts.type || 'text') + '"' +
      ' data-cip-field="' + esc(path) + '"' +
      ' value="' + esc(state.draft[path] || '') + '"' +
      (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
      (opts.max ? ' max="' + esc(opts.max) + '"' : '') +
      requiredAttr(path) +
      ' autocomplete="off">' +
      fieldError(path) +
      '</label>';
  }

  function selectField(path, options, placeholder, opts) {
    opts = opts || {};
    var list = [{ value: '', label: placeholder }].concat(options);
    return '<label class="tma-portal-field' + (state.errors[path] ? ' is-invalid' : '') + '">' +
      fieldLabel(path, opts.label || labelFor(path)) +
      '<select class="tma-portal-select" data-cip-field="' + esc(path) + '"' + requiredAttr(path) + '>' +
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
     one thing worth saying out loud. The --passport modifier is the size:
     here the photo IS the document being filed, so the control is big enough
     to judge the scan on, not an avatar disc. */
  function photoField(path) {
    var preview = state.previews[path];
    return '<div class="tma-dash__clients-photo tma-dash__clients-photo--passport' +
      (state.errors[path] ? ' is-invalid' : '') + '">' +
      fieldLabel(path, labelFor(path)) +
      '<input type="file" accept="image/jpeg,image/png,image/webp"' +
      ' class="tma-dash__clients-photo-input" data-cip-photo="' + esc(path) + '" aria-hidden="true">' +
      '<div class="tma-dash__clients-photo-wrap">' +
      '<button type="button" class="tma-dash__clients-photo-btn"' +
      (preview ? ' data-has-image="true"' : '') + ' data-cip-photo-btn="' + esc(path) + '">' +
      '<img src="' + ICON + 'User.svg" alt="" class="tma-dash__clients-photo-placeholder" width="120" height="120">' +
      '<img alt="" class="tma-dash__clients-photo-preview" width="360" height="360"' +
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
    var meta = state.filedMeta[path];
    var locked = meta && meta.uploaded && meta.status !== 'update_required';

    if (locked) {
      var lockedFile = meta.fileId
        ? '<button type="button" class="tma-portal-drop__file tma-portal-drop__file--locked" data-cip-open-file="' + esc(meta.fileId) + '">' +
          '<img class="tma-portal-drop__file-icon" src="' + esc(fileIcon(meta.fileName || '')) + '" alt="" width="20" height="20">' +
          '<span class="tma-portal-drop__file-name">' + esc(meta.fileName || 'Filed document') + '</span>' +
          (meta.fileSize ? '<span class="tma-portal-drop__file-size">' + esc(fileSize(meta.fileSize)) + '</span>' : '') +
          '</button>'
        : '';
      return '<div class="tma-portal-drop is-filled is-locked' +
        (state.errors[path] ? ' is-invalid' : '') + '">' +
        fieldLabel(path, labelFor(path)) +
        lockedFile +
        '<p class="tma-portal-drop__locked-note">Filed and in ' +
        esc(meta.statusLabel || 'application review') +
        '. Use <strong>Upload new version</strong> in the file viewer to replace.</p>' +
        fieldError(path) +
        '</div>';
    }

    return '<div class="tma-portal-drop' + (state.errors[path] ? ' is-invalid' : '') +
      (files.length ? ' is-filled' : '') + '" data-cip-drop="' + esc(path) + '">' +
      fieldLabel(path, labelFor(path)) +
      '<input type="file" accept=".pdf,image/*" multiple class="tma-dash__clients-photo-input"' +
      ' data-cip-file="' + esc(path) + '" aria-hidden="true">' +
      '<button type="button" class="tma-portal-drop__zone" data-cip-file-btn="' + esc(path) + '">' +
      '<img src="' + ICON + 'UploadSimple.svg" alt="" width="20" height="20">' +
      '<span class="tma-portal-drop__hint">' +
      (files.length || state.filed[path]
        ? 'Drop another file here, or choose one'
        : 'Drop a file here, or choose one') +
      '</span>' +
      '<span class="tma-portal-drop__meta">PDF or image, up to ' + MAX_DOCUMENT_MB + 'MB</span>' +
      '</button>' +
      // An edit opens with the answer already on the server. Saying so is the
      // difference between "this is filed" and "this was never uploaded" —
      // the control looks identical otherwise.
      (state.filed[path] && !files.length
        ? '<p class="tma-portal-drop__meta">Already filed. Choose a file to replace it.</p>'
        : '') +
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

    // Two to a row: the card sits beside a single column of drop targets,
    // and a pair of fields fills the width without crowding them.
    return '<div class="tma-portal-form-grid tma-portal-form-grid--person">' +
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
      { modifier: 'tma-portal-section--person' });
  }

  /* The uploads beside the person they belong to, one drop target per
     template the settings ask of that person. One to a row: two columns of
     targets fought the fields for width. */
  function documentsCard(prefix, section) {
    var fields = docFields(section || (prefix === 'sponsor.' ? 'sponsor' : 'principal'));
    if (!fields.length) return '';

    return card('Documents',
      '<div class="tma-portal-drops">' +
      fields.map(function (doc) { return documentField(prefix + doc.field); }).join('') +
      '</div>',
      { modifier: 'tma-dash__clients-card--docs' });
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

    // A person is a person: the sponsor gets the main applicant's row — name
    // above the box, photo, fields one under the last, documents beside them.
    // The only difference is that their scans are not demanded to start a
    // draft.
    return titledCard('Sponsor',
      photoField('sponsor.passportPhoto') + personFields('sponsor.'),
      { modifier: 'tma-portal-section--person' }) +
      documentsCard('sponsor.', 'sponsor');
  }

  /* §5: one person per dependent, with the same photo and documents the
     settings ask of their type — spouse, under the cutoff, or over it. */
  function dependentsCard() {
    var numbers = ordinals();
    var rows = '';

    for (var i = 0; i < state.dependents; i++) {
      rows += dependentRow(i, numbers[i]);
    }

    var add = state.dependents < MAX_DEPENDENTS
      ? '<div class="tma-dash__clients-intake-add"><button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-cip-dependent-add>' +
        'Add dependent</button></div>'
      : '';

    if (!state.dependents) {
      return titledCard('Dependents',
        '<p class="tma-portal-note tma-portal-note--empty">No dependents on this application.</p>' +
        '<div class="tma-portal-form-actions">' +
        '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-cip-dependent-add>Add dependent</button>' +
        '</div>');
    }

    return rows + add;
  }

  function dependentRow(i, ordinal) {
    var prefix = 'dependents.' + i + '.';
    var relationship = state.draft[prefix + 'relationship'];
    var title = relationship === 'spouse'
      ? 'Spouse'
      : (ordinal ? 'Qualified Dependent ' + ordinal : 'Dependent');

    return '<section class="tma-portal-section tma-portal-section--person">' +
      '<h3 class="tma-portal-section__title tma-portal-repeat__title">' + esc(title) + '</h3>' +
      '<div class="tma-portal-section__card">' +
      '<div class="tma-portal-repeat" data-cip-dependent="' + i + '">' +
      '<div class="tma-portal-repeat__head">' +
      '<button type="button" class="tma-portal-repeat__remove" data-cip-dependent-remove="' + i + '"' +
      ' aria-label="Remove ' + esc(title) + '">' +
      '<img src="' + ICON + 'Xcircle.svg" alt="" width="18" height="18"></button>' +
      '</div>' +
      photoField(prefix + 'passportPhoto') +
      '<div class="tma-portal-form-grid tma-portal-form-grid--person">' +
      textField(prefix + 'firstName') +
      textField(prefix + 'lastName') +
      textField(prefix + 'dateOfBirth', { type: 'date', max: new Date().toISOString().slice(0, 10) }) +
      selectField(prefix + 'relationship', [
        { value: 'spouse', label: 'Spouse' },
        { value: 'qualified_dependent', label: 'Qualified dependent' },
      ], 'Select') +
      '</div></div></div></section>' +
      documentsCard(prefix, dependentSection(i));
  }

  /* The whole ask on one page. Investment first — it is whose file this is
     and what they are filing for — then the people on it. */
  function formBody() {
    return '<div class="tma-dash__clients-cards tma-dash__clients-cards--intake">' +
      investmentCard() +
      applicantCard() +
      documentsCard('') +
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

    MORPH.unwired(root, '[data-cip-open-file]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var fileId = btn.getAttribute('data-cip-open-file');
        if (!fileId || !window.TMAFileActions || !window.TMAFileActions.open) return;
        window.TMAFileActions.open({ id: fileId });
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
    var meta = state.filedMeta[path];
    if (meta && meta.uploaded && meta.status !== 'update_required') {
      if (input) input.value = '';
      return;
    }

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
    var fields = ['id', 'firstName', 'lastName', 'dateOfBirth', 'relationship'];

    for (var i = index; i < state.dependents - 1; i++) {
      fields.forEach(function (f) {
        state.draft['dependents.' + i + '.' + f] = state.draft['dependents.' + (i + 1) + '.' + f];
        delete state.errors['dependents.' + i + '.' + f];
      });
      clearDependentAssets(i);
      moveDependentAssets(i + 1, i);
    }

    fields.forEach(function (f) {
      delete state.draft['dependents.' + (state.dependents - 1) + '.' + f];
      delete state.errors['dependents.' + (state.dependents - 1) + '.' + f];
    });
    clearDependentAssets(state.dependents - 1);

    state.dependents -= 1;
  }

  function moveDependentAssets(from, to) {
    var re = new RegExp('^dependents\\.' + from + '\\.');
    var prefix = 'dependents.' + to + '.';
    [state.files, state.documents, state.previews, state.filed].forEach(function (bag) {
      Object.keys(bag).forEach(function (path) {
        if (!re.test(path)) return;
        bag[path.replace(re, prefix)] = bag[path];
        delete bag[path];
      });
    });
  }

  function clearDependentAssets(index) {
    var re = new RegExp('^dependents\\.' + index + '\\.');
    [state.files, state.documents, state.previews, state.filed, state.errors].forEach(function (bag) {
      Object.keys(bag).forEach(function (path) {
        if (re.test(path)) delete bag[path];
      });
    });
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
   * The whole form, taken apart into the parts a multipart body is made of.
   *
   * The field paths are the form-data names, so `sponsor[firstName]` and
   * `dependents[0][dateOfBirth]` arrive as the nested arrays the validator
   * expects — and come back keyed the same way when it objects.
   *
   * A list rather than a FormData because the write queue has to be able to
   * put this on disk and rebuild it hours later, and a FormData cannot be
   * stored. body() below is the same thing assembled for a request that is
   * going out now.
   */
  function parts() {
    var out = [];

    Object.keys(state.draft).forEach(function (path) {
      var value = state.draft[path];
      if (value === '' || value === null || value === undefined) return;
      // Dependents past the visible count are leftovers from a removal.
      if (/^dependents\.(\d+)\./.test(path) && Number(RegExp.$1) >= state.dependents) return;
      // A sponsor's answers are not sent when there is no sponsor.
      if (!sponsored() && path.indexOf('sponsor.') === 0) return;
      out.push({ name: bracketed(path), value: value });
    });

    Object.keys(state.files).forEach(function (path) {
      if (!sponsored() && path.indexOf('sponsor.') === 0) return;
      if (/^dependents\.(\d+)\./.test(path) && Number(RegExp.$1) >= state.dependents) return;
      var file = state.files[path];
      out.push({ name: bracketed(path), file: file, filename: file.name });
    });

    // A requirement's scans go up as a list, in the order they were added.
    Object.keys(state.documents).forEach(function (path) {
      if (!sponsored() && path.indexOf('sponsor.') === 0) return;
      if (/^dependents\.(\d+)\./.test(path) && Number(RegExp.$1) >= state.dependents) return;
      state.documents[path].forEach(function (file) {
        out.push({ name: bracketed(path) + '[]', file: file, filename: file.name });
      });
    });

    out.push({ name: 'sponsored', value: sponsored() ? '1' : '0' });

    return out;
  }

  function body() {
    var form = new FormData();
    parts().forEach(function (part) {
      if (part.file) form.append(part.name, part.file, part.filename || 'upload');
      else form.append(part.name, part.value);
    });

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
    // The prefix travels with it: `sponsor.birthCertificate.2` belongs on the
    // sponsor's own control, not the main applicant's.
    var listed = key.match(/^(.+)\.\d+$/);

    return listed && allDocFields()[listed[1].split('.').pop()]
      ? listed[1]
      : key;
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

    // Editing posts to the application's own URL. Still POST, not PUT: PHP
    // parses a multipart body for POST only, and these carry files.
    var url = state.applicationId
      ? '/portal/cip/applications/' + encodeURIComponent(state.applicationId)
      : '/portal/cip/applications';

    fetch(url, {
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
          ui().toastError((json && json.message)
            || (state.applicationId ? 'Could not save this application' : 'Could not file this application'));

          return;
        }

        // The caller announces this — it knows where the reader lands next.
        if (state.onDone) state.onDone(json.application);
      });
    }).catch(function () {
      /*
       * Nothing was delivered. Not "the server said no" — the request never
       * arrived, which is the offline case and the whole reason the queue
       * exists. The form has already checked everything the server checks,
       * so parking it is a reasonable bet rather than a hope.
       */
      park(url);
    });
  }

  /**
   * Save this application on the device instead.
   *
   * Reached only when the request could not be delivered. The reader is told
   * plainly that it is on this machine and not yet at the firm — a "Saved"
   * that meant two different things depending on the wifi would be the worst
   * possible outcome of this whole feature.
   */
  function park(url) {
    var root = state.root;
    var editing = !!state.applicationId;
    var done = function () {
      state.saving = false;
      if (state.onSaving) state.onSaving(false);
    };

    if (!window.TMAQueue || !window.TMAQueue.usable()) {
      done();
      ui().toastError('Could not reach the server');

      return;
    }

    window.TMAQueue.add({
      kind: 'cip.application',
      label: editing
        ? 'Changes to application ' + ((state.record && state.record.number) || '')
        : 'A new application for ' + fullName(),
      method: 'POST',
      url: url,
      parts: parts(),
      // Everything drawn from this application, wherever it was cached. Two
      // prefixes because two screens ask different questions of the same
      // record: the profile keys on the client, the wizard on the application.
      // And the hub caches: the replay files scans into the applicant's
      // folders and creates the client record itself, and it runs through the
      // queue's own fetch rather than TMAFilesNet or clientsFetch — so
      // neither seam that invalidates every other write ever sees this one.
      invalidate: ['cip:application:', 'cip:application-record:', 'files:listing:', 'clients:'],
    }).then(function () {
      done();
      if (state.onDone) state.onDone(editing ? optimistic() : null, { queued: true });
    }).catch(function () {
      done();
      ui().toastError('Could not reach the server');
      if (root) render(root);
    });
  }

  function fullName() {
    return [state.draft.firstName, state.draft.lastName]
      .filter(Boolean).join(' ') || 'an applicant';
  }

  /**
   * What the record will say once the queued change lands.
   *
   * The server builds the real one; this is the same answers laid over the
   * copy the form was opened with, so the profile behind the reader shows
   * what they just typed rather than what they just replaced. It carries
   * `pendingSync` so every screen that draws it can say so — a local copy
   * that looked identical to a filed one would be a lie by omission.
   *
   * Files are deliberately not reflected. A scan chosen offline is in the
   * queue, not on the server, and marking a requirement answered before it
   * has been uploaded would tell the reader a checklist is complete when the
   * firm cannot see the document.
   */
  function optimistic() {
    if (!state.record) return null;

    var record = JSON.parse(JSON.stringify(state.record));
    var apply = function (person, prefix) {
      if (!person) return person;
      PERSON_FIELDS.forEach(function (f) {
        if (state.draft[prefix + f] !== undefined) person[f] = state.draft[prefix + f];
      });
      person.name = [person.firstName, person.lastName].filter(Boolean).join(' ');

      return person;
    };

    record.providerId = state.draft.providerId || record.providerId;
    record.investmentTypeValue = state.draft.investmentType || '';
    record.investmentTypeOther = state.draft.investmentTypeOther || '';
    record.investmentType = investmentLabel();
    record.sponsored = sponsored();

    apply(record.applicant, '');
    // A sponsor added offline has no filed record to lay answers over, and
    // inventing one would put a person on the screen the server has never
    // heard of. The queued write is what creates them.
    if (record.sponsor) apply(record.sponsor, 'sponsor.');
    if (!sponsored()) record.sponsor = null;

    record.dependents = [];
    for (var i = 0; i < state.dependents; i++) {
      var p = 'dependents.' + i + '.';
      var id = state.draft[p + 'id'];
      var filed = (state.record.dependents || []).filter(function (d) {
        return d.id && d.id === id;
      })[0];
      var dependent = filed ? JSON.parse(JSON.stringify(filed)) : { id: null, role: 'dependent', documents: [], outstanding: [] };
      dependent.firstName = state.draft[p + 'firstName'] || '';
      dependent.lastName = state.draft[p + 'lastName'] || '';
      dependent.dateOfBirth = state.draft[p + 'dateOfBirth'] || '';
      dependent.relationship = state.draft[p + 'relationship'] || 'qualified_dependent';
      dependent.name = [dependent.firstName, dependent.lastName].filter(Boolean).join(' ');
      record.dependents.push(dependent);
    }
    record.familySize = 1 + (record.sponsor ? 1 : 0) + record.dependents.length;

    record.pendingSync = true;

    return record;
  }

  /* The display string for the chosen investment type — the free text once
     somebody picked Other, the option's own label otherwise. */
  function investmentLabel() {
    var value = state.draft.investmentType || '';
    if (value === 'other') return state.draft.investmentTypeOther || 'Other';
    var option = ((state.options && state.options.investmentTypes) || [])
      .filter(function (o) { return o.value === value; })[0];

    return option ? option.label : value;
  }

  /* ── mount ─────────────────────────────────────────────────────── */

  /*
   * Put a filed application back into the form.
   *
   * Every answer goes into the same draft keys the form writes, so editing is
   * the create form with values in it rather than a second screen that has to
   * be kept in step. What cannot come back as a value is a file: the uploads
   * are on the server, so the controls remember what is already filed and ask
   * for a replacement rather than an answer.
   */
  function prefill(app) {
    var into = function (prefix, person) {
      if (!person) return;
      PERSON_FIELDS.forEach(function (f) { state.draft[prefix + f] = person[f] || ''; });
      if (person.photo) state.previews[prefix + 'passportPhoto'] = person.photo;
      state.filed[prefix + 'passportPhoto'] = !!person.photo;
      docFields(sectionForPath(prefix || 'x')).forEach(function (doc) {
        var slot = (person.documents || []).filter(function (d) {
          return d.type === doc.key;
        })[0];
        state.filed[prefix + doc.field] = !!(slot && slot.uploaded);
        state.filedMeta[prefix + doc.field] = slot ? {
          uploaded: !!slot.uploaded,
          status: slot.status || 'pending_upload',
          statusLabel: slot.statusLabel || '',
          fileId: slot.fileId || null,
          fileName: slot.fileName || null,
          fileSize: slot.fileSize || null,
          fileExt: slot.fileExt || null,
        } : null;
      });
    };

    state.draft.providerId = app.providerId || '';
    state.draft.investmentType = app.investmentTypeValue || '';
    state.draft.investmentTypeOther = app.investmentTypeOther || '';
    state.draft.sponsored = app.sponsored ? '1' : '0';

    into('', app.applicant);
    into('sponsor.', app.sponsor);

    (app.dependents || []).forEach(function (d, i) {
      var p = 'dependents.' + i + '.';
      // The uuid rides along so the server changes this dependant rather than
      // replacing the family with a new one.
      state.draft[p + 'id'] = d.id;
      state.draft[p + 'firstName'] = d.firstName || '';
      state.draft[p + 'lastName'] = d.lastName || '';
      state.draft[p + 'dateOfBirth'] = d.dateOfBirth || '';
      state.draft[p + 'relationship'] = d.relationship || 'qualified_dependent';
      into(p, d);
    });
    state.dependents = (app.dependents || []).length;
  }

  function open(root, opts) {
    opts = opts || {};
    state.root = root;
    state.draft = emptyDraft();
    state.files = {};
    state.previews = {};
    state.documents = {};
    state.filed = {};
    state.filedMeta = {};
    state.dependents = 0;
    state.errors = {};
    state.saving = false;
    state.error = '';
    state.applicationId = opts.applicationId || null;
    state.record = null;
    state.onDone = opts.onDone || null;
    state.onSaving = opts.onSaving || null;
    state.loading = true;
    render(root);

    // The options and, when editing, the record to put back into them. Asked
    // for together so the form paints once with everything it needs rather
    // than filling in under the reader.
    var wants = [held('cip:form', '/portal/cip/applications/form')];

    if (state.applicationId) {
      wants.push(held(
        'cip:application-record:' + state.applicationId,
        '/portal/cip/applications/' + encodeURIComponent(state.applicationId),
      ).then(function (json) { return json.application; }));
    }

    Promise.all(wants).then(function (answers) {
      state.options = answers[0];
      // Nothing to choose means the answer is already known.
      if (state.options.providers && state.options.providers.length === 1) {
        state.draft.providerId = state.options.providers[0].id;
      }
      // Kept, not just poured into the draft: a save that has to be parked
      // builds what the record will say by laying the draft over this.
      state.record = answers[1] || null;
      if (answers[1]) prefill(answers[1]);
      state.loading = false;
      render(root);
    }).catch(function () {
      state.loading = false;
      state.error = state.applicationId
        ? 'Couldn’t load this application. Refresh to try again.'
        : 'Couldn’t load the application form. Refresh to try again.';
      render(root);
    });
  }

  /*
   * Ask the server, and fall back to what was held.
   *
   * Network first, unlike the read-through cache the rest of the portal
   * paints with. A form is about to be edited and then posted whole, so
   * opening it on a stale copy risks a reader overwriting a colleague's
   * change with an answer they never saw — worth the wait. The held copy is
   * the offline case, where the choice is that or nothing.
   *
   * Only the desktop keeps these across a restart; in a browser the store is
   * memory alone, so what can be edited with no network is what was opened
   * with one. That is the firm's decision about whose disk holds a client's
   * details, not an oversight — see portal-store.js.
   */
  function held(key, url) {
    var ask = function () {
      return api('GET', url).then(function (res) {
        if (!res.ok) throw new Error(url);

        return res.json();
      });
    };

    if (!window.TMAStore) return ask();

    return ask().then(function (json) {
      window.TMAStore.put(key, json);

      return json;
    }).catch(function (err) {
      return window.TMAStore.get(key).then(function (value) {
        if (value === undefined) throw err;

        return value;
      });
    });
  }

  // submit() is the page toolbar's Add button: the form looks and behaves
  // like every other form in the hub, so its actions live where they do.
  window.TMACipIntake = { open: open, submit: submit };
})();
