/*
 * Fee Calculator (/calculator): the real estate admin fee for a CBI
 * application, estimated from who is on it.
 *
 * Portal-view-pattern module (see call-recordings.js): registers with
 * TMAPortalViews for the SPA shell. Open to every approved account, the page
 * is absent from Role::PAGE_CAPABILITIES on purpose. There is no server
 * side: the arithmetic is the whole feature, and it runs here.
 *
 * The rules are the firm's standalone calculator's, kept exactly:
 *   base fee          $30,000 alone, $45,000 with a spouse
 *   dependants 1 to 4 $5,000 under 18, $10,000 at 18 and over
 *   dependants 5+     $10,000 whatever the age, once a spouse is included;
 *                     without a spouse they still go by age
 *   no age chosen     $0, and left out of the count
 *   at most 15 dependants; the first row is always there
 * Fees follow the order the dependants are entered in, which is why the rows
 * are numbered and only the last one can be removed.
 *
 * Rendering is design-system components only: ui().section, ui().select,
 * ui().btn, .tma-portal-field__label, .tma-portal-chip; the shell's header
 * carries the page title, as it does for every portal page. The page
 * paints once per mount; a change updates the numbers in place, so a select
 * never loses focus to a repaint.
 */
(function () {
  'use strict';

  var MAX_DEPENDANTS = 15;
  var BASE_ALONE = 30000;
  var BASE_WITH_SPOUSE = 45000;
  var FEE_UNDER_18 = 5000;
  var FEE_18_AND_OVER = 10000;
  var AGE_UNDER_18 = 'Under 18';
  var AGE_18_AND_OVER = '18 and Over';
  var AGES = [AGE_UNDER_18, AGE_18_AND_OVER];

  function ui() { return window.TMAPortalUI || null; }

  /* ── The arithmetic ── */

  /* One dependant's fee by position (1-based) and age; null until an age is
     chosen, so an untouched row neither counts nor charges. */
  function dependantFee(position, age, withSpouse) {
    if (age !== AGE_UNDER_18 && age !== AGE_18_AND_OVER) return null;
    if (position > 4 && withSpouse) return FEE_18_AND_OVER;
    return age === AGE_UNDER_18 ? FEE_UNDER_18 : FEE_18_AND_OVER;
  }

  function compute(withSpouse, ages) {
    var base = withSpouse ? BASE_WITH_SPOUSE : BASE_ALONE;
    var fees = [];
    var dependantTotal = 0;
    var counted = 0;
    (ages || []).forEach(function (age, i) {
      var fee = dependantFee(i + 1, age, !!withSpouse);
      fees.push(fee);
      if (fee !== null) {
        dependantTotal += fee;
        counted += 1;
      }
    });
    return {
      base: base,
      fees: fees,
      counted: counted,
      dependantTotal: dependantTotal,
      total: base + dependantTotal,
    };
  }

  function money(n) {
    return '$' + Number(n || 0).toLocaleString('en-US');
  }

  /* Kept for the session, so leaving the page and coming back keeps the
     entries, the same as every other portal page. */
  var state = { withSpouse: false, ages: [''] };

  /* ── Markup ── */

  function dependantRow(index) {
    var n = index + 1;
    return '<div class="fee-calc__row" data-fee-dependant>' +
      '<span class="tma-portal-field__label fee-calc__row-label">Dependant ' + n + '</span>' +
      ui().select(
        [{ value: '', label: 'Select age' }].concat(AGES),
        state.ages[index] || '',
        'data-fee-age',
        'Dependant ' + n + ' age'
      ) +
      '<span class="tma-portal-chip fee-calc__fee" data-fee-chip>' + money(0) + '</span>' +
      '</div>';
  }

  function feeStructure() {
    return '<ul>' +
      '<li>Applying alone: ' + money(BASE_ALONE) + '</li>' +
      '<li>With a spouse: ' + money(BASE_WITH_SPOUSE) + '</li>' +
      '<li>Dependants 1 to 4: ' + money(FEE_UNDER_18) + ' under 18, ' + money(FEE_18_AND_OVER) + ' at 18 and over</li>' +
      '<li>With a spouse, dependants from the 5th: ' + money(FEE_18_AND_OVER) + ' each, any age</li>' +
      '</ul>';
  }

  function render(root) {
    root.innerHTML =
      '<div class="tma-portal-page fee-calc">' +
      ui().section('Application',
        '<div class="fee-calc__row">' +
        '<span class="tma-portal-field__label fee-calc__row-label">Applying with a spouse?</span>' +
        ui().select(
          [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }],
          state.withSpouse ? 'yes' : 'no',
          'data-fee-spouse',
          'Applying with a spouse'
        ) +
        '</div>') +
      ui().section('Dependants',
        '<div class="fee-calc__dependants" data-fee-dependants>' +
        state.ages.map(function (_, i) { return dependantRow(i); }).join('') +
        '</div>' +
        '<div class="tma-portal-form-actions">' +
        ui().btn({ label: 'Add dependant', icon: 'Plus', variant: 'ghost', attrs: ' data-fee-add' }) +
        ui().btn({ label: 'Remove dependant', icon: 'Minus', variant: 'ghost', attrs: ' data-fee-remove' }) +
        '</div>',
        { description: 'In the order they are on the application.' }) +
      ui().section('Total',
        '<div class="fee-calc__lines" data-fee-lines></div>' +
        '<div class="fee-calc__total">' +
        '<span class="fee-calc__total-label">Total admin fee</span>' +
        '<span class="fee-calc__total-amount" data-fee-total>' + money(BASE_ALONE) + '</span>' +
        '</div>' +
        '<p class="tma-portal-note">Estimates only.</p>') +
      ui().section('Fee structure', feeStructure()) +
      '</div>';
  }

  /* Write the numbers into the painted page; never repaint it. */
  function sync(root) {
    var result = compute(state.withSpouse, state.ages);

    var rows = root.querySelectorAll('[data-fee-dependant]');
    Array.prototype.forEach.call(rows, function (row, i) {
      var chip = row.querySelector('[data-fee-chip]');
      if (!chip) return;
      var fee = result.fees[i];
      var counted = fee !== null && fee !== undefined;
      chip.textContent = money(counted ? fee : 0);
      chip.classList.toggle('tma-portal-chip--ok', counted);
    });

    var lines = root.querySelector('[data-fee-lines]');
    if (lines) {
      var html = '<div class="fee-calc__line">' +
        '<span>Base fee (' + (state.withSpouse ? 'Applicant + Spouse' : 'Applicant only') + ')</span>' +
        '<span>' + money(result.base) + '</span></div>';
      if (result.dependantTotal > 0) {
        html += '<div class="fee-calc__line">' +
          '<span>Dependant fees (' + result.counted + ')</span>' +
          '<span>' + money(result.dependantTotal) + '</span></div>';
      }
      lines.innerHTML = html;
    }

    var total = root.querySelector('[data-fee-total]');
    if (total) total.textContent = money(result.total);

    var add = root.querySelector('[data-fee-add]');
    var remove = root.querySelector('[data-fee-remove]');
    if (add) add.disabled = state.ages.length >= MAX_DEPENDANTS;
    if (remove) remove.disabled = state.ages.length <= 1;
  }

  /* Bound once, right after the one paint, so nothing stacks. */
  function wire(root) {
    var list = root.querySelector('[data-fee-dependants]');

    var spouse = root.querySelector('[data-fee-spouse]');
    if (spouse) {
      spouse.addEventListener('change', function () {
        state.withSpouse = spouse.value === 'yes';
        sync(root);
      });
    }

    if (list) {
      list.addEventListener('change', function (e) {
        var select = e.target && e.target.closest ? e.target.closest('[data-fee-age]') : null;
        if (!select) return;
        var row = select.closest('[data-fee-dependant]');
        var index = Array.prototype.indexOf.call(list.children, row);
        if (index < 0) return;
        state.ages[index] = select.value;
        sync(root);
      });
    }

    var add = root.querySelector('[data-fee-add]');
    if (add) {
      add.addEventListener('click', function () {
        if (!list || state.ages.length >= MAX_DEPENDANTS) return;
        state.ages.push('');
        list.insertAdjacentHTML('beforeend', dependantRow(state.ages.length - 1));
        sync(root);
      });
    }

    var remove = root.querySelector('[data-fee-remove]');
    if (remove) {
      remove.addEventListener('click', function () {
        if (!list || state.ages.length <= 1) return;
        state.ages.pop();
        if (list.lastElementChild) list.removeChild(list.lastElementChild);
        sync(root);
      });
    }
  }

  /* ── Mount ── */

  function mount(root) {
    if (!root || !ui()) return;
    if (!root.querySelector('.fee-calc')) {
      render(root);
      wire(root);
    }
    sync(root);
  }

  window.TMAFeeCalculator = {
    compute: compute,
    dependantFee: dependantFee,
    MAX_DEPENDANTS: MAX_DEPENDANTS,
  };

  if (window.TMAPortalViews) {
    window.TMAPortalViews.register('calculator', mount);
  }
})();
