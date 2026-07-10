/*
 * TMA — Email templates
 * Global: window.TMAEmailTemplates
 * Figma: Email template page 12780:88498
 */
(function () {
  'use strict';

  var BRAND = '/TMA-PORTAL/images/brand/tma/';
  var ICON = '/TMA-PORTAL/images/icons/brands/';
  var PHOSPHOR = '/TMA-PORTAL/images/icons/phosphor/';
  var SITE_NAME = 'TM ANTOINE Advisory';
  var AUTH_LINK = 'https://portal.tmantoine.com/';
  var SUPPORT_EMAIL = 'byewind@live.com';
  var MOBILE_ADDRESS = '+852 19850622, One Apple Park Way, Cupertino, CA 95014';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderAuthMark() {
    return '<img class="tma-dash__email-template-auth-mark" src="' + BRAND + 'tma-logo-mark.png" alt="' + esc(SITE_NAME) + '" width="80" height="80">';
  }

  function renderAuthFooterBrand() {
    return (
      '<div class="tma-dash__email-template-auth-footer-brand">' +
      '<img class="tma-dash__email-template-auth-footer-logo" src="' + BRAND + 'tma-logo-horizontal.png" alt="' + esc(SITE_NAME) + '" height="20"></div>'
    );
  }

  function renderAuthContact() {
    return (
      '<div class="tma-dash__email-template-auth-contact">' +
      '<div class="tma-dash__email-template-auth-contact-col">' +
      '<p>+852 19850622</p><p>byewind@twitter.com</p><p>portal.tmantoine.com</p></div>' +
      '<div class="tma-dash__email-template-auth-contact-col">' +
      '<p>One Apple Park Way</p><p>Cupertino, CA 95014</p></div></div>'
    );
  }

  function renderAuthLegal() {
    return (
      '<div class="tma-dash__email-template-auth-legal">' +
      '<span>© 2026 ' + esc(SITE_NAME) + '</span>' +
      '<a class="tma-dash__email-template-auth-link tma-dash__email-template-auth-link--muted" href="' + esc(AUTH_LINK) + '">Unsubscribe</a></div>'
    );
  }

  function renderAuthHelp() {
    return (
      '<div class="tma-dash__email-template-auth-help">' +
      '<p>If you have any trouble with the button, you can copy and paste the link below into your browser:</p>' +
      '<p><a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">' + esc(AUTH_LINK) + '</a></p></div>'
    );
  }

  function renderAuthButton(label, href) {
    var url = href || AUTH_LINK;
    return '<a class="tma-dash__email-template-auth-btn" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>';
  }

  function renderAuthCode(code) {
    return '<div class="tma-dash__email-template-auth-code" aria-label="Verification code">' + esc(code) + '</div>';
  }

  function renderAuthHeading(title, lead) {
    return (
      '<div class="tma-dash__email-template-auth-heading">' +
      '<h2 class="tma-dash__email-template-auth-title">' + esc(title) + '</h2>' +
      (lead ? '<p class="tma-dash__email-template-auth-lead">' + esc(lead) + '</p>' : '') +
      '</div>'
    );
  }

  function renderAuthShell(nodeId, mainHtml) {
    return (
      '<div class="tma-dash__email-template-canvas tma-dash__email-template-canvas--auth tma-dash__email-template-canvas--auth-light" data-node-id="' + esc(nodeId) + '">' +
      '<div class="tma-dash__email-template-auth-shell">' +
      '<div class="tma-dash__email-template-auth-card">' +
      '<div class="tma-dash__email-template-auth-main">' + mainHtml + '</div>' +
      '<div class="tma-dash__email-template-auth-footer">' +
      renderAuthFooterBrand() + renderAuthContact() + '</div></div>' +
      renderAuthLegal() + '</div></div>'
    );
  }

  function renderMobileChrome(title, opts) {
    var o = opts || {};
    var left = o.close
      ? '<span class="tma-dash__email-template-mobile-chrome-spacer" aria-hidden="true"></span>'
      : '<button type="button" class="tma-dash__email-template-mobile-chrome-btn" aria-label="Back">' +
        '<img src="' + PHOSPHOR + 'CaretLeft.svg" alt="" width="24" height="24"></button>';
    var right = o.close
      ? '<button type="button" class="tma-dash__email-template-mobile-chrome-btn tma-dash__email-template-mobile-chrome-btn--text" aria-label="Close">Close</button>'
      : '<button type="button" class="tma-dash__email-template-mobile-chrome-btn" aria-label="More">' +
        '<img src="' + PHOSPHOR + 'DotsThree.svg" alt="" width="24" height="24"></button>';
    return (
      '<header class="tma-dash__email-template-mobile-chrome">' + left +
      '<h1 class="tma-dash__email-template-mobile-chrome-title">' + esc(title) + '</h1>' + right +
      '</header>'
    );
  }

  function renderMobileFooter() {
    return (
      '<footer class="tma-dash__email-template-mobile-foot">' +
      '<div class="tma-dash__email-template-mobile-foot-brand">' +
      '<img src="' + BRAND + 'tma-logo-mark.png" alt="" width="20" height="20">' +
      '<span>' + esc(SITE_NAME) + '</span></div>' +
      '<p class="tma-dash__email-template-mobile-foot-address">' + esc(MOBILE_ADDRESS) + '</p>' +
      '<p class="tma-dash__email-template-mobile-foot-note">You have received this email from ' + esc(SITE_NAME) + '. Thank you.</p>' +
      '</footer>'
    );
  }

  function renderMobileShell(nodeId, mainHtml, chromeOpts) {
    var o = chromeOpts || {};
    return (
      '<div class="tma-dash__email-template-canvas tma-dash__email-template-canvas--mobile" data-node-id="' + esc(nodeId) + '">' +
      '<div class="tma-dash__email-template-mobile-device">' +
      renderMobileChrome(o.title || 'Email', o) +
      '<div class="tma-dash__email-template-mobile-scroll">' + mainHtml +
      (o.hideFooter ? '' : renderMobileFooter()) + '</div></div></div>'
    );
  }

  function renderMobileMain(mainHtml) {
    return '<div class="tma-dash__email-template-mobile-main">' + mainHtml + '</div>';
  }

  function renderAuthVerifyHelp() {
    return (
      '<div class="tma-dash__email-template-auth-help">' +
      '<p>Please click the button to open the link or fill in the verification code in the page.</p>' +
      '<p>If you have any trouble with the button, you can copy and paste the link below into your browser:</p>' +
      '<p><a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">' + esc(AUTH_LINK) + '</a></p></div>'
    );
  }

  function renderAuthSignIn() {
    return renderAuthShell('32534:3772',
      renderAuthMark() +
      renderAuthHeading('Welcome to ' + SITE_NAME, 'Click the button below to sign in.') +
      '<div class="tma-dash__email-template-auth-actions">' + renderAuthButton('Sign in') + '</div>' +
      renderAuthHelp()
    );
  }

  function renderAuthSignInMobile() {
    return renderMobileShell('32534:3782', renderMobileMain(
      renderAuthMark() +
      renderAuthHeading('Welcome to ' + SITE_NAME, 'Click the button below to sign in to ' + SITE_NAME + '.') +
      '<div class="tma-dash__email-template-auth-actions">' + renderAuthButton('Sign in to ' + SITE_NAME) + '</div>' +
      renderAuthHelp()
    ));
  }

  function renderAuthVerifyEmail() {
    return renderAuthShell('32534:3776',
      renderAuthMark() +
      renderAuthHeading('Verify email address', 'Your verification code is:') +
      '<div class="tma-dash__email-template-auth-actions">' +
      renderAuthCode('1234') + renderAuthButton('Verify email address') + '</div>' +
      renderAuthVerifyHelp()
    );
  }

  function renderAuthVerifyEmailMobile() {
    return renderMobileShell('32534:3784', renderMobileMain(
      renderAuthMark() +
      renderAuthHeading('Verify email address', 'Your verification code is:') +
      '<div class="tma-dash__email-template-auth-actions">' +
      renderAuthCode('1234') + renderAuthButton('Verify email address') + '</div>' +
      renderAuthVerifyHelp()
    ));
  }

  function renderAuthChangeEmail() {
    return renderAuthShell('32534:3794',
      renderAuthMark() +
      renderAuthHeading('Change email verification', 'Your verification code is:') +
      '<div class="tma-dash__email-template-auth-actions">' +
      renderAuthCode('1234') + renderAuthButton('Verify email address') + '</div>' +
      renderAuthVerifyHelp()
    );
  }

  function renderAuthChangeEmailMobile() {
    return renderMobileShell('32534:3786', renderMobileMain(
      renderAuthMark() +
      renderAuthHeading('Change email verification', 'Your verification code is:') +
      '<div class="tma-dash__email-template-auth-actions">' +
      renderAuthCode('1234') + renderAuthButton('Verify email address') + '</div>' +
      renderAuthVerifyHelp()
    ));
  }

  function renderAuthResetPassword() {
    return renderAuthShell('32534:3778',
      renderAuthMark() +
      renderAuthHeading('Set a new password', 'You are in the process of setting a new password, click the button below to continue.') +
      '<div class="tma-dash__email-template-auth-actions">' + renderAuthButton('Set a new password') + '</div>' +
      renderAuthHelp()
    );
  }

  function renderAuthResetPasswordMobile() {
    return renderMobileShell('32534:3788', renderMobileMain(
      renderAuthMark() +
      renderAuthHeading('Set a new password', 'You are in the process of setting a new password, click the button below to continue.') +
      '<div class="tma-dash__email-template-auth-actions">' + renderAuthButton('Set a new password') + '</div>' +
      renderAuthHelp()
    ));
  }

  function renderAuthWelcome() {
    return renderAuthShell('32534:3774',
      renderAuthMark() +
      renderAuthHeading('Welcome to ' + SITE_NAME) +
      '<div class="tma-dash__email-template-auth-body-copy">' +
      '<p>Hey ByeWind,</p>' +
      '<p>We\u2019re so excited to welcome you to the <a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">' + esc(SITE_NAME) + '</a> community.</p>' +
      '<p>Here\u2019s your sign in address in case you forget:</p>' +
      '<p>Sign in: <a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">' + esc(AUTH_LINK) + '</a></p>' +
      '<p>If you need any help getting started reach out to us at <a class="tma-dash__email-template-auth-link" href="mailto:' + esc(SUPPORT_EMAIL) + '"><strong>' + esc(SUPPORT_EMAIL) + '</strong></a>.</p>' +
      '<p>Enjoy :)</p><p>ByeWind</p></div>'
    );
  }

  function renderAuthWelcomeMobile() {
    return renderMobileShell('32534:3790', renderMobileMain(
      renderAuthMark() +
      renderAuthHeading('Welcome to ' + SITE_NAME) +
      '<div class="tma-dash__email-template-auth-body-copy">' +
      '<p>Hi there,</p>' +
      '<p>We\u2019re so excited to welcome you to the <a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">' + esc(SITE_NAME) + '</a> community.</p>' +
      '<p>Here\u2019s your sign-in address in case you forget:</p>' +
      '<p>Sign-in: <a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">' + esc(AUTH_LINK) + '</a></p>' +
      '<p>If you need any help getting started reach out to us at: <a class="tma-dash__email-template-auth-link" href="mailto:' + esc(SUPPORT_EMAIL) + '">' + esc(SUPPORT_EMAIL) + '</a>.</p>' +
      '<p>Enjoy!</p><p>' + esc(SITE_NAME) + '</p></div>'
    ));
  }

  function renderAuthUnsubscribed() {
    return renderAuthShell('32534:3770',
      '<div class="tma-dash__email-template-auth-unsub">' +
      '<div class="tma-dash__email-template-auth-unsub-icon" aria-hidden="true">' +
      '<img src="' + PHOSPHOR + 'CheckCircle.svg" alt="" width="80" height="80"></div>' +
      renderAuthHeading('Unsubscribed', 'You have unsubscribed from all marketing emails.') +
      '<p class="tma-dash__email-template-auth-unsub-action">Unsubscribed by accident? <a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">Resubscribe</a></p>' +
      '<p class="tma-dash__email-template-auth-unsub-settings">Want these emails sent again? <a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">Edit settings</a></p></div>'
    );
  }

  function renderAuthUnsubscribedMobile() {
    return renderMobileShell('32534:3792',
      '<div class="tma-dash__email-template-mobile-unsub">' +
      '<div class="tma-dash__email-template-mobile-unsub-icon" aria-hidden="true">' +
      '<img src="' + PHOSPHOR + 'CheckCircle.svg" alt="" width="80" height="80"></div>' +
      '<h2 class="tma-dash__email-template-mobile-unsub-title">Unsubscribed</h2>' +
      '<p class="tma-dash__email-template-mobile-unsub-lead">You have unsubscribed from all marketing emails.</p>' +
      '<p class="tma-dash__email-template-mobile-unsub-action">Unsubscribed by accident? <a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">Resubscribe</a></p>' +
      '<p class="tma-dash__email-template-mobile-unsub-settings">Want these emails sent again? <a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">Edit settings</a></p></div>',
      { title: 'Unsubscribed', close: true, hideFooter: true }
    );
  }

  function renderInvoiceTemplate() {
    var LINE_ITEMS = [
      { product: 'ASOS Ridley High Waist', sku: 'Black/28', price: '$79.49', qty: '1', amount: '$79.49' },
      { product: 'Marco Lightweight Shirt', sku: 'White/32', price: '$128.50', qty: '1', amount: '$128.50' },
      { product: 'Half Sleeve  Shirt', sku: 'White/29', price: '$39.99', qty: '1', amount: '$39.99' },
      { product: 'Lightweight Jacket', sku: 'Black/30', price: '$20.00', qty: '1', amount: '$20.00' },
      { product: 'Marco Shoes', sku: 'Black/29', price: '$28.49', qty: '1', amount: '$28.49' },
    ];

    function renderBrandHeader() {
      return (
        '<div class="tma-dash__email-template-invoice-brand">' +
        '<img class="tma-dash__email-template-invoice-brand-mark" src="' + BRAND + 'tma-logo-mark.png" alt="" width="48" height="48">' +
        '<div class="tma-dash__email-template-invoice-brand-text">' +
        '<p class="tma-dash__email-template-invoice-brand-name">TM ANTOINE Advisory</p>' +
        '<p class="tma-dash__email-template-invoice-brand-type">Invoice</p></div></div>'
      );
    }

    function renderBrandFooter() {
      return (
        '<div class="tma-dash__email-template-invoice-brand tma-dash__email-template-invoice-brand--footer">' +
        '<img class="tma-dash__email-template-invoice-brand-wordmark" src="' + BRAND + 'tma-logo-horizontal.png" alt="TM ANTOINE Advisory" height="20"></div>'
      );
    }

    function renderSummaryField(label, valueHtml) {
      return (
        '<div class="tma-dash__email-template-invoice-summary-field">' +
        '<p class="tma-dash__email-template-invoice-summary-label">' + esc(label) + '</p>' +
        '<div class="tma-dash__email-template-invoice-summary-value">' + valueHtml + '</div></div>'
      );
    }

    function renderTableColumn(key, header, rows, cellClass) {
      var cls = 'tma-dash__email-template-invoice-col' + (cellClass ? ' ' + cellClass : '');
      return (
        '<div class="' + cls + '">' +
        '<div class="tma-dash__email-template-invoice-cell tma-dash__email-template-invoice-cell--head">' + esc(header) + '</div>' +
        rows.map(function (row) {
          return '<div class="tma-dash__email-template-invoice-cell">' + esc(row[key]) + '</div>';
        }).join('') + '</div>'
      );
    }

    var paymentValue =
      '<span class="tma-dash__email-template-invoice-payment">' +
      '<img src="' + ICON + 'PayPal40.svg" alt="" width="20" height="20">' +
      '<span>byewind@twitter.com</span></span>';

    return (
      '<div class="tma-dash__email-template-canvas tma-dash__email-template-canvas--invoice" data-node-id="32546:96133">' +
      '<div class="tma-dash__email-template-invoice-block">' +
      '<div class="tma-dash__email-template-invoice-head">' + renderBrandHeader() +
      '<div class="tma-dash__email-template-invoice-meta">' +
      '<p><span class="tma-dash__email-template-invoice-meta-label">Invoice ID:</span> #VL25000355</p>' +
      '<p><span class="tma-dash__email-template-invoice-meta-label">Date:</span> Feb 2, 2026, 8:00 AM</p></div></div>' +
      '<div class="tma-dash__email-template-invoice-summary">' +
      renderSummaryField('Invoice to', '<p>ByeWind</p>') +
      '<div class="tma-dash__email-template-invoice-summary-divider" aria-hidden="true"></div>' +
      renderSummaryField('Payment Method', paymentValue) +
      '<div class="tma-dash__email-template-invoice-summary-divider" aria-hidden="true"></div>' +
      renderSummaryField('Total Due', '<p>$340.94</p>') + '</div>' +
      '<div class="tma-dash__email-template-invoice-table">' +
      '<div class="tma-dash__email-template-invoice-table-grid">' +
      renderTableColumn('product', 'Products', LINE_ITEMS, 'tma-dash__email-template-invoice-col--product') +
      renderTableColumn('sku', 'SKU', LINE_ITEMS) +
      renderTableColumn('price', 'Price', LINE_ITEMS) +
      renderTableColumn('qty', 'Quantity', LINE_ITEMS) +
      renderTableColumn('amount', 'Amount', LINE_ITEMS) + '</div>' +
      '<div class="tma-dash__email-template-invoice-totals">' +
      '<div class="tma-dash__email-template-invoice-totals-labels"><p>Subtotal</p><p>Tax: Vat(15%)</p></div>' +
      '<div class="tma-dash__email-template-invoice-totals-values"><p>$296.47</p><p>$44.47</p></div></div>' +
      '<div class="tma-dash__email-template-invoice-grand-total">' +
      '<p class="tma-dash__email-template-invoice-grand-total-label">Total Due</p>' +
      '<p class="tma-dash__email-template-invoice-grand-total-value">$340.94</p></div></div>' +
      '<div class="tma-dash__email-template-invoice-foot">' + renderBrandFooter() +
      '<div class="tma-dash__email-template-invoice-contact">' +
      '<div class="tma-dash__email-template-invoice-contact-col"><p>+852 19850622</p><p>byewind@twitter.com</p><p>advisory.tmantoine.com</p></div>' +
      '<div class="tma-dash__email-template-invoice-contact-col"><p>One Apple Park Way</p><p>Cupertino, CA 95014</p></div></div></div></div></div>'
    );
  }

  var TEMPLATES = [
    {
      id: 'auth-sign-in',
      name: 'Email Sign In',
      category: 'Authentication',
      subject: 'Sign in to ' + SITE_NAME,
      preview: 'Welcome — click to sign in.',
      thumb: 'auth',
      nodeId: '32534:3772',
      mobileNodeId: '32534:3782',
      render: renderAuthSignIn,
      renderMobile: renderAuthSignInMobile,
    },
    {
      id: 'auth-verify-email',
      name: 'Verify email address',
      category: 'Authentication',
      subject: 'Verify your email address',
      preview: 'Your verification code is 1234.',
      thumb: 'auth',
      nodeId: '32534:3776',
      mobileNodeId: '32534:3784',
      render: renderAuthVerifyEmail,
      renderMobile: renderAuthVerifyEmailMobile,
    },
    {
      id: 'auth-change-email',
      name: 'Change email verification',
      category: 'Authentication',
      subject: 'Verify your new email address',
      preview: 'Confirm your email change with code 1234.',
      thumb: 'auth',
      nodeId: '32534:3794',
      mobileNodeId: '32534:3786',
      render: renderAuthChangeEmail,
      renderMobile: renderAuthChangeEmailMobile,
    },
    {
      id: 'auth-reset-password',
      name: 'Set a new password',
      category: 'Authentication',
      subject: 'Set a new password',
      preview: 'Reset your password with the secure link.',
      thumb: 'auth',
      nodeId: '32534:3778',
      mobileNodeId: '32534:3788',
      render: renderAuthResetPassword,
      renderMobile: renderAuthResetPasswordMobile,
    },
    {
      id: 'auth-welcome',
      name: 'Successful sign up',
      category: 'Authentication',
      subject: 'Welcome to ' + SITE_NAME,
      preview: 'Hey ByeWind, welcome to the community.',
      thumb: 'auth',
      nodeId: '32534:3774',
      mobileNodeId: '32534:3790',
      render: renderAuthWelcome,
      renderMobile: renderAuthWelcomeMobile,
    },
    {
      id: 'auth-unsubscribed',
      name: 'Unsubscribed',
      category: 'Unsubscribe',
      subject: 'You have been unsubscribed',
      preview: 'You have unsubscribed from all marketing emails.',
      thumb: 'auth',
      nodeId: '32534:3770',
      mobileNodeId: '32534:3792',
      render: renderAuthUnsubscribed,
      renderMobile: renderAuthUnsubscribedMobile,
    },
    {
      id: 'invoice',
      name: 'Invoice',
      category: 'Transactional',
      subject: 'Invoice #VL25000355 — TM ANTOINE Advisory',
      preview: 'Your invoice from TM ANTOINE Advisory. Total due: $340.94',
      thumb: 'invoice',
      nodeId: '32546:96133',
      render: renderInvoiceTemplate,
    },
  ];

  function findTemplate(id) {
    for (var i = 0; i < TEMPLATES.length; i++) {
      if (TEMPLATES[i].id === id) return TEMPLATES[i];
    }
    return TEMPLATES[0];
  }

  window.TMAEmailTemplates = {
    list: function () {
      return TEMPLATES.map(function (t) {
        return {
          id: t.id,
          name: t.name,
          category: t.category,
          subject: t.subject,
          preview: t.preview,
          thumb: t.thumb,
          nodeId: t.nodeId,
          mobileNodeId: t.mobileNodeId || null,
          hasMobile: !!t.renderMobile,
        };
      });
    },
    get: function (id) {
      return findTemplate(id);
    },
    renderBody: function (id, opts) {
      opts = opts || {};
      var template = findTemplate(id);
      if (opts.viewport === 'mobile' && template.renderMobile) {
        return template.renderMobile();
      }
      return template.render();
    },
    hasMobile: function (id) {
      var template = findTemplate(id);
      return !!(template && template.renderMobile);
    },
  };
})();
