/*
 * Shared payment method storage - Settings, billing-details/card
 * Global: window.TMAPaymentMethods
 *
 * Production never seeds sample cards. Empty until the user adds a method
 * (or a real billing API hydrates the store).
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'tma.payment.methods';
  var DEFAULT_PAYMENT_METHODS = [];

  function storeGet(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function storeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  }

  function isDemoPaymentMethod(m) {
    if (!m) return true;
    var name = String(m.name || '').toLowerCase();
    var email = String(m.email || '').toLowerCase();
    if (name === 'byewind' || email.indexOf('byewind') !== -1) return true;
    if (m.id === 'visa-1' || m.id === 'mc-1' || m.id === 'paypal-1') return true;
    return false;
  }

  function detectCardType(digits) {
    if (digits.charAt(0) === '5') return 'mastercard';
    return 'visa';
  }

  function splitCardGroups(digits) {
    var groups = [];
    var i;
    for (i = 0; i < digits.length && groups.length < 4; i += 4) {
      groups.push(digits.slice(i, i + 4));
    }
    while (groups.length < 4) groups.push('0000');
    return groups;
  }

  function readPaymentMethods() {
    try {
      var raw = storeGet(STORAGE_KEY, '');
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      var cleaned = parsed.filter(function (m) { return !isDemoPaymentMethod(m); });
      if (cleaned.length !== parsed.length) {
        writePaymentMethods(cleaned);
      }
      return cleaned;
    } catch (e) {
      return [];
    }
  }

  function writePaymentMethods(methods) {
    storeSet(STORAGE_KEY, JSON.stringify(methods || []));
  }

  function addCardMethod(opts) {
    var methods = readPaymentMethods();
    var makeDefault = !!opts.makeDefault || methods.length === 0;
    if (makeDefault) {
      methods.forEach(function (m) { m.isDefault = false; });
    }
    methods.push({
      id: 'pm-' + Date.now(),
      type: opts.type || detectCardType(opts.digits || ''),
      name: opts.nameOnCard,
      groups: splitCardGroups(opts.digits || ''),
      expiry: 'Exp ' + opts.expMonth + '/' + String(opts.expYear).slice(-2),
      isDefault: makeDefault,
    });
    writePaymentMethods(methods);
    return methods;
  }

  function addPayPalMethod(opts) {
    var methods = readPaymentMethods();
    var makeDefault = !!opts.makeDefault || methods.length === 0;
    if (makeDefault) {
      methods.forEach(function (m) { m.isDefault = false; });
    }
    methods.push({
      id: 'pm-' + Date.now(),
      type: 'paypal',
      name: 'PayPal',
      email: opts.email,
      isDefault: makeDefault,
    });
    writePaymentMethods(methods);
    return methods;
  }

  function setDefaultPaymentMethod(id) {
    var methods = readPaymentMethods();
    methods.forEach(function (m) {
      m.isDefault = m.id === id;
    });
    writePaymentMethods(methods);
    return methods;
  }

  function removePaymentMethod(id) {
    var methods = readPaymentMethods().filter(function (m) { return m.id !== id; });
    if (methods.length && !methods.some(function (m) { return m.isDefault; })) {
      methods[0].isDefault = true;
    }
    writePaymentMethods(methods);
    return methods;
  }

  // Drop any previously cached ByeWind sample cards on load.
  try { readPaymentMethods(); } catch (e) {}

  window.TMAPaymentMethods = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_PAYMENT_METHODS: DEFAULT_PAYMENT_METHODS,
    readPaymentMethods: readPaymentMethods,
    writePaymentMethods: writePaymentMethods,
    addCardMethod: addCardMethod,
    addPayPalMethod: addPayPalMethod,
    setDefaultPaymentMethod: setDefaultPaymentMethod,
    removePaymentMethod: removePaymentMethod,
  };
})();
