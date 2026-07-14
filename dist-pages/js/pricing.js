/*
 * TMA - Pricing page ( /pricing ) - Figma 32546:96132
 * Global: window.TMAPricing
 */
(function () {
  'use strict';

  var ICON = '/TMA-PORTAL/images/icons/phosphor/';

  var ICONS = {
    Check: ICON + 'Check.svg',
  };

  var SHARED_FEATURES = [
    'Component properties',
    'Interactive components',
    'Light & Dark theme',
    '30+ Page examples',
    'Lifetime Updates',
  ];

  var PLANS = [
    {
      id: 'pro',
      name: 'PRO version',
      monthly: 9.9,
      yearly: 99,
      current: true,
      license: 'Single user license',
    },
    {
      id: 'team',
      name: 'PRO TEAM version',
      monthly: 19.9,
      yearly: 199,
      license: 'Up to 6 users license',
    },
    {
      id: 'enterprise',
      name: 'PRO ENTERPRISE version',
      monthly: 29.9,
      yearly: 299,
      license: 'Unlimited user license',
    },
  ];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function formatPrice(value) {
    return '$' + (Number(value) % 1 === 0 ? value.toFixed(0) : value.toFixed(1));
  }

  function renderBillingToggle(billing) {
    return (
      '<div class="tma-tab-group tma-tab-group--segmented tma-dash__pricing-billing" role="group" aria-label="Billing period">' +
      '<button type="button" class="tma-tab' + (billing === 'monthly' ? ' is-active' : '') + '" data-pricing-billing="monthly">' +
      '<span class="tma-tab__label">Monthly</span><span class="tma-tab__indicator" aria-hidden="true"></span></button>' +
      '<button type="button" class="tma-tab' + (billing === 'yearly' ? ' is-active' : '') + '" data-pricing-billing="yearly">' +
      '<span class="tma-tab__label">Yearly</span><span class="tma-tab__indicator" aria-hidden="true"></span></button>' +
      '</div>'
    );
  }

  function renderHero(billing) {
    return (
      '<section class="tma-dash__pricing-hero" data-node-id="32546:96132">' +
      '<div class="tma-dash__pricing-hero-bg" aria-hidden="true"></div>' +
      '<div class="tma-dash__pricing-hero-content">' +
      '<div class="tma-dash__pricing-hero-copy">' +
      '<h1 class="tma-dash__pricing-hero-title">Choose Your Plan</h1>' +
      '<p class="tma-dash__pricing-hero-subtitle">Simple pricing. No hidden fees. Advanced features for you business.</p>' +
      '</div>' +
      renderBillingToggle(billing) +
      '</div></section>'
    );
  }

  function renderFeature(label) {
    return (
      '<li class="tma-dash__pricing-feature">' +
      '<img src="' + ICONS.Check + '" alt="" class="tma-dash__pricing-feature-icon" width="24" height="24">' +
      '<span class="tma-dash__pricing-feature-label">' + esc(label) + '</span></li>'
    );
  }

  function renderPlanCard(plan, billing) {
    var price = billing === 'yearly' ? plan.yearly : plan.monthly;
    var unit = billing === 'yearly' ? '/year' : '/month';
    var features = [plan.license].concat(SHARED_FEATURES);
    var buttonClass = 'tma-dash__pricing-card-btn';
    var buttonLabel = 'Choose Plan';

    if (plan.current) {
      buttonClass += ' tma-dash__pricing-card-btn--current';
      buttonLabel = 'Your current plan';
    }

    return (
      '<article class="tma-dash__pricing-card" data-pricing-plan="' + esc(plan.id) + '">' +
      '<h2 class="tma-dash__pricing-card-name">' + esc(plan.name) + '</h2>' +
      '<div class="tma-dash__pricing-card-price">' +
      '<span class="tma-dash__pricing-card-amount">' + esc(formatPrice(price)) + '</span>' +
      '<span class="tma-dash__pricing-card-unit">' + esc(unit) + '</span>' +
      '</div>' +
      '<button type="button" class="' + buttonClass + '"' + (plan.current ? ' disabled' : '') + '>' + esc(buttonLabel) + '</button>' +
      '<ul class="tma-dash__pricing-features" role="list">' + features.map(renderFeature).join('') + '</ul>' +
      '</article>'
    );
  }

  function renderPlans(billing) {
    return (
      '<section class="tma-dash__pricing-cards">' +
      PLANS.map(function (plan) { return renderPlanCard(plan, billing); }).join('') +
      '</section>'
    );
  }

  function renderPage(billing) {
    return (
      '<div class="tma-dash__pricing-page">' +
      renderHero(billing) +
      renderPlans(billing) +
      '</div>'
    );
  }

  function wireEvents(root, state, render) {
    root.querySelectorAll('[data-pricing-billing]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.billing = btn.getAttribute('data-pricing-billing');
        render();
      });
    });
  }

  function mount(root) {
    var state = { billing: 'monthly' };

    function render() {
      root.innerHTML = renderPage(state.billing);
      wireEvents(root, state, render);
    }

    render();
  }

  window.TMAPricing = { mount: mount };
})();
