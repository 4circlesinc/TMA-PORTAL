/*
 * Billing Details — card form (32546:96134)
 */
(function () {
  'use strict';

  function queryParams() {
    return typeof URLSearchParams !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : null;
  }

  function getReturnUrl() {
    var params = queryParams();
    var value = params && params.get('return');
    return value || '/billing-details/';
  }

  function getPreviousUrl() {
    var params = queryParams();
    if (params && params.get('return')) {
      return params.get('return').split('?')[0] || '/settings/';
    }
    return '/billing-details/';
  }

  function successRedirectUrl() {
    var base = getReturnUrl();
    var join = base.indexOf('?') >= 0 ? '&' : '?';
    return base + join + 'paymentAdded=1';
  }

  function populateExpYears(select) {
    if (!select || select.options.length > 2) return;
    var year = new Date().getFullYear();
    var i;
    for (i = 0; i < 10; i++) {
      var y = year + i;
      var opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      select.appendChild(opt);
    }
  }

  function bindForm(form) {
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nameInput = form.querySelector('[name="name_on_card"]');
      var numberInput = form.querySelector('[name="card_number"]');
      var monthInput = form.querySelector('[name="exp_month"]');
      var yearInput = form.querySelector('[name="exp_year"]');
      var cvvInput = form.querySelector('[name="cvv"]');
      var saveInput = form.querySelector('[name="save_card"]');

      var nameOnCard = nameInput ? nameInput.value.trim() : '';
      var digits = numberInput ? numberInput.value.replace(/\D/g, '') : '';
      var expMonth = monthInput ? monthInput.value : '';
      var expYear = yearInput ? yearInput.value : '';
      var cvv = cvvInput ? cvvInput.value.trim() : '';

      if (!nameOnCard || digits.length < 12 || !expMonth || !expYear || cvv.length < 3) {
        if (!nameOnCard && nameInput) nameInput.focus();
        else if (digits.length < 12 && numberInput) numberInput.focus();
        else if (!expMonth && monthInput) monthInput.focus();
        else if (!expYear && yearInput) yearInput.focus();
        else if (cvvInput) cvvInput.focus();
        return;
      }

      if (window.TMAPaymentMethods) {
        window.TMAPaymentMethods.addCardMethod({
          nameOnCard: nameOnCard,
          digits: digits,
          expMonth: expMonth,
          expYear: expYear,
          makeDefault: !saveInput || saveInput.checked,
        });
      }

      window.location.href = successRedirectUrl();
    });
  }

  function init() {
    var form = document.getElementById('billing-card-form');
    var previous = document.querySelector('[data-billing-card-previous]');
    if (previous) previous.setAttribute('href', getPreviousUrl());
    populateExpYears(form && form.querySelector('[name="exp_year"]'));
    bindForm(form);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
