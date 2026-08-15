/* TMA — CIP application intake (§2 Application Creation, §3 Investment Types)
 *
 * The form the firm actually files with: the government's own field set, in
 * the government's own order, so what is collected here is what gets
 * submitted. One page, like every other form in the hub — the reader fills
 * it top to bottom and sees the whole ask at once.
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
  var REQUIRED = ['providerId', 'firstName', 'lastName', 'gender', 'dateOfBirth',
    'countryOfBirth', 'countryOfResidence', 'occupation', 'passportNumber',
    'investmentType', 'sponsored'];

  var LABELS = {
    providerId: 'Service provider', firstName: 'First name', lastName: 'Last name',
    gender: 'Gender', dateOfBirth: 'Date of birth', countryOfBirth: 'Country of birth',
    countryOfResidence: 'Country of residence', occupation: 'Occupation',
    passportNumber: 'Passport number', investmentType: 'Investment type',
    investmentTypeOther: 'Specify investment type', sponsored: 'Sponsored',
  };

  function missing() {
    var found = {};
    REQUIRED.forEach(function (field) {
      if (String(state.draft[field] || '').trim() === '') found[field] = LABELS[field] + ' is required';
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

  /* The same card the service provider page draws a record in. Full width
     rather than paired: the applicant's eight fields and the investment's
     three do not balance side by side, and the form reads down the page. */
  function card(title, body) {
    return '<section class="tma-dash__clients-card">' +
      '<header class="tma-dash__clients-card-head">' +
      '<h3 class="tma-dash__clients-card-title">' + esc(title) + '</h3>' +
      '</header>' +
      body +
      '</section>';
  }

  function applicantStep() {
    var countries = ((state.options && state.options.countries) || []).map(function (c) {
      return { value: c.value, label: c.label };
    });
    var genders = ((state.options && state.options.genders) || []).map(function (g) {
      return { value: g, label: g };
    });
    var region = regionFor(state.draft.countryOfResidence);

    return card('Main applicant',
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
      // Nothing to say before a country is chosen.
      (region
        ? '<p class="tma-portal-note" data-cip-region>Region: <strong>' + esc(region) + '</strong></p>'
        : ''));
  }

  function investmentStep() {
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
      '</div>' +
      (String(state.draft.sponsored) === '1'
        ? '<p class="tma-portal-note">A sponsor profile and its own document folder are created with the application.</p>'
        : ''));
  }

  /* The whole ask on one page, in the government form's order. */
  function formBody() {
    return '<div class="tma-dash__clients-cards">' + applicantStep() + investmentStep() + '</div>';
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
          esc(count === 1 ? 'One answer is still needed.' : count + ' answers are still needed.') +
          '</p>'
        : '') +
      formBody() +
      '</div>');
    wire(root);
  }

  function wire(root) {
    MORPH.unwired(root, '[data-cip-field]').forEach(function (el) {
      var name = el.getAttribute('data-cip-field');
      el.addEventListener('input', function () {
        state.draft[name] = el.value;
        delete state.errors[name];
      });
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

  function submit() {
    var root = state.root;
    if (!root || state.saving) return;

    var found = missing();
    if (Object.keys(found).length) {
      state.errors = found;
      render(root);
      // Take the reader to the first thing they still owe.
      var first = root.querySelector('.tma-portal-field.is-invalid [data-cip-field]');
      if (first && first.focus) {
        first.focus();
        if (first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return;
    }

    state.saving = true;
    if (state.onSaving) state.onSaving(true);

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
        if (state.onSaving) state.onSaving(false);

        if (res.status === 422 && json.errors) {
          // The server's word, field by field.
          state.errors = {};
          Object.keys(json.errors).forEach(function (k) { state.errors[k] = json.errors[k][0]; });
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
