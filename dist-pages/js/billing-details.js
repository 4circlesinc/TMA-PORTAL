/*
 * Billing Details — business info step (32546:96135)
 */
(function () {
  'use strict';

  function bindForm(form) {
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      window.location.href = '/billing-details/card/';
    });
  }

  function init() {
    bindForm(document.getElementById('billing-details-form'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
