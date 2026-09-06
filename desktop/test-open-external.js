'use strict';

const { safeExternalUrl } = require('./open-external');

let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

check('https is allowed', !!safeExternalUrl('https://portal.tmantoinelaw.com/citizenship-applications/abc'), true);
check('http is allowed', !!safeExternalUrl('http://127.0.0.1:8001/x'), true);
check('mailto is allowed', safeExternalUrl('mailto:a@b.com'), 'mailto:a@b.com');
check('javascript is blocked', safeExternalUrl('javascript:alert(1)'), null);
check('file is blocked', safeExternalUrl('file:///etc/passwd'), null);
check('data is blocked', safeExternalUrl('data:text/html,hi'), null);
check('empty is blocked', safeExternalUrl(''), null);

if (failures) {
  process.exit(1);
}
console.log('\nAll open-external checks passed.');
