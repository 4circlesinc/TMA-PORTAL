/*
 * TMA - Email templates
 * Global: window.TMAEmailTemplates
 * Figma: Email template page 12780:88498
 */
(function () {
  'use strict';

  var BRAND = 'images/brand/tma/';
  var ICON = 'images/icons/brands/';
  var PHOSPHOR = 'images/icons/phosphor/';
  var SITE_NAME = 'TM ANTOINE Advisory';
  var AUTH_LINK = 'https://portal.tmantoine.com/';
  var SUPPORT_EMAIL = 'support@tmantoine.com';
  var SOCIALS = [
    { name: 'Facebook', href: 'https://www.facebook.com/tmantoinepartners', icon: 'Facebook40.svg' },
    { name: 'Instagram', href: 'https://www.instagram.com/tmapartners/', icon: 'Instagram40.svg' },
  ];

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

  function renderSocials() {
    return (
      '<span class="tma-dash__email-template-auth-socials">' +
      SOCIALS.map(function (s) {
        return '<a class="tma-dash__email-template-auth-social" href="' + esc(s.href) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(s.name) + '">' +
          '<img src="' + ICON + s.icon + '" alt="' + esc(s.name) + '" width="18" height="18"></a>';
      }).join('') + '</span>'
    );
  }

  // One line: a single contact email and the social icons.
  function renderAuthContact() {
    return (
      '<div class="tma-dash__email-template-auth-contact">' +
      '<a class="tma-dash__email-template-auth-link" href="mailto:' + esc(SUPPORT_EMAIL) + '">' + esc(SUPPORT_EMAIL) + '</a>' +
      renderSocials() + '</div>'
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
      '<p>Trouble with the button? Copy and paste this link into your browser: ' +
      '<a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">' + esc(AUTH_LINK) + '</a></p></div>'
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

  function renderAuthVerifyHelp() {
    return (
      '<div class="tma-dash__email-template-auth-help">' +
      '<p>Click the button to open the link, or enter the verification code on the page.</p>' +
      '<p>Trouble with the button? Copy and paste this link into your browser: ' +
      '<a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">' + esc(AUTH_LINK) + '</a></p></div>'
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

  function renderAuthVerifyEmail() {
    return renderAuthShell('32534:3776',
      renderAuthMark() +
      renderAuthHeading('Verify email address', 'Your verification code is:') +
      '<div class="tma-dash__email-template-auth-actions">' +
      renderAuthCode('1234') + renderAuthButton('Verify email address') + '</div>' +
      renderAuthVerifyHelp()
    );
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

  function renderAuthResetPassword() {
    return renderAuthShell('32534:3778',
      renderAuthMark() +
      renderAuthHeading('Set a new password', 'You are in the process of setting a new password, click the button below to continue.') +
      '<div class="tma-dash__email-template-auth-actions">' + renderAuthButton('Set a new password') + '</div>' +
      renderAuthHelp()
    );
  }

  function renderAuthWelcome() {
    return renderAuthShell('32534:3774',
      renderAuthMark() +
      renderAuthHeading('Welcome to ' + SITE_NAME) +
      '<div class="tma-dash__email-template-auth-body-copy">' +
      '<p>Hello,</p>' +
      '<p>We\u2019re so excited to welcome you to the <a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">' + esc(SITE_NAME) + '</a> community.</p>' +
      '<p>Here\u2019s your sign in address in case you forget:</p>' +
      '<p>Sign in: <a class="tma-dash__email-template-auth-link" href="' + esc(AUTH_LINK) + '">' + esc(AUTH_LINK) + '</a></p>' +
      '<p>If you need any help getting started reach out to us at <a class="tma-dash__email-template-auth-link" href="mailto:' + esc(SUPPORT_EMAIL) + '"><strong>' + esc(SUPPORT_EMAIL) + '</strong></a>.</p>' +
      '<p>Enjoy :)</p><p>TM ANTOINE Advisory</p></div>'
    );
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
      '<span>support@tmantoine.com</span></span>';

    return (
      '<div class="tma-dash__email-template-canvas tma-dash__email-template-canvas--invoice" data-node-id="32546:96133">' +
      '<div class="tma-dash__email-template-invoice-block">' +
      '<div class="tma-dash__email-template-invoice-head">' + renderBrandHeader() +
      '<div class="tma-dash__email-template-invoice-meta">' +
      '<p><span class="tma-dash__email-template-invoice-meta-label">Invoice ID:</span> #VL25000355</p>' +
      '<p><span class="tma-dash__email-template-invoice-meta-label">Date:</span> Feb 2, 2026, 8:00 AM</p></div></div>' +
      '<div class="tma-dash__email-template-invoice-summary">' +
      renderSummaryField('Invoice to', '<p>TM ANTOINE Advisory</p>') +
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
      '<div class="tma-dash__email-template-invoice-contact-col"><p>support@tmantoine.com</p><p>portal.tmantoine.com</p></div></div></div></div></div>'
    );
  }

  // ---- Reusable builders for the additional postcards ---------------------
  // Every new email is composed only from the existing auth-card components
  // (mark, heading, body copy, button, help) so it matches the approved design.

  function renderAuthBody(html) {
    return '<div class="tma-dash__email-template-auth-body-copy">' + html + '</div>';
  }

  function renderAuthActions(inner) {
    return '<div class="tma-dash__email-template-auth-actions">' + inner + '</div>';
  }

  // A small "detail" line list (When / Device / Location…) rendered as body copy.
  function renderDetailLines(rows) {
    return rows.map(function (r) {
      return '<p><strong>' + esc(r[0]) + ':</strong> ' + esc(r[1]) + '</p>';
    }).join('');
  }

  // Real file-type icon, via the shared TMAFileIcons map (falls back to a small
  // built-in map so the templates still render if that helper isn't loaded).
  function fileIcon(name) {
    if (window.TMAFileIcons) return window.TMAFileIcons.fileIconSrc('', name);
    var ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1] || '';
    var map = { pdf: 'FilePdf', doc: 'FileDoc', docx: 'FileDoc', xls: 'FileXls', xlsx: 'FileXls', csv: 'FileCsv', ppt: 'FilePpt', pptx: 'FilePpt', png: 'FileImage', jpg: 'FileImage', jpeg: 'FileImage', zip: 'FileZip' };
    return PHOSPHOR + (map[ext] || 'File') + '.svg';
  }

  // A quiet attachment row: file-type icon + a small two-line name/meta. Kept
  // deliberately low-key so it reads as an attachment, not a headline.
  function renderFileLines(files) {
    return (
      '<div class="tma-dash__email-template-files">' +
      files.map(function (f) {
        return '<span class="tma-dash__email-template-file">' +
          '<img class="tma-dash__email-template-file-icon" src="' + esc(fileIcon(f[0])) + '" alt="" width="28" height="28">' +
          '<span class="tma-dash__email-template-file-text">' +
          '<span class="tma-dash__email-template-file-name">' + esc(f[0]) + '</span>' +
          '<span class="tma-dash__email-template-file-meta">' + esc(f[1]) + '</span></span></span>';
      }).join('') + '</div>'
    );
  }

  // A quoted message (what the portal message actually said).
  function renderQuote(text) {
    return '<p><em>“' + esc(text) + '”</em></p>';
  }

  // spec: { title, lead, body(html), button(label) }
  function buildStandardMain(spec) {
    return (
      renderAuthMark() +
      renderAuthHeading(spec.title, spec.lead) +
      (spec.body ? renderAuthBody(spec.body) : '') +
      (spec.button ? renderAuthActions(renderAuthButton(spec.button)) : '') +
      (spec.help === false ? '' : renderAuthHelp())
    );
  }

  function makeStandardTemplate(cfg) {
    var spec = cfg.spec;
    return {
      id: cfg.id,
      name: cfg.name,
      category: cfg.category,
      subject: cfg.subject,
      preview: cfg.preview,
      thumb: 'auth',
      nodeId: cfg.id,
      render: function () { return renderAuthShell(cfg.id, buildStandardMain(spec)); },
    };
  }

  var TEMPLATES = [
    {
      id: 'auth-sign-in',
      name: 'Email Sign In',
      category: 'Authentication',
      subject: 'Sign in to ' + SITE_NAME,
      preview: 'Welcome - click to sign in.',
      thumb: 'auth',
      nodeId: '32534:3772',
      render: renderAuthSignIn,
    },
    {
      id: 'auth-verify-email',
      name: 'Verify email address',
      category: 'Authentication',
      subject: 'Verify your email address',
      preview: 'Your verification code is 1234.',
      thumb: 'auth',
      nodeId: '32534:3776',
      render: renderAuthVerifyEmail,
    },
    {
      id: 'auth-change-email',
      name: 'Change email verification',
      category: 'Authentication',
      subject: 'Verify your new email address',
      preview: 'Confirm your email change with code 1234.',
      thumb: 'auth',
      nodeId: '32534:3794',
      render: renderAuthChangeEmail,
    },
    {
      id: 'auth-reset-password',
      name: 'Set a new password',
      category: 'Authentication',
      subject: 'Set a new password',
      preview: 'Reset your password with the secure link.',
      thumb: 'auth',
      nodeId: '32534:3778',
      render: renderAuthResetPassword,
    },
    {
      id: 'auth-welcome',
      name: 'Successful sign up',
      category: 'Authentication',
      subject: 'Welcome to ' + SITE_NAME,
      preview: 'Hello, welcome to the community.',
      thumb: 'auth',
      nodeId: '32534:3774',
      render: renderAuthWelcome,
    },
    {
      id: 'auth-unsubscribed',
      name: 'Unsubscribed',
      category: 'Unsubscribe',
      subject: 'You have been unsubscribed',
      preview: 'You have unsubscribed from all marketing emails.',
      thumb: 'auth',
      nodeId: '32534:3770',
      render: renderAuthUnsubscribed,
    },
    {
      id: 'invoice',
      name: 'Invoice',
      category: 'Transactional',
      subject: 'Invoice #VL25000355 - TM ANTOINE Advisory',
      preview: 'Your invoice from TM ANTOINE Advisory. Total due: $340.94',
      thumb: 'invoice',
      nodeId: '32546:96133',
      render: renderInvoiceTemplate,
    },
  ];

  // Additional postcards, built from the same components as the auth cards.
  [
    makeStandardTemplate({
      id: 'auth-new-login', name: 'New sign-in alert', category: 'Authentication',
      subject: 'New sign-in to your account', preview: 'A new device just signed in to your account.',
      spec: {
        title: 'New sign-in to your account',
        lead: 'We noticed a sign-in to your account from a new device.',
        body: renderDetailLines([
          ['When', '27 Jul 2026, 2:14 PM'],
          ['Device', 'Safari on iPhone'],
          ['Location', 'Kingston, Jamaica (approx.)'],
        ]) + '<p>If this was you, no action is needed. If you don’t recognise it, secure your account now.</p>',
        button: 'Review activity',
      },
    }),
    makeStandardTemplate({
      id: 'auth-password-changed', name: 'Password changed', category: 'Authentication',
      subject: 'Your password was changed', preview: 'Your account password was just changed.',
      spec: {
        title: 'Your password was changed',
        lead: 'This confirms the password on your account was just changed.',
        body: renderDetailLines([
          ['When', '27 Jul 2026, 2:14 PM'],
          ['Device', 'Chrome on macOS'],
        ]) + '<p>Didn’t make this change? Reset your password right away and contact us at <a class="tma-dash__email-template-auth-link" href="mailto:' + esc(SUPPORT_EMAIL) + '">' + esc(SUPPORT_EMAIL) + '</a>.</p>',
        button: 'Secure my account',
      },
    }),
    makeStandardTemplate({
      id: 'client-invite', name: 'Connect to your files', category: 'Client',
      subject: 'Connect to your files with ' + SITE_NAME, preview: 'Create your account to see the files we’re working on together.',
      spec: {
        title: 'Connect to your files',
        lead: SITE_NAME + ' has set up a secure space for you.',
        body: '<p>Hello,</p>' +
          '<p>Create your account to see the files we’re working on together, message us directly, and follow along as things progress — all in one place.</p>' +
          '<p>Creating your account links it to your existing records with us automatically.</p>',
        button: 'Create your account',
      },
    }),
    makeStandardTemplate({
      id: 'client-invite-reminder', name: 'Invite reminder', category: 'Client',
      subject: 'Reminder: finish connecting to your files', preview: 'Your invitation is still waiting — it takes about a minute.',
      spec: {
        title: 'Your invitation is still waiting',
        lead: 'Setting up your account takes about a minute.',
        body: '<p>Hello,</p>' +
          '<p>A little while ago we invited you to connect to your files with ' + esc(SITE_NAME) + '. Your secure space is ready whenever you are.</p>',
        button: 'Finish setting up',
      },
    }),
    makeStandardTemplate({
      id: 'file-shared', name: 'A file was shared', category: 'Files',
      subject: 'A file has been shared with you', preview: 'A new document is waiting for you in the portal.',
      spec: {
        title: 'A file has been shared with you',
        lead: 'Tanya shared a document to your space.',
        body: renderFileLines([['2025-Financial-Statement.pdf', 'PDF · 2.4 MB']]) +
          '<p>Have a look and let us know if anything needs adjusting.</p>',
        button: 'View the file',
      },
    }),
    makeStandardTemplate({
      id: 'file-chain', name: 'File chain (multiple)', category: 'Files',
      subject: '4 files have been shared with you', preview: 'Four documents were added to your space.',
      spec: {
        title: '4 files have been shared with you',
        lead: 'These documents were added to your 2025 Year-End folder.',
        body: renderFileLines([
          ['2025-Financial-Statement.pdf', 'PDF · 2.4 MB'],
          ['Balance-Sheet-Q4.xlsx', 'Spreadsheet · 88 KB'],
          ['Tax-Summary-2025.pdf', 'PDF · 512 KB'],
          ['Engagement-Letter-Signed.pdf', 'PDF · 240 KB'],
        ]),
        button: 'Open the folder',
      },
    }),
    makeStandardTemplate({
      id: 'file-updated', name: 'File updated', category: 'Files',
      subject: 'A file you’re following was updated', preview: 'A new version of a document you follow is available.',
      spec: {
        title: 'A file you’re following was updated',
        lead: 'A new version is now available.',
        body: renderFileLines([['2025-Financial-Statement.pdf', 'Version 3 · updated by Tanya']]) +
          '<p>Previous versions are still kept, so nothing is lost.</p>',
        button: 'View the latest version',
      },
    }),
    makeStandardTemplate({
      id: 'message-reminder-1', name: 'Unread message (1 hour)', category: 'Reminders',
      subject: 'You have a new message from Tanya', preview: 'Tanya sent you a message an hour ago.',
      spec: {
        title: 'You have a new message',
        lead: 'Tanya sent you a message about an hour ago and it’s still unread.',
        body: renderQuote('Hi Marcus — just checking in on the statement whenever you get a moment.'),
        button: 'Read the message',
      },
    }),
    makeStandardTemplate({
      id: 'message-reminder-2', name: 'Still waiting (~20 hours)', category: 'Reminders',
      subject: 'Still waiting to hear from you', preview: 'Your message from Tanya is still unread.',
      spec: {
        title: 'Still waiting to hear from you',
        lead: 'We reached out yesterday and haven’t heard back.',
        body: '<p>Your message from Tanya is still waiting in the portal.</p>' +
          renderQuote('Hi Marcus — just checking in on the statement whenever you get a moment.'),
        button: 'Read and reply',
      },
    }),
    makeStandardTemplate({
      id: 'message-reminder-3', name: 'Final reminder (24 hours)', category: 'Reminders',
      subject: 'A message from us is still waiting for you', preview: 'One last reminder about your unread message.',
      spec: {
        title: 'A message from us is still waiting for you',
        lead: 'It’s been a full day and we haven’t heard back.',
        body: '<p>We don’t want anything important to slip through, so here’s one last reminder.</p>' +
          renderQuote('Hi Marcus — just checking in on the statement whenever you get a moment.') +
          '<p>If now isn’t a good time, the message will be waiting whenever you’re ready.</p>',
        button: 'Open the conversation',
      },
    }),
    makeStandardTemplate({
      id: 'signature-request', name: 'Signature request', category: 'Signatures',
      subject: 'Please sign: Engagement Letter 2025', preview: 'Tanya asked you to sign a document.',
      spec: {
        title: 'Tanya asked you to sign a document',
        lead: 'You can review and sign online — no account needed.',
        body: renderFileLines([['Engagement-Letter-2025.pdf', 'PDF · 240 KB']]) +
          renderQuote('Please review and sign at your earliest convenience. — Tanya') +
          '<p>This link is personal to you and expires on 10 Aug 2026.</p>',
        button: 'Review & sign',
      },
    }),
    makeStandardTemplate({
      id: 'signature-reminder', name: 'Signature reminder', category: 'Signatures',
      subject: 'Reminder: your signature is needed', preview: 'A document is still waiting for your signature.',
      spec: {
        title: 'A quick reminder',
        lead: 'A document is still waiting for your signature.',
        body: renderFileLines([['Engagement-Letter-2025.pdf', 'PDF · 240 KB']]) +
          '<p>Sent by Tanya Antoine.</p>',
        button: 'Review & sign',
      },
    }),
    makeStandardTemplate({
      id: 'signature-completed', name: 'Document signed', category: 'Signatures',
      subject: 'Signed: Engagement Letter 2025', preview: 'Everyone has now signed the document.',
      spec: {
        title: 'Your document is signed',
        lead: 'Everyone has now signed Engagement-Letter-2025.pdf.',
        body: '<p>Signed by: Marcus Reid, Tanya Antoine.</p>' +
          renderFileLines([['Engagement-Letter-2025-signed.pdf', 'PDF · 262 KB · attached']]) +
          '<p>The signed copy is attached to this email for your records.</p>',
        button: 'View the signed document',
      },
    }),
    makeStandardTemplate({
      id: 'signature-declined', name: 'Signature declined', category: 'Signatures',
      subject: 'A signature was declined', preview: 'A signature request was declined.',
      spec: {
        title: 'A signature was declined',
        lead: 'Engagement-Letter-2025.pdf was declined by Marcus Reid. Nobody else can sign it now.',
        body: renderQuote('I need the payment terms revised before I can sign.'),
        button: 'Open Signatures',
      },
    }),
    makeStandardTemplate({
      id: 'signature-changes', name: 'Changes requested', category: 'Signatures',
      subject: 'Changes were requested on your document', preview: 'A reviewer asked for changes before approving.',
      spec: {
        title: 'Changes were requested',
        lead: 'Engagement-Letter-2025.pdf was reviewed by Marcus Reid, who asked for changes before approving.',
        body: renderQuote('Please update section 3 and resend.') +
          '<p>The request is on hold until you revise and resend it.</p>',
        button: 'Open Signatures',
      },
    }),
    makeStandardTemplate({
      id: 'calendar-invitation', name: 'Event invitation', category: 'Calendar',
      subject: 'Invitation: Quarterly Review', preview: 'Tanya invited you to Quarterly Review.',
      spec: {
        title: 'Tanya invited you to Quarterly Review',
        lead: 'Here are the details.',
        body: renderDetailLines([
          ['When', 'Wed, 6 Aug 2026 · 2:00–3:00 PM'],
          ['Where', 'Boardroom · Google Meet'],
          ['Organizer', 'Tanya Antoine'],
        ]) + '<p>You can accept, mark yourself tentative, or decline from the event.</p>',
        button: 'Open in the portal',
      },
    }),
    makeStandardTemplate({
      id: 'calendar-updated', name: 'Event updated', category: 'Calendar',
      subject: 'Updated: Quarterly Review', preview: 'The details for Quarterly Review changed.',
      spec: {
        title: 'Quarterly Review has changed',
        lead: 'Tanya updated this event. Here are the current details.',
        body: '<p><strong>What changed:</strong> new time, new location.</p>' +
          renderDetailLines([
            ['When', 'Thu, 7 Aug 2026 · 10:00–11:00 AM'],
            ['Where', 'Conference Room B'],
            ['Organizer', 'Tanya Antoine'],
          ]),
        button: 'Open in the portal',
      },
    }),
    makeStandardTemplate({
      id: 'calendar-cancelled', name: 'Event cancelled', category: 'Calendar',
      subject: 'Cancelled: Quarterly Review', preview: 'Quarterly Review was cancelled.',
      spec: {
        title: 'Quarterly Review was cancelled',
        lead: 'Tanya cancelled this event. You don’t need to do anything — it has been taken off your calendar.',
        body: renderDetailLines([
          ['When', 'Wed, 6 Aug 2026 · 2:00–3:00 PM'],
          ['Organizer', 'Tanya Antoine'],
        ]),
        button: 'Open your calendar',
      },
    }),
    makeStandardTemplate({
      id: 'calendar-response', name: 'Invitation response', category: 'Calendar',
      subject: 'Marcus Reid accepted Quarterly Review', preview: 'An attendee responded to your invitation.',
      spec: {
        title: 'Marcus Reid accepted',
        lead: 'Marcus Reid accepted your invitation to Quarterly Review.',
        body: renderDetailLines([
          ['When', 'Wed, 6 Aug 2026 · 2:00–3:00 PM'],
          ['Organizer', 'You'],
        ]),
        button: 'See all responses',
      },
    }),
    makeStandardTemplate({
      id: 'team-added', name: 'Added to a team', category: 'Teams',
      subject: 'You were added to the Advisory Team', preview: 'Tanya added you to a team in the portal.',
      spec: {
        title: 'You were added to the Advisory Team',
        lead: 'Tanya added you to a team in the portal.',
        body: '<p>You can now see the team’s shared files, calendar and conversations, and reach everyone on it in one place.</p>',
        button: 'Open the team',
      },
    }),
  ].forEach(function (t) { TEMPLATES.push(t); });

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
          // Emails are one responsive design — there is no separate mobile
          // layout; "mobile" is just the same email at a narrower width.
          hasMobile: false,
        };
      });
    },
    get: function (id) {
      return findTemplate(id);
    },
    // viewport is accepted for backwards compatibility but ignored: the email
    // is a single responsive design, so mobile === desktop content.
    renderBody: function (id) {
      return findTemplate(id).render();
    },
    hasMobile: function () {
      return false;
    },
  };
})();
