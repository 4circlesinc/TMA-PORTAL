'use strict';

const { isComposePopoutUrl, windowOptions } = require('./compose-window');
const mailWindow = require('./mail-window');

let failures = 0;

function check(label, ok) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

const origin = 'https://portal.example.com';

check('the compose pop-out URL is recognised',
  isComposePopoutUrl('https://portal.example.com/email/compose', origin) === true);
check('and a trailing slash still counts',
  isComposePopoutUrl('https://portal.example.com/email/compose/', origin) === true);
check('a draft query does not change that',
  isComposePopoutUrl('https://portal.example.com/email/compose?draft=compose-1', origin) === true);
check('nor does a reply from the conversation window',
  isComposePopoutUrl('https://portal.example.com/email/compose?message=abc&mode=reply', origin) === true);
check('the mailbox itself is not a pop-out',
  isComposePopoutUrl('https://portal.example.com/email', origin) === false);
check('nor is a conversation window',
  isComposePopoutUrl('https://portal.example.com/portal/mail/window/abc', origin) === false);
check('and another origin is refused even on the same path',
  isComposePopoutUrl('https://evil.example/email/compose', origin) === false);
check('junk input is not one',
  isComposePopoutUrl('not a url', origin) === false);

const opts = windowOptions('/tmp/preload.js');
check('the window is sized like a composer, not the main app',
  opts.width === 760 && opts.height === 820);
check('it hides the native bar so the brand title bar can be drawn',
  opts.frame === true && opts.titleBarStyle === 'hidden');
check('and it loads the same isolated preload as the main window',
  opts.webPreferences.preload === '/tmp/preload.js'
  && opts.webPreferences.contextIsolation === true
  && opts.webPreferences.nodeIntegration === false);

check('a conversation window URL is recognised',
  mailWindow.isMailWindowUrl('https://portal.example.com/portal/mail/window/abc-uuid', origin) === true);
check('and a mail window trailing slash still counts',
  mailWindow.isMailWindowUrl('https://portal.example.com/portal/mail/window/abc-uuid/', origin) === true);
check('a print query does not change that',
  mailWindow.isMailWindowUrl('https://portal.example.com/portal/mail/window/abc-uuid?print=1', origin) === true);
check('the mailbox itself is not a conversation window',
  mailWindow.isMailWindowUrl('https://portal.example.com/email', origin) === false);
check('nor is compose',
  mailWindow.isMailWindowUrl('https://portal.example.com/email/compose', origin) === false);
check('nor a mail window path with no id',
  mailWindow.isMailWindowUrl('https://portal.example.com/portal/mail/window', origin) === false);
check('and a mail window from another origin is refused',
  mailWindow.isMailWindowUrl('https://evil.example/portal/mail/window/abc', origin) === false);

const mailOpts = mailWindow.windowOptions('/tmp/preload.js');
check('the conversation window is sized like the mailbox asks for',
  mailOpts.width === 1000 && mailOpts.height === 880);
check('it also hides the native bar for the brand title bar',
  mailOpts.frame === true && mailOpts.titleBarStyle === 'hidden');
check('and the conversation window loads the same isolated preload',
  mailOpts.webPreferences.preload === '/tmp/preload.js'
  && mailOpts.webPreferences.contextIsolation === true
  && mailOpts.webPreferences.nodeIntegration === false);

console.log(failures ? `\nFAILED — ${failures} check(s)` : '\nOK');
process.exit(failures ? 1 : 0);
