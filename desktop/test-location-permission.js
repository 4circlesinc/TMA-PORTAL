'use strict';

const fs = require('node:fs');
const path = require('node:path');

let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

const root = __dirname;
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const entitlements = fs.readFileSync(path.join(root, 'entitlements.mac.plist'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

const allowed = main.match(/const allowed = \[([^\]]+)\]/);
check('permission allow-list is declared', !!allowed, true);
check(
  'geolocation is allowed in the desktop shell',
  !!(allowed && allowed[1].includes("'geolocation'")),
  true,
);

check(
  'macOS location usage description is in Info.plist extras',
  typeof pkg.build.mac.extendInfo.NSLocationWhenInUseUsageDescription === 'string'
    && pkg.build.mac.extendInfo.NSLocationWhenInUseUsageDescription.length > 0,
  true,
);
check(
  'hardened-runtime location entitlement is present',
  entitlements.includes('com.apple.security.personal-information.location'),
  true,
);
check(
  'preload can open Location settings',
  preload.includes('openLocationSettings'),
  true,
);

if (failures) process.exit(1);
console.log('\nAll location-permission checks passed.');
