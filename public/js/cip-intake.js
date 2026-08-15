/* TMA — CIP application intake (§2 Application Creation, §3 Investment Types)
 *
 * The form the firm actually files with: the government's own field set, in
 * the government's own order, so what is collected here is what gets
 * submitted. Three steps rather than one long page — an application is
 * fifteen answers, and a wall of fifteen reads as a chore nobody finishes.
 *
 * Two answers are never asked for. The region follows the country of
 * residence, and the application number is minted server-side; the review
 * step shows both so the reader can see what the record will say without
 * being invited to contradict it.
 *
 * The options come from the server (/portal/cip/applications/form) rather
 * than a list in here: the country a browser offers and the country the
 * validator accepts have to be the same list, and the region mapping lives
 * with it.
 */
(function () {
  'use strict';

  var ui = function () { return window.TMAPortalUI; };
  var MORPH = window.TMAMorph;

  var STEPS = [
    { key: 'applicant', label: 'Main applicant', icon: 'User' },
    { key: 'investment', label: 'Investment', icon: 'Buildings' },
    { key: 'review', label: 'Review', icon: 'CheckCircle' },
  ];

  /* One draft per mount. Deliberately not persisted yet: until the wizard can
     save a partial application server-side (Phase 2d), a "resume" that lived
     only in this tab would promise more than it keeps. */
  function emptyDraft() {
    return {
      providerId: '', firstName: '', lastName: '', gender: '',
      dateOfBirth: '', countryOfBirth: '', countryOfResidence: '',
      occupation: '', passportNumber: '',
      investmentType: '', investmentTypeOther: '', sponsored: '',
    };
  }

  var state = {
    step: 'applicant',
    draft: emptyDraft(),
    options: null,
    loading: false,
    error: '',
    saving: false,
    errors: {},
    onDone: null,
  };

  function esc(s) { return ui().esc(s); }

  /* ── what each step must answer before it can be left ──────────────
     Mirrors App\Support\Cip\Intake::rules — the server is the authority,
     this only spares the reader a round trip to find out. */
  var REQUIRED = {
    applicant: ['firstName', 'lastName', 'gender', 'dateOfBirth', 'countryOfBirth',
      'countryOfResidence', 'occupation', 'passportNumber'],
    investment: ['providerId', 'investmentType', 'sponsored'],
    review: [],
  };

  var LABELS = {
    providerId: 'Service provider', firstName: 'First name', lastName: 'Last name',
    gender: 'Gender', dateOfBirth: 'Date of birth', countryOfBirth: 'Country of birth',
    countryOfResidence: 'Country of residence', occupation: 'Occupation',
    passportNumber: 'Passport number', investmentType: 'Investment type',
    investmentTypeOther: 'Specify investment type', sponsored: 'Sponsored',
  };

  function missingOn(stepKey) {
    var missing = {};
    (REQUIRED[stepKey] || []).forEach(function (field) {
      if (String(state.draft[field] || '').trim() === '') missing[field] = LABELS[field] + ' is required';
    });
    if (stepKey === 'investment' && state.draft.investmentType === 'other'
      && String(state.draft.investmentTypeOther || '').trim() === '') {
      missing.investmentTypeOther = 'Say which investment type this is';
    }
    return missing;
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

  function investmentLabel() {
    if (state.draft.investmentType === 'other') {
      return state.draft.investmentTypeOther || 'Other';
    }
    var list = (state.options && state.options.investmentTypes) || [];
    for (var i = 0; i < list.length; i++) if (list[i].value === state.draft.investmentType) return list[i].label;
    return '';
  }

  /* ── fields ────────────────────────────────────────────────────── */

  function fieldError(name) {
    var msg = state.errors[name];
    return msg ? '<span class="tma-portal-field__error">' + esc(msg) + '</span>' : '';
  }

  function textField(name, opts) {
    opts = opts || {};
    return '<label class="tma-portal-field' + (state.errors[name] ? ' is-invalid' : '') + '">' +
      '<span class="tma-portal-field__label">' + esc(LABELS[name]) + '</span>' +
      '<input class="tma-portal-input" type="' + (opts.type || 'text') + '"' +
      ' data-cip-field="' + name + '"' +
      ' value="' + esc(state.draft[name] || '') + '"' +
      (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
      (opts.max ? ' max="' + esc(opts.max) + '"' : '') +
      ' autocomplete="off">' +
      fieldError(name) +
      '</label>';
  }

  function selectField(name, options, placeholder) {
    var opts = [{ value: '', label: placeholder }].concat(options);
    return '<label class="tma-portal-field' + (state.errors[name] ? ' is-invalid' : '') + '">' +
      '<span class="tma-portal-field__label">' + esc(LABELS[name]) + '</span>' +
      '<select class="tma-portal-select" data-cip-field="' + name + '">' +
      opts.map(function (o) {
        return '<option value="' + esc(o.value) + '"' +
          (String(state.draft[name]) === String(o.value) ? ' selected' : '') + '>' +
          esc(o.label) + '</option>';
      }).join('') +
      '</select>' + fieldError(name) +
      '</label>';
  }

  /* ── steps ─────────────────────────────────────────────────────── */

  function applicantStep() {
    var countries = ((state.options && state.options.countries) || []).map(function (c) {
      return { value: c.value, label: c.label };
    });
    var genders = ((state.options && state.options.genders) || []).map(function (g) {
      return { value: g, label: g };
    });
    var region = regionFor(state.draft.countryOfResidence);

    return ui().section('Main applicant',
      '<div class="tma-portal-form-grid">' +
      textField('firstName') +
      textField('lastName') +
      selectField('gender', genders, 'Select') +
      textField('dateOfBirth', { type: 'date', max: new Date().toISOString().slice(0, 10) }) +
      selectField('countryOfBirth', countries, 'Select a country') +
      selectField('countryOfResidence', countries, 'Select a country') +
      textField('occupation') +
      textField('passportNumber', { placeholder: 'As printed on the bio page' }) +
      '</div>' +
      // Derived, and shown so it is never a surprise on the submitted form.
      (region
        ? '<p class="tma-portal-note" data-cip-region>Region: <strong>' + esc(region) + '</strong> — from the country of residence.</p>'
        : '<p class="tma-portal-note" data-cip-region>The region follows the country of residence.</p>'),
      { description: 'Every field here is required by the CIP application.' });
  }

  function investmentStep() {
    var providers = ((state.options && state.options.providers) || []).map(function (p) {
      return { value: p.id, label: p.name + ' (' + p.code + ')' };
    });
    var types = ((state.options && state.options.investmentTypes) || []).map(function (t) {
      return { value: t.value, label: t.label };
    });

    return ui().section('Investment',
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
      '</div>' +
      (String(state.draft.sponsored) === '1'
        ? '<p class="tma-portal-note">A sponsor profile and its own document folder are created with the application.</p>'
        : ''),
      { description: 'One investment route per application.' });
  }

  function reviewRow(label, value) {
    return '<div class="tma-portal-review__row">' +
      '<span class="tma-portal-review__label">' + esc(label) + '</span>' +
      '<span class="tma-portal-review__value">' + esc(value || '—') + '</span>' +
      '</div>';
  }

  function reviewStep() {
    var d = state.draft;
    var name = [d.firstName, d.lastName].filter(Boolean).join(' ');

    return ui().section('Review',
      '<div class="tma-portal-review">' +
      reviewRow('Applicant', name) +
      reviewRow('Gender', d.gender) +
      reviewRow('Date of birth', d.dateOfBirth) +
      reviewRow('Country of birth', d.countryOfBirth) +
      reviewRow('Country of residence', d.countryOfResidence) +
      reviewRow('Region', regionFor(d.countryOfResidence)) +
      reviewRow('Occupation', d.occupation) +
      reviewRow('Passport number', d.passportNumber) +
      reviewRow('Service provider', providerName(d.providerId)) +
      reviewRow('Investment type', investmentLabel()) +
      reviewRow('Sponsored', String(d.sponsored) === '1' ? 'Yes' : 'No') +
      '</div>' +
      '<p class="tma-portal-note">Filing this creates a draft and its application number. ' +
      'Documents and dependents come next, and nothing reaches an officer until it is submitted.</p>',
      { description: 'What the application will say.' });
  }

  function stepper() {
    return '<div class="tma-portal-sig-wizard__steps" role="list">' +
      STEPS.map(function (step, i) {
        var on = step.key === state.step;
        var done = STEPS.findIndex(function (s) { return s.key === state.step; }) > i;
        return (i ? '<span class="tma-portal-sig-wizard__step-line' + (done ? ' is-done' : '') + '" aria-hidden="true"></span>' : '') +
          '<div class="tma-portal-sig-wizard__step' + (on ? ' is-active' : done ? ' is-done' : '') + '" role="listitem">' +
          '<span class="tma-portal-sig-wizard__step-icon">' +
          '<img src="images/icons/phosphor/' + (done ? 'CheckCircle' : step.icon) + '.svg" alt="">' +
          '</span>' +
          '<span class="tma-portal-sig-wizard__step-label">' + esc(step.label) + '</span>' +
          '</div>';
      }).join('') +
      '</div>';
  }

  function actions() {
    var isFirst = state.step === STEPS[0].key;
    var isLast = state.step === STEPS[STEPS.length - 1].key;

    return '<div class="tma-portal-form-actions tma-portal-form-actions--split">' +
      '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-cip-cancel>Cancel</button>' +
      '<span class="tma-portal-form-actions__end">' +
      (isFirst ? '' : '<button type="button" class="tma-no-data__btn tma-portal-btn--ghost" data-cip-back>Back</button>') +
      (isLast
        ? '<button type="button" class="tma-no-data__btn" data-cip-file' + (state.saving ? ' disabled' : '') + '>' +
          (state.saving ? 'Filing…' : 'File application') + '</button>'
        : '<button type="button" class="tma-no-data__btn" data-cip-next>Continue</button>') +
      '</span></div>';
  }

  function render(root) {
    if (state.loading) { root.innerHTML = ui().loading(); return; }
    if (state.error) {
      root.innerHTML = '<p class="tma-portal-note">' + esc(state.error) + '</p>';
      return;
    }

    var body = state.step === 'applicant' ? applicantStep()
      : state.step === 'investment' ? investmentStep()
        : reviewStep();

    MORPH.patch(root,
      '<div class="tma-portal-sig-wizard" data-cip-wizard>' +
      stepper() + body + actions() +
      '</div>');
    wire(root);
  }

  function wire(root) {
    MORPH.unwired(root, '[data-cip-field]').forEach(function (el) {
      var name = el.getAttribute('data-cip-field');
      // input for typing, change for selects and the date picker.
      el.addEventListener('input', function () { state.draft[name] = el.value; });
      el.addEventListener('change', function () {
        state.draft[name] = el.value;
        delete state.errors[name];
        // These three change what the form shows: the derived region, the
        // "Other" free text, and the sponsor note.
        if (name === 'countryOfResidence' || name === 'investmentType' || name === 'sponsored') {
          render(root);
        }
      });
    });

    var next = MORPH.unwiredOne(root, '[data-cip-next]');
    if (next) next.addEventListener('click', function () {
      state.errors = missingOn(state.step);
      if (Object.keys(state.errors).length) { render(root); return; }
      var i = STEPS.findIndex(function (s) { return s.key === state.step; });
      state.step = STEPS[Math.min(i + 1, STEPS.length - 1)].key;
      render(root);
    });

    var back = MORPH.unwiredOne(root, '[data-cip-back]');
    if (back) back.addEventListener('click', function () {
      var i = STEPS.findIndex(function (s) { return s.key === state.step; });
      state.step = STEPS[Math.max(i - 1, 0)].key;
      state.errors = {};
      render(root);
    });

    var cancel = MORPH.unwiredOne(root, '[data-cip-cancel]');
    if (cancel) cancel.addEventListener('click', function () {
      if (state.onDone) state.onDone(null);
    });

    var file = MORPH.unwiredOne(root, '[data-cip-file]');
    if (file) file.addEventListener('click', function () { submit(root); });
  }

  function xsrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function api(method, url, body) {
    var headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-XSRF-TOKEN': xsrf(),
      'X-Requested-With': 'XMLHttpRequest',
    };
    // Skip our own echo of the live signal this write raises.
    if (window.TMALive && window.TMALive.headers) {
      var extra = window.TMALive.headers();
      Object.keys(extra || {}).forEach(function (k) { headers[k] = extra[k]; });
    }
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  function submit(root) {
    // Everything, not just this step — the reader can reach Review with an
    // earlier step half-answered by walking back and forth.
    var all = {};
    Object.keys(REQUIRED).forEach(function (key) {
      Object.assign(all, missingOn(key));
    });
    if (Object.keys(all).length) {
      state.errors = all;
      state.step = REQUIRED.applicant.some(function (f) { return all[f]; }) ? 'applicant' : 'investment';
      render(root);
      return;
    }

    state.saving = true;
    render(root);

    var d = state.draft;
    api('POST', '/portal/cip/applications', {
      providerId: d.providerId,
      firstName: d.firstName,
      lastName: d.lastName,
      gender: d.gender,
      dateOfBirth: d.dateOfBirth,
      countryOfBirth: d.countryOfBirth,
      countryOfResidence: d.countryOfResidence,
      occupation: d.occupation,
      passportNumber: d.passportNumber,
      investmentType: d.investmentType,
      investmentTypeOther: d.investmentTypeOther,
      sponsored: String(d.sponsored) === '1',
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        state.saving = false;

        if (res.status === 422 && json.errors) {
          // The server's word, field by field, on the step that owns them.
          state.errors = {};
          Object.keys(json.errors).forEach(function (k) { state.errors[k] = json.errors[k][0]; });
          state.step = REQUIRED.applicant.some(function (f) { return state.errors[f]; })
            ? 'applicant' : 'investment';
          render(root);
          return;
        }

        if (!res.ok) {
          ui().toastError((json && json.message) || 'Could not file this application');
          render(root);
          return;
        }

        // The caller announces this — it knows where the reader lands next.
        if (state.onDone) state.onDone(json.application);
      });
    }).catch(function () {
      state.saving = false;
      ui().toastError('Could not reach the server');
      render(root);
    });
  }

  /* ── mount ─────────────────────────────────────────────────────── */

  function open(root, opts) {
    opts = opts || {};
    state.step = 'applicant';
    state.draft = emptyDraft();
    state.errors = {};
    state.saving = false;
    state.error = '';
    state.onDone = opts.onDone || null;
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

  window.TMACipIntake = { open: open, STEPS: STEPS };
})();
