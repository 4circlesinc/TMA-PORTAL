'use strict';

const { isComposePopoutUrl, windowOptions } = require('./compose-window');

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
check('it keeps a native frame so this is an app window, not a browser tab',
  opts.frame === true && opts.titleBarStyle === 'default');
check('and it loads the same isolated preload as the main window',
  opts.webPreferences.preload === '/tmp/preload.js'
  && opts.webPreferences.contextIsolation === true
  && opts.webPreferences.nodeIntegration === false);

console.log(failures ? `\nFAILED — ${failures} check(s)` : '\nOK');
process.exit(failures ? 1 : 0);
