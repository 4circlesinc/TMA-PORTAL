/*
 * Shared payment method storage — Settings, billing-details/card
 * Global: window.TMAPaymentMethods
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'tma.payment.methods';

  var DEFAULT_PAYMENT_METHODS = [
    { id: 'visa-1', type: 'visa', name: 'ByeWind', groups: ['9656', '6598', '1236', '4698'], expiry: 'Exp 06/25', isDefault: true },
    { id: 'mc-1', type: 'mastercard', name: 'ByeWind', groups: ['1235', '6321', '1343', '7542'], expiry: 'Exp 06/25', isDefault: false },
    { id: 'paypal-1', type: 'paypal', name: 'PayPal', email: 'byewind@twitter.com', isDefault: false },
  ];

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
      if (!raw) return DEFAULT_PAYMENT_METHODS.map(function (m) { return Object.assign({}, m); });
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PAYMENT_METHODS.map(function (m) { return Object.assign({}, m); });
    } catch (e) {
      return DEFAULT_PAYMENT_METHODS.map(function (m) { return Object.assign({}, m); });
    }
  }

  function writePaymentMethods(methods) {
    storeSet(STORAGE_KEY, JSON.stringify(methods));
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

  window.TMAPaymentMethods = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_PAYMENT_METHODS: DEFAULT_PAYMENT_METHODS,
    readPaymentMethods: readPaymentMethods,
    writePaymentMethods: writePaymentMethods,
    addCardMethod: addCardMethod,
    addPayPalMethod: addPayPalMethod,
    setDefaultPaymentMethod: setDefaultPaymentMethod,
    removePaymentMethod: removePaymentMethod,
    detectCardType: detectCardType,
    splitCardGroups: splitCardGroups,
  };
})();
